export interface AgentUsage {
  days: number;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  /**
   * What the provider reported where it reported anything, list price for the
   * rest. A subscription is not billed per token, so this measures consumption
   * rather than an invoice.
   */
  cost_usd: number;
  active_7d: number;
  /** Distinct people with a turn anywhere in the window. */
  active: number;
  /** Tokens and turns per day, oldest first, gaps filled; `models` splits the tokens. */
  per_day: {
    day: string;
    turns: number;
    tokens: number;
    models: Record<string, number>;
  }[];
  by_model: { model: string; turns: number; tokens: number }[];
  /** Heaviest users first. Omitted by the route for anyone not an app admin. */
  top_users?: {
    email: string;
    turns: number;
    tokens: number;
    cost_usd: number;
  }[];
}

export interface ToolUsage {
  days: number;
  reads: number;
  writes: number;
  /** Most-called tools first. */
  tools: {
    tool: string;
    writes: boolean;
    calls: number;
    failures: number;
    misuse: number;
  }[];
  /**
   * Who has the agent change things, most writes first. Omitted by the route
   * for anyone who is not an app admin.
   */
  writers?: { email: string; writes: number }[];
  /** Calls per day over the last 14 days at most, oldest first, gaps filled. */
  per_day: { day: string; reads: number; writes: number }[];
}
