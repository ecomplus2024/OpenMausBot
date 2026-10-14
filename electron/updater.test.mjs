import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import environments from "./environments.cjs";
import localOriginModule from "./local-origin.cjs";

const LOCAL = "http://127.0.0.1:8799";
const OTHER = "https://bots.example.test";

const fixture = vi.hoisted(() => ({ autoUpdater: null, handlers: new Map() }));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => "/unused-updater-test-log" },
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: (name, handler) => fixture.handlers.set(name, handler) },
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({ autoUpdater: fixture.autoUpdater }),
}));

/** A page in the main window: its contents, and an IPC event it sends. */
function page(origin) {
  const mainFrame = { url: `${origin}/` };
  const webContents = { mainFrame, send: vi.fn() };
  return { webContents, event: { sender: webContents, senderFrame: mainFrame } };
}

/** main.mjs's own rule for who may use the updater, run against fakes of the
 * window and the saved servers it reads. */
function mainRule() {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("// ── Who asks, and where to"), end = source.indexOf("// ── end Copy this computer here ──", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  // main registers the updater's channels with exactly this rule.
  expect(source.includes("registerUpdaterIpc({ pageAllowed: updaterPageAllowed });"), "main.mjs wires the updater to updaterPageAllowed").toBe(true);
  const window = { isDestroyed: () => false, webContents: null };
  const context = vm.createContext({
    ipcMain: { handle: () => {}, on: () => {} },
    senderIsLocal: localOriginModule.isLocalSender, workspaceSenderAllowed: environments.workspaceSenderAllowed,
    activeEnvironment: environments.activeEnvironment, rendererOrigin: () => LOCAL, desktopRemoteAccess: false,
    mainWindow: window,
    environmentsState: { environments: [], activeId: environments.LOCAL_ID },
    named: value => value,
    moveSender: () => { throw new Error("unavailable"); },
    cloudMoveOverview: () => ({}),
    ensureCloudMove: () => ({}),
    dismissCloudMove: () => {},
  });
  vm.runInContext(source.slice(start, end), context);
  const show = (shown, activeId = environments.LOCAL_ID) => {
    window.webContents = shown.webContents;
    context.environmentsState = {
      environments: [{ id: "vps", name: "VPS", origin: OTHER }],
      activeId,
    };
  };
  return { context, window, show, pageAllowed: vm.runInContext("updaterPageAllowed", context) };
}

/** A fresh updater module with a fake electron-updater behind it. */
async function load(pageAllowed) {
  vi.resetModules();
  fixture.handlers.clear();
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = vi.fn(async () => {
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "2.0.0" });
    return { isUpdateAvailable: true };
  });
  autoUpdater.downloadUpdate = vi.fn(async () => {
    autoUpdater.emit("download-progress", { percent: 50 });
    autoUpdater.emit("update-downloaded", { version: "2.0.0" });
    return ["/unused-staged-update.zip"];
  });
  autoUpdater.quitAndInstall = vi.fn();
  fixture.autoUpdater = autoUpdater;
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed });
  return { updater, autoUpdater, handlers: fixture.handlers };
}

const settle = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

beforeEach(() => {
  localOriginModule.setLocalOrigin(LOCAL);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** The bridge preload.cjs gives a page at `origin`. */
function bridgeFor(origin, { clicked = false } = {}) {
  let bridge;
  const invoked = [];
  vm.runInNewContext(readFileSync(new URL("./preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] },
    location: { origin }, navigator: { userActivation: { isActive: clicked } },
    TextEncoder, localStorage: { getItem: () => null },
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: {
        on() {}, removeListener() {}, send() {},
        sendSync: () => undefined,
        invoke: (...args) => { invoked.push(args); return Promise.resolve({ status: "idle" }); },
      },
    }),
  });
  return { bridge, invoked };
}

it("this computer's page gets the update bridge; a server's page never does", async () => {
  const local = bridgeFor(LOCAL);
  expect(Object.keys(local.bridge.updater).sort()).toEqual(["check", "install", "onState"]);
  await local.bridge.updater.install();
  expect(local.invoked).toEqual([["update:install"]]);

  const remote = bridgeFor(OTHER);
  expect("updater" in remote.bridge).toBe(false);
  const clicked = bridgeFor(OTHER, { clicked: true });
  expect("updater" in clicked.bridge).toBe(false);
});

it("a downloaded update installs when the app quits, except a system package, which is the person's to install", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const resourcesPath = process.resourcesPath;
  const appImage = process.env.APPIMAGE;
  const resources = mkdtempSync(join(tmpdir(), "omb-updater-package-"));
  try {
    for (const [os, marker, image, installsOnQuit] of [
      ["darwin", null, null, true],
      ["win32", null, null, true],
      ["linux", null, "/home/a/OpenMausBot.AppImage", true],
      ["linux", "deb", null, false],
      ["linux", "rpm", null, false],
    ]) {
      Object.defineProperty(process, "platform", { ...platform, value: os });
      process.resourcesPath = resources;
      rmSync(join(resources, "package-type"), { force: true });
      if (marker) writeFileSync(join(resources, "package-type"), marker);
      if (image) process.env.APPIMAGE = image;
      else delete process.env.APPIMAGE;
      const { updater, autoUpdater } = await load(() => false);
      updater.startUpdater();
      expect(autoUpdater.autoInstallOnAppQuit, `${os} ${marker ?? image ?? ""}`).toBe(installsOnQuit);
      // Nothing is installed by itself before then: the coordinator owns the download.
      expect(autoUpdater.autoDownload).toBe(false);
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
    process.resourcesPath = resourcesPath;
    if (appImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = appImage;
    rmSync(resources, { recursive: true, force: true });
  }
});

it("downloads an update by itself: the first check after launch starts it, and nothing restarts", async () => {
  const rule = mainRule();
  const local = page(LOCAL);
  rule.show(local);
  const { updater, autoUpdater } = await load(rule.pageAllowed);
  updater.attachUpdaterWindow(rule.window);
  updater.startUpdater();

  await vi.advanceTimersByTimeAsync(15_000);
  await settle();

  expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  const statuses = local.webContents.send.mock.calls.map(([, state]) => state.status);
  expect(statuses).not.toContain("available");
  expect(statuses.at(-1)).toBe("downloaded");
});

it("this computer's page reads and drives the update channels, and a server's page is refused", async () => {
  const rule = mainRule();
  const { handlers } = await load(rule.pageAllowed);
  // There is no Download step left to ask for.
  expect([...handlers.keys()].sort()).toEqual(["update:check", "update:get-state", "update:install"]);

  const local = page(LOCAL);
  rule.show(local);
  for (const channel of handlers.keys()) expect(() => handlers.get(channel)(local.event), channel).not.toThrow();

  const other = page(OTHER);
  rule.show(other, "vps");
  for (const channel of handlers.keys()) expect(() => handlers.get(channel)(other.event), channel).toThrow(/only available/);
  // Nor may a page that only claims this computer's address, or a frame inside it.
  expect(() => handlers.get("update:get-state")({ sender: other.webContents, senderFrame: { url: `${LOCAL}/` } })).toThrow(/only available/);
  rule.show(local);
  expect(() => handlers.get("update:get-state")({ sender: local.webContents, senderFrame: { url: `${OTHER}/` } })).toThrow(/only available/);
});

it("sends update news only to a page allowed to read it", async () => {
  const rule = mainRule();
  const { updater, autoUpdater, handlers } = await load(rule.pageAllowed);
  updater.attachUpdaterWindow(rule.window);
  updater.startUpdater();

  let finish;
  autoUpdater.downloadUpdate = vi.fn(() => new Promise((resolve) => { finish = resolve; }).then(() => {
    autoUpdater.emit("update-downloaded", { version: "2.0.0" });
    return ["/unused-staged-update.zip"];
  }));

  const other = page(OTHER);
  rule.show(other, "vps");
  await vi.advanceTimersByTimeAsync(15_000);
  await settle();
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(other.webContents.send).not.toHaveBeenCalled();
  expect(() => handlers.get("update:get-state")(other.event)).toThrow(/only available/);

  // The person comes back to this computer's page while it downloads: that
  // page reads it, then hears it is ready.
  const local = page(LOCAL);
  rule.show(local);
  expect(handlers.get("update:get-state")(local.event)).toMatchObject({ status: "downloading", version: "2.0.0" });
  finish();
  await settle();
  expect(local.webContents.send).toHaveBeenLastCalledWith("update:state", expect.objectContaining({ status: "downloaded", version: "2.0.0" }));
  expect(other.webContents.send).not.toHaveBeenCalled();
});

it("sends updater progress to a reopened window without restarting the updater", async () => {
  const rule = mainRule();
  const first = page(LOCAL);
  rule.show(first);
  const { updater, autoUpdater, handlers } = await load(rule.pageAllowed);
  updater.attachUpdaterWindow({ webContents: first.webContents });
  updater.startUpdater();
  const listenerCount = autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0);
  const timerCount = vi.getTimerCount();

  first.webContents.send.mockImplementation(() => { throw new Error("window destroyed"); });
  first.webContents.send.mockClear();
  const reopened = page(LOCAL);
  rule.show(reopened);
  updater.attachUpdaterWindow(rule.window);

  await handlers.get("update:check")(reopened.event);
  await settle();

  expect(first.webContents.send).not.toHaveBeenCalled();
  expect(reopened.webContents.send.mock.calls.map(([, state]) => state.status))
    .toEqual(["checking", "downloading", "downloading", ...(process.platform === "darwin" ? ["preparing"] : []), "downloaded"]);
  expect(autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0)).toBe(listenerCount);
  expect(vi.getTimerCount()).toBe(timerCount);
});
