// HTTP client for the companion sidecar. One bearer token, several base URLs:
// the QR hands over every route the phone could reach (hosted HTTPS first,
// then Tailscale, LAN, Bonjour) and calls walk to the next one when the
// active route stops answering.
import type { CompanionEndpoint, EndpointsSnapshot, PairingInvite, PairResponse, Session } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** 401 means the device lost its pairing — no other endpoint can help. */
export class UnpairedError extends ApiError {}

const REQUEST_TIMEOUT_MS = 15_000;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not json */
  }
  return `request failed (${res.status})`;
}

/** Redeem the QR credential (or manual code) against one endpoint. Exported
 * for the pairing screen — returns null on a network miss so the caller can
 * walk to the next candidate. Throws on a real refusal. */
export async function redeemPairing(
  endpoint: CompanionEndpoint,
  invite: Pick<PairingInvite, "token" | "code">,
  deviceName: string,
  pairRequestId: string,
): Promise<PairResponse | null> {
  let res: Response;
  try {
    res = await fetch(`${endpoint.url}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // `credential` wins server-side over `code`, so send it only when it
        // is the real QR token; manual pairing redeems the six-digit code.
        credential: invite.token.startsWith("omb_pair_") ? invite.token : undefined,
        code: invite.code,
        deviceName,
        pairRequestId,
      }),
      signal: timeoutSignal(10_000),
    });
  } catch {
    return null; // unreachable — try the next endpoint
  }
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return (await res.json()) as PairResponse;
}

export class Client {
  /** Index into session.endpoints: where the last successful call went. */
  private active = 0;
  session: Session;
  private onSessionChange?: (session: Session) => void;

  constructor(session: Session, onSessionChange?: (session: Session) => void) {
    this.session = session;
    this.onSessionChange = onSessionChange;
  }

  get baseUrl(): string {
    return this.session.endpoints[this.active]?.url ?? "";
  }

  private setEndpoints(endpoints: CompanionEndpoint[]) {
    const next = endpoints
      .filter((e) => e && typeof e.url === "string")
      .sort((a, b) => a.priority - b.priority);
    if (!next.length) return;
    this.session = { ...this.session, endpoints: next };
    this.active = Math.min(this.active, next.length - 1);
    this.onSessionChange?.(this.session);
  }

  private async attempt<T>(base: string, path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.session.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) throw new UnpairedError(await errorMessage(res), 401);
    if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** One API call: try the active base URL, then walk the rest on network
   * failures only — an HTTP refusal is the server's answer, not a bad route. */
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const order = this.session.endpoints.map((_, i) => (this.active + i) % this.session.endpoints.length);
    let lastError: unknown = new ApiError("no endpoints", 0);
    for (const index of order) {
      try {
        const result = await this.attempt<T>(this.session.endpoints[index].url, path, init);
        if (index !== this.active) {
          this.active = index;
          this.onSessionChange?.(this.session);
        }
        return result;
      } catch (error) {
        if (error instanceof ApiError) throw error; // server answered — stop walking
        lastError = error;
      }
    }
    throw lastError;
  }

  /** Learn a new hosted route (or its withdrawal) without pairing again. */
  async refreshEndpoints(): Promise<void> {
    try {
      const snapshot = await this.api<EndpointsSnapshot>("/api/companion/endpoints");
      if (snapshot.endpoints?.length) this.setEndpoints(snapshot.endpoints);
    } catch {
      /* best effort — keep the list we have */
    }
  }

  /** Liveness + picking a working base after launch. */
  async ping(): Promise<boolean> {
    try {
      await this.api<{ ok?: boolean }>("/api/health");
      return true;
    } catch (error) {
      if (error instanceof UnpairedError) throw error;
      return false;
    }
  }
}
