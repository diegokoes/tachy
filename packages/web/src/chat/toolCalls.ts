export interface ToolTally {
  tool: string;
  count: number;
}

/** A run of tool calls in order, with back-to-back repeats counted as one. */
export function tallyCalls(calls: readonly string[]): ToolTally[] {
  const tallies: ToolTally[] = [];
  for (const tool of calls) {
    const last = tallies[tallies.length - 1];
    if (last?.tool === tool) last.count += 1;
    else tallies.push({ tool, count: 1 });
  }
  return tallies;
}

export const tallyLabel = (tally: ToolTally): string =>
  tally.count > 1 ? `${tally.tool} ×${tally.count}` : tally.tool;
