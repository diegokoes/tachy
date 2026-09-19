/** A timestamp as the plain day it names. Times are noise in a list of records. */
export const fmtDate = (d?: string) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

/** Date and time in the viewer's locale, or "-" when there is none. */
export const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString() : "-";
