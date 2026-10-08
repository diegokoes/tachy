/** One step as the agent sends it: where the code is, never the code. */
export interface WalkStep {
  label: string;
  repo: string;
  path: string;
  start_line: number;
  end_line: number;
  version?: string;
  ref?: string;
  /** Inclusive `[first, last]` line ranges that decide the outcome. */
  highlight?: [number, number][];
  note: string;
}

/** What the server read a step at, in the order the steps were sent. */
export interface ShownStep {
  path: string;
  ref: string;
  commit: string | null;
  start_line: number;
  end_line: number;
}

export interface CodeLine {
  number: number;
  text: string;
}

/** The API numbers each line as `<n>\t<text>`. */
export function numberedLines(content: string): CodeLine[] {
  if (!content) return [];
  return content.split("\n").map((line) => {
    const tab = line.indexOf("\t");
    return { number: Number(line.slice(0, tab)), text: line.slice(tab + 1) };
  });
}

export const isLit = (step: WalkStep, line: number): boolean =>
  (step.highlight ?? []).some(([first, last]) => line >= first && line <= last);

/** The query of the read route for one step. */
export function fileQuery(step: WalkStep): string {
  const query = new URLSearchParams({
    path: step.path,
    start: String(step.start_line),
    end: String(step.end_line),
  });
  if (step.version) query.set("version", step.version);
  else if (step.ref) query.set("ref", step.ref);
  return query.toString();
}
