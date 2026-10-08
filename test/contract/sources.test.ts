import { describe, expect, it } from "vitest";
import { isSourceBaseUrl } from "@tachy/contract";

describe("a source connection's base URL", () => {
  it.each([
    "https://acme.freshdesk.com",
    "https://dev.azure.com/acme",
    "http://ado.office.lan:8080/tfs",
  ])("accepts %s", (url) => {
    expect(isSourceBaseUrl(url)).toBe(true);
  });

  it.each([
    "",
    "acme.freshdesk.com",
    "ftp://acme.example.com",
    "file:///etc/passwd",
    "ext::sh -c id",
    "https://user@acme.example.com",
    "https://user:hunter2@acme.example.com",
  ])("refuses %s", (url) => {
    expect(isSourceBaseUrl(url)).toBe(false);
  });
});
