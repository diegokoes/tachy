/**
 * A tag list after a change, for sources whose API only takes the whole list.
 * Tags compare without case, so a tag already there in another case stays as
 * it is rather than gaining a twin.
 */
export function changeTagList(
  current: string[],
  change: { add: string[]; remove: string[] },
): string[] {
  const drop = new Set(change.remove.map((t) => t.toLowerCase()));
  const out = current.filter((t) => !drop.has(t.toLowerCase()));
  for (const t of change.add) {
    const tag = t.trim();
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase()))
      out.push(tag);
  }
  return out;
}
