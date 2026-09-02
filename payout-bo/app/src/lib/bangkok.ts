export const TZ = "Asia/Bangkok";
export const NOW = new Date("2026-08-31T18:00:00+07:00");

export function bkk(d: Date): string {
  return new Date(d).toLocaleString("sv-SE", { timeZone: TZ });
}

export function inputVal(d: Date): string {
  return bkk(d).replace(" ", "T").slice(0, 16);
}

export function parseInput(v: string): Date {
  return new Date(v + ":00+07:00");
}

export function fmtDT(d: Date): string {
  return bkk(d).replace("T", " ").slice(0, 19);
}

export function fmtTime(d: Date): string {
  return bkk(d).slice(11, 19);
}

export function fmtDateShort(d: Date): string {
  return new Date(d).toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "short" });
}

export function fmtDTThai(d: Date): string {
  return new Date(d).toLocaleString("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "medium" });
}

export function fmtD(d: Date): string {
  return bkk(d).slice(0, 10);
}

export function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

export function startOfDay(d: Date): Date {
  return new Date(fmtD(d) + "T00:00:00+07:00");
}

export function endOfDay(d: Date): Date {
  return new Date(fmtD(d) + "T23:59:59+07:00");
}

export const MAX_RANGE_MONTHS = 3;

export function addCalendarMonths(d: Date, months: number): Date {
  const [y, m, day] = fmtD(d).split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  const dd = Math.min(day, last);
  return new Date(
    `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(dd)}T00:00:00+07:00`,
  );
}

export function rangeFromDays(fromDay: Date, toDay: Date, now = NOW): { from: Date; to: Date; preset: "custom" } {
  const toStart = startOfDay(toDay);
  const earliest = addCalendarMonths(toStart, -MAX_RANGE_MONTHS);
  let from = startOfDay(fromDay);
  if (from.getTime() < earliest.getTime()) from = earliest;
  const to = fmtD(toDay) === fmtD(now) ? now : endOfDay(toDay);
  return { from, to, preset: "custom" };
}

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export type DatePreset = "today" | "yesterday" | "d7" | "d14" | "d30" | "d90" | "custom";

export function applyPreset(name: DatePreset, now = NOW): { from: Date; to: Date; preset: DatePreset } {
  const today0 = startOfDay(now);
  if (name === "today") return { from: today0, to: now, preset: name };
  if (name === "yesterday") {
    const y0 = addMs(today0, -86400000);
    return { from: y0, to: addMs(y0, 86400000 - 1000), preset: name };
  }
  if (name === "d7") return { from: addMs(today0, -6 * 86400000), to: now, preset: name };
  if (name === "d14") return { from: addMs(today0, -13 * 86400000), to: now, preset: name };
  if (name === "d30") return { from: new Date("2026-08-01T00:00:00+07:00"), to: now, preset: name };
  if (name === "d90") return { from: addCalendarMonths(today0, -MAX_RANGE_MONTHS), to: now, preset: name };
  return { from: today0, to: now, preset: "custom" };
}

export function prevRange(from: Date, to: Date): { from: Date; to: Date } {
  const fromD = startOfDay(from);
  const sameCalendar =
    Math.abs(from.getTime() - fromD.getTime()) < 60000 && fmtD(from) === fmtD(addMs(to, -1));
  if (sameCalendar || (fmtD(from) === fmtD(to) && from.getTime() - fromD.getTime() < 60000)) {
    return { from: addMs(from, -86400000), to: addMs(to, -86400000) };
  }
  const dur = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - dur), to: from };
}
