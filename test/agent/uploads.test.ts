import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@tachy/core/access";
import { parseUploadRef } from "@tachy/core/chat";
import { createApp } from "../../packages/api/src/app";
import { loginCookie } from "../http";
import { resetData, sql } from "../database";

afterAll(() => sql.end());

const app = createApp({ passwordAuth: true });

beforeEach(resetData);

async function uploaderCookie() {
  const user = await createUser({
    email: "uploader@example.com",
    password: "a-long-password",
    role: "member",
  });
  const cookie = await loginCookie(
    app,
    "uploader@example.com",
    "a-long-password",
  );
  return { user, cookie };
}

function upload(cookie: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return app.request("/api/agent/uploads", {
    method: "POST",
    body: form,
    headers: { Cookie: cookie },
  });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The first bytes of a zip, which is what a .docx is. */
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]);

describe("chat uploads", () => {
  it("stores an upload in the database for its uploader and hands back a reference", async () => {
    const { user, cookie } = await uploaderCookie();
    const response = await upload(cookie, new File(["hello"], "notes.txt"));
    expect(response.status).toBe(200);
    const { path } = await response.json();
    const ref = parseUploadRef(path)!;
    expect(ref.filename).toBe("notes.txt");
    const [row] =
      await sql`select user_id, content_type, byte_size, expires_at > now() + interval '23 hours' as long from chat_uploads where id = ${ref.id}`;
    expect(row).toMatchObject({
      user_id: user.id,
      content_type: "text/plain",
      byte_size: 5,
      long: true,
    });
  });

  it("records an image by what its bytes are, not by its extension", async () => {
    const { cookie } = await uploaderCookie();
    const response = await upload(cookie, new File([PNG], "screen.jpg"));
    expect(response.status).toBe(200);
    const [row] = await sql`select content_type from chat_uploads`;
    expect(row.content_type).toBe("image/png");
  });

  it("refuses an extension that is not on the list", async () => {
    const { cookie } = await uploaderCookie();
    const response = await upload(cookie, new File([ZIP], "report.docx"));
    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect((await response.json()).detail).toMatch(
      /report\.docx is not a type/,
    );
    expect(await sql`select 1 from chat_uploads`).toHaveLength(0);
  });

  it("refuses a file whose bytes are not what its extension says", async () => {
    const { cookie } = await uploaderCookie();
    for (const name of ["renamed.txt", "renamed.pdf", "renamed.png"]) {
      const response = await upload(cookie, new File([ZIP], name));
      expect(response.status).toBe(415);
      expect((await response.json()).detail).toMatch(/does not contain/);
    }
    expect(await sql`select 1 from chat_uploads`).toHaveLength(0);
  });
});
