import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { appPermissionAllowed, appPermissionHandlers, externalWebUrl, remoteClipboardWriteAllowed } from "./app-permissions.mjs";

const LOCAL_ORIGIN = "http://127.0.0.1:5199";
const LOCAL_PAGE = "http://127.0.0.1:5199/chat?botId=bot-1";

test("grants notifications, clipboard, and fullscreen to the local renderer page", () => {
  for (const permission of ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), true, permission);
  }
});

test("accepts a bare origin or a full URL on either side", () => {
  assert.equal(appPermissionAllowed("notifications", LOCAL_ORIGIN, LOCAL_ORIGIN), true);
  assert.equal(appPermissionAllowed("notifications", `${LOCAL_ORIGIN}/settings#voice`, `${LOCAL_ORIGIN}/`), true);
  assert.equal(appPermissionAllowed("fullscreen", "http://127.0.0.1:8799/chat", "http://127.0.0.1:8799"), true);
});

test("allows media for audio (microphone) and guarded display-capture, denies video (camera)", () => {
  // Audio only: allowed
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio"] }), true);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "audio" }), true);

  // Guarded display-capture path: Electron 43 routes getDisplayMedia through permission="media"
  // with an empty mediaTypes array before dispatching to setDisplayMediaRequestHandler
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: [] }), true);

  // Video / camera: strictly denied
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio", "video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "video" }), false);

  // Unknown or omitted details: fail closed
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "unknown" }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, {}), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("refuses permissions to any other origin", () => {
  assert.equal(appPermissionAllowed("notifications", "https://other.example/chat", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("clipboard-read", "http://127.0.0.1:5200/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("media", "https://127.0.0.1:5199/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("fullscreen", "http://localhost:5199/", LOCAL_ORIGIN), false);
});

test("keeps every privileged capability off even for the local renderer page", () => {
  const privileged = [
    "geolocation", "camera", "usb", "hid", "serial", "midi", "midiSysex",
    "display-capture", "fileSystem", "openExternal", "idle-detection", "speaker-selection",
    "window-management", "storage-access", "top-level-storage-access", "pointerLock",
    "keyboardLock", "mediaKeySystem", "unknown",
  ];
  for (const permission of privileged) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), false, permission);
  }
  assert.equal(appPermissionAllowed(undefined, LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("rejects mixed, unknown, and conflicting media details", () => {
  for (const details of [
    { mediaTypes: ["audio", "unknown"] }, { mediaTypes: ["unknown"] },
    { mediaType: "audio", mediaTypes: ["video"] },
    { mediaType: "unknown", mediaTypes: [] }, { mediaTypes: "audio" }, null,
  ]) assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, details), false);
});

test("web links reject embedded credentials and non-web schemes", () => {
  assert.equal(externalWebUrl("https://example.com/help?q=hello#more"), "https://example.com/help?q=hello#more");
  assert.equal(externalWebUrl("http://127.0.0.1:8799"), "http://127.0.0.1:8799/");
  for (const url of ["https://user:pass@example.com", "http://user@example.com", "https://:pass@example.com"])
    assert.throws(() => externalWebUrl(url), /credentials/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "mailto:test@example.com"])
    assert.throws(() => externalWebUrl(url), /Only web/);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalWebUrl(url), /web address/);
});

test("both external-link entry points use the policy and IPC retains the local-origin gate", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("desktop:open-external", localOnly\("desktop:open-external"/);
  assert.match(main, /shell\.openExternal\(externalWebUrl\(rawUrl\)\)/);
  assert.match(main, /shell\.openExternal\(externalWebUrl\(url\)\)/);
});

test("fails closed on unparsable or opaque origins", () => {
  assert.equal(appPermissionAllowed("notifications", "not a url", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", "", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", undefined, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", null, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, "not a url"), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, undefined), false);
  // Opaque origins all serialise as "null"; two of them must never match.
  assert.equal(appPermissionAllowed("notifications", "data:text/html,x", "about:blank"), false);
  assert.equal(appPermissionAllowed("notifications", "javascript:alert(1)", LOCAL_ORIGIN), false);
});

// ── The active saved server, open in this app's window ──
// A saved server's page may write the clipboard (its copy buttons) and, once
// the person said yes to that server's first microphone request, hear the
// microphone for a Live call: in the main frame of the main window, at the
// exact origin the active environment reports. Every other server, and every
// other capability, stays refused.
const REMOTE = "https://viernes.tail1.ts.net:9444";
function remoteFixture({ origin = REMOTE, microphone = true } = {}) {
  const main = { getURL: () => `${REMOTE}/chat?botId=bot-1` };
  const state = { origin, main, microphone, asks: [] };
  const handlers = appPermissionHandlers({
    rendererOrigin: () => LOCAL_ORIGIN,
    mainContents: () => state.main,
    activeRemoteOrigin: () => state.origin,
    activeRemoteMicrophone: () => state.microphone,
    askRemoteMicrophone: (asked) => { state.asks.push(asked); return state.asking ?? null; },
  });
  const ask = (permission, details, contents = state.main) => {
    let granted;
    const done = new Promise((resolve) => {
      handlers.request(contents, permission, (value) => { granted = value; resolve(value); }, details);
    });
    return { get value() { return granted; }, done };
  };
  const check = (permission, requestingOrigin, details, contents = state.main) => handlers.check(contents, permission, requestingOrigin, details);
  return { state, ask, check };
}
const onRemote = (fields = {}) => ({ requestingUrl: `${REMOTE}/chat?botId=bot-1`, isMainFrame: true, ...fields });

test("the active server the person allowed may use the microphone", () => {
  const { ask, check } = remoteFixture();
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, true);
  assert.equal(check("media", REMOTE, { requestingUrl: `${REMOTE}/`, isMainFrame: true, mediaType: "audio" }), true);
});

test("an unanswered microphone request waits for the person's answer, then follows it", async () => {
  const { state, ask } = remoteFixture({ microphone: false });
  let answer;
  state.asking = new Promise((resolve) => { answer = resolve; });
  const mic = ask("media", onRemote({ mediaTypes: ["audio"] }));
  await Promise.resolve();
  assert.equal(mic.value, undefined, "decided once the person answers, not refused for being early");
  assert.deepEqual(state.asks, [REMOTE]);
  answer();
  assert.equal(await mic.done, false, "still unanswered on the record");
  state.microphone = true;
  state.asking = Promise.resolve();
  assert.equal(await ask("media", onRemote({ mediaTypes: ["audio"] })).done, true);
});

test("the remote server never gets the camera, screen capture or any other capability but clipboard writes", () => {
  const { ask, check } = remoteFixture();
  for (const mediaTypes of [["video"], ["audio", "video"], [], ["unknown"]]) {
    assert.equal(ask("media", onRemote({ mediaTypes })).value, false, JSON.stringify(mediaTypes));
  }
  assert.equal(ask("media", onRemote()).value, false, "media with no type");
  assert.equal(check("media", REMOTE, { isMainFrame: true, mediaType: "video" }), false);
  assert.equal(check("media", REMOTE, { isMainFrame: true, mediaType: "unknown" }), false);
  for (const permission of ["notifications", "clipboard-read", "fullscreen", "geolocation", "display-capture", "camera"]) {
    assert.equal(ask(permission, onRemote()).value, false, permission);
    assert.equal(check(permission, REMOTE, { isMainFrame: true }), false, permission);
    // Audio details on another permission do not make it the microphone.
    assert.equal(ask(permission, onRemote({ mediaTypes: ["audio"] })).value, false, `${permission} with audio details`);
    assert.equal(check(permission, REMOTE, { isMainFrame: true, mediaType: "audio" }), false, `${permission} with audio details`);
  }
});

test("the remote server's microphone is decided by this computer's media rule, never a copy of it", () => {
  // One rule says what counts as the microphone. The remote page only narrows
  // it (its own origin, the main frame, no screen capture), so a new media
  // shape this computer accepts or refuses is accepted or refused there too.
  const { ask } = remoteFixture();
  const shapes = [
    {}, { mediaType: "audio" }, { mediaType: "video" }, { mediaTypes: ["audio"] }, { mediaTypes: ["audio", "audio"] },
    { mediaTypes: ["video"] }, { mediaTypes: ["audio", "video"] }, { mediaTypes: ["audio"], mediaType: "video" },
    { mediaTypes: null }, { mediaTypes: "audio" }, { mediaTypes: [""] },
  ];
  for (const shape of shapes) {
    const details = { isMainFrame: true, ...shape };
    assert.equal(ask("media", onRemote(shape)).value,
      appPermissionAllowed("media", REMOTE, REMOTE, details), JSON.stringify(shape));
  }
});

test("a server that is not the active one never hears the microphone", () => {
  const { state, ask, check } = remoteFixture();
  const mic = { isMainFrame: true, mediaTypes: ["audio"] };
  for (const other of ["https://my-vps.example.com", "http://viernes.tail1.ts.net:9444", "https://viernes.tail1.ts.net:8443", "https://evil.ts.net"]) {
    assert.equal(ask("media", { ...mic, requestingUrl: `${other}/chat` }).value, false, other);
    assert.equal(check("media", other, { isMainFrame: true, mediaType: "audio" }), false, other);
  }
  // The active server's own page in a subframe, or in any other window, does not count.
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"], isMainFrame: false })).value, false, "a subframe");
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] }), { getURL: () => `${REMOTE}/` }).value, false, "another window");
  assert.equal(check("media", REMOTE, { isMainFrame: true, mediaType: "audio" }, null), false, "no window");
  state.main = null;
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, false, "the main window is gone");
});

test("switching servers, or forgetting the microphone answer, withdraws it at once", () => {
  const { state, ask } = remoteFixture();
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, true);
  state.origin = null;
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, false);
  state.origin = "not a url";
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, false);
  state.origin = REMOTE;
  state.microphone = false;
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })).value, false, "not answered yet");
});

test("the active remote server may write the clipboard, by its own rule", () => {
  const write = "clipboard-sanitized-write";
  const { state, ask, check } = remoteFixture();
  assert.equal(ask(write, onRemote()).value, true);
  assert.equal(check(write, REMOTE, { requestingUrl: `${REMOTE}/`, isMainFrame: true }), true);
  // Never reading it.
  assert.equal(ask("clipboard-read", onRemote()).value, false);
  assert.equal(check("clipboard-read", REMOTE, { isMainFrame: true }), false);
  // Never a subframe, or no frame information.
  assert.equal(ask(write, onRemote({ isMainFrame: false })).value, false, "a subframe");
  assert.equal(check(write, REMOTE, { isMainFrame: false }), false, "a subframe");
  assert.equal(check(write, REMOTE, {}), false, "no frame information");
  // Never another origin.
  for (const other of ["https://my-vps.example.com", "http://viernes.tail1.ts.net:9444", "https://viernes.tail1.ts.net:8443", "https://evil.ts.net"]) {
    assert.equal(ask(write, { requestingUrl: `${other}/chat`, isMainFrame: true }).value, false, other);
    assert.equal(check(write, other, { isMainFrame: true }), false, other);
  }
  // Never another window, or with no window at all.
  assert.equal(ask(write, onRemote(), { getURL: () => `${REMOTE}/` }).value, false, "another window");
  assert.equal(check(write, REMOTE, { isMainFrame: true }, null), false, "no window");
  // No active remote server (Local, or a damaged value): withdrawn at once.
  for (const origin of [null, "not a url", "about:blank"]) {
    state.origin = origin;
    assert.equal(ask(write, onRemote()).value, false, String(origin));
    assert.equal(check(write, REMOTE, { isMainFrame: true }), false, String(origin));
  }
  state.origin = REMOTE;
  state.main = null;
  assert.equal(ask(write, onRemote(), { getURL: () => `${REMOTE}/` }).value, false, "the main window is gone");
});

test("this computer's own page keeps its permissions through the same handlers", () => {
  const { ask, check } = remoteFixture({ origin: null });
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["audio"] }, local).value, true);
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: [] }, local).value, true, "guarded display capture");
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["video"] }, local).value, false);
  assert.equal(ask("notifications", { requestingUrl: LOCAL_PAGE, isMainFrame: true }, local).value, true);
  // No requesting URL: the window's own address decides, as before.
  assert.equal(ask("notifications", {}, local).value, true);
  assert.equal(check("clipboard-read", "", { isMainFrame: true }, local), true);
  assert.equal(check("clipboard-read", "https://other.example", { isMainFrame: true }, local), false);
});

test("the app installs these handlers, wired to the active saved server", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /setPermissionRequestHandler\(appPermissions\.request\)/);
  assert.match(main, /setPermissionCheckHandler\(appPermissions\.check\)/);
  // perm:status's pageMic asks these very handlers: one module-level set,
  // never a second const that would leave perm:status answering "refused".
  assert.match(main, /ipcMain\.handle\("perm:status", \(event\) => \(\{[^}]*pageMic: appPermissions\?\.pageMicrophone\(event\) \?\? "refused",/s);
  assert.match(main, /^let appPermissions = null;$/m);
  assert.match(main, /^  appPermissions = appPermissionHandlers\(\{$/m);
  assert.doesNotMatch(main, /(const|let|var) appPermissions = appPermissionHandlers/);
  assert.match(main, /activeRemoteOrigin: \(\) => activeEnvironment\(environmentsState\)\?\.origin \?\? null,/);
  assert.match(main, /activeRemoteMicrophone: \(\) => activeEnvironment\(environmentsState\)\?\.microphone === true,/);
  assert.match(main, /askRemoteMicrophone,/);
});

// ── What a page is told when its microphone is refused ──
// perm:status answers `pageMic` for the asking page, so a blocked Live call
// can say who blocked it: this app (then a web browser can make the call) or
// the computer (then its privacy settings can). The answer is the request
// handler's own, never a second copy of the rule.
const ipcFrom = (contents, frameUrl, { mainFrame = true } = {}) => {
  const frame = { url: frameUrl };
  if (mainFrame) contents.mainFrame = frame;
  else contents.mainFrame ??= { url: contents.getURL() };
  return { sender: contents, senderFrame: frame };
};
const pageMicFixture = () => {
  const state = { origin: REMOTE, main: { getURL: () => `${REMOTE}/chat?botId=bot-1` }, microphone: true };
  const handlers = appPermissionHandlers({
    rendererOrigin: () => LOCAL_ORIGIN,
    mainContents: () => state.main,
    activeRemoteOrigin: () => state.origin,
    activeRemoteMicrophone: () => state.microphone,
  });
  return { state, handlers };
};

test("a page asking about its microphone hears whether this app lets it use it", () => {
  const { state, handlers } = pageMicFixture();
  assert.equal(handlers.pageMicrophone(ipcFrom(state.main, `${REMOTE}/chat?botId=bot-1`)), "allowed", "the allowed active server");
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(handlers.pageMicrophone(ipcFrom(local, LOCAL_PAGE)), "allowed", "this computer's own page");
  state.main = { getURL: () => "https://my-vps.example.com/chat" };
  assert.equal(handlers.pageMicrophone(ipcFrom(state.main, "https://my-vps.example.com/chat")), "refused", "another server");
});

test("a server's page is refused where its microphone request would be", () => {
  const { state, handlers } = pageMicFixture();
  assert.equal(handlers.pageMicrophone(ipcFrom(state.main, `${REMOTE}/frame`, { mainFrame: false })), "refused", "a subframe");
  const other = { getURL: () => `${REMOTE}/` };
  assert.equal(handlers.pageMicrophone(ipcFrom(other, `${REMOTE}/`)), "refused", "another window");
  assert.equal(handlers.pageMicrophone({ sender: state.main, senderFrame: null }), "refused", "a frame that is gone");
  assert.equal(handlers.pageMicrophone(undefined), "refused", "no sender");
  state.microphone = false;
  assert.equal(handlers.pageMicrophone(ipcFrom(state.main, `${REMOTE}/chat`)), "refused", "not answered yet");
});

// The request may decide later (Electron's callback allows it), so the test
// waits for its answer rather than reading it as the call returns.
test("the page's answer is the request handler's answer for its microphone", async () => {
  const { state, handlers } = pageMicFixture();
  const local = { getURL: () => LOCAL_PAGE };
  const other = { getURL: () => `${REMOTE}/` };
  for (const origin of [REMOTE, null, "https://evil.ts.net"]) {
    state.origin = origin;
    for (const contents of [state.main, local, other]) {
      for (const url of [`${REMOTE}/chat`, LOCAL_PAGE, "https://my-vps.example.com/", "http://viernes.tail1.ts.net:9444/"]) {
        for (const mainFrame of [true, false]) {
          const granted = await new Promise((resolve) => {
            handlers.request(contents, "media", resolve, { requestingUrl: url, isMainFrame: mainFrame, mediaTypes: ["audio"] });
          });
          const label = JSON.stringify({ origin, page: contents.getURL(), url, mainFrame });
          assert.equal(await handlers.pageMicrophone(ipcFrom(contents, url, { mainFrame })), granted ? "allowed" : "refused", label);
        }
      }
    }
  }
});

test("a remote server may write clipboard text only as the active origin's main frame", () => {
  const write = "clipboard-sanitized-write";
  assert.equal(remoteClipboardWriteAllowed(write, `${REMOTE}/chat?x=1`, REMOTE, { isMainFrame: true }), true);
  assert.equal(remoteClipboardWriteAllowed(write, REMOTE, `${REMOTE}/`, { isMainFrame: true }), true);
  // Read and everything else stay denied for the same trusted origin.
  for (const permission of ["clipboard-read", "notifications", "fullscreen", "media", "geolocation", "camera", "openExternal", "unknown", undefined]) {
    assert.equal(remoteClipboardWriteAllowed(permission, REMOTE, REMOTE, { isMainFrame: true }), false, String(permission));
  }
  // Frame requirement: a child frame, or no frame information, never counts.
  for (const details of [{ isMainFrame: false }, {}, undefined, null, { isMainFrame: "true" }]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, REMOTE, details), false);
  }
  // Exact origin only.
  for (const requesting of [
    "https://viernes.tail1.ts.net:9445/", "https://viernes.tail1.ts.net/", "http://viernes.tail1.ts.net:9444/",
    "https://other.tail1.ts.net:9444/", "https://viernes.tail1.ts.net.evil.test:9444/", "https://evil.test/#https://viernes.tail1.ts.net:9444",
    "about:blank", "data:text/html,x", "javascript:alert(1)", "not a url", "", null, undefined,
  ]) assert.equal(remoteClipboardWriteAllowed(write, requesting, REMOTE, { isMainFrame: true }), false, String(requesting));
  // No active remote server (Local, or a damaged value): nothing to match.
  for (const active of [undefined, null, "", "not a url", "about:blank", "data:text/html,x"]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, active, { isMainFrame: true }), false, String(active));
    assert.equal(remoteClipboardWriteAllowed(write, "about:blank", active, { isMainFrame: true }), false);
  }
});

test("the base policy itself still grants a remote origin nothing", () => {
  for (const permission of ["clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, REMOTE, LOCAL_ORIGIN, { isMainFrame: true }), false, permission);
  }
});
