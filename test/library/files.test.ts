import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, setTeamMember } from "@tachy/core/access";
import { addCustomer, addCustomerUnit } from "@tachy/core/catalog";
import {
  getDocFile,
  saveLibraryFile,
  sweepOrphanFiles,
} from "@tachy/core/library";
import { getReferenceDoc, saveReferenceDoc } from "@tachy/core/reference";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { minimalPdf } from "../fixtures/files";
import { resetData, sql, tqxProductId } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

beforeEach(resetData);

const pdfBytes = async (text: string) => new Uint8Array(await minimalPdf(text));

describe("a doc's original file", () => {
  it("stores one row per content however often it is saved", async () => {
    const bytes = await pdfBytes("Line layout");
    const file = {
      filename: "layout.pdf",
      contentType: "application/pdf" as const,
      bytes,
    };
    const first = await saveLibraryFile(sql, file);
    const again = await saveLibraryFile(sql, {
      ...file,
      filename: "copy.pdf",
    });
    expect(again).toBe(first);
    const [count] = await sql`select count(*)::int as n from library_files`;
    expect(count.n).toBe(1);
  });

  it("reads back the original of a doc, and nothing for one written as text", async () => {
    const bytes = await pdfBytes("Line layout");
    const fileId = await saveLibraryFile(sql, {
      filename: "layout.pdf",
      contentType: "application/pdf",
      bytes,
    });
    const withFile = await saveReferenceDoc({
      title: "Layout",
      body: "Line layout",
      productId: await tqxProductId(),
      fileId,
    });
    const asText = await saveReferenceDoc({
      title: "Notes",
      body: "Plain notes",
      productId: await tqxProductId(),
    });
    const file = await getDocFile(withFile.id);
    expect(file?.filename).toBe("layout.pdf");
    expect(Buffer.from(file!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(await getDocFile(asText.id)).toBeNull();
    expect((await getReferenceDoc(withFile.id)).file_name).toBe("layout.pdf");
  });

  it("sweeps a file no doc points at once it is a week old, and keeps the rest", async () => {
    const kept = await saveLibraryFile(sql, {
      filename: "kept.pdf",
      contentType: "application/pdf",
      bytes: await pdfBytes("kept"),
    });
    await saveReferenceDoc({
      title: "Kept",
      body: "kept",
      productId: await tqxProductId(),
      fileId: kept,
    });
    await saveLibraryFile(sql, {
      filename: "fresh.pdf",
      contentType: "application/pdf",
      bytes: await pdfBytes("fresh"),
    });
    const stale = await saveLibraryFile(sql, {
      filename: "stale.pdf",
      contentType: "application/pdf",
      bytes: await pdfBytes("stale"),
    });
    await sql`update library_files set created_at = now() - interval '8 days'`;
    await sql`update library_files set created_at = now() where filename = 'fresh.pdf'`;
    expect(await sweepOrphanFiles()).toBe(1);
    const left = await sql`select id from library_files order by filename`;
    expect(left.map((r) => r.id)).not.toContain(stale);
    expect(left).toHaveLength(2);
  });
});

describe("uploading a file as a doc", () => {
  async function curatorCookie() {
    await createUser({
      email: "lead@example.com",
      password: "a-long-password",
      role: "member",
    });
    await setTeamMember("test-team", "lead@example.com", "admin");
    return loginCookie(app, "lead@example.com", "a-long-password");
  }

  function upload(cookie: string, file: File, fields: Record<string, string>) {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return app.request("/api/reference/files", {
      method: "POST",
      body: form,
      headers: { Cookie: cookie },
    });
  }

  it("files the doc under a customer's unit with its text, and keeps the PDF to download", async () => {
    const cookie = await curatorCookie();
    const productId = await tqxProductId();
    await addCustomer({ name: "Ilverton Brands", slug: "ivk" });
    await addCustomerUnit({
      customerSlug: "ivk",
      slug: "pln191",
      name: "PLN191",
      kind: "line",
      productId,
    });
    const bytes = await pdfBytes("Electrical layout of line PLN191");
    const response = await upload(
      cookie,
      new File([bytes], "PLN191 layout.pdf"),
      { productId, customerSlug: "ivk", unit: "pln191" },
    );
    expect(response.status).toBe(200);
    const { id } = await response.json();
    const doc = await getReferenceDoc(id);
    expect(doc).toMatchObject({
      title: "PLN191 layout",
      customer_slug: "ivk",
      customer_unit_slug: "pln191",
      file_name: "PLN191 layout.pdf",
    });
    expect(doc.body).toContain("Electrical layout of line PLN191");

    const download = await app.request(`/api/reference/${id}/file`, {
      headers: { Cookie: cookie },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="PLN191 layout\.pdf"/,
    );
    expect(
      Buffer.from(await download.arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);
  });

  it("refuses a file a doc keeps no original of, and a member", async () => {
    const cookie = await curatorCookie();
    const productId = await tqxProductId();
    const notes = await upload(cookie, new File(["plain"], "notes.txt"), {
      productId,
    });
    expect(notes.status).toBe(415);

    await createUser({
      email: "member@example.com",
      password: "a-long-password",
      role: "member",
    });
    const member = await loginCookie(
      app,
      "member@example.com",
      "a-long-password",
    );
    const refused = await upload(
      member,
      new File([await pdfBytes("x")], "x.pdf"),
      { productId },
    );
    expect(refused.status).toBe(403);
  });

  it("answers 404 for a doc that keeps no original", async () => {
    const cookie = await curatorCookie();
    const doc = await saveReferenceDoc({
      title: "Notes",
      body: "Plain notes",
      productId: await tqxProductId(),
    });
    const response = await app.request(`/api/reference/${doc.id}/file`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(404);
  });
});
