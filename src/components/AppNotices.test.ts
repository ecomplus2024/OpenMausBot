import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTourFinished } from "@/lib/guided-tour";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, LOCAL_VIEWER, type WelcomeViewer } from "@/lib/onboarding";
import { STAR_NOTICE } from "@/lib/notices";

const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, state: {} as any, updater: null as any, dispatch: null as any, brand: "default" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: unknown) => { f.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(f.values[index]) : next; }]; },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/analytics", () => ({ emailGateDone: () => false, track: vi.fn() }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => f.updater }));
vi.mock("@/lib/brand", () => ({ brandStatus: () => ({ brand: { name: "OpenMausBot" }, source: f.brand, file: "" }) }));
import { AppNotices } from "./AppNotices";
import { api } from "@/state/store";

const STAR = "Enjoying OpenMausBot?";

let storage: Map<string, string>;
let viewer: WelcomeViewer | null;

const render = () => { f.index = 0; return renderToStaticMarkup(createElement(AppNotices, { viewer })); };
type Node = ReactElement<Record<string, any>>;
const nodes = (value: ReactNode): Node[] => {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return nodes((node.type as (props: unknown) => ReactNode)(node.props));
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
};
const tree = () => { f.index = 0; return nodes(AppNotices({ viewer })); };
const press = (label: string) => {
  const button = tree().find(node => node.type === "button" && (renderToStaticMarkup(node).includes(`>${label}<`) || node.props["aria-label"] === label));
  expect(button, label).toBeTruthy(); button!.props.onClick();
};
const returning = () => { f.state.bots = [{ tasks: [{ threadId: "t", createdAt: 1, usage: { turns: 2 } }] }]; };
const hints = () => f.state.config.onboarding.hintsSeen as string[];

beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map(); f.values = []; f.index = 0; f.updater = null; f.brand = "default"; f.dispatch = vi.fn();
  setLocale("en"); viewer = LOCAL_VIEWER;
  f.state = { connected: true, bots: [], groups: [],
    config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen: withTourFinished(undefined) } } };
  vi.mocked(api).mockImplementation(async (_path, init) => {
    const patch = JSON.parse(String((init as RequestInit).body));
    f.state.config.onboarding.hintsSeen = patch.onboarding.hintsSeen;
    return f.state.config;
  });
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("window", { ogb: { remoteClient: { active: false }, openExternal: vi.fn(async () => true) },
    addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

describe("the star card", () => {
  it("shows once to someone who has used the app before", () => {
    returning();
    const html = render();
    expect(html).toContain(STAR);
    expect(html).toContain("Star on GitHub");
    expect(html).toContain("Not now");
    // Already dismissed: nothing.
    f.state.config.onboarding.hintsSeen = [...hints(), STAR_NOTICE];
    expect(render()).toBe("");
  });

  it("never to someone new this launch, on a branded build, or outside the desktop app's own page", () => {
    // A brand new install: its first conversation is in this launch.
    expect(render()).toBe("");
    returning();
    f.brand = "file";
    expect(render()).toBe("");
    f.brand = "default";
    // A remote client's page and a plain browser have none.
    (window.ogb as Record<string, any>).remoteClient = { active: true };
    expect(render()).toBe("");
    vi.stubGlobal("window", { ogb: undefined, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect(render()).toBe("");
  });

  it("never over setup, a dialog, busy work, or an update being offered", () => {
    returning();
    const waits: Array<() => void> = [
      () => { f.state.welcomeOpen = true; }, () => { f.state.tourOpen = true; }, () => { f.state.appSettingsOpen = true; },
      () => { f.updater = { status: "downloaded" }; },
      () => { f.state.bots = [{ busy: true, tasks: [{ threadId: "t", createdAt: 1, usage: { turns: 2 } }] }]; }, () => { f.state.connected = false; },
    ];
    for (const wait of waits) {
      const saved = structuredClone(f.state); wait();
      expect(render(), wait.toString()).toBe("");
      f.state = saved; f.updater = null;
    }
    expect(render()).toContain(STAR);
  });

  it("Not now, the X and Escape end it for good, on this device and in the workspace record", async () => {
    for (const close of ["Not now", "Dismiss for good", "Escape"]) {
      storage.clear(); f.values = []; f.state.config.onboarding.hintsSeen = withTourFinished(undefined);
      returning();
      expect(render(), close).toContain(STAR);
      if (close === "Escape") {
        const card = tree().find(node => node.type === "aside")!;
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        card.props.onKeyDown(event); expect(event.preventDefault).toHaveBeenCalled();
      } else press(close);
      await vi.waitFor(() => expect(storage.get(STAR_NOTICE), close).toBe("1"));
      expect(hints()).toContain(STAR_NOTICE);
      expect(render()).toBe("");
    }
  });
});
