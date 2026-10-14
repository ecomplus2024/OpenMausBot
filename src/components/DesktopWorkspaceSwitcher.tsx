import { useEffect, useState } from "react";
import { ChevronDown, Cloud, Laptop } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** The native server menu; resolves when it closes. */
export function openServerMenu(bridge: { menu: () => Promise<void> }): Promise<void> {
  return bridge.menu();
}

/** `inline` is the small pill that shares the sidebar's top row with the
 * traffic lights and the header buttons: icon, short name, tiny chevron,
 * truncating to whatever width the row leaves it (and clipping, never
 * spilling onto the buttons, in the narrowest rows). Inside a `sidebar-top`
 * container narrower than 96px it drops the name for icon + chevron, because
 * that is too little for icon, a truncated name, and the chevron. Wider than
 * that, including the default macOS Advanced row (about 121px), the name
 * stays and truncates. The title and aria-label keep the full name. It
 * brings no row padding of its own; the row
 * places it at the right beside the buttons and, being `relative`, anchors
 * its error note to the row's right end so the note stays inside the sidebar.
 *
 * The dropdown is native: a remote workspace cannot choose a destination
 * itself or read the other workspaces saved on this computer. Outside the
 * desktop app there is nothing to switch. */
export function DesktopWorkspaceSwitcher({ compact = false, inline = false }: {
  compact?: boolean; inline?: boolean;
}) {
  const bridge = window.ogb?.workspaces;
  const [current, setCurrent] = useState<{ local: boolean; name: string; origin?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void bridge?.state().then((state) => { if (alive) setCurrent(state); }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);
  if (!bridge) return null;
  const name = current?.name ?? t("sidebar.servers");
  const Icon = current?.local === false ? Cloud : Laptop;
  const title = current?.origin ? `${name} · ${current.origin}` : name;
  const label = t("sidebar.switchServer", { name });
  const openMenu = () => {
    if (open) return;
    setError(""); setOpen(true);
    void openServerMenu(bridge).catch(() => setError(t("sidebar.switchServerError")))
      .finally(() => setOpen(false));
  };
  if (inline) return <div data-workspace-switcher="inline" className="flex min-w-0">
    <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-tour="server-switcher" title={title} onClick={openMenu}
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left text-[12.5px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      {/* Hide the name only when this slot cannot hold icon, a truncated
          name, and the chevron. Default macOS Advanced (~121px) still shows it. */}
      <span className="min-w-0 truncate @max-[96px]/sidebar-top:hidden">{name}</span>
      <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
    {error && <p role="alert" className="absolute right-2 top-full z-40 mt-1 w-56 max-w-[calc(100%-1rem)] rounded-md bg-menu px-2 py-1 text-[11px] text-danger shadow-lg">{error}</p>}
  </div>;
  return <div className={cn("py-1.5", compact ? "px-2" : "px-3")}>
    <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-tour="server-switcher" title={title}
      onClick={openMenu}
      className={cn("flex w-full items-center gap-2 rounded-lg py-2 text-left text-[13px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", compact ? "justify-center px-1" : "px-2")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={16} className="shrink-0 text-ink-secondary" />
      {!compact && <><span className="min-w-0 flex-1 truncate">{name}</span><ChevronDown size={13} className="shrink-0 text-ink-secondary" /></>}
    </button>
    {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
  </div>;
}
