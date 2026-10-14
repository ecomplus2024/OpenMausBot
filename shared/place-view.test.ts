import { describe, expect, it } from "vitest";

import en from "../src/locales/en.json";
import {
  cloudRefusal, PLACE_EN, PLACE_STATES, PLACE_WORDS, placeRowText, placeRowView, placeState, placeView, placeViewOf,
  type PlaceFacts, type PlaceParams, type PlaceSource, type PlaceState,
} from "./place-view.ts";

/** Every param any line or action names, so a state always reads whole. */
const PARAMS: PlaceParams = {
  bot: "Scout", engine: "Claude", model: "Llama", computer: "Team desk",
  words: "Start the Boat plan to create sandboxes.", reason: "CUA Driver is not ready.",
  cause: "the Local VM is not ready",
};

const facts = (patch: Partial<PlaceFacts> = {}): PlaceFacts => ({
  place: "cloud", server: "mac", bot: "Scout", boat: "own-key", role: "admin", toolsAllowComputer: true, browserOn: true,
  engine: { name: "Claude", model: "Claude Fable 5", computer: true, browser: true, signedIn: true },
  ...patch,
});

describe("U1: one line and at most one action for every state", () => {
  it("words every state whole, for an Admin and for a User", () => {
    for (const state of PLACE_STATES) {
      for (const role of ["admin", "user"] as const) {
        const view = placeViewOf(state, PARAMS, { role, server: "mac" });
        expect(view.short.trim(), state).not.toBe("");
        expect(view.line.trim(), state).not.toBe("");
        // one message: no second paragraph, no placeholder left unfilled
        expect(view.line, state).not.toMatch(/\n|\{\w+\}/);
        expect(view.short, state).not.toMatch(/\{\w+\}/);
        if (view.action) expect(view.action.label, state).not.toMatch(/^$|\{\w+\}/);
      }
    }
  });

  it("gives a User no action that changes a setting, and says who can", () => {
    for (const state of PLACE_STATES) {
      const admin = placeViewOf(state, PARAMS, { role: "admin", server: "mac" });
      const user = placeViewOf(state, PARAMS, { role: "user", server: "mac" });
      if (!admin.action || admin.action.id === "try-again" || admin.action.id === "watch" || admin.action.id === "clear-pin" || admin.action.id === "open-computer-panel") {
        expect(user, state).toEqual(admin);
        continue;
      }
      // Starting a computer early is a shortcut: a User's own message starts it.
      if (admin.action.id === "start" || admin.action.id === "wake") {
        expect(user, state).toEqual({ ...admin, action: null });
        continue;
      }
      expect(user.action, state).toBeNull();
      expect(user.line, state).toBe(`${admin.line} Ask an Admin to change it.`);
    }
  });

  it("mirrors en.json exactly, key for key", () => {
    const catalog = en as Record<string, string>;
    for (const [key, value] of Object.entries(PLACE_EN)) expect(catalog[key], key).toBe(value);
    const mirrored = new Set(Object.keys(PLACE_EN));
    const inCatalog = Object.keys(catalog).filter((key) => /^place\.(view|action)\./.test(key) || key === "place.askAdmin" || key === "place.backOnAuto");
    expect(inCatalog.filter((key) => !mirrored.has(key))).toEqual([]);
  });

  it("keeps jargon out of what people read", () => {
    const boatAllowed = new Set<PlaceState>(["cc-needs-key", "cc-provider"]);
    for (const state of PLACE_STATES) {
      const view = placeViewOf(state, { ...PARAMS, words: "x" }, { role: "admin", server: "mac" });
      const words = `${view.short} ${view.line} ${view.action?.label ?? ""}`;
      if (!boatAllowed.has(state)) expect(words, state).not.toMatch(/Boat/);
      expect(words, state).not.toMatch(/\bbox\b|OMB|Hosted desktop|Cloud box|Works on to Auto|\btools?\b/i);
      if (state.startsWith("cc-")) expect(words, state).not.toMatch(/\bVM\b/);
    }
    for (const [id, sentence] of Object.entries(PLACE_WORDS)) {
      expect(sentence, id).not.toMatch(/\bbox\b|OMB|Hosted desktop|Cloud box|Works on to Auto|\btools?\b/i);
      if (id !== "add-boat-key") expect(sentence, id).not.toMatch(/Boat/);
    }
  });

  it("uses each state's own copy", () => {
    const admin = { role: "admin" as const, server: "mac" as const };
    expect(placeViewOf("cc-unavailable", {}, admin)).toMatchObject({
      short: "Not available now", line: "Cloud computers can't start right now. It isn't anything you did.", action: { id: "try-again" },
    });
    expect(placeViewOf("auto", {}, admin).line)
      .toBe("Uses the built-in browser, a private desktop on this computer, or this computer's screen, whichever the task needs.");
    expect(placeViewOf("cc-provider", { bot: "Scout", words: "Start the $20/month Boat plan." }, admin))
      .toMatchObject({ short: "Couldn't start", line: "Your Boat account couldn't start Scout's cloud computer: Start the $20/month Boat plan." });
    expect(placeViewOf("vps", { bot: "Scout" }, admin)).toMatchObject({ short: "Your server" });
  });
});

describe("placeState", () => {
  it("reads the cloud computer's facts in order: model, what it can use, sign-in, provider, state", () => {
    expect(placeState(facts({ engine: { name: "Llama", computer: false, browser: true, signedIn: true } })).state).toBe("cc-cannot");
    expect(placeState(facts({ toolsAllowComputer: false })).state).toBe("cc-tools-off");
    expect(placeState(facts({ engine: { name: "Claude", computer: true, browser: true, signedIn: false } }))).toEqual({
      state: "cc-sign-in", params: { bot: "Scout", engine: "Claude" },
    });
    expect(placeState(facts({ boat: "none" })).state).toBe("cc-needs-key");
    expect(placeState(facts({ boat: "own-key" })).state).toBe("cc-new");
    expect(placeState(facts({ computer: "starting" })).state).toBe("cc-starting");
    expect(placeState(facts({ computer: "asleep" })).state).toBe("cc-asleep");
    expect(placeState(facts({ computer: "on" })).state).toBe("cc-on");
    expect(placeState(facts({ refusal: { state: "cc-unavailable", params: {} } }))).toEqual({
      state: "cc-unavailable", params: { bot: "Scout" },
    });
    expect(placeState(facts({ backend: "vps" })).state).toBe("vps");
  });

  it("reads Auto, Off, the browser, this computer and a Local VM", () => {
    expect(placeState(facts({ place: "auto" })).state).toBe("auto");
    expect(placeState(facts({ place: "auto", teamComputer: "Team desk" }))).toEqual({ state: "auto-team", params: { bot: "Scout", computer: "Team desk" } });
    expect(placeState(facts({ place: "off" })).state).toBe("off");
    expect(placeState(facts({ place: "browser" })).state).toBe("browser");
    expect(placeState(facts({ place: "browser", browserOn: false })).state).toBe("browser-off");
    expect(placeState(facts({ place: "browser", engine: { name: "X", computer: true, browser: false, signedIn: true } })).state).toBe("browser-cannot");
    expect(placeState(facts({ place: "local", local: { ready: false, reason: "Not yet." } }))).toEqual({
      state: "local-unavailable", params: { bot: "Scout", reason: "Not yet." },
    });
    expect(placeState(facts({ place: "vm", engine: { name: "X", computer: false, browser: true, signedIn: true } })).state).toBe("vm-cannot");
  });

  it("words the Auto line for where this server runs", () => {
    expect(placeView(facts({ place: "auto" })).line).toMatch(/this computer's screen/);
    expect(placeView(facts({ place: "auto", server: "pc" })).line).not.toMatch(/Local VM/);
    expect(placeView(facts({ place: "auto", server: "linux" })).line).toMatch(/Local VM/);
    expect(placeView(facts({ engine: { name: "Claude", computer: true, browser: true, signedIn: false } })).line)
      .toBe("Sign in to Claude first. Scout uses it on the cloud computer too.");
  });
});

describe("a failed place, by where it came from", () => {
  const row = (source: PlaceSource, state: PlaceState = "cc-unavailable") => ({ state, params: { bot: "Scout" }, source });

  it("has its own way on per source for a passing cause", () => {
    const view = (source: PlaceSource, mode?: "simple" | "advanced") =>
      placeRowView(row(source), { role: "admin", mode, worksOnLabel: "Auto" });
    expect(view("works-on").action).toEqual({ id: "try-again", label: "Try again" });
    expect(view("pin", "advanced").action).toEqual({ id: "clear-pin", label: "Clear this conversation's place" });
    expect(view("pin", "simple").action).toEqual({ id: "clear-pin", label: "Use Auto" });
    expect(view("auto-pin")).toMatchObject({ line: "Cloud computers can't start right now. It isn't anything you did. This conversation is back on Auto.", action: { id: "try-again" } });
    expect(view("routine").action).toEqual({ id: "change-routine", label: "Change where it runs" });
    expect(view("room").action).toBeNull();
  });

  it("keeps a cause's own fix whatever the source", () => {
    for (const source of ["works-on", "pin", "auto-pin", "routine", "room"] as const) {
      expect(placeRowView(row(source, "cc-needs-key"), { role: "admin" }).action?.id, source).toBe("add-boat-key");
    }
  });

  it("stores the line and its action as words a phone can read", () => {
    expect(placeRowText({ state: "cc-needs-key", params: { bot: "Scout" }, source: "works-on" }))
      .toBe("A cloud computer here needs your own Boat key, a paid service. Add a Boat key in Settings → API keys.");
    expect(placeRowText(row("auto-pin")))
      .toBe("Cloud computers can't start right now. It isn't anything you did. This conversation is back on Auto. Send your message again.");
    expect(placeRowText(row("routine"))).toBe("Cloud computers can't start right now. It isn't anything you did. Change where this routine runs.");
    expect(placeRowText(row("room"))).toBe("Cloud computers can't start right now. It isn't anything you did.");
    expect(placeRowText({ state: "cc-cannot", params: { bot: "Scout", model: "Llama" }, source: "works-on" }))
      .toBe("Llama can't use a computer. Choose a model that can, such as Claude or ChatGPT. Choose another model in Scout's settings.");
  });
});

describe("cloudRefusal reads a failed start", () => {
  const refusal = (message: string, code?: string, status?: number) => cloudRefusal({ message, code, status });

  it("maps the provider's own codes and transient failures to try-again states", () => {
    expect(refusal("x", "too_many_starts").state).toBe("cc-unavailable");
    expect(refusal("x", "rate_limited").state).toBe("cc-unavailable");
    expect(refusal("Cloud computers are busy right now. Try again in a few minutes.", "rate_limited", 429).state).toBe("cc-unavailable");
    expect(refusal("Cloud computers are temporarily unavailable. Try again later.", undefined, 503).state).toBe("cc-unavailable");
  });

  it("reads this app's own start failures, and a provider's own words", () => {
    expect(refusal("box did not become ready within 90s — retry in a minute").state).toBe("cc-no-start");
    expect(refusal("box desktop link could not be created").state).toBe("cc-no-start");
    expect(refusal("this cloud computer is being deleted — wait for it to finish, or retry Delete if it needs attention").state).toBe("cc-clearing");
    expect(refusal("Start the $20/month Boat plan to create sandboxes.", undefined, 402))
      .toEqual({ state: "cc-provider", params: { words: "Start the $20/month Boat plan to create sandboxes." } });
    expect(refusal("something new")).toEqual({ state: "cc-provider", params: { words: "something new." } });
    expect(refusal("").state).toBe("cc-no-start");
  });
});
