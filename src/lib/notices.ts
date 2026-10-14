// The desktop app's one-time notices: the small cards at the bottom left
// (src/components/AppNotices.tsx). A dismissal is for good: either button,
// the X or Escape. It is kept in the workspace's onboarding hint record
// (hintsSeen), which updates and tour replays never clear, plus a
// browser-storage copy that holds at once.
import { hintSeen, hintSeenPatch, type OnboardingStatus } from "@/lib/onboarding";

/** "Star us on GitHub", asked once. */
export const STAR_NOTICE = "github-star-dismissed";

const stored = (id: string): string | null => { try { return localStorage.getItem(id); } catch { return null; } };
const store = (id: string, value: string) => { try { localStorage.setItem(id, value); } catch { /* The workspace record still keeps it. */ } };

/** Dismissed for good: in the workspace record, or on this device. */
export function noticeSeen(record: OnboardingStatus | undefined, id: string): boolean {
  return hintSeen(record, id) || stored(id) === "1";
}

/** Marks a notice dismissed on this device and returns the workspace patch
 * to send (null when the record already has it). */
export function dismissNotice(record: OnboardingStatus | undefined, id: string): { onboarding: { hintsSeen: string[] } } | null {
  store(id, "1");
  return hintSeenPatch(record, id);
}

/** When this window opened: the line between this launch and earlier ones. */
export const LAUNCHED_AT = Date.now();

/** Not brand new: a conversation started before this launch has had at
 * least one reply (a settled turn). */
export function usedBefore(
  bots: ReadonlyArray<{ tasks?: ReadonlyArray<{ createdAt?: number; usage?: { turns: number } }> }>,
  launchedAt = LAUNCHED_AT,
): boolean {
  return bots.some(bot => bot.tasks?.some(task => (task.createdAt ?? Infinity) < launchedAt && (task.usage?.turns ?? 0) > 0) ?? false);
}
