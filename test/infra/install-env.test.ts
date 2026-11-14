// What `tachy-install render` writes has to be enough for the production
// overlay: a variable the overlay starts to require fails here until the
// installer writes it.
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const installer = join(repo, "deploy/host/tachy-install");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const OPTIONAL_SETTINGS = [
  "OIDC_CLIENT_SECRET",
  "TEAMS_WEBHOOK_URL",
  "HC_BACKUP_URL",
  "HC_RESTORE_URL",
  "HC_WATCH_URL",
];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function render(hostYml: string, given: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "tachy-install-"));
  dirs.push(dir);
  writeFileSync(join(dir, "host.yml"), hostYml);
  renderAgain(dir, given);
  return dir;
}

function renderAgain(dir: string, given: Record<string, string> = {}): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TACHY_INSTALL_CORES: "16",
    ...given,
  };
  for (const name of OPTIONAL_SETTINGS) if (!(name in given)) delete env[name];
  execFileSync("bash", [installer, "render", dir, "--commit", COMMIT], {
    env,
    stdio: "pipe",
  });
}

function envOf(file: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

/** The variables a shell has after sourcing the file, as tachy-watch does. */
function sourced(file: string, names: string[]): string[] {
  const script = `set -eu; . "$1"; shift; for name; do printf '%s\\n' "\${!name}"; done`;
  return execFileSync("bash", ["-c", script, "bash", file, ...names], {
    encoding: "utf8",
  })
    .trimEnd()
    .split("\n");
}

function overlayAccepts(dir: string): void {
  execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      dir,
      "-f",
      join(repo, "docker-compose.yml"),
      "-f",
      join(repo, "deploy/compose.prod.yml"),
      "config",
      "-q",
    ],
    { stdio: "pipe" },
  );
}

const LAN_HOST = `
hostname: tachy.office.lan
host_ip: "192.168.1.20"
tls: internal
update_branch: main
host_profile: laptop
lan_cidrs: ["192.168.1.0/24"]
admin_users:
  - name: diego
    ssh_pubkey: "ssh-ed25519 AAAA diego"
backup_downloaders: []
`;

const SSO_HOST = `
hostname: tachy.example.com
tls: acme
tls_email: ops@example.com
update_branch: ""
oidc_issuer: https://login.example.com/tenant/v2.0
oidc_client_id: 11111111-2222-3333-4444-555555555555
host_profile: server
admin_users:
  - name: azureuser
`;

describe("tachy-install render", () => {
  it("writes an env the production overlay starts with", () => {
    const dir = render(LAN_HOST);
    overlayAccepts(dir);

    const env = envOf(join(dir, ".env"));
    expect(env).toMatchObject({
      TACHY_HOSTNAME: "tachy.office.lan",
      TACHY_HOST_IP: "192.168.1.20",
      TACHY_TLS: "internal",
      TACHY_COMMIT: COMMIT.slice(0, 12),
      TACHY_IMAGE: `ghcr.io/diegokoes/tachy:sha-${COMMIT.slice(0, 12)}`,
      TACHY_SANDBOX_IMAGE: `ghcr.io/diegokoes/tachy:sandbox-sha-${COMMIT.slice(0, 12)}`,
    });
    const secrets = [
      "POSTGRES_PASSWORD",
      "TACHY_APP_DB_PASSWORD",
      "TACHY_MCP_DB_PASSWORD",
      "TACHY_BACKUP_DB_PASSWORD",
      "TACHY_SECRET_KEY",
      "TACHY_SESSION_SECRET",
      "TACHY_INTERNAL_SECRET",
      "TACHY_API_TOKEN",
    ].map((name) => env[name]);
    for (const secret of secrets)
      expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(new Set(secrets).size).toBe(secrets.length);
    expect(Buffer.from(env.TACHY_SECRET_KEY, "base64")).toHaveLength(32);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);

    expect(
      sourced(join(dir, "tachy.env"), [
        "TACHY_UPDATE_BRANCH",
        "WATCH_DOWNLOADS",
      ]),
    ).toEqual(["main", "0"]);
  });

  it("keeps every value on a second run", () => {
    const dir = render(LAN_HOST);
    const first = readFileSync(join(dir, ".env"), "utf8");
    const firstHost = readFileSync(join(dir, "tachy.env"), "utf8");
    renderAgain(dir);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(first);
    expect(readFileSync(join(dir, "tachy.env"), "utf8")).toBe(firstHost);
  });

  it("leaves a value the admin set, and does not bring a removed first-start token back", () => {
    const dir = render(LAN_HOST);
    const kept = readFileSync(join(dir, ".env"), "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("TACHY_API_TOKEN="))
      .map((line) =>
        line.startsWith("TACHY_HOSTNAME=")
          ? "TACHY_HOSTNAME=renamed.lan"
          : line,
      )
      .join("\n");
    writeFileSync(join(dir, ".env"), kept);
    renderAgain(dir);
    const env = envOf(join(dir, ".env"));
    expect(env.TACHY_HOSTNAME).toBe("renamed.lan");
    expect(env).not.toHaveProperty("TACHY_API_TOKEN");
  });

  it("sets single sign-on up without a first-start token, and quotes what a shell would split", () => {
    const webhook = "https://example.webhook.office.com/hook?a=1&sig=it's";
    const dir = render(SSO_HOST, {
      OIDC_CLIENT_SECRET: "the~client.secret_value",
      TEAMS_WEBHOOK_URL: webhook,
    });
    overlayAccepts(dir);

    const env = envOf(join(dir, ".env"));
    expect(env).toMatchObject({
      TACHY_TLS: "ops@example.com",
      OIDC_ISSUER: "https://login.example.com/tenant/v2.0",
      OIDC_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
      OIDC_CLIENT_SECRET: "the~client.secret_value",
      OIDC_REDIRECT_URI: "https://tachy.example.com/auth/callback",
    });
    expect(env).not.toHaveProperty("TACHY_API_TOKEN");
    expect(env).not.toHaveProperty("TACHY_HOST_IP");

    expect(
      sourced(join(dir, "tachy.env"), ["TEAMS_WEBHOOK_URL", "TACHY_CA_FILE"]),
    ).toEqual([webhook, "/etc/ssl/certs/ca-certificates.crt"]);
    expect(envOf(join(dir, "tachy.env"))).not.toHaveProperty(
      "TACHY_UPDATE_BRANCH",
    );
  });

  it("lowers a CPU limit that is above the host's cores, and only that", () => {
    const limits = (cores: string) => {
      const env = envOf(
        join(render(LAN_HOST, { TACHY_INSTALL_CORES: cores }), ".env"),
      );
      return Object.fromEntries(
        Object.entries(env).filter(([name]) => name.endsWith("_CPUS")),
      );
    };
    expect(limits("8")).toEqual({});
    expect(limits("4")).toEqual({ TACHY_EMBEDDER_CPUS: "4" });
    expect(limits("2")).toEqual({
      TACHY_EMBEDDER_CPUS: "2",
      TACHY_WORKER_HEAVY_CPUS: "2",
    });
  });

  it("refuses a host file that cannot work", () => {
    const refusal = (hostYml: string, given?: Record<string, string>) => {
      try {
        render(hostYml, given);
      } catch (err) {
        return String((err as { stderr: Buffer }).stderr);
      }
      return "rendered";
    };
    expect(refusal("host_profile: server\n")).toMatch(/has no hostname/);
    expect(refusal("hostname: a.example\ntls: acme\n")).toMatch(/tls_email/);
    expect(refusal("hostname: a.example\ntls: files\n")).toMatch(
      /tls_cert_dir/,
    );
    expect(refusal("hostname: a.example\ntls: none\n")).toMatch(
      /internal, acme or files/,
    );
    expect(refusal(SSO_HOST)).toMatch(/OIDC_CLIENT_SECRET/);
  });
});
