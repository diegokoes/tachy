import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { ANONYMOUS_UPLOADS, saveUpload, sweepUploads } from "@tachy/core/chat";
import { extractSource } from "../../packages/mcp/src/extract";
import { resetData, sql } from "../database";
import { minimalPdf, zipOf } from "../fixtures/files";

afterAll(() => sql.end());
beforeEach(async () => {
  await resetData();
  await sql`truncate chat_uploads`;
});

describe("extractSource", () => {
  it("names an image as having no text, and does not decode it", async () => {
    const image = await saveUpload({
      userId: null,
      filename: "screen.png",
      contentType: "image/png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await expect(extractSource(image.ref)).rejects.toThrow(
      /screen\.png is an image/,
    );
  });

  it("sniffs a row stored without a content type", async () => {
    const [unchecked] = await sql`
      insert into chat_uploads (filename, byte_size, bytes, expires_at)
      values ('legacy.bin', 3, ${Buffer.from("old")}, now() + interval '1 hour')
      returning id`;
    const extracted = await extractSource(`upload:${unchecked.id}/legacy.bin`);
    expect(extracted.text).toBe("old");
  });

  it("extracts text and page count from an uploaded PDF, and passes text through", async () => {
    const pdf = await saveUpload({
      userId: null,
      filename: "runbook.pdf",
      contentType: "application/pdf",
      bytes: minimalPdf("Line controller failover heartbeat"),
    });
    const got = await extractSource(pdf.ref);
    expect(got.pages).toBe(1);
    expect(got.text).toBe("[page 1]\nLine controller failover heartbeat");

    const txt = await saveUpload({
      userId: null,
      filename: "notes.txt",
      contentType: "text/plain",
      bytes: Buffer.from("plain utf8 notes\n"),
    });
    const extracted = await extractSource(txt.ref);
    expect(extracted.pages).toBeUndefined();
    expect(extracted.text).toBe("plain utf8 notes\n");
  });

  it("lists an uploaded zip and reads the member it is asked for", async () => {
    const zip = await saveUpload({
      userId: null,
      filename: "logs.zip",
      contentType: "application/zip",
      bytes: zipOf({ "app.log": "ERROR timeout\n", "notes.md": "# notes" }),
    });
    const listed = await extractSource(zip.ref);
    expect(listed.members?.map((m) => m.name)).toEqual(["app.log", "notes.md"]);
    expect((await extractSource(zip.ref, { member: "notes.md" })).text).toBe(
      "# notes",
    );
  });

  it("refuses anything that is not a chat upload", async () => {
    for (const path of [
      "/proc/self/environ",
      "/etc/passwd",
      "upload:not-a-uuid/x",
      "../x",
    ])
      await expect(extractSource(path)).rejects.toThrow(
        "is not an uploaded file",
      );
  });

  it("confines a turn's child to its own user's uploads, and to live ones", async () => {
    const alice = await createUser({ email: "alice@example.com" });
    const bob = await createUser({ email: "bob@example.com" });
    const a = await saveUpload({
      userId: alice.id,
      filename: "a.txt",
      contentType: "text/plain",
      bytes: Buffer.from("alice's"),
    });
    const b = await saveUpload({
      userId: bob.id,
      filename: "b.txt",
      contentType: "text/plain",
      bytes: Buffer.from("bob's"),
    });

    process.env.TACHY_UPLOAD_OWNER = alice.id;
    try {
      expect((await extractSource(a.ref)).text).toBe("alice's");
      await expect(extractSource(b.ref)).rejects.toThrow(
        "is not an uploaded file",
      );
      await sql`update chat_uploads set expires_at = now() - interval '1 second' where id = ${a.id}`;
      await expect(extractSource(a.ref)).rejects.toThrow(
        "is not an uploaded file",
      );
    } finally {
      delete process.env.TACHY_UPLOAD_OWNER;
    }
  });
});

describe("a turn with no user", () => {
  it("reads the uploads nobody owns, and no one else's", async () => {
    const alice = await createUser({ email: "alice@example.com" });
    const hers = await saveUpload({
      userId: alice.id,
      filename: "a.txt",
      contentType: "text/plain",
      bytes: Buffer.from("alice's"),
    });
    const ownerless = await saveUpload({
      userId: null,
      filename: "n.txt",
      contentType: "text/plain",
      bytes: Buffer.from("nobody's"),
    });

    process.env.TACHY_UPLOAD_OWNER = ANONYMOUS_UPLOADS;
    try {
      expect((await extractSource(ownerless.ref)).text).toBe("nobody's");
      await expect(extractSource(hers.ref)).rejects.toThrow(
        "is not an uploaded file",
      );
    } finally {
      delete process.env.TACHY_UPLOAD_OWNER;
    }
    expect((await extractSource(hers.ref)).text).toBe("alice's");
  });
});

describe("sweepUploads", () => {
  it("deletes expired uploads only", async () => {
    const old = await saveUpload({
      userId: null,
      filename: "old.txt",
      contentType: "text/plain",
      bytes: Buffer.from("x"),
    });
    await saveUpload({
      userId: null,
      filename: "new.txt",
      contentType: "text/plain",
      bytes: Buffer.from("y"),
    });
    await sql`update chat_uploads set expires_at = now() - interval '1 minute' where id = ${old.id}`;
    expect(await sweepUploads()).toBe(1);
    expect(
      (await sql`select filename from chat_uploads`).map((r) => r.filename),
    ).toEqual(["new.txt"]);
  });
});
