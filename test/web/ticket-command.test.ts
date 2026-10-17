import { describe, expect, it } from "vitest";
import {
  parseTicketLine,
  ticketArgs,
} from "../../packages/web/src/work-items/ticketCommand";

describe("parseTicketLine", () => {
  it("reads the command, the id and its flags", () => {
    expect(parseTicketLine("/compact 1234 --no-note")).toEqual({
      name: "compact",
      id: "1234",
      flags: " --no-note",
    });
    expect(parseTicketLine("/summary #77")).toEqual({
      name: "summary",
      id: "77",
      flags: "",
    });
  });

  it("is there before the id is typed", () => {
    expect(parseTicketLine("/analyze ")).toEqual({
      name: "analyze",
      id: "",
      flags: "",
    });
    expect(parseTicketLine("/analyze")).toMatchObject({ id: "" });
  });

  it("leaves other lines alone, prose after the id included", () => {
    expect(parseTicketLine("/analyze 12 and check billing")).toBeNull();
    expect(parseTicketLine("/compactor 12")).toBeNull();
    expect(parseTicketLine("/az explain 12")).toBeNull();
    expect(parseTicketLine("please /summary 12")).toBeNull();
  });
});

describe("ticketArgs", () => {
  const line = { name: "compact" as const, id: "9", flags: " --no-note" };

  it("names the source the lookup found", () => {
    expect(ticketArgs(line, "fd")).toBe("fd 9 --no-note");
  });

  it("sends the id alone when no source was found", () => {
    expect(ticketArgs({ ...line, flags: "" }, null)).toBe("9");
  });
});
