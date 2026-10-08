/**
 * How a person reads dates. Times are always UTC: storage, scheduling and day
 * buckets are UTC, so showing anything else would make the screen disagree
 * with the rows behind it. The format is the only personal part.
 */

export const DATE_ORDERS = ["iso", "dmy", "mdy", "long"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

/** The pattern each order is offered under. */
export const DATE_ORDER_LABELS: Record<DateOrder, string> = {
  iso: "YYYY-MM-DD",
  dmy: "DD-MM-YYYY",
  mdy: "MM-DD-YYYY",
  long: "DD Month YYYY",
};

export const CLOCKS = ["24h", "12h"] as const;
export type Clock = (typeof CLOCKS)[number];

export interface DateFormat {
  order: DateOrder;
  clock: Clock;
}

export const DEFAULT_DATE_FORMAT: DateFormat = { order: "dmy", clock: "24h" };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored moment: a Date, an ISO string, or epoch milliseconds. */
export type Moment = Date | string | number | null | undefined;

function toDate(at: Moment): Date | null {
  if (at == null || at === "") return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The UTC day `at` falls on, or "" when it is not a date. */
export function formatDay(at: Moment, format: DateFormat): string {
  const date = toDate(at);
  if (!date) return "";
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  switch (format.order) {
    case "dmy":
      return `${pad(day)}-${pad(month + 1)}-${year}`;
    case "mdy":
      return `${pad(month + 1)}-${pad(day)}-${year}`;
    case "long":
      return `${day} ${MONTHS[month]} ${year}`;
    default:
      return `${year}-${pad(month + 1)}-${pad(day)}`;
  }
}

/** The UTC time of day, to the minute. */
export function formatTime(at: Moment, format: DateFormat): string {
  const date = toDate(at);
  if (!date) return "";
  const hour = date.getUTCHours();
  const minute = pad(date.getUTCMinutes());
  if (format.clock === "24h") return `${pad(hour)}:${minute}`;
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatDateTime(at: Moment, format: DateFormat): string {
  const day = formatDay(at, format);
  return day && `${day} ${formatTime(at, format)}`;
}

/**
 * The spreadsheet number format showing a date cell the way `formatDateTime`
 * does. Separators are escaped because Excel otherwise swaps `/` and `-` for
 * the reader's locale separator.
 */
export function excelDateTimeFormat(format: DateFormat): string {
  const day = {
    iso: "yyyy\\-mm\\-dd",
    dmy: "dd\\-mm\\-yyyy",
    mdy: "mm\\-dd\\-yyyy",
    long: "d\\ mmm\\ yyyy",
  }[format.order];
  const time = format.clock === "24h" ? "hh:mm" : "h:mm\\ AM/PM";
  return `${day}\\ ${time}`;
}

/** `"dmy/12h"`: the format as one string, for an environment variable. */
export const encodeDateFormat = (f: DateFormat) => `${f.order}/${f.clock}`;

export function parseDateFormat(
  encoded: string | null | undefined,
): DateFormat {
  const [order, clock] = (encoded ?? "").split("/");
  return {
    order: (DATE_ORDERS as readonly string[]).includes(order)
      ? (order as DateOrder)
      : DEFAULT_DATE_FORMAT.order,
    clock: (CLOCKS as readonly string[]).includes(clock)
      ? (clock as Clock)
      : DEFAULT_DATE_FORMAT.clock,
  };
}
