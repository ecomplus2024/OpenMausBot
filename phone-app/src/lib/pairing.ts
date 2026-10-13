// Reader side of the `openmausbot://pair` link the desktop/server prints as a
// QR. Mirrors shared/pairing-link.ts in the OpenMausBot repository — keep the
// accepted fields in sync with that file.
import { base64UrlDecodeJson } from "./base64";
import type { CompanionEndpoint, PairingInvite } from "./types";

const ENDPOINT_KINDS = new Set(["hosted", "tailnet", "lan", "bonjour"]);
const TOKEN_RE = /^omb_pair_[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^\d{6}$/;

/** `+` is a space too — desktop builds before Oct 2026 wrote it that way. */
function params(raw: string): Map<string, string> {
  const query = raw.slice(raw.indexOf("?") + 1);
  const out = new Map<string, string>();
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1).replaceAll("+", " ");
    try {
      out.set(key, decodeURIComponent(value));
    } catch {
      out.set(key, value);
    }
  }
  return out;
}

function decodeEndpoints(raw: string | undefined): CompanionEndpoint[] {
  if (!raw) return [];
  try {
    const list = base64UrlDecodeJson<unknown>(raw);
    if (!Array.isArray(list)) return [];
    const out: CompanionEndpoint[] = [];
    for (const entry of list) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { url?: unknown }).url === "string" &&
        ENDPOINT_KINDS.has(String((entry as { kind?: unknown }).kind)) &&
        Number.isInteger((entry as { priority?: unknown }).priority)
      ) {
        const e = entry as { url: string; kind: CompanionEndpoint["kind"]; priority: number };
        out.push({ url: e.url, kind: e.kind, priority: e.priority });
      }
    }
    return out.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

/** Rebuild the base URL for a bare `host:port` address (LAN/Tailscale). */
function endpointFromAddress(address: string): CompanionEndpoint | null {
  const value = address.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return { url: parsed.origin, kind: "hosted", priority: 0 };
    } catch {
      return null;
    }
  }
  return { url: `http://${value}`, kind: "lan", priority: 200 };
}

/** Parse a scanned QR payload. Returns null when the link is not a pairing
 * invite or is malformed — the caller shows "not an OpenMausBot code". */
export function parsePairingLink(raw: string): PairingInvite | null {
  const text = raw.trim();
  if (!/^openmausbot:\/\/pair\?/i.test(text)) return null;
  const p = params(text);

  const token = p.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return null;

  const code = p.get("code");
  const invite: PairingInvite = {
    address: "",
    token,
    code: code && CODE_RE.test(code) ? code : undefined,
    name: p.get("name")?.trim() || undefined,
    endpoints: decodeEndpoints(p.get("endpoints")),
  };

  const address = p.get("address") ?? "";
  const lead = endpointFromAddress(address);
  if (lead && !invite.endpoints.some((e) => e.url === lead.url)) {
    invite.endpoints.push(lead);
    invite.endpoints.sort((a, b) => a.priority - b.priority);
  }
  // `hosts` are bare hostnames a very old QR may carry instead of endpoints.
  const hosts = (p.get("hosts") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  for (const host of hosts) {
    const guess = `http://${host}:8810`;
    if (!invite.endpoints.some((e) => e.url === guess)) {
      invite.endpoints.push({ url: guess, kind: "lan", priority: 250 });
    }
  }

  invite.address = lead?.url ?? invite.endpoints[0]?.url ?? "";
  return invite.endpoints.length ? invite : null;
}
