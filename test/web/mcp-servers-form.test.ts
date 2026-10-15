import { describe, expect, it } from "vitest";
import {
  formatFiles,
  formatPairs,
  formatWindows,
  parseCodes,
  parseFiles,
  parsePairs,
  parseWindows,
  serverPayload,
  toolPrefixFor,
} from "../../packages/web/src/mcp-servers/form";

describe("linked-server form fields", () => {
  it("reads and writes name/value lines at the first separator", () => {
    const headers = parsePairs(
      "Authorization: Bearer {{token}}\n\nX-Env: a:b",
      ":",
    );
    expect(headers).toEqual({
      Authorization: "Bearer {{token}}",
      "X-Env": "a:b",
    });
    expect(parsePairs(formatPairs(headers, ": "), ":")).toEqual(headers);
    expect(() => parsePairs("no separator", ":")).toThrow(/needs a name/);
  });

  it("reads rate windows and codes, and refuses what is neither", () => {
    expect(parseWindows("60/15, 3600 / 150,")).toEqual([
      { seconds: 60, limit: 15 },
      { seconds: 3600, limit: 150 },
    ]);
    expect(formatWindows([{ seconds: 60, limit: 15 }])).toBe("60/15");
    expect(() => parseWindows("60:15")).toThrow(/seconds\/limit/);
    expect(parseCodes("-32029, 429")).toEqual([-32029, 429]);
    expect(() => parseCodes("x")).toThrow(/not a code/);
  });

  it("splits files on their path lines and keeps their content", () => {
    const files = parseFiles(
      "--- config/env.yaml\nurl: https://h\ntoken: {{token}}\n--- b.txt\nb\n",
    );
    expect(files).toEqual([
      {
        path: "config/env.yaml",
        content: "url: https://h\ntoken: {{token}}\n",
      },
      { path: "b.txt", content: "b\n" },
    ]);
    expect(parseFiles(formatFiles(files))).toEqual(files);
    expect(() => parseFiles("content before a path")).toThrow(/--- path/);
  });

  it("derives a tool prefix a tool name can start with", () => {
    expect(toolPrefixFor("hub-preprod")).toBe("hub_preprod");
    expect(toolPrefixFor("2nd-cloud")).toBe("nd_cloud");
    expect(toolPrefixFor("a".repeat(30))).toHaveLength(20);
  });

  it("builds the request body for each transport", () => {
    const http = serverPayload(
      {
        slug: "hub",
        name: "Hub",
        tool_prefix: "hub",
        transport: "http",
        url: "https://hub.example/mcp",
        headers: "Authorization: Bearer {{token}}",
        credential_mode: "shared",
        rate_windows: "60/15",
        rate_limit_codes: "-32029",
        argument_bindings: "customer = hub_customer",
        result_max_chars: "50000",
        call_timeout_ms: "",
        redaction: true,
        enabled: true,
        note: "",
      },
      ["ops"],
    );
    expect(http).toMatchObject({
      transport: "http",
      config: {
        url: "https://hub.example/mcp",
        headers: { Authorization: "Bearer {{token}}" },
      },
      credentialMode: "shared",
      rateWindows: [{ seconds: 60, limit: 15 }],
      argumentBindings: { customer: "hub_customer" },
      resultMaxChars: 50000,
      callTimeoutMs: undefined,
      note: null,
      teams: ["ops"],
    });
    const stdio = serverPayload(
      {
        slug: "gw",
        name: "Gateway",
        tool_prefix: "gw",
        transport: "stdio",
        command: "/usr/bin/gateway",
        args: "mcp\n--lock-config",
        env: "CONFIG_DIR={{dir}}",
        files: "--- env.yaml\ntoken: {{token}}",
        credential_mode: "personal",
        enabled: false,
      },
      [],
    );
    expect(stdio).toMatchObject({
      transport: "stdio",
      config: {
        command: "/usr/bin/gateway",
        args: ["mcp", "--lock-config"],
        env: { CONFIG_DIR: "{{dir}}" },
        files: [{ path: "env.yaml", content: "token: {{token}}\n" }],
      },
      credentialMode: "personal",
      enabled: false,
    });
    expect(
      serverPayload({ slug: "hub-x", transport: "http" }, []),
    ).toMatchObject({
      toolPrefix: "hub_x",
    });
    expect(() =>
      serverPayload({ transport: "http", result_max_chars: "-3" }, []),
    ).toThrow(/whole number/);
  });
});
