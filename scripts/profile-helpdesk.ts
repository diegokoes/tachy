/**
 * Profile a Freshdesk helpdesk before its tickets are measured: how many, of
 * which kinds, which fields are filled, and which endpoints the key may read.
 *
 *   npx tsx scripts/profile-helpdesk.ts https://<domain>.freshdesk.com \
 *     [--months=12] [--sample=20] [--out=<file>.json]
 *
 * Read-only: every call is a GET. The API key is asked for without echo, is
 * sent to the helpdesk's own host and nowhere else, and is not written. The
 * report holds counts, field names and status codes: no subject, message,
 * name or address. The walk keeps to half of the per-minute call budget.
 */
import { writeFileSync } from "node:fs";
import {
  conversationShapes,
  createTicketTally,
  keysOf,
  nextListPosition,
  toSecond,
  type ListedConversation,
  type ListedTicket,
  type ListPosition,
} from "./helpdesk-shapes";

const PER_PAGE = 100;
/**
 * "A maximum of 300 pages (30000 tickets) will be returned."
 * https://developers.freshdesk.com/api/#list_all_tickets (v2)
 */
const MAX_LIST_PAGES = 300;
const MAX_AGENT_PAGES = 10;
const MAX_ATTEMPTS = 5;
const DEFAULT_MONTHS = 12;
const DEFAULT_SAMPLE = 20;
/** The share of the per-minute budget left to the helpdesk's other callers. */
const BUDGET_SHARE_KEPT = 0.5;
const BUDGET_WAIT_MS = 20_000;
const DEFAULT_RETRY_SECONDS = 30;
const PROGRESS_EVERY_PAGES = 10;
/** Earlier than any ticket: asks the listing for everything it still returns. */
const EVERYTHING_SINCE = "2000-01-01T00:00:00Z";
const RESOLVED_STATUSES = new Set([4, 5]);
/** Plain http is taken for a stand-in on this machine only. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

interface Answer {
  status: number;
  body: unknown;
  headers: Headers;
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function usage(): never {
  console.error(
    "usage: npx tsx scripts/profile-helpdesk.ts https://<domain>.freshdesk.com [--months=12] [--sample=20] [--out=<file>.json]",
  );
  process.exit(2);
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

function countOption(name: string, fallback: number): number {
  const given = option(name);
  if (given === undefined) return fallback;
  const count = Number(given);
  if (!Number.isInteger(count) || count < 1) usage();
  return count;
}

/** A line typed without echo, or the first line of a piped stdin. */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  stdin.setEncoding("utf8");
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let typed = "";
    let finished = false;
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      settle();
    };
    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\u0003")
          return finish(() => reject(new Error("aborted")));
        if (char === "\r" || char === "\n" || char === "\u0004")
          return finish(() => resolve(typed.trim()));
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    }
    stdin.on("data", onData);
    stdin.on("end", () => finish(() => resolve(typed.trim())));
  });
}

/** How many choices a field offers, whichever shape the source lists them in. */
function choiceCount(choices: unknown): number | null {
  if (Array.isArray(choices)) return choices.length;
  if (choices && typeof choices === "object")
    return Object.keys(choices).length;
  return null;
}

function monthsAgo(months: number): Date {
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - months);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

async function main() {
  const given = process.argv[2];
  if (!given || given.startsWith("--") || !URL.canParse(given)) usage();
  const base = new URL(given);
  const encrypted = base.protocol === "https:";
  if (!encrypted && !LOCAL_HOSTS.has(base.hostname)) usage();
  const months = countOption("months", DEFAULT_MONTHS);
  const sampleSize = countOption("sample", DEFAULT_SAMPLE);
  const today = new Date().toISOString().slice(0, 10);
  const out = option("out") ?? `helpdesk-profile-${base.host}-${today}.json`;

  const key = await readSecret(`API key for ${base.host}: `);
  if (!key) usage();
  const authorization = "Basic " + Buffer.from(`${key}:X`).toString("base64");

  const budget: { per_minute: number | null; list_call_cost: number | null } = {
    per_minute: null,
    list_call_cost: null,
  };

  /**
   * One GET on the helpdesk's host. A redirect is reported and not followed:
   * the key goes to no other host. Any status is an answer, since several
   * probes expect a refusal.
   */
  async function call(path: string): Promise<Answer> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(new URL(path, base), {
        headers: { Authorization: authorization },
        redirect: "manual",
      });
      const retryAfter = Number(response.headers.get("retry-after"));
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        await wait((retryAfter || DEFAULT_RETRY_SECONDS) * 1000);
        continue;
      }
      const total = Number(response.headers.get("x-ratelimit-total"));
      const remaining = Number(response.headers.get("x-ratelimit-remaining"));
      const used = Number(
        response.headers.get("x-ratelimit-used-currentrequest"),
      );
      if (total > 0) {
        budget.per_minute = total;
        if (path.startsWith("/api/v2/tickets?") && used > 0)
          budget.list_call_cost = used;
        if (remaining < total * BUDGET_SHARE_KEPT) await wait(BUDGET_WAIT_MS);
      }
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: response.status, body, headers: response.headers };
    }
  }

  const listed = (answer: Answer) =>
    Array.isArray(answer.body) ? (answer.body as unknown[]) : [];

  /** Status and field names of an endpoint, and how many entries its first page has. */
  async function probe(path: string) {
    const answer = await call(path);
    return {
      path: path.split("?")[0],
      status: answer.status,
      count: Array.isArray(answer.body) ? answer.body.length : null,
      keys: keysOf(answer.body),
    };
  }

  const identity = await call("/api/v2/agents/me");
  if (identity.status !== 200) {
    console.error(
      `the helpdesk answered ${identity.status} to the key: nothing was read`,
    );
    process.exit(1);
  }

  const windowStart = monthsAgo(months);
  const tally = createTicketTally(windowStart);
  const recentResolved: number[] = [];
  let newestTicketId: number | null = null;
  let position: ListPosition = { since: windowStart.toISOString(), page: 1 };
  let pages = 0;
  for (;;) {
    const answer = await call(
      `/api/v2/tickets?per_page=${PER_PAGE}&order_by=updated_at&order_type=asc&include=stats&updated_since=${toSecond(position.since)}&page=${position.page}`,
    );
    if (answer.status !== 200)
      throw new Error(`the ticket listing answered ${answer.status}`);
    const tickets = listed(answer) as ListedTicket[];
    pages++;
    for (const ticket of tickets) {
      tally.add(ticket);
      newestTicketId = ticket.id;
      if (!RESOLVED_STATUSES.has(ticket.status ?? 0)) continue;
      recentResolved.push(ticket.id);
      if (recentResolved.length > sampleSize) recentResolved.shift();
    }
    if (pages % PROGRESS_EVERY_PAGES === 0)
      console.error(
        `${tally.report().tickets} tickets, at ${toSecond(position.since)}`,
      );
    if (tickets.length < PER_PAGE) break;
    position = nextListPosition(position, tickets);
    if (position.page > MAX_LIST_PAGES)
      throw new Error(
        `the listing gave ${MAX_LIST_PAGES} full pages from ${position.since} and lists no further`,
      );
  }

  // A start with milliseconds is what a resumed sync sends.
  const millisecondStart = await call(
    `/api/v2/tickets?per_page=1&updated_since=${new Date().toISOString()}`,
  );
  const oldest = await call(
    `/api/v2/tickets?per_page=1&order_by=created_at&order_type=asc&updated_since=${EVERYTHING_SINCE}`,
  );
  const oldestReachable = (listed(oldest)[0] as ListedTicket | undefined)
    ?.created_at;

  const agentIds = new Set<string>();
  let agentsStatus = 0;
  let occasionalAgents = 0;
  for (let page = 1; page <= MAX_AGENT_PAGES; page++) {
    const answer = await call(
      `/api/v2/agents?per_page=${PER_PAGE}&page=${page}`,
    );
    agentsStatus = answer.status;
    const agents = listed(answer) as { id?: number; occasional?: boolean }[];
    for (const agent of agents) {
      if (agent.id != null) agentIds.add(String(agent.id));
      if (agent.occasional) occasionalAgents++;
    }
    if (agents.length < PER_PAGE) break;
  }

  const fields = await call("/api/v2/ticket_fields");
  const ticketFields = (
    listed(fields) as {
      name?: string;
      type?: string;
      default?: boolean;
      choices?: unknown;
    }[]
  ).map((field) => ({
    name: field.name ?? null,
    type: field.type ?? null,
    default: field.default === true,
    choices_count: choiceCount(field.choices),
    // A status's labels and a type's names are configuration. Other choices
    // can name people or customers, so only their number is kept.
    ...(field.name === "status" || field.name === "ticket_type"
      ? { choices: field.choices ?? null }
      : {}),
  }));

  const hours = await call("/api/v2/business_hours");
  const timeZones = [
    ...new Set(
      (listed(hours) as { time_zone?: string }[]).map(
        (calendar) => calendar.time_zone ?? null,
      ),
    ),
  ];

  const account = await call("/api/v2/account");
  const tier = (account.body as { tier_type?: unknown } | null)?.tier_type;

  const sampled: (ListedConversation & Record<string, unknown>)[] = [];
  for (const ticketId of recentResolved) {
    const answer = await call(`/api/v2/tickets/${ticketId}/conversations`);
    sampled.push(
      ...(listed(answer) as (ListedConversation & Record<string, unknown>)[]),
    );
  }

  const report = {
    generated_at: new Date().toISOString(),
    host: base.host,
    window: { months, start: windowStart.toISOString() },
    calls: budget,
    listing: { pages, ...tally.report() },
    updated_since_with_milliseconds: millisecondStart.status,
    oldest_reachable_created: oldestReachable ?? null,
    agents: {
      status: agentsStatus,
      count: agentIds.size,
      occasional: occasionalAgents,
    },
    groups: await probe(`/api/v2/groups?per_page=${PER_PAGE}`),
    ticket_fields: { status: fields.status, fields: ticketFields },
    business_hours: {
      status: hours.status,
      count: listed(hours).length,
      time_zones: timeZones,
      keys: keysOf(hours.body),
    },
    account: {
      status: account.status,
      keys: keysOf(account.body),
      tier_type: typeof tier === "string" ? tier : null,
    },
    // The reference documents the first, and the third only with a survey's
    // id and `/responses` after it: its bare form is a guess at the listing.
    surveys: {
      legacy_ratings: await probe(
        `/api/v2/surveys/satisfaction_ratings?created_since=${toSecond(windowStart.toISOString())}`,
      ),
      legacy_surveys: await probe("/api/v2/surveys"),
      current_surveys: await probe("/api/v2/customer-satisfaction/surveys"),
    },
    // The agent interface's own endpoint, absent from the public reference.
    activities:
      newestTicketId === null
        ? null
        : await probe(`/api/_/tickets/${newestTicketId}/activities`),
    conversations: {
      tickets: recentResolved.length,
      ...conversationShapes(
        sampled,
        agentsStatus === 200 && agentIds.size ? agentIds : null,
      ),
    },
  };

  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  const { listing } = report;
  console.log(
    [
      `${listing.tickets} tickets changed since ${windowStart.toISOString().slice(0, 10)}, ${listing.created_before_window} of them created before it`,
      `oldest ticket the listing still returns: ${report.oldest_reachable_created ?? "none"}`,
      `first response, calendar hours: p50 ${listing.first_response_hours.p50}, p90 ${listing.first_response_hours.p90} (n ${listing.first_response_hours.n})`,
      `naming a dev item: ${listing.naming_dev_item}`,
      `agents: ${report.agents.count} (status ${report.agents.status})`,
      `surveys: legacy ${report.surveys.legacy_ratings.status}, current ${report.surveys.current_surveys.status}`,
      `activities endpoint: ${report.activities?.status ?? "not asked"}`,
      `report written to ${out}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
