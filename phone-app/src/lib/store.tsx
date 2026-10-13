// Fleet + thread state, fed by GET /api/bots hydration and the SSE stream.
// One provider per session; screens subscribe through hooks.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { Client, UnpairedError } from "./client";
import { openEvents, type EventsHandle } from "./events";
import { clearSession, loadSession, saveSession } from "./session";
import type {
  FleetResponse,
  OptionCardData,
  ThreadPage,
  WireBot,
  WireGroup,
  WireMessage,
} from "./types";

const PAGE = 50;

interface ThreadState {
  messages: WireMessage[];
  hasMore: boolean;
  loaded: boolean;
}

interface FleetState {
  status: "loading" | "paired" | "unpaired" | "offline";
  serverName: string;
  bots: WireBot[];
  groups: WireGroup[];
  connected: boolean;
  threads: Record<string, ThreadState>;
}

interface FleetActions {
  connect(): Promise<void>;
  refresh(): Promise<void>;
  openThread(threadId: string): Promise<void>;
  loadOlder(threadId: string): Promise<void>;
  sendText(threadId: string, text: string): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  markRead(threadId: string): Promise<void>;
  answerCard(threadId: string, card: OptionCardData, option: string): Promise<void>;
  dismissCard(threadId: string, card: OptionCardData): Promise<void>;
  unpair(): Promise<void>;
}

const FleetContext = createContext<(FleetState & FleetActions) | null>(null);

/** The card→response rule from the desktop (src/lib/card-answer.ts): a
 * permission card names its tool and answers allow/deny; a question answers
 * with the chosen text, and is dismissed, never denied. */
function cardResponse(card: OptionCardData, option: string) {
  if (card.tool) return { behavior: option === "Deny" ? "deny" : "allow" };
  return { behavior: "answer", message: option };
}

function upsertMessage(list: WireMessage[], message: WireMessage): WireMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => a.at - b.at);
  const next = [...list];
  next[index] = { ...next[index], ...message };
  return next;
}

export function FleetProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FleetState>({
    status: "loading",
    serverName: "",
    bots: [],
    groups: [],
    connected: false,
    threads: {},
  });
  const clientRef = useRef<Client | null>(null);
  const eventsRef = useRef<EventsHandle | null>(null);
  const threadsRef = useRef(state.threads);
  useEffect(() => {
    threadsRef.current = state.threads;
  }, [state.threads]);

  const patchThread = useCallback((threadId: string, patch: Partial<ThreadState>) => {
    setState((s) => {
      const existing = s.threads[threadId] ?? { messages: [], hasMore: false, loaded: false };
      return { ...s, threads: { ...s.threads, [threadId]: { ...existing, ...patch } } };
    });
  }, []);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const fleet = await client.api<FleetResponse>("/api/bots?messages=30");
    setState((s) => ({
      ...s,
      status: "paired",
      serverName: client.session.serverName,
      bots: fleet.bots ?? [],
      groups: fleet.groups ?? [],
      // Seed open threads' tails from the fleet preview; full pages still
      // come from the thread route when a screen asks.
      threads: Object.fromEntries(
        Object.entries(s.threads).map(([id, t]) => {
          const host = [...(fleet.bots ?? []), ...(fleet.groups ?? [])].find((x) => x.threadId === id);
          if (!t.loaded || !host?.messages) return [id, t];
          let messages = t.messages;
          for (const m of host.messages) messages = upsertMessage(messages, m);
          return [id, { ...t, messages }];
        }),
      ),
    }));
  }, []);

  const connect = useCallback(async () => {
    const session = await loadSession();
    if (!session) {
      setState((s) => ({ ...s, status: "unpaired" }));
      return;
    }
    const client = new Client(session, (next) => void saveSession(next));
    clientRef.current = client;
    try {
      await refresh();
      void client.refreshEndpoints();
    } catch (error) {
      if (error instanceof UnpairedError) {
        await clearSession();
        clientRef.current = null;
        setState((s) => ({ ...s, status: "unpaired" }));
        return;
      }
      setState((s) => ({ ...s, status: "offline", serverName: session.serverName }));
    }

    eventsRef.current?.close();
    eventsRef.current = openEvents(client, {
      onStatus: (connected) => setState((s) => ({ ...s, connected })),
      onGap: () => void refresh(),
      onFrame: (frame) => {
        if (frame.kind === "unauthorized") {
          void clearSession();
          setState((s) => ({ ...s, status: "unpaired" }));
          return;
        }
        if (frame.kind === "message" && "message" in frame && "threadId" in frame) {
          const { threadId, message } = frame as { threadId: string; message: WireMessage };
          if (threadsRef.current[threadId]?.loaded) {
            patchThread(threadId, { messages: upsertMessage(threadsRef.current[threadId].messages, message) });
          }
          setState((s) => ({
            ...s,
            bots: s.bots.map((b) =>
              b.threadId === threadId ? { ...b, unread: message.role === "bot" ? true : b.unread, messages: undefined } : b,
            ),
            groups: s.groups.map((g) =>
              g.threadId === threadId ? { ...g, unread: message.role === "bot" ? true : g.unread } : g,
            ),
          }));
          return;
        }
        if (frame.kind === "bot" && "bot" in frame) {
          const bot = (frame as { bot: WireBot }).bot;
          setState((s) => ({
            ...s,
            bots: s.bots.some((b) => b.id === bot.id) ? s.bots.map((b) => (b.id === bot.id ? { ...b, ...bot } : b)) : [...s.bots, bot],
          }));
          return;
        }
        if (frame.kind === "group" && "group" in frame) {
          const group = (frame as { group: WireGroup }).group;
          setState((s) => ({
            ...s,
            groups: s.groups.some((g) => g.id === group.id) ? s.groups.map((g) => (g.id === group.id ? { ...g, ...group } : g)) : [...s.groups, group],
          }));
          return;
        }
        // Unknown frame kinds still matter — refresh cheaply (debounced by
        // the caller's own cadence) rather than drift.
      },
    });
  }, [patchThread, refresh]);

  useEffect(() => {
    const boot = setTimeout(() => void connect(), 0);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void connect();
    });
    return () => {
      clearTimeout(boot);
      sub.remove();
      eventsRef.current?.close();
    };
  }, [connect]);

  const openThread = useCallback(
    async (threadId: string) => {
      const client = clientRef.current;
      if (!client) return;
      const page = await client.api<ThreadPage>(`/api/threads/${threadId}/messages?limit=${PAGE}`);
      patchThread(threadId, { messages: page.messages ?? [], hasMore: page.hasMore, loaded: true });
    },
    [patchThread],
  );

  const loadOlder = useCallback(
    async (threadId: string) => {
      const client = clientRef.current;
      const current = threadsRef.current[threadId];
      if (!client || !current?.messages.length || !current.hasMore) return;
      const before = current.messages[0].id;
      const page = await client.api<ThreadPage>(
        `/api/threads/${threadId}/messages?limit=${PAGE}&before=${encodeURIComponent(before)}`,
      );
      patchThread(threadId, {
        messages: [...(page.messages ?? []), ...current.messages],
        hasMore: page.hasMore,
      });
    },
    [patchThread],
  );

  const ownerFor = useCallback(
    (threadId: string): { kind: "bot" | "group"; id: string } | null => {
      const bot = state.bots.find((b) => b.threadId === threadId || b.tasks?.some((t) => t.threadId === threadId));
      if (bot) return { kind: "bot", id: bot.id };
      const group = state.groups.find((g) => g.threadId === threadId || g.tasks?.some((t) => t.threadId === threadId));
      if (group) return { kind: "group", id: group.id };
      return null;
    },
    [state.bots, state.groups],
  );

  const sendText = useCallback(
    async (threadId: string, text: string) => {
      const client = clientRef.current;
      const owner = ownerFor(threadId);
      if (!client || !owner) return;
      const optimistic: WireMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        kind: "text",
        text,
        at: Date.now(),
      };
      patchThread(threadId, { messages: upsertMessage(threadsRef.current[threadId]?.messages ?? [], optimistic) });
      const path = owner.kind === "bot" ? `/api/bots/${owner.id}/messages` : `/api/groups/${owner.id}/messages`;
      await client.api(path, {
        method: "POST",
        body: JSON.stringify({ text, threadId, sendId: optimistic.id }),
      });
    },
    [ownerFor, patchThread],
  );

  const interrupt = useCallback(
    async (threadId: string) => {
      const client = clientRef.current;
      const owner = ownerFor(threadId);
      if (!client || !owner) return;
      const path = owner.kind === "bot" ? `/api/bots/${owner.id}/interrupt` : `/api/groups/${owner.id}/interrupt`;
      await client.api(path, { method: "POST", body: JSON.stringify({ threadId }) });
    },
    [ownerFor],
  );

  const markRead = useCallback(
    async (threadId: string) => {
      const client = clientRef.current;
      const owner = ownerFor(threadId);
      if (!client || !owner) return;
      const path = owner.kind === "bot" ? `/api/bots/${owner.id}/read` : `/api/groups/${owner.id}/read`;
      setState((s) => ({
        ...s,
        bots: s.bots.map((b) => (b.id === owner.id ? { ...b, unread: false } : b)),
        groups: s.groups.map((g) => (g.id === owner.id ? { ...g, unread: false } : g)),
      }));
      await client.api(path, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
    },
    [ownerFor],
  );

  const answerCard = useCallback(
    async (threadId: string, card: OptionCardData, option: string) => {
      const client = clientRef.current;
      if (!client) return;
      if (card.requestId) {
        await client.api(`/api/threads/${threadId}/respond`, {
          method: "POST",
          body: JSON.stringify({ requestId: card.requestId, ...cardResponse(card, option) }),
        });
        return;
      }
      // Passive card: the click is just a reply in the conversation.
      await sendText(threadId, option);
    },
    [sendText],
  );

  const dismissCard = useCallback(
    async (threadId: string, card: OptionCardData) => {
      const client = clientRef.current;
      if (!client?.session || !card.requestId) return;
      const body = card.tool
        ? { requestId: card.requestId, behavior: "deny", message: "Dismissed by user." }
        : { requestId: card.requestId, behavior: "answer", message: "(dismissed)", dismiss: true };
      await client.api(`/api/threads/${threadId}/respond`, { method: "POST", body: JSON.stringify(body) });
    },
    [],
  );

  const unpair = useCallback(async () => {
    eventsRef.current?.close();
    clientRef.current = null;
    await clearSession();
    setState({ status: "unpaired", serverName: "", bots: [], groups: [], connected: false, threads: {} });
  }, []);

  const value = useMemo<FleetState & FleetActions>(
    () => ({
      ...state,
      connect,
      refresh,
      openThread,
      loadOlder,
      sendText,
      interrupt,
      markRead,
      answerCard,
      dismissCard,
      unpair,
    }),
    [state, connect, refresh, openThread, loadOlder, sendText, interrupt, markRead, answerCard, dismissCard, unpair],
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetState & FleetActions {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet outside FleetProvider");
  return ctx;
}
