import {
  MENTION_KINDS,
  type Mention,
  type MentionKind,
  type Mentionables,
} from "@tachy/contract";
import { matches } from "../work-items/azCommand";

/** The `@` word being completed: a typed `repo.` / `bucket.` / `project.` narrows it. */
export interface MentionQuery {
  kind: MentionKind | null;
  query: string;
}

export interface MentionOption {
  mention: Mention;
  hint: string;
}

/** A word starts the line or follows a space, so an address like `a@b` is prose. */
const TRAILING_WORD_RE = /(^|\s)@([^\s@]*)$/;
const ANY_WORD_RE = /(^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)]+$/;

/** `repo.billing` and `billing` alike, the prefix split off when it names a kind. */
function splitKind(word: string): MentionQuery {
  const dot = word.indexOf(".");
  const prefix = word.slice(0, dot);
  if (dot > 0 && (MENTION_KINDS as readonly string[]).includes(prefix))
    return { kind: prefix as MentionKind, query: word.slice(dot + 1) };
  return { kind: null, query: word };
}

/** Null unless the line ends in an `@` word. */
export function mentionBeingTyped(input: string): MentionQuery | null {
  const word = input.match(TRAILING_WORD_RE);
  return word ? splitKind(word[2]) : null;
}

export const mentionWord = (mention: Mention): string =>
  `${mention.kind}.${mention.key}`;

export const parseMentionWord = (word: string): Mention | null => {
  const { kind, query } = splitKind(word);
  return kind && query ? { kind, key: query } : null;
};

function allOptions(mentionables: Mentionables): MentionOption[] {
  return [
    ...mentionables.repos.map((repo) => ({
      mention: { kind: "repo" as const, key: repo.slug },
      hint: repo.project ?? repo.product_slug ?? "",
    })),
    ...mentionables.buckets.map((bucket) => ({
      mention: { kind: "bucket" as const, key: bucket.slug },
      hint: bucket.name,
    })),
    ...mentionables.projects.map((project) => ({
      mention: { kind: "project" as const, key: project },
      hint: "",
    })),
  ];
}

export function mentionOptions(
  mentionables: Mentionables,
  typed: MentionQuery,
): MentionOption[] {
  return allOptions(mentionables).filter(
    (option) =>
      (!typed.kind || option.mention.kind === typed.kind) &&
      matches(typed.query, option.mention.key, option.hint),
  );
}

/** What one word names: its own kind when prefixed, every kind with that key when bare. */
function resolveWord(word: string, mentionables: Mentionables): Mention[] {
  const { kind, query } = splitKind(word);
  return allOptions(mentionables)
    .map((option) => option.mention)
    .filter(
      (mention) =>
        mention.key.toLowerCase() === query.toLowerCase() &&
        (!kind || mention.kind === kind),
    );
}

/**
 * The `@` words of a line that name something, and the line without them. A
 * word that names nothing stays, since it may be prose.
 */
export function takeTypedMentions(
  input: string,
  mentionables: Mentionables,
): { mentions: Mention[]; rest: string } {
  const mentions: Mention[] = [];
  const rest = input.replace(
    ANY_WORD_RE,
    (whole, lead: string, word: string) => {
      const punctuation = word.match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
      const found = resolveWord(
        word.slice(0, word.length - punctuation.length),
        mentionables,
      );
      if (!found.length) return whole;
      mentions.push(...found);
      // Punctuation closes up on the word before, as if no mention was typed.
      return punctuation || lead;
    },
  );
  return { mentions, rest: rest.replace(/[ \t]{2,}/g, " ").trim() };
}

/** The line with the `@` word being typed taken out. */
export const withoutMentionBeingTyped = (input: string): string =>
  input.replace(TRAILING_WORD_RE, "$1");

export function withMentions(current: Mention[], added: Mention[]): Mention[] {
  const merged = [...current];
  for (const mention of added)
    if (!merged.some((m) => m.kind === mention.kind && m.key === mention.key))
      merged.push(mention);
  return merged;
}
