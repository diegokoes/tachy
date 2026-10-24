/** A way into an empty chat: what it says, and the line it starts in the composer. */
export type Starter = { key: string; label: string; line: string };

const STARTERS: Starter[] = [
  { key: "analyze", label: "analyze a ticket", line: "/analyze " },
  { key: "mention", label: "attach a repo or bucket", line: "@" },
  { key: "recipe", label: "use a recipe", line: "/recipe " },
];

/** The starters to show while the composer is empty, and none once it is not. */
export const startersFor = (input: string): Starter[] =>
  input.trim() ? [] : STARTERS;
