import type { Mentionables } from "@tachy/contract";
import { api } from "../api";
import { errText } from "../resource.svelte";

/** What the `@` picker offers, fetched the first time it opens. */
export const mentionables = $state({
  list: null as Mentionables | null,
  error: null as string | null,
});

let mentionablesCall: Promise<Mentionables | null> | null = null;

export function ensureMentionables(): Promise<Mentionables | null> {
  if (mentionables.list) return Promise.resolve(mentionables.list);
  mentionablesCall ??= api
    .get<Mentionables>("/agent/mentions")
    .then((list) => (mentionables.list = list))
    .catch((e) => {
      mentionables.error = errText(e);
      mentionablesCall = null;
      return null;
    });
  return mentionablesCall;
}

/** Why the picker has no rows, said in their place. */
export function mentionsNote(): string {
  if (mentionables.error) return mentionables.error;
  if (!mentionables.list) return "loading…";
  const { repos, buckets } = mentionables.list;
  return repos.length || buckets.length
    ? "no repo, bucket or project matches"
    : "no repo is linked and no bucket is shared with your teams";
}
