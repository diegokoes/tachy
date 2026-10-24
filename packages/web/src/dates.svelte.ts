import {
  encodeDateFormat,
  formatDateTime,
  formatDay,
  formatTime,
  parseDateFormat,
  type Clock,
  type DateFormat,
  type DateOrder,
  type Moment,
} from "@tachy/contract";
import { api } from "./api";
import { EMPTY } from "./tui/glyphs";

const STORAGE_KEY = "tachy-date-format";

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The signed-in reader's format. Seeded from the last one this browser saw so
 * a reload does not flash the default before the server answers.
 */
export const dateFormat = $state<DateFormat>(parseDateFormat(stored()));

function apply(format: DateFormat) {
  dateFormat.order = format.order;
  dateFormat.clock = format.clock;
  try {
    localStorage.setItem(STORAGE_KEY, encodeDateFormat(format));
  } catch {
    // storage blocked: the server copy still holds
  }
}

type Pref<T> = { value: T; source: string };
type DatePrefs = { date_order: Pref<DateOrder>; clock: Pref<Clock> };

export async function loadDateFormat() {
  try {
    const prefs = await api.get<DatePrefs>("/me/preferences");
    apply({ order: prefs.date_order.value, clock: prefs.clock.value });
  } catch {
    // keep whatever the browser last saw
  }
}

const PREF_KEY = { order: "date_order", clock: "clock" } as const;

/** Applied at once and put back if the server refuses it. */
export async function setDatePart<P extends keyof DateFormat>(
  part: P,
  value: DateFormat[P],
) {
  const before = { ...dateFormat };
  apply({ ...dateFormat, [part]: value });
  try {
    await api.put(`/me/preferences/${PREF_KEY[part]}`, { value });
  } catch (e) {
    apply(before);
    throw e;
  }
}

/** A timestamp as the plain day it names. Times are noise in a list of records. */
export const fmtDate = (d?: Moment) => formatDay(d, dateFormat);

/** Date and time, or the empty mark when there is none. */
export const fmtDateTime = (d?: Moment) =>
  formatDateTime(d, dateFormat) || EMPTY;

export const fmtTime = (d?: Moment) => formatTime(d, dateFormat);

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const HOURS_SHOWN_BELOW = 48;

/** "12 min", "5 h", "3 d": a stretch of time in its largest whole unit. */
export function span(ms: number): string {
  const min = Math.max(0, Math.round(ms / MINUTE_MS));
  if (min < HOUR_MINUTES) return `${min} min`;
  const h = Math.round(min / HOUR_MINUTES);
  return h < HOURS_SHOWN_BELOW ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** "12 min ago", "3 h ago", "21 d ago"; "never" when there is no time. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const atMs = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(atMs) ? `${span(now - atMs)} ago` : "never";
}

/** The hover text for a timestamp: the full moment, and that it is UTC. */
export const utcTip = (d?: Moment) => {
  const at = formatDateTime(d, dateFormat);
  return at && `${at} UTC`;
};
