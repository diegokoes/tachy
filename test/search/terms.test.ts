import { describe, expect, it } from "vitest";
import {
  exactTerms,
  keywordInputs,
  keywordQueryOf,
  MAX_EXACT_TERMS,
} from "@tachy/core/search";

describe("exactTerms", () => {
  it("takes codes, identifiers, file names and quoted messages", () => {
    const text = [
      "Since Monday the export fails with ECONNREFUSED and error E1234.",
      "The log shows TOO_MANY_STRINGS and 0x80070005 from NullReferenceException",
      "in System.IO.IOException, after we edited config.json.",
      'The dialog says "Access is denied" and the German one „Zugriff verweigert“.',
    ].join(" ");
    expect(exactTerms(text)).toEqual([
      "ECONNREFUSED",
      "E1234",
      "TOO_MANY_STRINGS",
      "0x80070005",
      "NullReferenceException",
      "System.IO.IOException",
      "config.json",
      '"Access is denied"',
      '"Zugriff verweigert"',
    ]);
  });

  it("leaves out prose, numbers, versions, units and shouted words", () => {
    const text =
      "URGENT please help: since version 2.4.1 and v2.5.0 the scanner is offline. " +
      "Ticket 48213 from 23.10.2026 at 10:30, the 2nd time, 16GB free, e.g. a reboot. " +
      "Der Scanner geht seit dem Software-Update nicht mehr.";
    expect(exactTerms(text)).toEqual([]);
  });

  it("leaves out redaction placeholders, emails and URLs", () => {
    const text =
      "[USER_1] wrote from ops@example.com, see https://status.example.com/incident_42 for ECONNREFUSED.";
    expect(exactTerms(text)).toEqual(["ECONNREFUSED"]);
  });

  it("puts the most frequent first, then keeps the order they appear in", () => {
    const text =
      "AMQP_RECONNECT then LC_TIMEOUT, LC_TIMEOUT again, then PDF_EMPTY.";
    expect(exactTerms(text)).toEqual([
      "LC_TIMEOUT",
      "AMQP_RECONNECT",
      "PDF_EMPTY",
    ]);
  });

  it(`stops at ${MAX_EXACT_TERMS}`, () => {
    const text = Array.from({ length: 20 }, (_, i) => `ERR_${i}`).join(" ");
    expect(exactTerms(text)).toHaveLength(MAX_EXACT_TERMS);
    expect(exactTerms(text)[0]).toBe("ERR_0");
  });
});

describe("keywordInputs", () => {
  it("searches the query's own words when there are no terms", () => {
    expect(keywordInputs("scanner offline", [])).toEqual({
      words: "scanner offline",
      fuzzy: ["scanner offline"],
    });
    expect(keywordInputs("scanner offline", undefined).fuzzy).toEqual([
      "scanner offline",
    ]);
  });

  it("matches any one term, a quoted message as a phrase", () => {
    const terms = ["ECONNREFUSED", '"Access is denied"'];
    expect(keywordQueryOf(terms)).toBe('ECONNREFUSED or "Access is denied"');
    expect(keywordInputs("a long ticket", terms)).toEqual({
      words: 'ECONNREFUSED or "Access is denied"',
      fuzzy: terms,
    });
  });
});
