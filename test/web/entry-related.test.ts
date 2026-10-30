import { describe, expect, it } from "vitest";
import { linkLabel } from "../../packages/web/src/knowledge/related";

describe("a related link as listed", () => {
  it("drops the scheme and a trailing slash", () => {
    expect(linkLabel("https://dev.azure.com/acme/_workitems/edit/50912")).toBe(
      "dev.azure.com/acme/_workitems/edit/50912",
    );
    expect(linkLabel("http://wiki.office.lan/printers/")).toBe(
      "wiki.office.lan/printers",
    );
  });
});
