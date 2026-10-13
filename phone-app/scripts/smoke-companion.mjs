#!/usr/bin/env node
// End-to-end smoke for the phone client against an ISOLATED fixture
// harness + companion sidecar (the same arrangement
// scripts/capture-companion-fixtures.mjs uses in the server repo).
//
//   node scripts/smoke-companion.mjs
//
// Exercises the app's own code paths: QR link parsing, /api/pair redemption
// through the endpoint walk, the authed API, and the SSE event stream.
// Nothing touches the real ~/.openmausbot — HOME is a temp dir.

import { register } from "node:module";
register("./resolve-ts.mjs", import.meta.url);

const { parsePairingLink } = await import("../src/lib/pairing.ts");
const { Client, redeemPairing } = await import("../src/lib/client.ts");
const { openEvents } = await import("../src/lib/events.ts");

const { spawn } = await import("node:child_process");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { dirname, join, resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(APP_DIR, ".."); // the OpenMausBot checkout
const base = 23100 + Math.floor(Math.random() * 2000);
const HARNESS_PORT = base;
const COMPANION_PORT = base + 10;
const CONTROL_PORT = base + 11;
const SIDECAR = `http://127.0.0.1:${COMPANION_PORT}`;
const CONTROL = `http://127.0.0.1:${CONTROL_PORT}`;

const children = [];
const home = mkdtempSync(join(tmpdir(), "omb-phone-smoke-"));
mkdirSync(join(home, ".openmausbot"), { recursive: true });
writeFileSync(
  join(home, ".openmausbot", "config.json"),
  JSON.stringify({
    profile: { name: "Smoke Tester", email: "smoke@example.com" },
    instances: {
      claude: {
        driver: "claudeAgent",
        displayName: "Fixture engine",
        config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") },
      },
    },
  }),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = (label, args, env) => {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { PATH: dirname(process.execPath), SystemRoot: process.env.SystemRoot, TZ: "UTC", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (c) => (child.err = (child.err ?? "") + c));
  children.push(child);
  return child;
};
const waitFor = async (url, label, child) => {
  const deadline = Date.now() + 40_000;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* booting */
    }
    if (child.exitCode !== null) throw new Error(`${label} exited:\n${child.err}`);
    if (Date.now() > deadline) throw new Error(`${label} never came up:\n${child.err}`);
    await sleep(150);
  }
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  const harness = start("harness", [join(ROOT, "server", "index.ts")], {
    HOME: home,
    USERPROFILE: home,
    OMB_PORT: String(HARNESS_PORT),
    OMB_WEBHOOK_PORT: String(base + 1),
    FAKE_CLAUDE_MODE: "happy",
  });
  await waitFor(`http://127.0.0.1:${HARNESS_PORT}/api/health`, "harness", harness);

  const sidecar = start("companion", [join(ROOT, "companion", "src", "index.ts")], {
    HOME: home,
    USERPROFILE: home,
    OMB_PORT: String(HARNESS_PORT),
    OMB_WEBHOOK_PORT: String(base + 1),
    OMB_COMPANION_PORT: String(COMPANION_PORT),
    OMB_CONTROL_PORT: String(CONTROL_PORT),
    OMB_COMPANION_DIR: join(home, "companion"),
  });
  await waitFor(`${CONTROL}/state`, "companion", sidecar);

  // 1. open a pairing window on the control plane, as the desktop does
  const window = await (await fetch(`${CONTROL}/pairing`, { method: "POST" })).json();
  check("pairing window opened", Boolean(window.code && window.token));

  // 2. build the exact QR payload the desktop prints and parse it back
  const endpoints = [{ url: SIDECAR, kind: "lan", priority: 200 }];
  const encoded = Buffer.from(JSON.stringify(endpoints)).toString("base64url");
  const link =
    `openmausbot://pair?address=${encodeURIComponent(`127.0.0.1:${COMPANION_PORT}`)}` +
    `&token=${window.token}&code=${window.code}&name=${encodeURIComponent("Smoke's computer")}` +
    `&endpoints=${encoded}`;
  const invite = parsePairingLink(link);
  check("QR link parses", Boolean(invite && invite.token === window.token));
  check("QR carries an endpoint", Boolean(invite?.endpoints.some((e) => e.url === SIDECAR)));

  // 3. redeem through the app's endpoint walk (with a dead route up front,
  //    like a stale LAN IP in a real QR)
  invite.endpoints.unshift({ url: "http://127.0.0.1:9", kind: "lan", priority: 150 });
  let paired = null;
  for (const endpoint of invite.endpoints) {
    paired = await redeemPairing(endpoint, invite, "Smoke Android", "smoke-request-0001");
    if (paired) break;
  }
  check("pairing redeems a device token", Boolean(paired?.token?.startsWith("omb_")));

  // 3b. the manual path: a fresh window redeemed by six-digit code alone.
  //     Regression test — a fake `omb_pair_…` credential here would win
  //     server-side over the code and always come back "not right".
  const window2 = await (await fetch(`${CONTROL}/pairing`, { method: "POST" })).json();
  const manual = await redeemPairing(
    { url: SIDECAR, kind: "lan", priority: 200 },
    { token: "", code: window2.code },
    "Smoke Manual",
    "smoke-request-0002",
  );
  check("manual code-only pairing redeems", Boolean(manual?.token?.startsWith("omb_")));

  // 4. the authed API through Client
  const session = {
    token: paired.token,
    deviceId: paired.device.id,
    deviceName: paired.device.name,
    serverName: paired.serverName,
    endpoints: paired.endpoints?.length ? paired.endpoints : invite.endpoints,
  };
  const client = new Client(session);
  const fleet = await client.api("/api/bots?messages=5");
  check("GET /api/bots returns the fleet", Array.isArray(fleet.bots) && fleet.bots.length >= 1);
  const bot = fleet.bots[0];

  const sent = await client.api(`/api/bots/${bot.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "hello from smoke", threadId: bot.threadId }),
  }).then(() => true).catch((e) => e);
  check("POST bot message", sent === true, sent === true ? "" : String(sent?.message ?? sent));

  const page = await client.api(`/api/threads/${bot.threadId}/messages?limit=10`);
  check(
    "thread page includes the sent line",
    (page.messages ?? []).some((m) => m.text === "hello from smoke"),
  );

  // 5. SSE: connect, then send another message and expect its frame
  const frames = [];
  const events = openEvents(client, {
    onFrame: (f) => frames.push(f),
    onGap: () => frames.push({ kind: "gap" }),
  });
  await sleep(800);
  await client.api(`/api/bots/${bot.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "stream me", threadId: bot.threadId }),
  });
  const deadline = Date.now() + 10_000;
  while (!frames.some((f) => f.kind === "message" && f.message?.text === "stream me")) {
    if (Date.now() > deadline) break;
    await sleep(150);
  }
  check("SSE hello frame", frames.some((f) => f.kind === "hello"));
  check(
    "SSE delivered the message frame",
    frames.some((f) => f.kind === "message" && f.message?.text === "stream me"),
  );
  events.close();

  // 6. endpoint refresh is harmless
  await client.refreshEndpoints();
  check("endpoint refresh keeps a working base", Boolean(client.baseUrl));
} finally {
  for (const child of children) child.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true, maxRetries: 3 });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
