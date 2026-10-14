// The Boat or self-hosted VPS choice, in both its homes (the Computer panel
// and a bot's Access settings). Boat and a self-hosted VPS follow one rule
// (shared/cloud-computer.ts): an engine that can use a computer can use
// either. The Computer engine, which could run only on Boat, is gone, so
// neither backend is offered or refused on its own, and no copy sends anyone
// to Boat to get around an engine.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";

const { CloudBackendPicker } = await import("./CloudBackendPicker");
const picker = (value: "box" | "vps" = "box") => renderToStaticMarkup(createElement(CloudBackendPicker, { value, onChange: () => {} }));

describe("CloudBackendPicker", () => {
  it("offers Boat or a self-hosted VPS", () => {
    expect(picker()).toContain("Self-hosted VPS");
  });

  it.each(["box", "vps"] as const)("offers both backends whichever is chosen (%s)", (value) => {
    const markup = picker(value);
    expect(markup).toContain("Boat");
    expect(markup).toContain("Self-hosted VPS");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toMatch(/ACP model provider/);
  });

  it("leaves no message that tells someone to switch backends for an engine", () => {
    expect(Object.keys(en)).not.toContain("computer.err.vpsEngine");
    expect(Object.values(en).filter((value) => /switch the cloud backend to Boat/i.test(value))).toEqual([]);
  });
});
