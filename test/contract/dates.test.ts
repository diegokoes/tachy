import { describe, expect, it } from "vitest";
import {
  CLOCKS,
  DATE_ORDERS,
  DEFAULT_DATE_FORMAT,
  encodeDateFormat,
  excelDateTimeFormat,
  formatDateTime,
  formatDay,
  formatTime,
  parseDateFormat,
} from "../../packages/contract/src";

const INSTANT = "2026-09-04T14:05:00Z";

describe("formatDay", () => {
  it.each([
    ["iso", "2026-09-04"],
    ["dmy", "04-09-2026"],
    ["mdy", "09-04-2026"],
    ["long", "4 Sep 2026"],
  ] as const)("%s", (order, expected) => {
    expect(formatDay(INSTANT, { order, clock: "24h" })).toBe(expected);
  });

  it("names the UTC day, whatever zone the process runs in", () => {
    expect(formatDay("2026-09-04T23:30:00-05:00", DEFAULT_DATE_FORMAT)).toBe(
      "05-09-2026",
    );
  });

  it("takes a Date, an ISO string or epoch milliseconds alike", () => {
    const date = new Date(INSTANT);
    for (const at of [date, INSTANT, date.getTime()])
      expect(formatDateTime(at, DEFAULT_DATE_FORMAT)).toBe("04-09-2026 14:05");
  });

  it("is empty for nothing and for garbage", () => {
    for (const at of [null, undefined, "", "not a date"])
      expect(formatDateTime(at, DEFAULT_DATE_FORMAT)).toBe("");
  });

  it("reads epoch 0 as a moment, not as missing", () => {
    expect(formatDay(0, DEFAULT_DATE_FORMAT)).toBe("01-01-1970");
  });
});

describe("formatTime", () => {
  const h12 = { order: "iso", clock: "12h" } as const;

  it.each([
    ["2026-09-04T00:00:00Z", "00:00", "12:00 AM"],
    ["2026-09-04T00:30:00Z", "00:30", "12:30 AM"],
    ["2026-09-04T09:07:00Z", "09:07", "9:07 AM"],
    ["2026-09-04T12:00:00Z", "12:00", "12:00 PM"],
    ["2026-09-04T23:59:00Z", "23:59", "11:59 PM"],
  ])("%s", (at, h24, h12text) => {
    expect(formatTime(at, DEFAULT_DATE_FORMAT)).toBe(h24);
    expect(formatTime(at, h12)).toBe(h12text);
  });
});

describe("excelDateTimeFormat", () => {
  it("matches the default day-first format", () => {
    expect(excelDateTimeFormat(DEFAULT_DATE_FORMAT)).toBe(
      "dd\\-mm\\-yyyy\\ hh:mm",
    );
  });

  it("escapes every separator so Excel keeps them", () => {
    expect(excelDateTimeFormat({ order: "mdy", clock: "12h" })).toBe(
      "mm\\-dd\\-yyyy\\ h:mm\\ AM/PM",
    );
  });
});

describe("encodeDateFormat / parseDateFormat", () => {
  it("round-trips every combination", () => {
    for (const order of DATE_ORDERS)
      for (const clock of CLOCKS)
        expect(parseDateFormat(encodeDateFormat({ order, clock }))).toEqual({
          order,
          clock,
        });
  });

  it("falls back per part on anything unknown", () => {
    expect(parseDateFormat(undefined)).toEqual(DEFAULT_DATE_FORMAT);
    expect(parseDateFormat("dmy/13h")).toEqual({ order: "dmy", clock: "24h" });
    expect(parseDateFormat("ymd/12h")).toEqual({ order: "dmy", clock: "12h" });
  });
});
