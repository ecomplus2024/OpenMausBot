// Model: which provider/model this bot runs on, and how hard it thinks.
// Moved from SettingsPanel.tsx (~835-881). ModelPicker keeps `contained`:
// this section sits inside the dialog's overflow-y-auto scroller, where the
// picker's floating popover (absolute, ~480px tall) would open below the
// fold and only become visible by scrolling; the in-flow menu pushes the
// Effort card down instead and is fully visible where it opens.
import { EffortRow, ModelPicker } from "../ModelPicker";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { ProposalStatus } from "./ProposalStatus";
import { ThreadModelsLine } from "../ThreadModelsLine";
import { t } from "@/lib/i18n";

export function ModelSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
  const modelVariants = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.modelVariants;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <ModelPicker
          bot={bot}
          contained
          label={
            <div>
              <div className="text-[15px] font-medium text-ink">{t("botSettings.simple.defaultModel")}</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {draft ? t("botSettings.model.defaultHintDraft") : t("botSettings.model.defaultHint")}
              </div>
              <ProposalStatus bot={bot} kind="chief" />
            </div>
          }
        />
        {/* Right below the picker, so it shows the moment the model changes. */}
        {!draft && <ThreadModelsLine bot={bot} className="mt-3" />}
      </div>

      {/* Share the model picker's effort choices, but edit the profile default. */}
      <EffortRow
        bot={bot}
        className="rounded-xl bg-card p-4"
        label={
          <div>
            <div className="text-[15px] font-medium text-ink">{modelVariants ? t("model.simple.reasoning") : t("model.effort")}</div>
            {/* Says what the app does, not what the engine ends up at:
                Codex applies a level to the whole thread and has no way to
                take one back, so "currently: engine default" was a promise
                we could not keep for a thread that had already been sent
                one. Sending nothing is true on every engine. */}
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {modelVariants ? (draft ? t("botSettings.model.effortDraft") : t("botSettings.model.effortVariantHint")) : t("botSettings.model.effortHint") + (bot.modelSelection.effort ? "" : t("botSettings.model.effortHintNoLevel"))}
            </div>
            <ProposalStatus bot={bot} kind="chief" />
          </div>
        }
      />
      {!draft && <FallbackChain bot={bot} onChange={(fallback) => dispatch({ type: "updateBot", botId: bot.id, patch: { fallback } })} />}
      {!draft && state.config?.cacheKeepWarm && (
        <KeepWarmRow bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

/** Prompt-cache keep-warm for this bot: follow the workspace, or override it. */
function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  return (
    // Stacked like the backup-models card above: the settings panel is
    // narrow, and a select beside the text squeezes it into a thin column.
    <div className="rounded-xl bg-card p-4">
      <label htmlFor="bot-cache-keepwarm" className="text-[15px] font-medium text-ink">{t("bot.keepWarm.title")}</label>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("bot.keepWarm.help")}</div>
      <select id="bot-cache-keepwarm" value={value}
        onChange={(event) => onChange(event.target.value === "on" ? true : event.target.value === "off" ? false : null)}
        className="mt-3 max-w-full cursor-pointer rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink">
        <option value="follow">{t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") })}</option>
        <option value="on">{t("bot.keepWarm.on")}</option>
        <option value="off">{t("bot.keepWarm.off")}</option>
      </select>
    </div>
  );
}

/** Ordered backups use the same opt-in, proven-before-start recovery as
 * the workspace backup. They change only the failed thread's model. */
function FallbackChain({ bot, onChange }: { bot: Bot; onChange: (fallback: Bot["fallback"]) => void }) {
  const { state } = useStore();
  const chain = bot.fallback ?? [];
  const available = state.instances.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const nameOf = (instanceId: string) => state.instances.find((instance) => instance.instanceId === instanceId)?.displayName ?? instanceId;

  const add = (instanceId: string) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === instanceId);
    if (!instance || !instance.models.default.trim() || chain.length >= 5 || !available.includes(instance)) return;
    onChange([...chain, { instanceId, model: instance.models.default }]);
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("botSettings.model.backups")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {t("botSettings.model.backupsHint")}
      </div>
      {!state.config?.automaticRecovery?.enabled && <p className="mt-2 text-[12px] text-ink-secondary">{t("botSettings.model.recoveryOff")}</p>}
      {chain.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1">
          {chain.map((entry, index) => (
            <li key={entry.instanceId} className="flex items-center gap-2 rounded-lg bg-inset px-3 py-1.5 text-[13px]">
              <span className="w-4 shrink-0 tabular-nums text-ink-secondary">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-ink">{nameOf(entry.instanceId)}</span>
              <span className="shrink-0 truncate text-[11.5px] text-ink-secondary">{entry.model}</span>
              <button
                type="button"
                onClick={() => onChange(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
                aria-label={t("botSettings.model.removeFallback", { name: nameOf(entry.instanceId) })}
                className="shrink-0 rounded p-0.5 text-ink-secondary hover:text-ink"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {chain.length < 5 && (
        <div className={cn("flex items-center gap-2", chain.length > 0 ? "mt-2" : "mt-3")}>
          <select
            value=""
            onChange={(event) => add(event.target.value)}
            aria-label={t("botSettings.model.addFallbackAria")}
            disabled={available.length === 0}
            className="rounded-lg border border-hairline/40 bg-inset px-2 py-1 text-[13px] text-ink disabled:opacity-50"
          >
            <option value="">{available.length === 0 ? t("botSettings.model.noEngine") : t("botSettings.model.addEngine")}</option>
            {available.map((instance) => (
              <option key={instance.instanceId} value={instance.instanceId}>
                {instance.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
