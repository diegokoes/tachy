import { describe, expect, it } from "vitest";
import {
  attachmentPath,
  attachmentRef,
  parseAttachmentRef,
} from "../../packages/contract/src";

describe("a ticket file's reference", () => {
  const file = {
    source: "acme-freshdesk",
    externalId: "4711",
    attachmentId: "80012345",
  };

  it("names the connection, the item and the file, and reads back", () => {
    const ref = attachmentRef(file);
    expect(ref).toBe("attachment:acme-freshdesk/4711/80012345");
    expect(parseAttachmentRef(` ${ref} `)).toEqual(file);
  });

  it("keeps an id that holds a slash or a hash in one piece", () => {
    const issue = {
      source: "gh",
      externalId: "acme/portal#12",
      attachmentId: "a b",
    };
    const ref = attachmentRef(issue);
    expect(ref.split("/")).toHaveLength(3);
    expect(parseAttachmentRef(ref)).toEqual(issue);
  });

  it("is nothing else: not an upload, not a path, not a part short", () => {
    for (const other of [
      "upload:0f8fad5b-d9cb-469f-a165-70867728950e/a.png",
      "/etc/passwd",
      "attachment:only/two",
      "attachment:a//c",
      "attachment:a/%E0%A4%A/c",
      "",
    ])
      expect(parseAttachmentRef(other), other).toBeNull();
  });

  it("gives the address the file opens from", () => {
    expect(attachmentPath(file)).toBe(
      "/api/work-items/acme-freshdesk/4711/attachments/80012345",
    );
    expect(
      attachmentPath({ source: "gh", externalId: "a/b#1", attachmentId: "x" }),
    ).toBe("/api/work-items/gh/a%2Fb%231/attachments/x");
  });
});
