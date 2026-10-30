import { describe, expect, it } from "vitest";
import { isRelatedLink } from "@tachy/contract";

describe("an entry's related link", () => {
  it.each([
    "https://dev.azure.com/acme/_workitems/edit/50912",
    "https://acme.freshdesk.com/a/tickets/4711",
    "http://wiki.office.lan/printers#spooler",
  ])("accepts %s", (url) => {
    expect(isRelatedLink(url)).toBe(true);
  });

  it.each([
    "",
    "DevOps#158327",
    "acme.freshdesk.com/a/tickets/4711",
    "ftp://files.example.com/log.txt",
    "javascript:alert(1)",
    "https://user:hunter2@acme.example.com",
  ])("refuses %s", (url) => {
    expect(isRelatedLink(url)).toBe(false);
  });
});
