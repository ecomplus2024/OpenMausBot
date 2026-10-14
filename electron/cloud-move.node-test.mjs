// Copy this computer here, the desktop's half (docs/copy-workspace.md),
// against in-memory fakes of this computer's server and the destination (any
// server the person added): resuming a dropped upload, refusing a full
// server, refusing before anything is exported, stopping before anything is
// replaced, and the bridge and IPC guards. The whole copy between real
// servers is server/cloud-move.e2e.test.ts.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import environments from "./environments.cjs";
import localOrigin from "./local-origin.cjs";
import { createCloudMove, mintOwnerCode, moveBlocked, moveFit, moveRefusal, moveSenderDestination, olderVersion, parseMoveEstimate } from "./cloud-move.mjs";

const ORIGIN = "https://bots.example.test";
const MAGIC = Buffer.from("OMB-WORKSPACE-1\n");
const UUID = () => "3f9c2a4e-8b1d-4c6e-9a7f-" + randomBytes(6).toString("hex");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** This computer's server: an estimate, an export and its download. */
function desktop({ bytes = 5000, busy = false, exportError = null, routines, identity = {} } = {}) {
  const archive = Buffer.concat([MAGIC, randomBytes(bytes - MAGIC.length)]), calls = [];
  const id = UUID();
  return {
    archive, calls,
    request: async (route, init) => {
      calls.push([init.method, route, init.body ? JSON.parse(init.body) : undefined]);
      if (route === "/api/cloud-move/estimate") return json(200, { bots: 3, rooms: 1, chats: 7, bytes, files: 12, ...(routines === undefined ? {} : { routines }), ...identity });
      if (route === "/api/workspace-backup/status") return json(200, { busy, pendingRestore: false });
      if (route === "/api/workspace-backup/export") {
        if (exportError) return json(400, { error: exportError });
        return busy ? json(409, { error: "busy" }) : json(200, { id, bytes, summary: { bots: 3, files: 12, messages: 40 } });
      }
      if (route === `/api/workspace-backup/download/${id}`) return new Response(archive, { status: 200, headers: { "content-length": String(bytes) } });
      return json(404, {});
    },
  };
}

/** The destination server: pairing, the upload slot, jobs, and a restart. */
function serverFake({ freeBytes = 1024 ** 4, volumeBytes, empty = true, failPut = () => false, dropAnswer = () => false, loseAt = 0, busyRestores = 0, storedPart = 0, previewBots = 3, identity = {}, refuse = null,
  partBytes = 1024, proxyLimit = Infinity } = {}) {
  const state = { freeBytes, upload: storedPart ? { sha256: "e".repeat(64), bytes: storedPart } : null, received: Buffer.alloc(storedPart), job: null, lastRestoreId: null, restarting: 0,
      previous: null, contents: { bots: 1, rooms: 0, chats: 0 }, empty, discards: 0, restoreAsks: [] },
    log = [], tokens = new Set();
  let lost = false;
  const fetchImpl = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    const { pathname, searchParams } = new URL(url);
    const auth = new Headers(init.headers).get("authorization");
    log.push([init.method ?? "GET", pathname]);
    if (pathname === "/api/auth/pair") {
      assert.equal(JSON.parse(init.body).code, "ABCD-EFGH-JKLM");
      const token = `omb_sess_${randomBytes(8).toString("hex")}`; tokens.add(token);
      return json(200, { token });
    }
    if (!tokens.has(auth?.slice("Bearer ".length))) return json(401, { error: "unauthorized" });
    if (pathname === "/api/auth/logout") { tokens.delete(auth.slice("Bearer ".length)); return json(200, { ok: true }); }
    if (state.restarting > 0) { state.restarting--; throw new TypeError("fetch failed"); }
    if (refuse && pathname.startsWith("/api/cloud-move")) return json(refuse.status, refuse.body);
    if (pathname === "/api/cloud-move" && (init.method ?? "GET") === "GET") {
      return json(200, { ...identity, contents: state.contents, empty: state.empty, freeBytes: state.freeBytes, ...(volumeBytes ? { volumeBytes } : {}), previous: state.previous, job: state.job, pendingRestore: false, busy: false,
        lastRestoreId: state.lastRestoreId, rolledBackId: null, partBytes: 1024,
        upload: state.upload && { ...state.upload, received: state.received.length } });
    }
    const body = init.body && !(init.body instanceof Uint8Array) ? JSON.parse(init.body) : undefined;
    if (pathname === "/api/cloud-move/discard") { state.discards++; if (state.job?.kind === "preview") state.job = null; return json(200, { ok: true }); }
    if (pathname === "/api/cloud-move/upload") {
      if (3 * body.bytes > state.freeBytes + state.received.length) return json(507, { error: "full", freeBytes: state.freeBytes, neededBytes: 3 * body.bytes });
      if (state.upload?.sha256 !== body.sha256) { state.upload = { sha256: body.sha256, bytes: body.bytes }; state.received = Buffer.alloc(0); }
      return json(200, { received: state.received.length, partBytes });
    }
    if (pathname.startsWith("/api/cloud-move/upload/")) {
      const offset = Number(searchParams.get("offset")), part = Buffer.from(init.body);
      state.puts = [...(state.puts ?? []), part.length];
      // A proxy in front (nginx: client_max_body_size), before the server sees anything.
      if (part.length > proxyLimit) return new Response("<html><body><h1>413 Request Entity Too Large</h1></body></html>", { status: 413, headers: { "content-type": "text/html" } });
      if (failPut(offset)) throw new TypeError("fetch failed");
      if (offset + part.length <= state.received.length) return json(200, { received: state.received.length });
      if (offset !== state.received.length) return json(409, { error: "elsewhere", received: state.received.length });
      state.received = Buffer.concat([state.received, part]);
      const received = state.received.length;
      // Stored, but the answer never arrives: the app sends the part again.
      if (dropAnswer(offset)) throw new TypeError("fetch failed");
      // Answered, then lost (a restart mid-upload): the next part is refused with where it stands.
      if (loseAt && received === loseAt && !lost) { lost = true; state.received = state.received.subarray(0, received - part.length); }
      return json(200, { received });
    }
    if (pathname === "/api/cloud-move/preview") {
      const hash = createHash("sha256").update(state.received).digest("hex");
      assert.equal(hash, state.upload.sha256);
      assert.ok(body.password.length >= 12);
      state.job = { kind: "preview", state: "done", id: UUID(), summary: { bots: previewBots, messages: 40 } };
      return json(202, { job: { kind: "preview", state: "running" } });
    }
    if (pathname === "/api/cloud-move/restore") {
      state.restoreAsks.push(body.id);
      if (busyRestores-- > 0) return json(409, { error: "Another move step is running on that server. Wait for it to finish." });
      assert.equal(body.id, state.job.id);
      state.previous = state.empty ? null : { createdAt: new Date().toISOString(), bots: 2, rooms: 0, chats: 4 };
      state.job = null; state.restarting = 2; state.lastRestoreId = body.id;
      state.contents = { bots: 3, rooms: 1, chats: 7 }; state.empty = false;
      return json(202, { job: { kind: "restore", state: "running" } });
    }
    if (pathname === "/api/cloud-move/undo") {
      state.job = null; state.restarting = 2; state.rolledBackId = null;
      state.lastRestoreId = `undo-${UUID()}`;
      return json(202, { job: { kind: "undo", state: "running" } });
    }
    return json(404, {});
  };
  return { state, log, tokens, fetchImpl };
}

const SERVER = { id: "vps", name: "bots.example.test", origin: ORIGIN, kind: "server" };
/** The destination, as main describes it: the window's session mints a code. */
function serverDestination(options = {}) {
  return { ...SERVER, grant: options.grant ?? (async () => ({ origin: ORIGIN, code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 60_000 })) };
}
function harness(options = {}) {
  const temp = mkdtempSync(join(tmpdir(), "omb-cloud-move-test-"));
  const local = desktop(options.desktop), server = serverFake(options.server), states = [];
  const dest = options.dest ?? serverDestination(options);
  const engine = createCloudMove({
    localRequest: local.request, fetchImpl: server.fetchImpl, tempRoot: join(temp, "move"),
    availableBytes: async () => options.localFree ?? 1024 ** 4, sleep: async (_ms, signal) => signal?.throwIfAborted(), pollMs: 0, retryDelaysMs: [0, 0],
    ...(options.now ? { now: options.now } : {}),
    onState: state => { states.push(state); options.onState?.(state, move); },
  });
  const move = { ...engine, move: copy => engine.move(dest, copy), restorePrevious: () => engine.restorePrevious(dest) };
  return { temp, local, server, states, move, engine, dest, done: () => rmSync(temp, { recursive: true, force: true }) };
}

test("moves this computer's archive in parts, waits out the restart, signs its session out and leaves no temporary file", async () => {
  const f = harness();
  try {
    const result = await f.move.move();
    assert.deepEqual(result, { phase: "done", action: "move", moved: { bots: 3, rooms: 1, chats: 7 }, previous: false, destination: SERVER });
    assert.ok(f.server.state.received.equals(f.local.archive));
    assert.deepEqual([...new Set(f.states.map(state => state.phase))], ["preparing", "exporting", "uploading", "checking", "replacing", "restarting", "done"]);
    assert.equal(f.server.log.filter(([method, path]) => method === "PUT" && path.startsWith("/api/cloud-move/upload/")).length, 5);
    // The export carried no drafts or window state, and a random password.
    const exported = f.local.calls.find(([, route]) => route === "/api/workspace-backup/export")[2];
    assert.deepEqual(exported.clientState, {});
    assert.ok(exported.password.length >= 40);
    assert.equal(f.server.tokens.size, 0, "the move's session was signed out");
    assert.deepEqual(readdirSync(join(f.temp, "move")), []);
  } finally { f.done(); }
});

const puts = f => f.server.log.filter(([method, path]) => method === "PUT" && path.startsWith("/api/cloud-move/upload/")).length;
test("continues a dropped upload: a part whose answer was lost is sent again without being stored twice", async () => {
  let drops = 1;
  const f = harness({ server: { dropAnswer: offset => offset === 2048 && drops-- > 0 } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result));
    assert.ok(f.server.state.received.equals(f.local.archive));
    assert.equal(puts(f), 6); // 0, 1024, 2048 (answer lost), 2048 again, 3072, 4096
  } finally { f.done(); }
});

test("continues from where the server stands when it lost a part", async () => {
  const f = harness({ server: { loseAt: 2048 } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result));
    assert.ok(f.server.state.received.equals(f.local.archive));
    assert.equal(puts(f), 7); // 0, 1024 (then lost), 2048 refused at 1024, 1024, 2048, 3072, 4096
  } finally { f.done(); }
});

test("an upload that keeps failing stops resumable, and moving again continues it without a second export", async () => {
  let failing = true;
  const f = harness({ server: { failPut: offset => failing && offset >= 3072 } });
  try {
    const first = await f.move.move();
    assert.equal(first.phase, "failed");
    assert.equal(first.error.code, "upload_failed");
    assert.equal(first.resumable, true);
    assert.equal(f.server.state.lastRestoreId, null, "nothing was replaced");
    assert.equal(f.server.tokens.size, 0);
    failing = false;
    const second = await f.move.move();
    assert.equal(second.phase, "done", JSON.stringify(second));
    assert.equal(f.local.calls.filter(([, route]) => route === "/api/workspace-backup/export").length, 1);
    assert.ok(f.server.state.received.equals(f.local.archive));
  } finally { f.done(); }
});

test("a proxy that refuses large parts gets smaller ones; one that refuses even 512 KB is named, with what to change, and the copy continues later", async () => {
  const MB = 1024 ** 2;
  // nginx's default client_max_body_size, 1 MB, in front of a server that asks for 4 MB parts.
  const behind = harness({ desktop: { bytes: 8 * MB + 5000 }, server: { partBytes: 4 * MB, proxyLimit: MB } });
  try {
    const result = await behind.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result.error));
    assert.ok(behind.server.state.received.equals(behind.local.archive));
    assert.deepEqual(behind.server.state.puts.slice(0, 3), [4 * MB, 2 * MB, MB]);
    assert.ok(behind.server.state.puts.slice(2).every(size => size <= MB), "every later part fits");
  } finally { behind.done(); }
  // A proxy allowing 256 KB: parts halve to 512 KB at the least, then the copy says what refused it.
  const tight = harness({ desktop: { bytes: 4 * MB }, server: { partBytes: 3 * MB, proxyLimit: 256 * 1024 } });
  try {
    const result = await tight.move.move();
    assert.equal(result.phase, "failed");
    assert.equal(result.error.code, "proxy_limit");
    assert.equal(result.error.partBytes, 512 * 1024);
    assert.match(result.error.message, /^A proxy in front of bots\.example\.test refused a 512 KB upload\. Raise its request size limit \(nginx: client_max_body_size 64m\), then copy again\.$/);
    assert.deepEqual(tight.server.state.puts, [3 * MB, 1.5 * MB, 768 * 1024, 512 * 1024]);
    // Nothing was replaced, and the prepared archive waits: copying again (limit raised) continues without a second export.
    assert.equal(result.resumable, true);
    assert.equal(tight.server.state.restoreAsks.length, 0);
    assert.equal(tight.server.tokens.size, 0);
  } finally { tight.done(); }
  // The server's own 413 to the declaration (over 10 GB) stays "too large".
  const declared = harness({ server: { refuse: null } });
  try {
    const fetchImpl = declared.server.fetchImpl;
    const big = createCloudMove({ localRequest: declared.local.request, tempRoot: join(declared.temp, "move"), availableBytes: async () => 1024 ** 4, sleep: async () => {}, pollMs: 0,
      fetchImpl: (url, init) => new URL(url).pathname === "/api/cloud-move/upload" ? Promise.resolve(json(413, { error: "This workspace is larger than the 10 GB a copy can carry." })) : fetchImpl(url, init) });
    assert.equal((await big.move(serverDestination())).error.code, "too_large");
  } finally { declared.done(); }
});

test("refuses a server without room before anything is uploaded, saying how much it needs", async () => {
  const f = harness({ server: { freeBytes: 10_000 } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "failed");
    assert.equal(result.error.code, "cloud_full");
    assert.equal(result.error.freeBytes, 10_000);
    assert.ok(result.error.neededBytes > 10_000);
    assert.equal(f.local.calls.filter(([, route]) => route === "/api/workspace-backup/export").length, 0);
    assert.equal(f.server.log.some(([method]) => method === "PUT"), false);
  } finally { f.done(); }
});

const GB = 1024 ** 3, MARGIN = 256 * 1024 ** 2;
test("a move is measured against the destination's free space, and a stored part of an earlier upload counts as room", () => {
  // The audit's case: about 3.4 GB here, 8.9 GB free on a 10 GB server.
  const local = 3.4 * GB, free = 8.9 * GB;
  assert.deepEqual(moveFit({ localBytes: 1 * GB, freeBytes: free }), { fit: "now", neededBytes: 3 * GB + MARGIN, freeBytes: free });
  assert.deepEqual(moveFit({ localBytes: local, freeBytes: free }), { fit: "never", neededBytes: 3 * local + MARGIN, freeBytes: free });
  // The server's own volume size says why it cannot fit.
  assert.deepEqual(moveFit({ localBytes: local, freeBytes: free, volumeBytes: 10 * GB }), { fit: "never", neededBytes: 3 * local + MARGIN, freeBytes: free, volumeBytes: 10 * GB });
  // A stored part of an earlier upload counts as room.
  assert.equal(moveFit({ localBytes: 1 * GB, freeBytes: 2 * GB, uploadReceived: 2 * GB }).fit, "now");
  assert.deepEqual(parseMoveEstimate({ bots: 1, rooms: 0, chats: 2, bytes: 10, files: 1, routines: 4 }).routines, 4);
  assert.equal(parseMoveEstimate({ bots: 1, rooms: 0, chats: 2, bytes: 10, files: 1, routines: -1 }).routines, undefined);
});

const OVERVIEW_START = "async function cloudMoveOverview(", IPC_START = "// ── Who asks, and where to", IPC_END = "// ── end Copy this computer here ──";
/** main's cloudMoveOverview, run against fakes of what it asks. */
async function mainOverview({ dest, peek, local = { bots: 3, rooms: 1, chats: 12, bytes: 3.4 * GB, files: 100 }, state = { phase: "idle" }, running = false, onServerPage = true }) {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(OVERVIEW_START), end = source.indexOf(IPC_START, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ moveFit, moveBlocked, cloudMoveDismissed: () => false, peekCloudMove: async () => peek,
    ensureCloudMove: () => ({ estimate: async () => local, state: () => state, running: () => running }) });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.cloudMoveOverview = cloudMoveOverview;`, context);
  // Made in main's own realm: compared as plain data.
  return JSON.parse(JSON.stringify(await context.cloudMoveOverview(dest, onServerPage)));
}
test("a server's card offers a copy only when it can fit and nothing blocks it", async () => {
  const peek = { status: { empty: true, freeBytes: 8.9 * GB, uploadReceived: 0, volumeBytes: 10 * GB, contents: { bots: 0, rooms: 0, chats: 0 }, previous: null }, refusal: null };
  // 3.4 GB here, 8.9 GB free there: no card offers a copy it would refuse.
  let result = await mainOverview({ dest: SERVER, peek });
  assert.equal(result.fit.fit, "never"); assert.equal(result.fit.volumeBytes, 10 * GB); assert.equal(result.suggest, false);
  const roomy = { ...peek, status: { ...peek.status, freeBytes: 50 * GB } };
  result = await mainOverview({ dest: SERVER, peek: roomy });
  assert.equal(result.suggest, true); assert.deepEqual(result.destination, SERVER); assert.equal(result.blocked, null);
  // Each reason a copy cannot start blocks the card, and says which.
  for (const [blocked, input] of [
    ["owner_needed", { peek: { status: null, refusal: "owner_needed" } }],
    ["shared_workspace", { peek: { status: null, refusal: "shared_workspace" } }],
    ["outdated", { peek: { status: null, refusal: "outdated" } }],
    ["unreachable", { peek: { status: null, refusal: "unreachable" } }],
    ["same_computer", { peek: { ...roomy, status: { ...roomy.status, environmentId: "env-1" } }, local: { bots: 3, rooms: 1, chats: 12, bytes: GB, files: 1, environmentId: "env-1" } }],
  ]) {
    result = await mainOverview({ dest: SERVER, ...input });
    assert.equal(result.blocked, blocked); assert.equal(result.suggest, false);
    // A server's page learns nothing that identifies this computer.
    assert.equal(JSON.stringify(result).includes("env-1"), false);
  }
  const OTHER = { id: "other", name: "Other", origin: "https://other.example.test", kind: "server" };
  // A copy running elsewhere: this server waits, and is not shown its progress.
  result = await mainOverview({ dest: SERVER, peek: roomy, running: true, state: { phase: "uploading", action: "move", destination: OTHER } });
  assert.equal(result.blocked, "busy_elsewhere"); assert.equal(result.busyWith, "Other"); assert.equal(result.phase, "idle"); assert.equal(result.suggest, false);
  // A finished copy elsewhere does not keep this server's card away.
  result = await mainOverview({ dest: SERVER, peek: roomy, state: { phase: "done", action: "move", destination: OTHER } });
  assert.equal(result.phase, "idle"); assert.equal(result.suggest, true);
  // No session on the server in this window yet blocks the card: the grant is minted when the copy starts.
  result = await mainOverview({ dest: SERVER, peek: { status: null, refusal: "owner_needed" } });
  assert.equal(result.blocked, "owner_needed"); assert.equal(result.suggest, false);
  // This computer's own page, without a server named: what is here, nothing more.
  result = await mainOverview({ dest: null, peek });
  assert.deepEqual([result.destination, result.blocked, result.suggest], [null, null, false]);
});

test("a busy computer, an unreachable destination and a stop all end before the server replaces anything", async () => {
  const busy = harness({ desktop: { busy: true } });
  try { assert.equal((await busy.move.move()).error.code, "busy"); } finally { busy.done(); }
  const missing = harness({ grant: async () => { throw new Error("That server is not ready to connect yet."); } });
  try {
    assert.equal((await missing.move.move()).error.code, "cloud_unavailable");
    assert.deepEqual(missing.server.log, []);
  } finally { missing.done(); }
  const stopped = harness({ onState: (state, move) => { if (state.phase === "uploading") move.cancel(); } });
  try {
    const result = await stopped.move.move();
    assert.equal(result.phase, "failed");
    assert.equal(result.error.code, "cancelled");
    assert.equal(stopped.server.log.some(([, path]) => path === "/api/cloud-move/restore"), false);
  } finally { stopped.done(); }
});

test("says a server from before any server could receive a copy has to update first", async () => {
  const f = harness();
  const fetchImpl = f.server.fetchImpl;
  const outdated = createCloudMove({
    localRequest: f.local.request, tempRoot: join(f.temp, "move"), availableBytes: async () => 1024 ** 4, sleep: async () => {}, pollMs: 0,
    fetchImpl: (url, init) => new URL(url).pathname === "/api/cloud-move" ? Promise.resolve(json(404, { error: "not found" })) : fetchImpl(url, init),
  });
  try {
    const result = await outdated.move(serverDestination());
    assert.equal(result.error.code, "outdated");
    assert.equal(f.local.calls.some(([, route]) => route === "/api/workspace-backup/export"), false);
  } finally { f.done(); }
});

test("asks a busy server again with the same staged workspace, instead of uploading it twice", async () => {
  const f = harness({ server: { busyRestores: 2 } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result));
    assert.equal(f.server.state.restoreAsks.length, 3);
    assert.equal(new Set(f.server.state.restoreAsks).size, 1);
    assert.equal(f.server.log.filter(([, path]) => path === "/api/cloud-move/preview").length, 1);
  } finally { f.done(); }
});

test("a server that stays busy, a stop while it checks, and a mismatch each drop what the move staged there", async () => {
  const busy = harness({ server: { busyRestores: 10 } });
  try {
    const result = await busy.move.move();
    assert.equal(result.error.code, "cloud_busy");
    assert.equal(busy.server.state.discards, 1);
    assert.equal(busy.server.state.lastRestoreId, null);
  } finally { busy.done(); }
  const stopped = harness({ onState: (state, move) => { if (state.phase === "checking") move.cancel(); } });
  try {
    const result = await stopped.move.move();
    assert.equal(result.error.code, "cancelled");
    assert.match(result.error.message, /was not replaced/);
    assert.equal(stopped.server.state.discards, 1);
  } finally { stopped.done(); }
  const different = harness({ server: { previewBots: 2 } });
  try {
    const result = await different.move.move();
    assert.equal(result.error.code, "invalid_backup");
    assert.equal(different.server.state.discards, 1);
    assert.equal(different.server.state.restoreAsks.length, 0);
  } finally { different.done(); }
});

test("credits a stored part of an earlier upload when checking the server's room", async () => {
  // 3 × 5000 bytes plus the margin is more than is free, until the stored part is counted.
  const f = harness({ server: { freeBytes: 256 * 1024 ** 2 + 12_000, storedPart: 4_000 } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result));
  } finally { f.done(); }
});

test("says why this computer's server could not export, in its own words, on one line", async () => {
  const f = harness({ desktop: { exportError: "Cannot back up user-created symbolic link; replace it with regular files first: workspaces/bot/link\n" } });
  try {
    const result = await f.move.move();
    assert.equal(result.error.code, "export_failed");
    assert.equal(result.error.message, "Cannot back up user-created symbolic link; replace it with regular files first: workspaces/bot/link");
  } finally { f.done(); }
});

test("reports a replaced server's backup, and Swap back restores it", async () => {
  const f = harness({ server: { empty: false } });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done");
    assert.equal(result.previous, true);
    assert.equal(f.states.find(state => state.phase === "replacing").replacing, true);
    const back = await f.move.restorePrevious();
    assert.equal(back.phase, "done");
    assert.equal(back.action, "restore");
  } finally { f.done(); }
});

// ── The window's own session mints the destination's grant ──────────────
const VPS = "https://bots.example.test";
const VPS_ENTRY = { id: "vps", name: "bots.example.test", origin: VPS, kind: "server" };
/** This window's own session on a self-hosted server (Chromium's cookie jar, session.defaultSession.fetch). */
function windowSession({ session = { kind: "session", id: "s1", scopes: ["admin", "client"] }, status = 200, pairing = null } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push({ method: init.method ?? "GET", pathname, credentials: init.credentials, origin: new Headers(init.headers).get("origin"), body: init.body ? JSON.parse(init.body) : undefined });
    if (pathname === "/api/auth/session") return json(status, status === 200 ? session : { error: "unauthorized" });
    if (pathname === "/api/auth/pairing" && init.method === "POST") return pairing ?? json(200, { code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 60_000 });
    return json(404, {});
  };
  return { fetch, calls };
}
const grantedDestination = (cookie, extra = {}) => ({ ...VPS_ENTRY, grant: () => mintOwnerCode(cookie.fetch, VPS), ...extra });

test("the window's owner session mints the code; the copy's own session signs out", async () => {
  const cookie = windowSession();
  const f = harness({ desktop: { routines: 2 }, dest: grantedDestination(cookie) });
  try {
    const result = await f.move.move();
    assert.equal(result.phase, "done", JSON.stringify(result));
    assert.deepEqual(result.destination, VPS_ENTRY);
    assert.equal(result.routines, 2);
    assert.ok(f.server.state.received.equals(f.local.archive));
    assert.ok(f.states.every(state => state.destination?.origin === VPS), "every state names where it goes");
    // The cookie only asked who it is and minted one admin code, from this origin.
    assert.deepEqual(cookie.calls.map(call => `${call.method} ${call.pathname}`), ["GET /api/auth/session", "POST /api/auth/pairing"]);
    assert.ok(cookie.calls.every(call => call.credentials === "include" && call.origin === VPS));
    assert.deepEqual(cookie.calls[1].body.scopes, ["admin", "client"]);
    // The copy's bearer session was signed out; the window's session was never touched.
    assert.equal(f.server.tokens.size, 0);
    assert.ok(f.server.log.some(([method, path]) => method === "POST" && path === "/api/auth/logout"));
    assert.equal(cookie.calls.some(call => call.pathname === "/api/auth/logout"), false);
  } finally { f.done(); }
});

const exportsOf = f => f.local.calls.filter(([, route]) => route === "/api/workspace-backup/export").length;
test("refuses before exporting anything: another origin's grant, an old server, a shared one, this computer itself, an older version, or work a page may not replace", async () => {
  const cases = [
    ["cloud_unavailable", { dest: { ...VPS_ENTRY, grant: async () => ({ origin: "https://elsewhere.example.test", code: "ABCD-EFGH-JKLM" }) } }],
    ["outdated", { server: { refuse: { status: 404, body: { error: "Unknown" } } } }],
    ["shared_workspace", { server: { refuse: { status: 403, body: { error: "This server is shared with other people.", code: "shared_workspace" } } } }],
    ["same_computer", { desktop: { identity: { environmentId: "env-1", appVersion: "0.1.96" } }, server: { identity: { environmentId: "env-1", appVersion: "0.1.96" } } }],
    ["outdated", { desktop: { identity: { environmentId: "env-1", appVersion: "0.1.96" } }, server: { identity: { environmentId: "env-2", appVersion: "0.1.95" } } }],
    ["not_empty", { server: { empty: false }, copy: { requireEmpty: true } }],
  ];
  for (const [code, options] of cases) {
    const f = harness({ dest: grantedDestination(windowSession()), ...options });
    try {
      const result = await f.move.move(options.copy);
      assert.equal(result.phase, "failed", `${code}: ${JSON.stringify(result)}`);
      assert.equal(result.error.code, code);
      assert.equal(exportsOf(f), 0, `${code}: nothing exported`);
      assert.equal(f.server.log.some(([method]) => method === "PUT"), false);
      assert.equal(f.server.tokens.size, 0, `${code}: the copy's session was signed out`);
      if (options.dest) assert.deepEqual(f.server.log, [], "never signed in anywhere else");
    } finally { f.done(); }
  }
  const older = harness({ dest: grantedDestination(windowSession()), desktop: { identity: { appVersion: "0.1.96" } }, server: { identity: { appVersion: "0.1.95" } } });
  try {
    const result = await older.move.move();
    assert.deepEqual([result.error.destVersion, result.error.localVersion], ["0.1.95", "0.1.96"]);
    assert.match(result.error.message, /^bots\.example\.test runs 0\.1\.95; this computer runs 0\.1\.96/);
  } finally { older.done(); }
  // The same versions, an empty server from its own page: it copies.
  const same = harness({ dest: grantedDestination(windowSession()), desktop: { identity: { appVersion: "0.1.96", environmentId: "env-1" } }, server: { identity: { appVersion: "0.1.96", environmentId: "env-2" } } });
  try { assert.equal((await same.move.move({ requireEmpty: true })).phase, "done"); } finally { same.done(); }
});

test("the window's session mints an owner code only when it is a signed-in owner of a server only they use", async () => {
  const minted = windowSession();
  assert.deepEqual(Object.keys(await mintOwnerCode(minted.fetch, VPS)).sort(), ["code", "expiresAt", "origin"]);
  assert.equal((await mintOwnerCode(minted.fetch, VPS)).origin, VPS);
  for (const [code, options] of [
    ["owner_needed", { session: { kind: "session", id: "s1", scopes: ["client"] } }],
    ["owner_needed", { status: 401 }],
    ["owner_needed", { session: { kind: "loopback", scopes: ["admin", "client"] } }],
    ["shared_workspace", { session: { kind: "session", id: "s1", scopes: ["admin", "client"], hosted: true } }],
  ]) {
    const refused = windowSession(options);
    await assert.rejects(mintOwnerCode(refused.fetch, VPS), error => error.code === code);
    assert.equal(refused.calls.some(call => call.method === "POST"), false, `${code}: no code minted`);
  }
  const managed = windowSession({ pairing: json(403, { error: "Your organisation turned off remote access.", code: "managed_policy" }) });
  await assert.rejects(mintOwnerCode(managed.fetch, VPS), error => error.code === "cloud_refused" && error.message === "Your organisation turned off remote access.");
  const offline = { fetch: async () => { throw new TypeError("fetch failed"); } };
  await assert.rejects(mintOwnerCode(offline.fetch, VPS), error => error.code === "network");
});

test("says why a server cannot receive a copy before one starts, one reason each", () => {
  assert.equal(moveRefusal(403, { code: "shared_workspace" }), "shared_workspace");
  assert.equal(moveRefusal(404, {}), "outdated");
  assert.equal(moveRefusal(401, {}), "owner_needed");
  assert.equal(moveRefusal(403, { error: "forbidden" }), "owner_needed");
  assert.equal(moveRefusal(502, {}), "unreachable");
  assert.equal(olderVersion("0.1.95", "0.1.96"), true);
  assert.equal(olderVersion("0.2.0", "0.1.96"), false);
  assert.equal(olderVersion("0.1.96", "0.1.96"), false);
  assert.equal(olderVersion(null, "0.1.96"), false);
  const local = { appVersion: "0.1.96", environmentId: "env-1" };
  assert.equal(moveBlocked({ local, cloud: { appVersion: "0.1.96", environmentId: "env-2" } }), null);
  assert.equal(moveBlocked({ local, cloud: { appVersion: "0.1.96", environmentId: "env-1" } }), "same_computer");
  assert.equal(moveBlocked({ local, cloud: { appVersion: "0.1.90", environmentId: "env-2" } }), "outdated");
  assert.equal(moveBlocked({ refusal: "owner_needed", local }), "owner_needed");
  assert.equal(moveBlocked({ refusal: "unreachable", local }), "unreachable");
  assert.equal(moveBlocked({ local, busyElsewhere: true }), "busy_elsewhere");
});

test("where a copy goes comes from main: this computer's page names a saved server, a server's page gets only itself", () => {
  const LOCAL_PAGE = "http://127.0.0.1:48993";
  const saved = [{ id: "vps", name: "VPS", origin: VPS }, { id: "other", name: "Other", origin: "https://other.example.test" }];
  const localFrame = { url: `${LOCAL_PAGE}/settings` }, localContents = { mainFrame: localFrame };
  const onLocal = { environments: saved, activeId: "local" };
  const ask = (event, context) => moveSenderDestination(event, { contents: localContents, environments: onLocal, localOrigin: LOCAL_PAGE, ...context });
  const local = { sender: localContents, senderFrame: localFrame };
  assert.deepEqual(ask(local, { id: "vps" }), { entry: saved[0], remote: false });
  assert.deepEqual(ask(local, {}), { entry: null, remote: false });
  assert.equal(ask(local, { id: "nope" }), null, "an unknown id");
  assert.equal(ask(local, { id: { origin: "https://evil.example.test" } }), null, "not an id");
  // The server open in this window asks about itself, and names nothing.
  const vpsFrame = { url: `${VPS}/` }, vpsContents = { mainFrame: vpsFrame };
  const onVps = { environments: saved, activeId: "vps" };
  const page = { sender: vpsContents, senderFrame: vpsFrame };
  assert.deepEqual(moveSenderDestination(page, { contents: vpsContents, environments: onVps, localOrigin: LOCAL_PAGE }), { entry: saved[0], remote: true });
  assert.equal(moveSenderDestination(page, { contents: vpsContents, environments: onVps, localOrigin: LOCAL_PAGE, id: "other" }), null, "a server's page naming a destination");
  assert.equal(moveSenderDestination(page, { contents: vpsContents, environments: onLocal, localOrigin: LOCAL_PAGE }), null, "while Local is active");
  assert.equal(moveSenderDestination(page, { contents: vpsContents, environments: { environments: saved, activeId: "other" }, localOrigin: LOCAL_PAGE }), null, "another server is active");
  assert.equal(moveSenderDestination({ sender: vpsContents, senderFrame: { url: `${VPS}/` } }, { contents: vpsContents, environments: onVps, localOrigin: LOCAL_PAGE }), null, "a subframe");
  assert.equal(moveSenderDestination({ sender: {}, senderFrame: vpsFrame }, { contents: vpsContents, environments: onVps, localOrigin: LOCAL_PAGE }), null, "another window");
  const evil = { url: "https://evil.example.test/" }, evilContents = { mainFrame: evil };
  assert.equal(moveSenderDestination({ sender: evilContents, senderFrame: evil }, { contents: evilContents, environments: onVps, localOrigin: LOCAL_PAGE }), null, "a page that is not the saved server");
});

const LOCAL = "http://127.0.0.1:48993";
function preload({ remote = false, activation = false } = {}) {
  let bridge; const invoked = [], listeners = new Map();
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`, "--omb-company-desktop=1"] },
    location: { origin: remote ? ORIGIN : LOCAL }, navigator: { userActivation: { isActive: activation } },
    TextEncoder, localStorage: { getItem: () => null },
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on: (channel, handler) => listeners.set(channel, handler), removeListener() {}, send() {}, invoke: (...args) => { invoked.push(args); return Promise.resolve({ phase: "idle" }); } } }),
  });
  return { bridge, invoked, listeners };
}
test("the bridge forwards only a saved server's id, only from this computer's page; a server's page names nothing and starts a copy only from the person's click", async () => {
  const local = preload();
  for (const method of ["state", "start", "cancel", "restorePrevious", "dismiss"]) await local.bridge.cloudMove[method]({ origin: "https://evil.example.test", token: "forged" });
  assert.deepEqual(local.invoked, [["cloud-move:state"], ["cloud-move:start"], ["cloud-move:cancel"], ["cloud-move:restore-previous"], ["cloud-move:dismiss"]]);
  local.invoked.length = 0;
  for (const method of ["state", "start", "cancel", "restorePrevious", "dismiss"]) await local.bridge.cloudMove[method]("vps");
  assert.deepEqual(local.invoked, [["cloud-move:state", "vps"], ["cloud-move:start", "vps"], ["cloud-move:cancel"], ["cloud-move:restore-previous", "vps"], ["cloud-move:dismiss", "vps"]]);
  const page = preload({ remote: true });
  assert.ok(page.bridge.cloudMove, "a server's card can reach it; main decides whether to answer");
  await assert.rejects(page.bridge.cloudMove.start(), /Choose Copy/);
  assert.deepEqual(page.invoked, []);
  await page.bridge.cloudMove.state("vps"); await page.bridge.cloudMove.dismiss("vps");
  assert.deepEqual(page.invoked, [["cloud-move:state"], ["cloud-move:dismiss"]]);
  const clicked = preload({ remote: true, activation: true });
  await clicked.bridge.cloudMove.start("vps");
  assert.deepEqual(clicked.invoked, [["cloud-move:start"]]);
  // Main opens Settings → Servers on a server's copy panel: only "copy" is a panel name.
  const seen = [];
  local.bridge.environments.onOpenSettings((id, panel) => seen.push([id, panel]));
  for (const panel of ["copy", "evil", undefined]) local.listeners.get("workspaces:open-settings")({}, "vps", panel);
  assert.deepEqual(seen, [["vps", "copy"], ["vps", undefined], ["vps", undefined]]);
});

/** main's copy IPC, run against fakes of what it calls. */
function mainIpc(extra = {}) {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(IPC_START), end = source.indexOf(IPC_END, start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map(), calls = [];
  let engineState = { phase: "idle" };
  localOrigin.setLocalOrigin(LOCAL);
  const describe = dest => ({ id: dest.id, name: dest.name, origin: dest.origin, kind: dest.kind, grant: typeof dest.grant });
  const context = vm.createContext({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: () => {} },
    senderIsLocal: localOrigin.isLocalSender, workspaceSenderAllowed: environments.workspaceSenderAllowed, moveSenderDestination,
    activeEnvironment: environments.activeEnvironment, rendererOrigin: () => LOCAL, desktopRemoteAccess: false,
    mainWindow: { isDestroyed: () => false, webContents: localContents },
    environmentsState: { environments: SAVED, activeId: "local" },
    mintOwnerCode,
    session: { defaultSession: { fetch: async () => { throw new Error("no network in this test"); } } },
    ensureCloudMove: () => ({
      // What main passes is made in its own realm: compared as plain data.
      move: async (dest, options) => { calls.push(["move", describe(dest), options ? JSON.parse(JSON.stringify(options)) : null]); return context.result ?? { phase: "idle" }; },
      cancel: () => { calls.push(["cancel"]); return engineState; }, state: () => engineState,
      restorePrevious: async dest => { calls.push(["restorePrevious", describe(dest)]); return context.result ?? { phase: "idle" }; } }),
    cloudMoveOverview: (dest, onServerPage) => { calls.push(["overview", dest && describe(dest), onServerPage]); return { suggest: false }; },
    dismissCloudMove: origin => calls.push(["dismiss", origin]),
    switchEnvironment: async id => calls.push(["switch", id]),
    navigateMainWindow: url => calls.push(["navigate", url]), slog: () => {},
    openWorkspaceSettings: (id, panel) => calls.push(["openSettings", id, panel]),
    ...extra,
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, handlers, calls, setState: next => { engineState = next; } };
}
const SAVED = [{ id: "vps", name: "VPS", origin: "https://bots.example.test" }, { id: "other", name: "Other", origin: "https://other.example.test" }];
const localFrame = { url: `${LOCAL}/` }, localContents = { mainFrame: localFrame };
const vpsFrame = { url: "https://bots.example.test/" }, vpsContents = { mainFrame: vpsFrame };
const VPS_DEST = { id: "vps", name: "VPS", origin: "https://bots.example.test", kind: "server", grant: "function" };

test("production IPC: this computer's page names a saved server, and each gets its own way in", async () => {
  const { handlers, calls } = mainIpc();
  const local = { sender: localContents, senderFrame: localFrame };
  await handlers.get("cloud-move:state")(local, "vps");
  await handlers.get("cloud-move:start")(local, "vps");
  await handlers.get("cloud-move:restore-previous")(local, "vps");
  await handlers.get("cloud-move:dismiss")(local, "vps");
  await handlers.get("cloud-move:cancel")(local);
  await handlers.get("cloud-move:state")(local);
  assert.deepEqual(calls, [
    ["overview", VPS_DEST, false], ["move", VPS_DEST, null], ["restorePrevious", VPS_DEST],
    ["dismiss", VPS_DEST.origin], ["overview", VPS_DEST, false], ["cancel"], ["overview", null, false],
  ]);
  // A copy needs a server; an id must be one of this app's saved servers.
  assert.throws(() => handlers.get("cloud-move:start")(local), /Choose a server/);
  for (const id of ["nope", { origin: "https://evil.example.test" }]) assert.throws(() => handlers.get("cloud-move:start")(local, id), /only available/);
});

test("production IPC: nothing is local until this computer's origin is", async () => {
  const { context, handlers } = mainIpc();
  const local = { sender: localContents, senderFrame: localFrame };
  // Until main knows this computer's own origin, its page is not this computer's: fail closed.
  context.senderIsLocal = () => false;
  for (const channel of ["cloud-move:state", "cloud-move:start", "cloud-move:restore-previous"]) assert.throws(() => handlers.get(channel)(local, "vps"), /only available/);
  assert.throws(() => handlers.get("cloud-move:state")(local), /only available/);
});

test("production IPC: a server's own page gets only itself, never starts a copy to itself, and cannot swap back", async () => {
  const { context, handlers, calls, setState } = mainIpc();
  context.mainWindow.webContents = vpsContents;
  context.environmentsState = { environments: SAVED, activeId: "vps" };
  const page = { sender: vpsContents, senderFrame: vpsFrame };
  await handlers.get("cloud-move:state")(page);
  // What it says about itself (owner, empty) is its own word: its Copy opens
  // this computer's Settings → Servers on its copy, and sends nothing.
  assert.deepEqual(JSON.parse(JSON.stringify(await handlers.get("cloud-move:start")(page))), { phase: "idle" });
  await handlers.get("cloud-move:dismiss")(page);
  assert.deepEqual(calls, [["overview", VPS_DEST, true], ["openSettings", "vps", "copy"], ["dismiss", VPS_DEST.origin], ["overview", VPS_DEST, true]]);
  // It names no destination, and never swaps back.
  assert.throws(() => handlers.get("cloud-move:start")(page, "other"), /only available/);
  assert.throws(() => handlers.get("cloud-move:restore-previous")(page), /only available/);
  // It stops only a copy to itself.
  calls.length = 0;
  setState({ phase: "uploading", destination: { origin: "https://other.example.test" } });
  await handlers.get("cloud-move:cancel")(page);
  setState({ phase: "uploading", destination: { origin: "https://bots.example.test" } });
  await handlers.get("cloud-move:cancel")(page);
  assert.deepEqual(calls, [["cancel"]]);
  // A subframe, another window, a page that is not the active server, or a companion: nothing.
  for (const event of [{ sender: vpsContents, senderFrame: { url: `${VPS}/` } }, { sender: {}, senderFrame: vpsFrame }, { sender: vpsContents, senderFrame: { url: "https://evil.example.test/" } }]) {
    for (const channel of ["cloud-move:state", "cloud-move:start", "cloud-move:cancel", "cloud-move:dismiss", "cloud-move:restore-previous"]) assert.throws(() => handlers.get(channel)(event), /only available/);
  }
  context.desktopRemoteAccess = true;
  assert.throws(() => handlers.get("cloud-move:start")({ sender: vpsContents, senderFrame: vpsFrame }), /only available/);
});

test("production IPC: a finished copy opens the server it went to", async () => {
  const { context, handlers, calls } = mainIpc();
  context.result = { phase: "done", action: "move" };
  const local = { sender: localContents, senderFrame: localFrame };
  await handlers.get("cloud-move:start")(local, "vps");
  // Already open (that server's own page started it): it reloads.
  context.mainWindow.webContents = vpsContents;
  context.environmentsState = { environments: SAVED, activeId: "vps" };
  context.result = { phase: "done", action: "move" };
  const vpsPage = { sender: vpsContents, senderFrame: vpsFrame };
  await handlers.get("cloud-move:start")(vpsPage);
  assert.deepEqual(calls.filter(([kind]) => kind !== "move"), [["switch", "vps"], ["openSettings", "vps", "copy"]]);
  calls.length = 0;
  context.mainWindow.webContents = localContents;
  context.environmentsState = { environments: SAVED, activeId: "local" };
  context.result = { phase: "failed", error: { code: "network" } };
  await handlers.get("cloud-move:start")(local, "vps");
  assert.deepEqual(calls.filter(([kind]) => kind !== "move"), []);
});

test("a server's Copy opens this computer's Settings → Servers on that server's copy, in this window or by switching it to this computer", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("function openWorkspaceSettings("), end = source.indexOf("\n}\n", start) + 3;
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = vm.createContext({ LOCAL_ID: "local", rendererOrigin: () => LOCAL, environmentsState: { environments: SAVED, activeId: "vps" },
    withActive: (state, id) => ({ ...state, activeId: id }), persistEnvironments: state => calls.push(["persist", state.activeId]),
    navigateMainWindow: url => calls.push(["navigate", url]), senderIsLocal: ({ sender }) => sender === localContents,
    mainWindow: { isDestroyed: () => false, webContents: { ...vpsContents, send: (...args) => calls.push(["send", ...args]) } } });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.openWorkspaceSettings = openWorkspaceSettings;`, context);
  // On a server's page: this window switches to this computer, on that server's copy panel.
  context.openWorkspaceSettings("vps", "copy");
  context.openWorkspaceSettings("vps");
  assert.deepEqual(calls, [["persist", "local"], ["navigate", `${LOCAL}/?desktop-settings=workspaces&copy-to=vps`],
    ["persist", "local"], ["navigate", `${LOCAL}/?desktop-settings=workspaces&share-computer=vps`]]);
  // Already on this computer's page: one message names the server and the panel.
  calls.length = 0;
  const send = (...args) => calls.push(["send", ...args]);
  context.mainWindow = { isDestroyed: () => false, webContents: localContents };
  localContents.send = send;
  try {
    context.openWorkspaceSettings("vps", "copy");
    context.openWorkspaceSettings("vps");
  } finally { delete localContents.send; }
  assert.deepEqual(calls, [["send", "workspaces:open-settings", "vps", "copy"], ["send", "workspaces:open-settings", "vps"]]);
});
