import {
  DEFAULT_DATE_FORMAT,
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
 * a reload does not flash ISO before the server answers.
 */
export const dateFormat = $state<DateFormat>(parseDateFormat(stored()));

/** Which of the two the reader has set themselves, for the reset mark. */
export const dateFormatOwned = $state({ order: false, clock: false });

function apply(f: DateFormat) {
  dateFormat.order = f.order;
  dateFormat.clock = f.clock;
  try {
    localStorage.setItem(STORAGE_KEY, encodeDateFormat(f));
  } catch {
    /* storage blocked: the server copy still holds */
  }
}

type Pref<T> = { value: T; source: string };
type DatePrefs = { date_order: Pref<DateOrder>; clock: Pref<Clock> };

export async function loadDateFormat() {
  try {
    const p = await api.get<DatePrefs>("/me/preferences");
    dateFormatOwned.order = p.date_order.source === "user";
    dateFormatOwned.clock = p.clock.source === "user";
    apply({ order: p.date_order.value, clock: p.clock.value });
  } catch {
    /* keep whatever the browser last saw */
  }
}

const PREF_KEY = { order: "date_order", clock: "clock" } as const;

/** Applied at once and put back if the server refuses it. */
export async function setDatePart<P extends keyof DateFormat>(
  part: P,
  value: DateFormat[P],
) {
  const before = { ...dateFormat };
  const owned = dateFormatOwned[part];
  apply({ ...dateFormat, [part]: value });
  dateFormatOwned[part] = true;
  try {
    await api.put(`/me/preferences/${PREF_KEY[part]}`, { value });
  } catch (e) {
    apply(before);
    dateFormatOwned[part] = owned;
    throw e;
  }
}

export async function resetDatePart(part: keyof DateFormat) {
  await api.delete(`/me/preferences/${PREF_KEY[part]}`);
  dateFormatOwned[part] = false;
  apply({ ...dateFormat, [part]: DEFAULT_DATE_FORMAT[part] });
}

/** A timestamp as the plain day it names. Times are noise in a list of records. */
export const fmtDate = (d?: Moment) => formatDay(d, dateFormat);

/** Date and time, or "-" when there is none. */
export const fmtDateTime = (d?: Moment) => formatDateTime(d, dateFormat) || "-";

export const fmtTime = (d?: Moment) => formatTime(d, dateFormat);

/** The hover text for a timestamp: the full moment, and that it is UTC. */
export const utcTip = (d?: Moment) => {
  const at = formatDateTime(d, dateFormat);
  return at && `${at} UTC`;
};
