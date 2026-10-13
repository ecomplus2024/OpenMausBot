/** Wire types for the OpenMausBot companion API.
 *  Shapes mirror shared/wire.ts and shared/pairing-link.ts in the server repo. */

export type CompanionEndpointKind = "hosted" | "tailnet" | "lan" | "bonjour";

export interface CompanionEndpoint {
  url: string;
  kind: CompanionEndpointKind;
  priority: number;
}

export interface PairingInvite {
  /** `host:port` or a bare http(s) origin — the first thing to dial. */
  address: string;
  /** The `omb_pair_…` one-time credential carried by the QR. */
  token: string;
  /** Six-digit manual code, kept for older flows. */
  code?: string;
  /** Computer name shown to the user for confirmation. */
  name?: string;
  /** Ordered fallback base URLs, best first. */
  endpoints: CompanionEndpoint[];
}

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  cloudDesktopAccess?: boolean;
  browserControlAccess?: boolean;
}

export interface PairResponse {
  device: PairedDevice;
  token: string;
  serverName: string;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
}

/** A live session: the bearer plus every base URL that can reach the host. */
export interface Session {
  token: string;
  deviceId: string;
  deviceName: string;
  serverName: string;
  endpoints: CompanionEndpoint[];
}

export interface OptionCardData {
  title: string;
  subtitle?: string;
  options: string[];
  requestType?: "permission" | "question";
  answered?: string;
  answeredText?: string;
  dismissed?: boolean;
  expired?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  allowSession?: boolean;
}

export interface WireMessage {
  id: string;
  role: "bot" | "user";
  kind:
    | "text"
    | "options"
    | "activity"
    | "screen"
    | "connector"
    | "secret"
    | "signin"
    | "routine.run"
    | "goal.run"
    | "digest"
    | "compaction"
    | "call";
  text?: string;
  card?: OptionCardData;
  tool?: { name: string; ok?: boolean; spoken?: string; summary?: string };
  digest?: { reply?: string; durationMs?: number };
  at: number;
  parentId?: string | null;
  from?: { botId: string; name: string; color: string };
  turnId?: string;
  turnSucceeded?: boolean;
  turnTerminal?: boolean;
  sendId?: string;
  queued?: boolean;
}

export interface WireTask {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  unread?: boolean;
  activity?: string;
  busy?: boolean;
  working?: boolean;
}

export interface WireBot {
  id: string;
  threadId: string;
  name: string;
  title?: string;
  description?: string;
  color?: string;
  unread?: boolean;
  activity?: string;
  busy?: boolean;
  avatarUrl?: string | null;
  /** "mascot" = no picture crop (desktop draws the mascot); the others
   * crop avatarUrl — circle 50%, rounded 22%, square 0. */
  avatarCrop?: "mascot" | "circle" | "rounded" | "square";
  avatarZoom?: number;
  avatarFocusX?: number;
  avatarFocusY?: number;
  tasks?: WireTask[];
  messages?: WireMessage[];
  hasMore?: boolean;
}

export interface WireGroup {
  id: string;
  threadId: string;
  name: string;
  memberIds: string[];
  unread?: boolean;
  working?: boolean;
  busyBotId?: string | null;
  tasks?: WireTask[];
  messages?: WireMessage[];
  hasMore?: boolean;
}

export interface FleetResponse {
  bots: WireBot[];
  groups: WireGroup[];
  sections?: string[];
}

export interface ThreadPage {
  messages: WireMessage[];
  hasMore: boolean;
  activeLeafId?: string;
}

export interface EndpointsSnapshot {
  name?: string;
  hosts?: string[];
  endpoints?: CompanionEndpoint[];
}

export type SseFrame =
  | { kind: "hello"; cursor: string; resumed: boolean }
  | { kind: "ping" }
  | { kind: "bot"; bot: WireBot; seq?: number }
  | { kind: "group"; group: WireGroup; seq?: number }
  | { kind: "message"; threadId: string; message: WireMessage; seq?: number }
  | { kind: "botDeleted"; botId?: string; id?: string; seq?: number }
  | { kind: "groupDeleted"; groupId?: string; id?: string; seq?: number }
  | { kind: string; [key: string]: unknown };
