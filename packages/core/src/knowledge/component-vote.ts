/** Good matches that have to agree before their component is suggested. */
export const MIN_AGREEING_ENTRIES = 3;

export interface ComponentVote {
  componentId: string;
  /** Good matches filed under it. */
  agreeing: number;
  /** Good matches that carry a component at all. */
  of: number;
}

/**
 * The component a ticket's similar past entries agree on: at least
 * `MIN_AGREEING_ENTRIES` of the good or strong matches, and more than half of
 * those that carry one. Weak matches don't vote, so a ticket nothing resembles
 * gets no suggestion.
 */
export function suggestComponent(
  hits: { component_id?: string | null; grade: string }[],
): ComponentVote | null {
  const votes = hits
    .filter((hit) => hit.grade !== "weak" && hit.component_id)
    .map((hit) => hit.component_id as string);
  const counts = new Map<string, number>();
  for (const componentId of votes)
    counts.set(componentId, (counts.get(componentId) ?? 0) + 1);
  const [leader] = [...counts].sort((a, b) => b[1] - a[1]);
  if (!leader) return null;
  const [componentId, agreeing] = leader;
  if (agreeing < MIN_AGREEING_ENTRIES || agreeing * 2 <= votes.length)
    return null;
  return { componentId, agreeing, of: votes.length };
}
