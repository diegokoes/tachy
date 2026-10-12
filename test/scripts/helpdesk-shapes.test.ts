import { describe, expect, it } from "vitest";
import {
  conversationShapes,
  createTicketTally,
  isApiAnswer,
  keysOf,
  nextListPosition,
  quantiles,
  refusalText,
  toSecond,
  type ListedTicket,
} from "../../scripts/helpdesk-shapes";

const WINDOW_START = new Date("2026-01-01T00:00:00Z");

const ticket = (over: Partial<ListedTicket> = {}): ListedTicket => ({
  id: 1,
  subject: "printer down",
  status: 2,
  priority: 1,
  type: "Incident",
  source: 1,
  group_id: 11,
  responder_id: 5,
  company_id: 9,
  custom_fields: {},
  created_at: "2026-02-10T08:00:00Z",
  updated_at: "2026-02-11T08:00:00Z",
  ...over,
});

describe("quantiles", () => {
  it("reads a quantile between the two nearest ranks", () => {
    expect(quantiles([4, 1, 3, 2])).toEqual({
      n: 4,
      p50: 2.5,
      p75: 3.3,
      p90: 3.7,
    });
  });

  it("gives none for no values", () => {
    expect(quantiles([])).toEqual({ n: 0, p50: null, p75: null, p90: null });
  });
});

describe("createTicketTally", () => {
  it("counts a ticket once, by its codes and by what it leaves empty", () => {
    const tally = createTicketTally(WINDOW_START);
    tally.add(ticket());
    tally.add(ticket());
    tally.add(
      ticket({
        id: 2,
        status: 5,
        type: null,
        responder_id: null,
        company_id: null,
        tags: ["vip"],
        fr_escalated: true,
        is_escalated: true,
        association_type: 3,
      }),
    );
    const shapes = tally.report();
    expect(shapes.tickets).toBe(2);
    expect(shapes.by_status).toEqual({ "2": 1, "5": 1 });
    expect(shapes.by_type).toEqual({ Incident: 1, none: 1 });
    expect(shapes.by_association_type).toEqual({ none: 1, "3": 1 });
    expect(shapes).toMatchObject({
      unassigned: 1,
      without_company: 1,
      with_tags: 1,
      first_response_overdue: 1,
      resolution_overdue: 1,
    });
    expect(shapes.top_level_keys).toContain("association_type");
  });

  it("puts a ticket in the month it was created and the month it was resolved", () => {
    const tally = createTicketTally(WINDOW_START);
    tally.add(
      ticket({
        stats: {
          first_responded_at: "2026-02-10T10:00:00Z",
          resolved_at: "2026-03-02T08:00:00Z",
          closed_at: null,
        },
      }),
    );
    tally.add(
      ticket({
        id: 2,
        created_at: "2025-11-20T08:00:00Z",
        stats: { resolved_at: "2026-02-01T08:00:00Z" },
      }),
    );
    const shapes = tally.report();
    expect(shapes.per_month).toEqual({
      "2026-02": { created: 1, resolved: 1 },
      "2026-03": { created: 0, resolved: 1 },
    });
    expect(shapes.created_before_window).toBe(1);
    expect(shapes.oldest_created).toBe("2025-11-20T08:00:00.000Z");
    expect(shapes.newest_created).toBe("2026-02-10T08:00:00.000Z");
    expect(shapes.stats_keys).toEqual({
      first_responded_at: 1,
      resolved_at: 2,
    });
    // The ticket from before the window has no place in the window's durations.
    expect(shapes.first_response_hours).toMatchObject({ n: 1, p50: 2 });
    expect(shapes.resolution_hours).toMatchObject({ n: 1, p50: 480 });
  });

  it("counts the tickets that fill each custom field, and those naming a dev item", () => {
    const tally = createTicketTally(WINDOW_START);
    tally.add(
      ticket({
        custom_fields: {
          cf_devops_work_item: "50912",
          cf_site: "",
          cf_lines: [],
        },
      }),
    );
    tally.add(
      ticket({
        id: 2,
        subject: "follow-up to AB#77",
        custom_fields: { cf_devops_work_item: null, cf_site: "north" },
      }),
    );
    tally.add(ticket({ id: 3 }));
    const shapes = tally.report();
    expect(shapes.custom_fields).toEqual({
      cf_devops_work_item: 1,
      cf_site: 1,
      cf_lines: 0,
    });
    expect(shapes.dev_item_fields).toEqual({ cf_devops_work_item: 1 });
    expect(shapes.naming_dev_item).toBe(2);
  });

  it("reports no dates for no tickets", () => {
    const shapes = createTicketTally(WINDOW_START).report();
    expect(shapes).toMatchObject({
      tickets: 0,
      oldest_created: null,
      newest_created: null,
    });
  });
});

describe("conversationShapes", () => {
  const agents = new Set(["5"]);

  it("counts messages by who wrote them and how the source marks them", () => {
    const shapes = conversationShapes(
      [
        { user_id: 5, incoming: false, private: false, source: 0 },
        { user_id: 42, incoming: true, private: false, source: 0 },
        { user_id: 42, incoming: false, private: false, source: 2 },
        { user_id: 5, private: true, source: 2, body_text: "see AB#12" },
        { user_id: null, automation_id: 3 },
        { user_id: 5, auto_response: true },
      ],
      agents,
    );
    expect(shapes.messages).toBe(6);
    expect(shapes.by_shape).toMatchObject({
      "author=agent incoming=false private=false source=0": 1,
      "author=contact incoming=true private=false source=0": 1,
      "author=contact incoming=false private=false source=2": 1,
      "author=agent incoming=false private=true source=2": 1,
      "author=none incoming=false private=false source=none": 1,
    });
    expect(shapes.automated).toBe(2);
    expect(shapes.naming_dev_item).toBe(1);
    expect(shapes.keys).toContain("automation_id");
  });

  it("marks every author unknown without the agent list", () => {
    const shapes = conversationShapes([{ user_id: 5, incoming: true }], null);
    expect(Object.keys(shapes.by_shape)).toEqual([
      "author=unknown incoming=true private=false source=none",
    ]);
  });
});

describe("nextListPosition", () => {
  const from = { since: "2026-03-01T10:00:00.000Z", page: 1 };

  it("restarts a second before the page's last change", () => {
    expect(
      nextListPosition(from, [
        ticket({ updated_at: "2026-03-01T10:05:00Z" }),
        ticket({ updated_at: "2026-03-01T10:04:00Z" }),
      ]),
    ).toEqual({ since: "2026-03-01T10:04:59.000Z", page: 1 });
  });

  it("pages on when the page ends in the second it started in", () => {
    expect(
      nextListPosition(from, [ticket({ updated_at: "2026-03-01T10:00:01Z" })]),
    ).toEqual({ ...from, page: 2 });
  });

  it("pages on when no ticket of the page says when it changed", () => {
    expect(nextListPosition(from, [ticket({ updated_at: undefined })])).toEqual(
      { ...from, page: 2 },
    );
  });
});

describe("toSecond and keysOf", () => {
  it("writes a time to the second", () => {
    expect(toSecond("2026-03-01T10:00:00.750Z")).toBe("2026-03-01T10:00:00Z");
  });

  it("names the fields of an object, or of a list's first entry", () => {
    expect(keysOf({ b: 1, a: 2 })).toEqual(["a", "b"]);
    expect(keysOf([{ id: 1, name: "x" }, { other: 1 }])).toEqual([
      "id",
      "name",
    ]);
    expect(keysOf([])).toEqual([]);
    expect(keysOf(null)).toEqual([]);
  });
});

describe("a refusal", () => {
  it("tells an answer of the API from a page", () => {
    expect(isApiAnswer("application/json; charset=utf-8")).toBe(true);
    expect(isApiAnswer("text/html")).toBe(false);
    expect(isApiAnswer(null)).toBe(false);
  });

  it("reads the API's code and message", () => {
    expect(
      refusalText(
        '{"code":"invalid_credentials","message":"You have to be logged in to perform this action."}',
      ),
    ).toBe(
      "invalid_credentials: You have to be logged in to perform this action.",
    );
    expect(refusalText('{"message":"admin only"}')).toBe("admin only");
  });

  it("reads a page's title", () => {
    expect(
      refusalText(
        "<html><head>\n<title>Unauthorized location</title></head></html>",
      ),
    ).toBe('a page titled "Unauthorized location"');
  });

  it("gives none for what is neither", () => {
    expect(refusalText("")).toBeNull();
    expect(refusalText("{}")).toBeNull();
    expect(refusalText("<html><body>no</body></html>")).toBeNull();
  });
});
