import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { DesktopWorkspaceSwitcher, openServerMenu } from "./DesktopWorkspaceSwitcher";

afterEach(() => { vi.unstubAllGlobals(); });

it("names the saved-server switcher with the product word, not workspace", () => {
  vi.stubGlobal("window", { ogb: { workspaces: { state: () => new Promise(() => {}), menu: () => Promise.resolve() } } });
  const html = renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher));
  expect(html).toContain('aria-label="Switch server: Servers"');
  expect(html).toContain(">Servers<");
  expect(html).not.toMatch(/workspace/i);
});

it("renders nothing outside the desktop app", () => {
  vi.stubGlobal("window", {});
  expect(renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher))).toBe("");
});

it("is the switcher's anchor in every shape, and opens the menu as passed in", async () => {
  vi.stubGlobal("window", { ogb: { workspaces: { state: () => new Promise(() => {}), menu: () => Promise.resolve() } } });
  for (const props of [{}, { inline: true }, { compact: true }]) expect(renderToStaticMarkup(createElement(DesktopWorkspaceSwitcher, props))).toContain('data-tour="server-switcher"');
  const menu = vi.fn(() => Promise.resolve());
  await openServerMenu({ menu });
  expect(menu).toHaveBeenCalledOnce();
  menu.mockRejectedValueOnce(new Error("no menu"));
  await expect(openServerMenu({ menu })).rejects.toThrow("no menu");
});
