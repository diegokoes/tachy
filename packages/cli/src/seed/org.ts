import { SCOPES } from "@tachy/core/config";
import { TEAM_ROLES, USER_ROLES } from "@tachy/core";
import { hashPassword } from "@tachy/core/access";
import { insertRows, type Tx } from "./batches";
import { chance, intBetween, pick, rngFor, uuidFor } from "./deterministic";
import { ARTIFACT_BODIES, PRODUCTS, slugify } from "./corpus";
import type { Volumes } from "./scale";

export const DEV_PASSWORD = "tachy-dev-password";
/** The first users by index; the rest are numbered. */
const DEV_NAMES = ["Dev Admin", "Dev Member"];
export const ADMIN_EMAIL = "admin@tachy.local";
/** The k6 login: a plain member, so load tests measure the real authz path. */
export const MEMBER_EMAIL = "dev-member@tachy.local";

export interface SeededTeam {
  id: string;
  slug: string;
}
export interface SeededProduct {
  id: string;
  slug: string;
  teamId: string;
}
export interface SeededUser {
  id: string;
  email: string;
  role: string;
}
export interface Org {
  teams: SeededTeam[];
  products: SeededProduct[];
  users: SeededUser[];
  artifacts: string[];
}

const TEAM_NAMES = [
  "Support",
  "Platform",
  "Field Engineering",
  "Integrations",
  "Firmware",
  "Data",
  "Reliability",
  "Onboarding",
];

export async function seedOrg(tx: Tx, volumes: Volumes): Promise<Org> {
  const teams: SeededTeam[] = Array.from({ length: volumes.teams }, (_, i) => ({
    id: uuidFor("team", i),
    slug:
      slugify(TEAM_NAMES[i % TEAM_NAMES.length]) +
      (i >= TEAM_NAMES.length ? `-${i}` : ""),
  }));
  await insertRows(
    tx,
    "teams",
    ["id", "slug", "name"],
    teams.map((t, i) => ({
      id: t.id,
      slug: t.slug,
      name: TEAM_NAMES[i % TEAM_NAMES.length],
    })),
  );

  // Products enumerate per team, so (team_id, slug) is unique by construction.
  const products: SeededProduct[] = Array.from(
    { length: volumes.products },
    (_, i) => ({
      id: uuidFor("product", i),
      slug:
        i >= PRODUCTS.length
          ? `${PRODUCTS[i % PRODUCTS.length][0]}-${i}`
          : PRODUCTS[i % PRODUCTS.length][0],
      teamId: teams[i % teams.length].id,
    }),
  );
  await insertRows(
    tx,
    "products",
    ["id", "team_id", "slug", "name", "aliases"],
    products.map((product, i) => {
      const [, name] = PRODUCTS[i % PRODUCTS.length];
      const rng = rngFor("product", i);
      return {
        id: product.id,
        team_id: product.teamId,
        slug: product.slug,
        name: i >= PRODUCTS.length ? `${name} ${i}` : name,
        aliases: chance(rng, 0.4) ? [product.slug.toUpperCase()] : [],
      };
    }),
  );

  // One shared dev password means one scrypt hash, not one per user.
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const users: SeededUser[] = [
    { id: uuidFor("user", 0), email: ADMIN_EMAIL, role: "admin" },
    { id: uuidFor("user", 1), email: MEMBER_EMAIL, role: "member" },
  ];
  for (let i = 2; i < volumes.users; i++)
    users.push({
      id: uuidFor("user", i),
      email: `dev+${i}@tachy.local`,
      role: i % 9 === 0 ? USER_ROLES[0] : "member",
    });

  await insertRows(
    tx,
    "users",
    ["id", "email", "display_name", "role", "password_hash", "disabled"],
    users.map((u, i) => ({
      id: u.id,
      email: u.email,
      display_name: DEV_NAMES[i] ?? `Seed User ${i}`,
      role: u.role,
      password_hash: passwordHash,
      disabled: i > 2 && i % 17 === 0,
    })),
  );

  // A token nobody holds: its hash is of nothing, so it lists and never opens.
  await insertRows(
    tx,
    "api_tokens",
    ["id", "user_id", "name", "token_hash", "hint", "created_by"],
    [
      {
        id: uuidFor("api_token", 0),
        user_id: users[1].id,
        name: "nightly export script",
        token_hash: Buffer.from(uuidFor("api_token_hash", 0)),
        hint: "seed",
        created_by: users[0].id,
      },
    ],
  );

  // Every user joins at least one team; the k6 member joins all of them.
  const memberships: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const join = (teamId: string, userId: string, role: string) => {
    const key = `${teamId}:${userId}`;
    if (seen.has(key)) return;
    seen.add(key);
    memberships.push({ team_id: teamId, user_id: userId, role });
  };
  for (const team of teams) join(team.id, users[1].id, "member");
  for (let i = 0; i < users.length; i++) {
    const rng = rngFor("membership", i);
    for (const team of teams.slice(0, intBetween(rng, 1, teams.length)))
      join(team.id, users[i].id, i % 6 === 0 ? TEAM_ROLES[0] : "member");
  }
  await insertRows(
    tx,
    "team_members",
    ["team_id", "user_id", "role"],
    memberships,
  );

  const artifacts = await seedArtifacts(tx, volumes, teams, users);
  await seedPreferences(tx, teams, users);

  return { teams, products, users, artifacts };
}

/**
 * scope and its FK agree by construction, so both CHECKs and all three partial
 * unique indexes hold without an `on conflict`.
 */
const scopedRow = (scope: string, teamId: string, userId: string) => ({
  scope,
  team_id: scope === "team" ? teamId : null,
  user_id: scope === "user" ? userId : null,
});

async function seedArtifacts(
  tx: Tx,
  volumes: Volumes,
  teams: SeededTeam[],
  users: SeededUser[],
): Promise<string[]> {
  const rows: Record<string, unknown>[] = [];
  const ids: string[] = [];
  for (let i = 0; i < volumes.artifacts; i++) {
    const scope = SCOPES[i % SCOPES.length];
    const team = teams[i % teams.length];
    const user = users[i % users.length];
    const id = uuidFor("artifact", i);
    ids.push(id);
    rows.push({
      id,
      ...scopedRow(scope, team.id, user.id),
      // Unique per scope bucket: the counter is the whole slug.
      slug: `seeded-prompt-${i}`,
      title: `Seeded prompt ${i}`,
      description: "Generated by `npm run sync -- seed`.",
      body: pick(rngFor("artifact", i), ARTIFACT_BODIES),
      spec: null,
      created_by: users[0].id,
    });
  }
  await insertRows(
    tx,
    "artifacts",
    [
      "id",
      "scope",
      "team_id",
      "user_id",
      "slug",
      "title",
      "description",
      "body",
      "spec",
      "created_by",
    ],
    rows,
  );
  return ids;
}

async function seedPreferences(
  tx: Tx,
  teams: SeededTeam[],
  users: SeededUser[],
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const push = (
    scope: string,
    teamId: string,
    userId: string,
    key: string,
    value: unknown,
  ) =>
    rows.push({
      id: uuidFor("preference", rows.length),
      ...scopedRow(scope, teamId, userId),
      key,
      value: tx.json(value as never),
    });

  for (const team of teams) push("team", team.id, "", "agent_effort", "medium");
  // `rngFor("pref", i)`, not `("pref", 0)`: a generator made with a constant
  // seed restarts every iteration, so every user draws the same value.
  users
    .slice(0, 12)
    .forEach((u, i) =>
      push(
        "user",
        "",
        u.id,
        "agent_effort",
        pick(rngFor("pref", i), ["low", "medium", "high"]),
      ),
    );

  await insertRows(
    tx,
    "preferences",
    ["id", "scope", "team_id", "user_id", "key", "value"],
    rows,
  );
}
