import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCustomer, listCustomers, resolveCustomerByEmail, getCustomerIdBySlug, getCustomerName,
} from "@tachy/core";
import { resetData, sql } from "./helpers";

describe("customers", () => {
  beforeEach(resetData);
  afterAll(() => sql.end());

  it("starts empty and lists what's added", async () => {
    expect(await listCustomers()).toEqual([]);
    await addCustomer({ name: "Dalmoor", slug: "dalmoor", aliases: ["dalmoor.example"] });
    const rows = await listCustomers();
    expect(rows.map((r) => r.slug)).toEqual(["dalmoor"]);
  });

  it("resolves by email domain via aliases, including a distributor alias", async () => {
    const c = await addCustomer({ name: "Dalmoor", slug: "dalmoor", aliases: ["dalmoor.example", "arkwell.example"] });
    expect(await resolveCustomerByEmail("user@dalmoor.example")).toBe(c.id);
    expect(await resolveCustomerByEmail("agent@arkwell.example")).toBe(c.id);
    expect(await resolveCustomerByEmail("user@unrelated.com")).toBeNull();
    expect(await resolveCustomerByEmail(undefined)).toBeNull();
  });

  it("getCustomerIdBySlug throws a clear error for an unknown slug", async () => {
    await expect(getCustomerIdBySlug("nope")).rejects.toThrow(/Unknown customer 'nope'/);
  });

  it("getCustomerName resolves a name, and is null-safe", async () => {
    const c = await addCustomer({ name: "Dalmoor", slug: "dalmoor" });
    expect(await getCustomerName(c.id)).toBe("Dalmoor");
    expect(await getCustomerName(null)).toBeNull();
  });
});
