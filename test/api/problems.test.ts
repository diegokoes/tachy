import { afterAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { notFound, forbidden } from "@tachy/core/infra";
import { createApp } from "../../packages/api/src/app";
import { PROBLEM_JSON } from "../../packages/api/src/problems";
import { json } from "../http";
import { sql } from "../database";

afterAll(() => sql.end());

const app = createApp();
const raising = app as unknown as Hono;
raising.get("/raise/app-error", () => {
  throw notFound("no such thing");
});
raising.get("/raise/extended", () => {
  throw forbidden("not for you", { code: "why", email: "a@example.com" });
});
raising.get("/raise/http-4xx", () => {
  throw new HTTPException(403, { message: "app admin role required" });
});
raising.get("/raise/http-5xx", () => {
  throw new HTTPException(502, { message: "the provider said something" });
});
raising.get("/raise/unknown", () => {
  throw new Error("a detail nobody outside should read");
});

async function problemOf(response: Response) {
  expect(response.headers.get("content-type")).toBe(PROBLEM_JSON);
  const body = await response.json();
  expect(body.status).toBe(response.status);
  return body;
}

describe("every refusal is a problem document", () => {
  it("answers an AppError with its message as the detail", async () => {
    const response = await app.request("/raise/app-error");
    expect(response.status).toBe(404);
    expect(await problemOf(response)).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "no such thing",
    });
  });

  it("carries an AppError's extensions beside the detail", async () => {
    const body = await problemOf(await app.request("/raise/extended"));
    expect(body).toMatchObject({
      status: 403,
      detail: "not for you",
      code: "why",
      email: "a@example.com",
    });
  });

  it("answers a thrown 4xx HTTPException as JSON, with its message", async () => {
    const body = await problemOf(await app.request("/raise/http-4xx"));
    expect(body).toMatchObject({
      status: 403,
      title: "Forbidden",
      detail: "app admin role required",
    });
  });

  it("keeps a 5xx HTTPException's message out of the answer", async () => {
    const body = await problemOf(await app.request("/raise/http-5xx"));
    expect(body).toEqual({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
    });
  });

  it("says nothing about an unexpected error", async () => {
    const body = await problemOf(await app.request("/raise/unknown"));
    expect(body).toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
    });
  });

  it("names each failing field of a body the schema refuses", async () => {
    const response = await app.request(
      "/api/knowledge",
      json({ status: "no-such-status" }),
    );
    expect(response.status).toBe(400);
    const body = await problemOf(response);
    expect(typeof body.detail).toBe("string");
    expect(body.detail).toMatch(/status: /);
  });

  it("answers a body that is not JSON", async () => {
    const response = await app.request("/api/knowledge", {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(400);
    expect((await problemOf(response)).detail).toMatch(/JSON/);
  });

  it("answers a path with no route", async () => {
    const response = await app.request("/api/no-such-route");
    expect(response.status).toBe(404);
    expect((await problemOf(response)).title).toBe("Not Found");
  });
});
