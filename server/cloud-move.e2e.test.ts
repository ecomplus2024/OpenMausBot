// Copy this computer here end to end (docs/copy-workspace.md): a desktop-like
// server and two plain self-hosted servers, each a real server process over
// HTTP, driven by the desktop's own orchestrator (electron/cloud-move.mjs),
// one code path for every destination. The test plays the desktop window's
// cookie on each destination (it mints the owner code), the edge (every
// request to a destination arrives forwarded, never as the loopback owner)
// and the launcher (it starts a server again when it exits with
// RESTART_EXIT_CODE to install a restore). Disposable homes; no network; a
// synthetic Claude CLI.
import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createCloudMove, mintOwnerCode } from "../electron/cloud-move.mjs";
import { RESTART_EXIT_CODE } from "./restart.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { stageWorkspaceBackup } from "./workspace-backup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
// A second self-hosted server the person added in the desktop app.
const SPARE_HOST = "spare.example.test";
const SPARE_ORIGIN = `https://${SPARE_HOST}`;
// A self-hosted server the person added in the desktop app (`openmausbot serve`).
const SERVER_HOST = "bots.example.test";
const SERVER_ORIGIN = `https://${SERVER_HOST}`;
const unique = (label: string) => `${label}-${randomBytes(12).toString("hex")}`;
// What the desktop holds that must never reach a destination.
const SOURCE_SECRETS = {
  anthropic: unique("sk-ant-source"), tts: unique("source-voice-key"), box: unique("box_source"),
  env: unique("source-driver-env"), credential: unique("source-workspace-credential"), provider: unique("source-provider-login"),
};
const SPARE_KEY = unique("sk-ant-spare");
const SERVER_KEY = unique("sk-ant-server");
// The servers never reach the network.
const OFFLINE = `data:text/javascript,${encodeURIComponent('globalThis.fetch = async () => new Response("offline fixture", { status: 503 });')}`;

interface Fixture { name: string; host: string; home: string; dataDir: string; base: string; env: NodeJS.ProcessEnv; child?: ChildProcess; log: string; closing: boolean; boots: number;
  /** A relaunch (exit 75) that failed: thrown by the next request to this server, or by teardown, with its cause. */
  failure?: Error }
let source: Fixture;
let spare: Fixture;
let server: Fixture;
let scratch: string;
// The desktop window's own session on each self-hosted server: the cookie its /pair page set.
let serverCookie: string;
let spareCookie: string;
let movedRoutine = "";
// The desktop's bots: its first-run starter bot and the one made below.
let desktopBots: string[];

async function boot(fixture: Fixture): Promise<void> {
  const child = spawn(process.execPath, ["--import", OFFLINE, join(SERVER_DIR, "index.ts")], { cwd: join(SERVER_DIR, ".."), env: fixture.env, stdio: ["ignore", "pipe", "pipe"] });
  fixture.child = child;
  fixture.boots++;
  child.stdout?.on("data", (chunk) => { fixture.log += chunk; });
  child.stderr?.on("data", (chunk) => { fixture.log += chunk; });
  // The server's launcher: start it again when it asks to (server/restart.ts).
  // A relaunch is nobody's await, so its failure is kept for the next request (api) or teardown to throw,
  // never left as an unhandled rejection.
  child.once("exit", (code) => { if (code === RESTART_EXIT_CODE && !fixture.closing && fixture.child === child) boot(fixture).catch((error: Error) => { fixture.failure = error; }); });
  const deadline = Date.now() + 30_000;
  for (;;) {
    // Stopped on purpose (a test or teardown) or already replaced: nothing to report.
    if (fixture.closing || fixture.child !== child) return;
    if (child.exitCode !== null) throw new Error(`the ${fixture.name} server exited:\n${fixture.log}`);
    try {
      const health = await (await fetch(`${fixture.base}/api/health`)).json() as { pid?: number };
      if (health.pid === child.pid) return;
    } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error(`the ${fixture.name} server did not start:\n${fixture.log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function launch(name: "desktop" | "spare" | "server"): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), `omb-move-${name}-`));
  const dataDir = join(home, ".openmausbot");
  mkdirSync(dataDir, { recursive: true });
  const cli = join(home, "fixture-claude.mjs");
  writeFileSync(cli, `#!/usr/bin/env node
if (process.argv[2] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, email: "person@example.test" }));
  process.exit(0);
}
await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, "testing", "fake-claude-cli.ts")).href)});
`, { mode: 0o755 });
  const instances: Record<string, unknown> = {
    ...Object.fromEntries(["codex", "cursor", "openaiCompat", "qwen", "hermes", "pi"].map((id) => [id, { driver: "not-a-real-driver" }])),
    claude: { driver: "claudeAgent", displayName: "Claude", config: { cli }, ...(name === "desktop" ? { environment: { FIXTURE_TOKEN: SOURCE_SECRETS.env } } : {}) },
  };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(name === "desktop"
    ? { instances, anthropic: { key: SOURCE_SECRETS.anthropic }, tts: { key: SOURCE_SECRETS.tts }, box: { token: SOURCE_SECRETS.box }, features: { sharedComputers: true } }
    : { instances, anthropic: { key: name === "spare" ? SPARE_KEY : SERVER_KEY } }));
  if (name === "desktop") {
    writeFileSync(join(dataDir, "workspace-credentials.json"), JSON.stringify({ fixture: SOURCE_SECRETS.credential }), { mode: 0o600 });
    mkdirSync(join(dataDir, "providers", "fixture"), { recursive: true });
    writeFileSync(join(dataDir, "providers", "fixture", ".credentials.json"), JSON.stringify({ token: SOURCE_SECRETS.provider }), { mode: 0o600 });
  }
  const port = await freePortBlock([0, 1]);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home, USERPROFILE: home, OMB_DATA_DIR: dataDir, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
    ...(name === "server" ? { OMB_PUBLIC_URL: SERVER_ORIGIN } : name === "spare" ? { OMB_PUBLIC_URL: SPARE_ORIGIN } : {}),
  };
  const fixture: Fixture = { name, host: name === "server" ? SERVER_HOST : name === "spare" ? SPARE_HOST : "127.0.0.1", home, dataDir, base: `http://127.0.0.1:${port}`, env, log: "", closing: false, boots: 0 };
  await boot(fixture);
  return fixture;
}

/** What the edge adds to every request it forwards: never the owner. */
const edge = (fixture: Fixture) => ({ host: fixture.host, "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" });
/** A request as the edge forwards it, with the public Host kept (Node's fetch
 * always sends its own): what a cookie's same-origin check reads. */
function viaEdge(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers)) }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: response.statusCode,
        headers: Object.entries(response.headers).flatMap(([name, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((one) => [name, String(one)] as [string, string])) })));
      response.on("error", reject);
    });
    request.on("error", reject);
    const body = typeof init.body === "string" || Buffer.isBuffer(init.body) ? init.body : undefined;
    if (body !== undefined) request.setHeader("content-length", body.length);
    request.end(body);
  });
}
async function api(fixture: Fixture, method: string, path: string, options: { body?: unknown; token?: string; cookie?: string; remote?: boolean; raw?: Buffer } = {}) {
  if (fixture.failure) throw fixture.failure;
  const response = await (options.cookie ? viaEdge : fetch)(`${fixture.base}${path}`, {
    method,
    headers: {
      ...(options.remote || options.token || options.cookie ? edge(fixture) : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.cookie ? { cookie: options.cookie, origin: `https://${fixture.host}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.raw ? { "content-type": "application/octet-stream" } : {}),
    },
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

/** The network as the desktop sees it: each public origin reaches its server through the edge. */
const routed = (url: string): { fixture: Fixture; url: string } => {
  const fixture = url.startsWith(SERVER_ORIGIN) ? server : spare;
  return { fixture, url: url.replace(fixture === server ? SERVER_ORIGIN : SPARE_ORIGIN, fixture.base) };
};
/** The desktop window's own fetch on a self-hosted server: its cookie, from that origin. */
const windowFetchFor = (origin: string, cookie: () => string) => ((url: string, init: RequestInit = {}) => {
  const target = routed(String(url));
  const headers = new Headers(init.headers);
  expect(headers.get("origin")).toBe(origin);
  expect(init.credentials).toBe("include");
  return viaEdge(target.url, { ...init, headers: { ...Object.fromEntries(headers), ...edge(target.fixture), cookie: cookie() } });
}) as typeof fetch;
const windowFetch = windowFetchFor(SERVER_ORIGIN, () => serverCookie);
const spareFetch = windowFetchFor(SPARE_ORIGIN, () => spareCookie);
/** Where a copy goes, as main's destinationFor describes it. */
const spareHosted = { id: "spare", name: SPARE_HOST, origin: SPARE_ORIGIN, kind: "server" as const, grant: () => mintOwnerCode(spareFetch, SPARE_ORIGIN) };
const selfHosted = { id: "self", name: SERVER_HOST, origin: SERVER_ORIGIN, kind: "server" as const, grant: () => mintOwnerCode(windowFetch, SERVER_ORIGIN) };
function mover() {
  return createCloudMove({
    localRequest: (route, init) => fetch(`${source.base}${route}`, init),
    fetchImpl: ((url: string, init: RequestInit = {}) => {
      const target = routed(String(url));
      return fetch(target.url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...edge(target.fixture) } });
    }) as typeof fetch,
    tempRoot: join(scratch, "move-temp"),
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
    pollMs: 150, retryDelaysMs: [100, 300], restartTimeoutMs: 90_000,
  });
}

/** Why a copy ended as it did (a failed one's error names its step), then the destination's log. */
const why = (result: { error?: unknown }, fixture: Fixture) => `${JSON.stringify(result.error ?? null)}\n${fixture.log.slice(-2000)}`;

async function newBot(fixture: Fixture, name: string, token?: string) {
  const created = await api(fixture, "POST", "/api/bots", { token, body: { name, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, requireAvailableModel: true } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.bot as { id: string; threadId: string };
}
async function botNames(fixture: Fixture, token?: string): Promise<string[]> {
  const listed = await api(fixture, "GET", "/api/bots", { token });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  return listed.body.bots.map((bot: { name: string }) => bot.name);
}
/** Poll outside a test body too (beforeAll): expect.poll only works inside one. */
async function until(what: string, check: () => Promise<boolean>, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const idle = (fixture: Fixture) => until("idle bots", async () => (await api(fixture, "GET", "/api/bots")).body.bots
  .every((bot: { activity?: string }) => bot.activity !== "working"));
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path); else if (stat.isFile()) found.push(path);
    }
  };
  walk(root);
  return found;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "omb-move-scratch-"));
  [source, spare, server] = await Promise.all([launch("desktop"), launch("spare"), launch("server")]);
  // On each self-hosted server, from Connect to a server with an owner code
  // (`openmausbot pair`): its /pair page sets this window's cookie.
  for (const [fixture, origin, set] of [[server, SERVER_ORIGIN, (v: string) => { serverCookie = v; }], [spare, SPARE_ORIGIN, (v: string) => { spareCookie = v; }]] as const) {
    const owner = await api(fixture, "POST", "/api/auth/pairing", { body: { scopes: ["admin", "client"], label: "Owner code" } });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    const pairPage = await viaEdge(`${fixture.base}/api/auth/pair`, { method: "POST", headers: { ...edge(fixture), "content-type": "application/json", origin },
      body: JSON.stringify({ code: owner.body.code, cookie: true, label: "OpenMausBot desktop" }) });
    expect(pairPage.status).toBe(200);
    set((pairPage.headers.get("set-cookie") ?? "").split(";")[0]!);
  }
  expect(serverCookie).toMatch(/^omb_session_\d+_\w+=omb_sess_/);
  expect(spareCookie).toMatch(/^omb_session_\d+_\w+=omb_sess_/);
  // The desktop's work: a bot with a real conversation, and a room.
  const planner = await newBot(source, "Moved Planner");
  expect((await api(source, "POST", `/api/bots/${planner.id}/messages`, { body: { text: "Plan the launch party" } })).status).toBe(202);
  await until("the bot's reply", async () => ((await api(source, "GET", `/api/threads/${planner.threadId}/messages`)).body?.messages ?? [])
    .filter((message: { role: string }) => message.role === "bot").length >= 2);
  await idle(source);
  // …and a routine, switched on here: the desktop records no writer for it.
  const routine = await api(source, "POST", "/api/routines", { body: { name: "Weekly plan", prompt: "Plan the week.", botId: planner.id, enabled: true,
    schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } } });
  expect(routine.status, JSON.stringify(routine.body)).toBe(201);
  movedRoutine = routine.body.routine.id;
  const room = await api(source, "POST", "/api/groups", { body: { name: "Launch room", memberIds: [planner.id] } });
  expect(room.status, JSON.stringify(room.body)).toBe(201);
  desktopBots = (await botNames(source)).sort();
  expect(desktopBots).toHaveLength(2);
  // The secrets really are in the desktop's files, so their absence is proof.
  const saved = readFileSync(join(source.dataDir, "config.json"), "utf8");
  for (const value of [SOURCE_SECRETS.anthropic, SOURCE_SECRETS.tts, SOURCE_SECRETS.box, SOURCE_SECRETS.env]) expect(saved).toContain(value);
}, 90_000);

afterAll(async () => {
  for (const fixture of [source, spare, server]) {
    if (!fixture) continue;
    fixture.closing = true;
    await waitForExit(fixture.child, { signal: "SIGTERM" });
  }
  for (const directory of [source?.home, spare?.home, server?.home, scratch]) if (directory) await removeTempDir(directory);
  const failed = [source, spare, server].find((fixture) => fixture?.failure);
  if (failed) throw failed.failure;
});

it("moves this computer's bots, chats and rooms to an empty server, which keeps its own sign-ins, sessions and switches", async () => {
  const before = await api(spare, "GET", "/api/cloud-move", { cookie: spareCookie });
  expect(before.status, JSON.stringify(before.body)).toBe(200);
  expect(before.body).toMatchObject({ empty: true, previous: null });
  const boots = spare.boots;

  const result = await mover().move(spareHosted);
  expect(result, why(result, spare)).toMatchObject({ phase: "done", action: "move", previous: false, routines: 1, destination: { id: "spare", origin: SPARE_ORIGIN, kind: "server" } });
  expect(result.moved).toMatchObject({ bots: 2, rooms: 1, chats: 1 });
  expect(spare.boots).toBe(boots + 1);

  // The window's session survived the restore and the restart.
  const session = await api(spare, "GET", "/api/auth/session", { cookie: spareCookie });
  expect(session.body).toMatchObject({ kind: "session", scopes: ["admin", "client"] });
  expect((await botNames(spare)).sort()).toEqual(desktopBots);
  const moved = (await api(spare, "GET", "/api/bots", { cookie: spareCookie })).body;
  const planner = moved.bots.find((bot: { name: string }) => bot.name === "Moved Planner");
  const transcript = await api(spare, "GET", `/api/threads/${planner.threadId}/messages`, { cookie: spareCookie });
  expect(JSON.stringify(transcript.body.messages)).toContain("Plan the launch party");
  // A restore pauses every routine; the owner's Resume switches it on again.
  const routines = (await api(spare, "GET", "/api/routines", { cookie: spareCookie })).body.routines as Array<{ id: string; enabled: boolean }>;
  expect(routines.find((routine) => routine.id === movedRoutine)).toMatchObject({ enabled: false });
  const resumed = await api(spare, "PATCH", `/api/routines/${movedRoutine}`, { cookie: spareCookie, body: { enabled: true } });
  expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
  expect((await api(spare, "PATCH", `/api/routines/${movedRoutine}`, { cookie: spareCookie, body: { enabled: false } })).status).toBe(200);
  // The copy's own session was signed out; the window's is the one left.
  const sessions = (await api(spare, "GET", "/api/auth/sessions", { cookie: spareCookie })).body.sessions as Array<{ label: string }>;
  expect(sessions.map((entry) => entry.label)).not.toContain("Copy from desktop");

  // The server keeps its own engine key and its own computer-sharing switch.
  const config = JSON.parse(readFileSync(join(spare.dataDir, "config.json"), "utf8"));
  expect(config.anthropic).toEqual({ key: SPARE_KEY });
  expect(config.features?.sharedComputers).toBeUndefined();
  // No desktop secret anywhere on the server's volume.
  for (const file of filesUnder(spare.home)) {
    const text = readFileSync(file).toString("latin1");
    for (const value of Object.values(SOURCE_SECRETS)) expect(text.includes(value), `${value} in ${file}`).toBe(false);
  }
  // What the restore replaced is not kept: no safety copy, no staged files.
  expect(readdirSync(join(spare.dataDir, ".backups")).filter((name) => name.startsWith("safety-") || /^[0-9a-f-]{36}$/.test(name))).toEqual([]);
  // This computer is unchanged: a copy, not a move of its files.
  expect((await botNames(source)).sort()).toEqual(desktopBots);
  expect(readFileSync(join(source.dataDir, "config.json"), "utf8")).toContain(SOURCE_SECRETS.anthropic);
}, 150_000);

it("the bundle a move sends carries no key, sign-in, credential or session of this computer", async () => {
  const password = "fixture bundle password";
  const exported = await api(source, "POST", "/api/workspace-backup/export", { body: { password, clientState: {} } });
  expect(exported.status, JSON.stringify(exported.body)).toBe(200);
  const archive = join(scratch, "bundle.ombbackup");
  writeFileSync(archive, Buffer.from(await (await fetch(`${source.base}/api/workspace-backup/download/${exported.body.id}`)).arrayBuffer()));
  const inspect = mkdtempSync(join(scratch, "bundle-"));
  const staged = await stageWorkspaceBackup(inspect, archive, { password });
  const data = join(inspect, ".backups", staged.id, "staged", "data");
  const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
  for (const field of ["anthropic", "tts", "box", "instances", "mcpServers", "signIn"]) expect(config).not.toHaveProperty(field);
  for (const path of ["workspace-credentials.json", "providers", "sessions.json", "sessions.json.open", "environment-id"]) expect(existsSync(join(data, path)), path).toBe(false);
  for (const file of filesUnder(data)) {
    const text = readFileSync(file).toString("latin1");
    for (const value of Object.values(SOURCE_SECRETS)) expect(text.includes(value), `${value} in ${file}`).toBe(false);
  }
  expect(readFileSync(join(data, "bots.json"), "utf8")).toContain("Moved Planner");
}, 60_000);

it("backs up a server that has work before replacing it; swapping back keeps what it replaces, so it can be swapped again", async () => {
  await newBot(spare, "Spare-only bot");
  const before = await api(spare, "GET", "/api/cloud-move", { cookie: spareCookie });
  expect(before.body).toMatchObject({ empty: false, previous: null });

  const result = await mover().move(spareHosted);
  expect(result, why(result, spare)).toMatchObject({ phase: "done", previous: true });
  expect((await botNames(spare)).sort()).toEqual(desktopBots);
  const status = await api(spare, "GET", "/api/cloud-move", { cookie: spareCookie });
  expect(status.body.previous).toMatchObject({ bots: 3, rooms: 1 });

  // Work done on the server after the move is not lost by swapping back.
  await newBot(spare, "Post-move work");
  const swapped = await mover().restorePrevious(spareHosted);
  expect(swapped, why(swapped, spare)).toMatchObject({ phase: "done", action: "restore" });
  expect((await botNames(spare)).sort()).toEqual(["Spare-only bot", ...desktopBots].sort());
  expect((await api(spare, "GET", "/api/cloud-move", { cookie: spareCookie })).body.previous).toMatchObject({ bots: 3, rooms: 1 });
  const again = await mover().restorePrevious(spareHosted);
  expect(again, why(again, spare)).toMatchObject({ phase: "done", action: "restore" });
  expect((await botNames(spare)).sort()).toEqual(["Post-move work", ...desktopBots].sort());

  // One undo point is all that stays: no safety copies, no staged files.
  const backups = join(spare.dataDir, ".backups");
  expect(readdirSync(backups).filter((name) => name.startsWith("safety-") || /^[0-9a-f-]{36}$/.test(name) || name === "cloud-previous.next")).toEqual([]);
  const held = (await api(spare, "GET", "/api/cloud-move", { cookie: spareCookie })).body;
  const archive = lstatSync(join(backups, "cloud-previous", "workspace.ombbackup")).size;
  expect(held.previous.bytes).toBe(archive);
  expect(held.heldBytes).toBeLessThan(archive + 256 * 1024);
  const config = JSON.parse(readFileSync(join(spare.dataDir, "config.json"), "utf8"));
  expect(config.anthropic).toEqual({ key: SPARE_KEY });
  expect((await api(spare, "GET", "/api/auth/session", { cookie: spareCookie })).body).toMatchObject({ kind: "session" });
}, 300_000);

it("copies this computer to an empty self-hosted server by the same path: the window's own owner session mints the code, and the server keeps its own key", async () => {
  const before = await api(server, "GET", "/api/cloud-move", { cookie: serverCookie });
  expect(before.status, JSON.stringify(before.body)).toBe(200);
  expect(before.body).toMatchObject({ empty: true, previous: null, environmentId: expect.any(String) });
  const boots = server.boots;

  // From the server's own page: an empty server may be filled from there.
  const result = await mover().move(selfHosted, { requireEmpty: true });
  expect(result, why(result, server)).toMatchObject({ phase: "done", action: "move", previous: false, routines: 1, destination: { id: "self", origin: SERVER_ORIGIN, kind: "server" } });
  expect(result.moved).toMatchObject({ bots: 2, rooms: 1, chats: 1 });
  // It restarted itself (exit 75) to install the copy.
  expect(server.boots).toBe(boots + 1);

  // The window's own session (its cookie) survived; the copy's session was signed out.
  expect((await api(server, "GET", "/api/auth/session", { cookie: serverCookie })).body).toMatchObject({ kind: "session", scopes: ["admin", "client"] });
  const sessions = (await api(server, "GET", "/api/auth/sessions", { cookie: serverCookie })).body.sessions as Array<{ label: string }>;
  expect(sessions.map((entry) => entry.label)).not.toContain("Copy from desktop");
  expect((await botNames(server, undefined)).sort()).toEqual(desktopBots);
  // Routines arrive paused: on here, off there until the person turns them on.
  const routines = (await api(server, "GET", "/api/routines")).body.routines as Array<{ id: string; enabled: boolean }>;
  expect(routines.find((routine) => routine.id === movedRoutine)).toMatchObject({ enabled: false });
  // The server keeps its own engine key; no desktop secret reaches its volume.
  expect(JSON.parse(readFileSync(join(server.dataDir, "config.json"), "utf8")).anthropic).toEqual({ key: SERVER_KEY });
  for (const file of filesUnder(server.home)) {
    const text = readFileSync(file).toString("latin1");
    for (const value of Object.values(SOURCE_SECRETS)) expect(text.includes(value), `${value} in ${file}`).toBe(false);
  }
  expect(readdirSync(join(server.dataDir, ".backups")).filter((name) => name.startsWith("safety-") || /^[0-9a-f-]{36}$/.test(name))).toEqual([]);
}, 150_000);

it("a self-hosted server with work is replaced only from this computer's Settings, backed up first, and swaps back", async () => {
  await newBot(server, "Server-only bot");
  // Its own page may not replace work it has: nothing is exported.
  const refused = await mover().move(selfHosted, { requireEmpty: true });
  expect(refused).toMatchObject({ phase: "failed", error: { code: "not_empty" } });
  expect((await botNames(server)).sort()).toEqual(["Server-only bot", ...desktopBots].sort());

  const result = await mover().move(selfHosted);
  expect(result, why(result, server)).toMatchObject({ phase: "done", previous: true });
  expect((await botNames(server)).sort()).toEqual(desktopBots);
  expect((await api(server, "GET", "/api/cloud-move", { cookie: serverCookie })).body.previous).toMatchObject({ bots: 3, rooms: 1 });
  const swapped = await mover().restorePrevious(selfHosted);
  expect(swapped, why(swapped, server)).toMatchObject({ phase: "done", action: "restore" });
  expect((await botNames(server)).sort()).toEqual(["Server-only bot", ...desktopBots].sort());
  expect(readdirSync(join(server.dataDir, ".backups")).filter((name) => name.startsWith("safety-") || /^[0-9a-f-]{36}$/.test(name) || name === "cloud-previous.next")).toEqual([]);
  expect((await api(server, "GET", "/api/auth/session", { cookie: serverCookie })).body).toMatchObject({ kind: "session" });

  // Swap back keeps one workspace. Copy, then copy again: the second copy's
  // backup takes the first one's place (the Replace panel says so, with its
  // date, before it starts), so Swap back returns what the first copy put there.
  const kept = async () => (await api(server, "GET", "/api/cloud-move", { cookie: serverCookie })).body.previous as { createdAt: string; bots: number };
  const firstCopy = await mover().move(selfHosted);
  expect(firstCopy, why(firstCopy, server)).toMatchObject({ phase: "done", previous: true });
  const first = await kept();
  expect(first).toMatchObject({ bots: 3 });
  const secondCopy = await mover().move(selfHosted);
  expect(secondCopy, why(secondCopy, server)).toMatchObject({ phase: "done", previous: true });
  const second = await kept();
  expect(second).toMatchObject({ bots: 2 });
  expect(second.createdAt > first.createdAt).toBe(true);
  const swappedBack = await mover().restorePrevious(selfHosted);
  expect(swappedBack, why(swappedBack, server)).toMatchObject({ phase: "done", action: "restore" });
  expect((await botNames(server)).sort()).toEqual(desktopBots);
  // Put the server-only bot back for the next test, as an owner would.
  await newBot(server, "Server-only bot");
}, 600_000);

it("a self-hosted server whose email sign-in lets other people in never receives a copy, and says why before anything is exported", async () => {
  const signIn = async (lists: { admins?: string[]; members?: string[] }) => {
    server.closing = true;
    await waitForExit(server.child, { signal: "SIGTERM" });
    const config = JSON.parse(readFileSync(join(server.dataDir, "config.json"), "utf8"));
    writeFileSync(join(server.dataDir, "config.json"), JSON.stringify({ ...config, signIn: lists }));
    server.closing = false;
    await boot(server);
  };
  // `openmausbot access add me@example.test`: only its owner signs in, from a browser too. Still theirs alone.
  await signIn({ admins: ["me@example.test"] });
  expect((await api(server, "GET", "/api/cloud-move", { cookie: serverCookie })).status).toBe(200);
  // `openmausbot access add` lets someone else sign in: the server is shared now.
  await signIn({ admins: ["me@example.test"], members: ["colleague@example.test"] });
  const refused = await api(server, "GET", "/api/cloud-move", { cookie: serverCookie });
  expect(refused).toMatchObject({ status: 403, body: { code: "shared_workspace" } });
  const exportsBefore = readdirSync(join(source.dataDir, ".backups")).length;
  const result = await mover().move(selfHosted);
  expect(result).toMatchObject({ phase: "failed", error: { code: "shared_workspace" } });
  expect(readdirSync(join(source.dataDir, ".backups")).length).toBe(exportsBefore);
  expect(existsSync(join(server.dataDir, ".backups", "cloud-move", "upload.json"))).toBe(false);
  expect((await botNames(server)).sort()).toEqual(["Server-only bot", ...desktopBots].sort());
  // Put the server back to its owner-only sign-in for the next test.
  await signIn({ admins: ["me@example.test"] });
}, 120_000);

it("refuses a move too big for a server, an upload that is not a backup, and anyone but the owner's app", async () => {
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const tooBig = await api(server, "POST", "/api/cloud-move/upload", { cookie: serverCookie, body: { sha256: "a".repeat(64), bytes: 11 * 1024 ** 3 } });
  expect(tooBig.status).toBe(413);
  const tooMany = await api(server, "POST", "/api/cloud-move/upload", { cookie: serverCookie, body: { sha256: "a".repeat(64), bytes: 4096, files: 100_001 } });
  expect(tooMany.status).toBe(413);

  const garbage = randomBytes(4096);
  const begun = await api(server, "POST", "/api/cloud-move/upload", { cookie: serverCookie, body: { sha256: sha256(garbage), bytes: garbage.length } });
  expect(begun.body).toMatchObject({ received: 0 });
  const beyond = await api(server, "PUT", `/api/cloud-move/upload/${sha256(garbage)}?offset=0`, { cookie: serverCookie, raw: Buffer.concat([garbage, Buffer.alloc(1)]) });
  expect(beyond.status).toBe(413);
  expect((await api(server, "PUT", `/api/cloud-move/upload/${sha256(garbage)}?offset=0`, { cookie: serverCookie, raw: garbage })).body).toEqual({ received: 4096 });
  expect((await api(server, "POST", "/api/cloud-move/preview", { cookie: serverCookie, body: { sha256: sha256(garbage), password: "fixture password 123" } })).status).toBe(202);
  await expect.poll(async () => (await api(server, "GET", "/api/cloud-move", { cookie: serverCookie })).body.job?.state, { timeout: 15_000 }).toBe("failed");
  const refused = (await api(server, "GET", "/api/cloud-move", { cookie: serverCookie })).body;
  expect(refused.job.error).toMatch(/not a supported encrypted workspace backup/);
  expect(refused.upload).toBeNull();

  // A client-scoped device cannot, and a request without a session is refused.
  const invite = await api(server, "POST", "/api/auth/pairing", { cookie: serverCookie, body: { scopes: ["client"], label: "Phone" } });
  const phone = (await api(server, "POST", "/api/auth/pair", { remote: true, body: { code: invite.body.code } })).body.token;
  expect((await api(server, "GET", "/api/cloud-move", { token: phone })).status).toBe(403);
  expect((await api(server, "POST", "/api/cloud-move/restore", { token: phone, body: { id: "3f9c2a4e-8b1d-4c6e-9a7f-2d5e8c1b0a93" } })).status).toBe(403);
  expect([401, 403]).toContain((await api(server, "GET", "/api/cloud-move", { remote: true })).status);
  // A server receives only from its owner's paired app, never a bare request
  // on the machine; it still sizes its own workspace for its own desktop.
  expect((await api(source, "GET", "/api/cloud-move")).status).toBe(403);
  expect((await api(source, "GET", "/api/cloud-move/estimate")).body).toMatchObject({ bots: 2, rooms: 1, chats: 1 });
}, 60_000);
