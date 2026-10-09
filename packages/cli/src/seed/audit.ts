import type { AuditAction } from "@tachy/core";
import { insertRows, type Tx } from "./batches";
import { pastDate, pick, rngFor } from "./deterministic";
import type { SeededUser } from "./org";

/** What a week of an ordinary deployment leaves in the trail, per person. */
const EVENTS_PER_USER = 4;
const ROUTINE: AuditAction[] = ["login", "login", "logout", "output_download"];
const ADMIN_WORK: AuditAction[] = [
  "user_create",
  "team_member_set",
  "setting_set",
  "bucket_token_rotate",
];

/** A trail to read: sign-ins from everyone, account and settings work from admins. */
export async function seedAudit(tx: Tx, users: SeededUser[]): Promise<void> {
  const events: Record<string, unknown>[] = [];
  users.forEach((user, u) => {
    for (let i = 0; i < EVENTS_PER_USER; i++) {
      const rng = rngFor("audit", u * EVENTS_PER_USER + i);
      const action = pick(
        rng,
        user.role === "admin" ? [...ROUTINE, ...ADMIN_WORK] : ROUTINE,
      );
      events.push({
        at: pastDate(rng, 30),
        actor_user_id: user.id,
        actor_email: user.email,
        actor: "web",
        action,
        target: action === "output_download" ? "export.xlsx" : user.email,
        address: `10.0.0.${(u % 200) + 10}`,
      });
    }
  });
  await insertRows(
    tx,
    "audit_events",
    [
      "at",
      "actor_user_id",
      "actor_email",
      "actor",
      "action",
      "target",
      "address",
    ],
    events,
  );
}
