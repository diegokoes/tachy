import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin, publicOrigins } from "@tachy/core/infra";

afterEach(() => {
  delete process.env.TACHY_PUBLIC_ORIGINS;
});

describe("the server's own address", () => {
  it("is unknown on a host that sets none", () => {
    expect(publicOrigins()).toEqual([]);
    expect(publicOrigin("https://tachy.local")).toBeUndefined();
  });

  it("is read as origins, and anything that is not one is left out", () => {
    process.env.TACHY_PUBLIC_ORIGINS =
      " https://tachy.local/ , https://192.0.2.7:8443/x?y=1,ftp://files.example,not a url,,";
    expect(publicOrigins()).toEqual([
      "https://tachy.local",
      "https://192.0.2.7:8443",
    ]);
  });

  it("follows the address a request came in on when that is one of ours, else the first", () => {
    process.env.TACHY_PUBLIC_ORIGINS = "https://tachy.local,https://192.0.2.7";
    expect(publicOrigin("https://192.0.2.7")).toBe("https://192.0.2.7");
    expect(publicOrigin("https://evil.example")).toBe("https://tachy.local");
    expect(publicOrigin(undefined)).toBe("https://tachy.local");
    expect(publicOrigin(null)).toBe("https://tachy.local");
  });
});
