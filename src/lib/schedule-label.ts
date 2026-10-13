import { activeLocale, documentLanguage, t } from "@/lib/i18n";
import { atLocalTime } from "@/lib/routine-calendar";
import type { RoutineSchedule } from "@/lib/routines";
import type { LocaleKey } from "@/locales";
import { cronScheduleLabel } from "../../shared/cron-label";

const DAY_KEYS = [
  "computer.day.sun",
  "computer.day.mon",
  "computer.day.tue",
  "computer.day.wed",
  "computer.day.thu",
  "computer.day.fri",
  "computer.day.sat",
] as const satisfies readonly LocaleKey[];

/** Short weekday name in the active locale; 0 is Sunday, like Date#getDay. */
export function dayName(day: number): string {
  return t(DAY_KEYS[day]!);
}

const dateLocale = () => documentLanguage(activeLocale());

export function niceTime(at: number): string {
  return new Date(at).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit" });
}

export function niceDate(at: number): string {
  return new Date(at).toLocaleDateString(dateLocale(), { weekday: "long", month: "long", day: "numeric" });
}

/** A change's timestamp for a list row: the time alone if it happened
 * today, else the date — one rule shared by the Overview's recent-changes
 * card and the History section so the same row never reads two ways. */
export function whenLabel(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? niceTime(at) : date.toLocaleDateString(dateLocale(), { month: "short", day: "numeric" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return t("schedule.min", { count: minutes });
  if (minutes % 60 === 0) return t("schedule.hr", { count: minutes / 60 });
  return t("schedule.hrMin", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return t("schedule.everyMin", { count: minutes });
  if (minutes === 60) return t("schedule.everyHour");
  if (minutes % 60 === 0) return t("schedule.everyHr", { count: minutes / 60 });
  return t("schedule.everyHrMin", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function intervalRestrictions(schedule: Extract<RoutineSchedule, { type: "interval" }>): string[] {
  const details: string[] = [];
  if (schedule.weekdays && schedule.weekdays.length < 7) {
    details.push(schedule.weekdays.join(",") === "1,2,3,4,5"
      ? t("schedule.weekdays")
      : schedule.weekdays.map((day) => dayName(day)).join(", "));
  }
  if (schedule.window) {
    const wallTime = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return niceTime(new Date(2000, 0, 1, hour, minute).getTime());
    };
    details.push(`${wallTime(schedule.window.start)}–${wallTime(schedule.window.end)}`);
  }
  if (schedule.endsAt != null) {
    details.push(t("schedule.until", { date: new Date(schedule.endsAt).toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" }) }));
  }
  return details;
}

export function scheduleLabel(schedule: RoutineSchedule | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] }): string {
  if (schedule.type === "cron") return cronScheduleLabel(schedule);
  if (schedule.type === "once") return t("schedule.dateTime", { date: niceDate(schedule.at), time: niceTime(schedule.at) });
  if (schedule.type === "interval") {
    return [intervalLabel(schedule.everyMinutes), ...intervalRestrictions(schedule)].join(" · ");
  }
  const days = schedule.weekdays;
  const label = days.length === 7
    ? t("schedule.everyDay")
    : days.join(",") === "1,2,3,4,5"
      ? t("schedule.everyWeekday")
      : days.length === 1
        ? t("schedule.weeklyOn", { day: dayName(days[0]!) })
        : days.map((day) => dayName(day)).join(", ");
  return t("schedule.labelAt", { label, time: niceTime(atLocalTime(Date.now(), schedule.time)) });
}

export function scheduleSentence(schedule: RoutineSchedule): string {
  if (schedule.type === "cron") return cronScheduleLabel(schedule);
  if (schedule.type === "interval") {
    const minutes = schedule.everyMinutes;
    const cadence = minutes < 60
      ? t("schedule.sentEveryMin", { count: minutes })
      : minutes === 60
        ? t("schedule.sentEveryHour")
        : minutes % 60 === 0
          ? t("schedule.sentEveryHr", { count: minutes / 60 })
          : Math.floor(minutes / 60) === 1
            ? t("schedule.sentEveryHrMin1", { minutes: minutes % 60 })
            : t("schedule.sentEveryHrMin", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
    return [cadence, ...intervalRestrictions(schedule)].join(" · ");
  }
  if (schedule.type === "once") {
    return t("schedule.sentOnce", { date: niceDate(schedule.at), time: niceTime(schedule.at) });
  }
  // type === "daily"
  const days = schedule.weekdays;
  const time = niceTime(atLocalTime(Date.now(), schedule.time));

  if (days.length === 7) {
    return t("schedule.sentEveryDay", { time });
  }
  if (days.join(",") === "1,2,3,4,5") {
    return t("schedule.sentEveryWeekday", { time });
  }
  if (days.length === 1) {
    return t("schedule.sentWeeklyOn", { day: dayName(days[0]!), time });
  }

  // Custom multi-day selection
  return t("schedule.sentDays", { days: days.map((day) => dayName(day)).join(", "), time });
}
