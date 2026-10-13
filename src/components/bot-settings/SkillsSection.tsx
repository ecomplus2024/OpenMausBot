// Skills: durable behavior the bot learned or imported, so the user needs a
// normal way to inspect, disable, and remove it after the one-time approval
// card is gone. Moved from SettingsPanel.tsx's LearnedSkillsCard (79-295),
// its nested review dialog raised from z-[80] to z-[90] to float above this
// dialog's own z-50, plus: an Import from GitHub row, a static "when it's
// used" line on every row (learned skills have no triggers to show), and a
// read-only click-through view of a skill's full text.
import { BookOpen, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { Switch } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { OrgSkillsCard } from "./OrgSkillsCard";
import { WriteCommandCard } from "./WriteCommandCard";

export interface ManagedSkill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  warnings: string[];
  /** Present only under features.skillsLibrary: where the bot reads this
   * skill from. Private shadows library on name collision. */
  origin?: "private" | "library";
}

/** Library entries this bot has not been assigned yet (flag on only). */
interface LibraryPoolSkill {
  name: string;
  description: string;
}

interface StagedSkillSummary {
  id: string;
  name: string;
  gist: string;
}

/** The bot's installed skills and the on/off switch the Skills section and
 * the Simple bot panel share: switching a skill off writes at once; switching
 * one on fetches its integrity-checked text and waits for an explicit review
 * (`reviewing` + `enableReviewed`) before it can reach the bot's prompt. */
export function useManagedSkills(bot: Bot) {
  const { request: api } = useBotEditor();
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [assignedSkills, setAssignedSkills] = useState<string[]>([]);
  const [libraryPool, setLibraryPool] = useState<LibraryPoolSkill[]>([]);
  const [addFromLibrary, setAddFromLibrary] = useState("");
  const [staged, setStaged] = useState<StagedSkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<{ skill: ManagedSkill; text: string } | null>(null);
  // One assignment change at a time: each one reads the server's list first.
  const assignmentBusy = useRef(false);

  const refresh = async (cancelled?: () => boolean) => {
    try {
      const result = (await api(`/api/bots/${bot.id}/skills`)) as {
        skills?: ManagedSkill[];
        staged?: StagedSkillSummary[];
        library?: LibraryPoolSkill[];
        assignedSkills?: string[];
      };
      if (cancelled?.()) return;
      setSkills(result.skills ?? []);
      setStaged(result.staged ?? []);
      setLibraryPool(result.library ?? []);
      setAssignedSkills(result.assignedSkills ?? []);
      setAddFromLibrary("");
      setError("");
    } catch (cause) {
      if (!cancelled?.()) setError(cause instanceof Error ? cause.message : t("botSettings.skills.listFailed"));
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReviewing(null);
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  const putAssignments = async (name: string, remove = false) => {
    const listing = (await api(`/api/bots/${bot.id}/skills`)) as { assignedSkills?: string[] };
    const current = listing.assignedSkills ?? assignedSkills;
    const next = remove ? current.filter((skill) => skill !== name) : [...new Set([...current, name])];
    await api(`/api/bots/${bot.id}/skills-library`, {
      method: "PUT",
      body: JSON.stringify({ skills: next }),
    });
    await refresh();
  };

  const addToBot = async () => {
    const name = addFromLibrary.trim();
    if (!name || assignmentBusy.current) return;
    assignmentBusy.current = true;
    setWorking(name);
    setError("");
    try {
      await putAssignments(name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.assignFailed"));
    } finally {
      assignmentBusy.current = false;
      setWorking("");
    }
  };

  const toggle = async (skill: ManagedSkill) => {
    setWorking(skill.name);
    setError("");
    try {
      if (skill.origin === "library" && skill.enabled) {
        // Library skills share one review state across every bot assigned
        // to them; disabling is immediate, enabling still requires review below.
        await api(`/api/skills-library/${encodeURIComponent(skill.name)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !skill.enabled }),
        });
        await refresh();
        return;
      }
      if (!skill.enabled) {
        // A disabled import has not necessarily been reviewed. Fetch the
        // integrity-checked bytes and require one explicit review step before
        // they can reach the bot's prompt or native skill discovery.
        const result = (await api(skill.origin === "library" ? `/api/skills-library/${encodeURIComponent(skill.name)}` : `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`)) as { text?: string };
        if (!result.text) throw new Error("The skill contents are unavailable; remove and import or learn it again.");
        setReviewing({ skill, text: result.text });
        return;
      }
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.updateFailed"));
    } finally {
      setWorking("");
    }
  };

  const enableReviewed = async () => {
    if (!reviewing) return;
    const { skill } = reviewing;
    setWorking(skill.name);
    setError("");
    try {
      await api(skill.origin === "library" ? `/api/skills-library/${encodeURIComponent(skill.name)}` : `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      });
      setReviewing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.enableFailed"));
    } finally {
      setWorking("");
    }
  };

  return {
    skills, staged, loading, working, setWorking, error, setError, reviewing, setReviewing, refresh, toggle, enableReviewed,
    // the shared skills library (features.skillsLibrary): what this bot can still add, and assignment changes
    libraryPool, addFromLibrary, setAddFromLibrary, assignmentBusy, putAssignments, addToBot,
  };
}

/** The review step before a skill is switched on: its full SKILL.md, with
 * Escape and a focus trap, layered above the settings panel. */
export function SkillReviewDialog({
  skill,
  text,
  error,
  working,
  onCancel,
  onEnable,
}: {
  skill: ManagedSkill;
  text: string;
  error: string;
  working: boolean;
  onCancel: () => void;
  onEnable: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const parentDialog = dialog?.parentElement?.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!working) cancel.current();
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else parentDialog?.focus();
    };
  }, [working]);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-review-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6"
    >
      <div className="flex max-h-[min(760px,90vh)] w-full max-w-2xl flex-col rounded-2xl bg-card p-5 shadow-2xl">
        <div id="skill-review-title" className="text-[16px] font-semibold text-ink">
          {t("botSettings.skills.reviewTitle", { name: skill.name })}
        </div>
        <div className="mt-1 break-all text-[11.5px] text-ink-secondary">
          {t("botSettings.skills.source", { source: skill.source })}
        </div>
        {skill.warnings.length > 0 && (
          <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
            {skill.warnings.join(" · ")}
          </div>
        )}
        <pre
          tabIndex={0}
          aria-label={t("botSettings.skills.fullSkill", { name: skill.name })}
          className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink"
        >
          {text}
        </pre>
        {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={working}
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] font-medium text-ink-secondary hover:bg-raised disabled:opacity-40"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={onEnable}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {t("botSettings.skills.enableReviewed")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkillsSection({ bot }: { bot: Bot }) {
  const { request: api } = useBotEditor();
  const { state } = useStore();
  const featureEnabled = skillAuthoringEnabled(state.config);
  const libraryOn = skillsLibraryEnabled(state.config);
  const {
    skills, staged, loading, working, setWorking, error, setError, reviewing, setReviewing, refresh, toggle, enableReviewed,
    libraryPool, addFromLibrary, setAddFromLibrary, assignmentBusy, putAssignments, addToBot,
  } = useManagedSkills(bot);
  const [viewing, setViewing] = useState<{ name: string; text: string } | null>(null);
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const skillDialogRef = useRef<HTMLDivElement>(null);
  const skillDialogOpen = Boolean(viewing);

  useEffect(() => {
    if (!skillDialogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = skillDialogRef.current;
    const parentDialog = dialog?.parentElement?.closest<HTMLElement>('[role="dialog"]');
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!working) setViewing(null);
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else parentDialog?.focus();
    };
  }, [skillDialogOpen, working]);

  useEffect(() => {
    setViewing(null);
  }, [bot.id]);

  const remove = async (skill: ManagedSkill) => {
    if (skill.origin === "library") {
      if (assignmentBusy.current) return;
      if (!window.confirm(t("botSettings.skills.unassignConfirm", { name: skill.name }))) return;
      assignmentBusy.current = true;
      setWorking(skill.name);
      setError("");
      try {
        await putAssignments(skill.name, true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("botSettings.skills.unassignFailed"));
      } finally {
        assignmentBusy.current = false;
        setWorking("");
      }
      return;
    }
    if (!window.confirm(t("botSettings.skills.removeConfirm", { name: skill.name }))) return;
    setWorking(skill.name);
    setError("");
    try {
      await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.removeFailed"));
    } finally {
      setWorking("");
    }
  };

  const view = async (skill: ManagedSkill) => {
    setError("");
    try {
      const result = skill.origin === "library"
        ? ((await api(`/api/skills-library/${encodeURIComponent(skill.name)}`)) as { text?: string })
        : ((await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`)) as { text?: string });
      setViewing({ name: skill.name, text: result.text ?? "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.loadFailed"));
    }
  };

  const importSkill = async () => {
    const trimmed = source.trim();
    if (!trimmed) return;
    setImporting(true);
    setError("");
    setImportMessage("");
    try {
      const result = (await api(`/api/bots/${bot.id}/skills`, {
        method: "POST",
        body: JSON.stringify({ source: trimmed }),
      })) as { installed?: unknown[] };
      const count = (result.installed ?? []).length;
      setImportMessage(t(count === 1 ? "botSettings.skills.importedOne" : "botSettings.skills.importedMany", { count }));
      setSource("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botSettings.skills.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-ink-secondary" />
          <div className="text-[15px] font-medium text-ink">{t("botSettings.skills.learned")}</div>
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
          {featureEnabled ? t("skills.learned.hintOn") : t("skills.learned.hintOff")}
        </div>

        {libraryOn ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {libraryPool.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label={t("botSettings.skills.addFromLibrary")}
                  value={addFromLibrary}
                  disabled={Boolean(working)}
                  onChange={(e) => setAddFromLibrary(e.target.value)}
                  className={inputCls + " truncate"}
                >
                  <option value="">{t("botSettings.skills.addFromLibraryOption")}</option>
                  {libraryPool.map((skill) => (
                    <option key={skill.name} value={skill.name}>{skill.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!addFromLibrary || Boolean(working)}
                  onClick={() => void addToBot()}
                  className="shrink-0 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
                >
                  {t("common.add")}
                </button>
              </div>
            ) : (
              <div className="text-[12px] text-ink-secondary">{t("botSettings.skills.allAssigned")}</div>
            )}
            <div className="text-[11.5px] text-ink-secondary">{t("botSettings.skills.manageHint")}</div>
          </div>
        ) : (
          <>
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void importSkill();
              }}
            >
              <input
                className={inputCls}
                placeholder={t("botSettings.skills.importPlaceholder")}
                aria-label={t("botSettings.skills.importAria")}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              <button
                type="submit"
                disabled={importing || !source.trim()}
                className="shrink-0 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
              >
                {importing ? t("skills.library.importing") : t("botSettings.skills.import")}
              </button>
            </form>
            {importMessage && <div className="mt-1 text-[12px] text-ink-secondary">{importMessage}</div>}
          </>
        )}

        {loading ? (
          <div className="mt-3 text-[12px] text-ink-secondary">{t("skills.library.loading")}</div>
        ) : skills.length === 0 ? (
          <div className="mt-3 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("botSettings.skills.empty")}</div>
        ) : (
          <div className="mt-3 divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
            {skills.map((skill) => (
              <div key={skill.name} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void view(skill)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-mono text-[12.5px] text-ink">{skill.name}</div>
                    {libraryOn && (
                      <span className="ml-1.5 rounded bg-control px-1 py-px font-mono text-[9.5px] uppercase tracking-wide text-ink-secondary">
                        {skill.origin === "library" ? t("botSettings.skills.originLibrary") : t("botSettings.skills.originPrivate")}
                      </span>
                    )}
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-secondary">{skill.description}</div>
                    <div className="mt-0.5 text-[10.5px] text-ink-secondary">{t("botSettings.skills.usedWhen")}</div>
                  </button>
                  <Switch
                    checked={skill.enabled}
                    aria-label={t(skill.enabled ? "botSettings.skills.disable" : "botSettings.skills.enable", { name: skill.name })}
                    disabled={Boolean(working)}
                    onClick={() => void toggle(skill)}
                  />
                  <button
                    aria-label={t("botSettings.skills.remove", { name: skill.name })}
                    title={t("botSettings.skills.removeTitle")}
                    disabled={Boolean(working)}
                    onClick={() => void remove(skill)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-1 truncate text-[10.5px] text-ink-secondary" title={skill.source}>{t("botSettings.skills.source", { source: skill.source })}</div>
                {skill.warnings.length > 0 && (
                  <div className="mt-1 text-[10.5px] text-warning">{skill.warnings.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {staged.length > 0 && (
          <div className="mt-2 text-[11.5px] text-warning">
            {t(staged.length === 1 ? "botSettings.skills.stagedOne" : "botSettings.skills.stagedMany", { count: staged.length })}
          </div>
        )}
        {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
      </div>

      <WriteCommandCard bot={bot} taken={skills.map((skill) => skill.name)} onSaved={() => void refresh()} />

      <OrgSkillsCard bot={bot} onAdded={() => void refresh()} />

      {reviewing && (
        <SkillReviewDialog
          skill={reviewing.skill}
          text={reviewing.text}
          error={error}
          working={working === reviewing.skill.name}
          onCancel={() => setReviewing(null)}
          onEnable={() => void enableReviewed()}
        />
      )}

      {viewing && (
        <div
          ref={skillDialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-view-title"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-6"
        >
          <div className="flex max-h-[min(760px,90vh)] w-full max-w-2xl flex-col rounded-2xl bg-card p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div id="skill-view-title" className="text-[16px] font-semibold text-ink">{viewing.name}</div>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="rounded-md px-2 py-1 text-[13px] text-ink-secondary hover:bg-control hover:text-ink"
              >
                {t("common.close")}
              </button>
            </div>
            <pre
              tabIndex={0}
              aria-label={t("botSettings.skills.fullSkill", { name: viewing.name })}
              className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink"
            >
              {viewing.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
