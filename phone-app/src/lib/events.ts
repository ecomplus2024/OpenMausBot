// Server-sent events over streaming fetch. The harness numbers every
// frame (`id: <streamId>:<seq>`); we remember the cursor and pass it back as
// `?since=` on reconnect so missed frames replay instead of forcing a full
// re-download. `screens=off` because this app never renders screen frames.
//
// On native, the global fetch IS expo/fetch (SDK 52+ installs it as global),
// so response.body.getReader() streams on device — and stays plain-fetch
// testable under Node.
import type { Client } from "./client";
import type { SseFrame } from "./types";

export interface EventsHandle {
  close(): void;
}

export interface EventsCallbacks {
  /** hello.resumed === false means the gap replay was impossible — hydrate. */
  onGap?: () => void;
  onFrame: (frame: SseFrame) => void;
  onStatus?: (connected: boolean) => void;
}

const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

export function openEvents(client: Client, callbacks: EventsCallbacks): EventsHandle {
  let closed = false;
  let cursor: string | null = null;
  let retry = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (closed) return;
    const delay = RETRY_MS[Math.min(retry, RETRY_MS.length - 1)];
    retry += 1;
    timer = setTimeout(() => void connect(), delay);
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const since = cursor ? `&since=${encodeURIComponent(cursor)}` : "";
      const res = await fetch(`${client.baseUrl}/api/events?screens=off${since}`, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${client.session.token}`,
        },
        signal: controller.signal,
      });
      if (res.status === 401) {
        closed = true;
        callbacks.onFrame({ kind: "unauthorized" });
        return;
      }
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      retry = 0;
      callbacks.onStatus?.(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let id: string | null = null;
          for (const line of raw.split("\n")) {
            if (line.startsWith("id:")) id = line.slice(3).trim();
            if (!line.startsWith("data:")) continue;
            try {
              const frame = JSON.parse(line.slice(5).trim()) as SseFrame;
              if (frame.kind === "hello") {
                const hello = frame as { resumed?: boolean; cursor?: string };
                if (hello.resumed === false) callbacks.onGap?.();
                if (hello.cursor) cursor = hello.cursor;
              }
              if (frame.kind !== "ping") {
                callbacks.onFrame(frame);
              }
            } catch {
              /* comment or heartbeat — not JSON */
            }
          }
          if (id) cursor = id;
        }
      }
      throw new Error("stream ended");
    } catch {
      if (closed) return;
      callbacks.onStatus?.(false);
      // A dead route can sit in `active` (e.g. a LAN endpoint that went away).
      // ping walks every endpoint and re-points `active` at the first that
      // answers, so the next reconnect doesn't retry the same dead URL.
      void client.ping().catch(() => {});
      schedule();
    }
  };

  void connect();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    },
  };
}
