import { describe, expect, it } from "vitest";
import { fetchUntrustedUrl } from "../packages/core/src/sources/fetch";

/**
 * Every case here is refused before any socket is opened, so the suite needs no
 * network. The positive path — a real public host — is deliberately not covered:
 * it would make the suite depend on DNS and on the internet being up.
 */
describe("fetchUntrustedUrl", () => {
  it("refuses schemes that are not http or https", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/",
    ])
      await expect(fetchUntrustedUrl("t", url)).rejects.toThrow(
        "only http and https",
      );
  });

  it("refuses loopback, link-local and private addresses", async () => {
    for (const url of [
      "http://127.0.0.1:8787/api/admin/system",
      "http://localhost:8787/",
      "http://[::1]:8787/",
      // The cloud metadata endpoint, the classic SSRF target.
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://192.168.1.117:8787/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
    ])
      await expect(fetchUntrustedUrl("t", url)).rejects.toThrow(
        /private or loopback|cannot resolve/,
      );
  });

  it("refuses a hostname that does not resolve rather than attempting it", async () => {
    await expect(
      fetchUntrustedUrl("t", "http://tachy-no-such-host.invalid/"),
    ).rejects.toThrow("cannot resolve");
  });

  it("refuses something that is not a URL at all", async () => {
    await expect(fetchUntrustedUrl("t", "not a url")).rejects.toThrow(
      "is not a URL",
    );
  });
});
