// Where a routine runs, said where it is scheduled: on this computer only
// while the app is open; on another server, while that server runs.
import { t } from "@/lib/i18n";
import { localDesktopPage } from "./onboarding/WelcomeGate";

export function RoutineScheduleNote() {
  const local = localDesktopPage() && window.ogb?.remoteClient?.active !== true;
  return <p data-routine-schedule-note={local ? "local" : "server"} className="text-[11px] leading-relaxed text-ink-secondary">
    {t(local ? "routines.scheduleNote.local" : "routines.scheduleNote.server")}
  </p>;
}
