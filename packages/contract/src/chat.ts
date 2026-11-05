/** Modes stay on across turns until the user leaves them; commands last one message. */
export const CHAT_MODES = ["analyze", "code"] as const;
export type ChatModeName = (typeof CHAT_MODES)[number];

export const MENTION_KINDS = ["repo", "bucket", "project", "customer"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

/** A source the user attached to the conversation with `@`. */
export interface Mention {
  kind: MentionKind;
  /**
   * A repo or bucket slug, a project token (see `projectToken`), or a customer
   * slug with an optional unit after a slash (`ivk/pln191`).
   */
  key: string;
}

/** What the `@` picker offers: only what the caller may attach. */
export interface Mentionables {
  repos: {
    slug: string;
    product_slug: string | null;
    project: string | null;
  }[];
  buckets: { slug: string; name: string }[];
  /** Project tokens of the projects that have repos. */
  projects: string[];
  /** Each customer, and each unit of their setups as `customer/unit`. */
  customers: { key: string; name: string }[];
}
