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
    await addCustomer({ name: "Davidoff", slug: "davidoff", aliases: ["davidoff.com"] });
    const rows = await listCustomers();
    expect(rows.map((r) => r.slug)).toEqual(["davidoff"]);
  });

  it("resolves by email domain via aliases, including a distributor alias", async () => {
    const c = await addCustomer({ name: "Davidoff", slug: "davidoff", aliases: ["davidoff.com", "arvato.com"] });
    expect(await resolveCustomerByEmail("user@davidoff.com")).toBe(c.id);
    expect(await resolveCustomerByEmail("agent@arvato.com")).toBe(c.id);
    expect(await resolveCustomerByEmail("user@unrelated.com")).toBeNull();
    expect(await resolveCustomerByEmail(undefined)).toBeNull();
  });

  it("getCustomerIdBySlug throws a clear error for an unknown slug", async () => {
    await expect(getCustomerIdBySlug("nope")).rejects.toThrow(/Unknown customer 'nope'/);
  });

  it("getCustomerName resolves a name, and is null-safe", async () => {
    const c = await addCustomer({ name: "Davidoff", slug: "davidoff" });
    expect(await getCustomerName(c.id)).toBe("Davidoff");
    expect(await getCustomerName(null)).toBeNull();
  });
});
