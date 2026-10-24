import { describe, expect, it } from "vitest";
import { AGENT_EFFORTS } from "@tachy/contract";
import {
  effortOptions,
  modelOptions,
  parseModel,
  pickOf,
  typedPick,
} from "../../packages/web/src/chat/modelCommand";
import type { ModelChoice } from "../../packages/web/src/settings/prefs.svelte";

const OPUS: ModelChoice = {
  id: "claude-opus-5-5",
  label: "Opus 5.5",
  efforts: ["low", "medium", "high"],
};
const HAIKU: ModelChoice = {
  id: "claude-haiku-5-5",
  label: "Haiku 5.5",
  efforts: [],
};
const LISTED = [OPUS, HAIKU];

describe("parseModel", () => {
  it("is not there until the command has its space", () => {
    expect(parseModel("/model", LISTED)).toBeNull();
    expect(parseModel("/models ", LISTED)).toBeNull();
    expect(parseModel("which /model is this", LISTED)).toBeNull();
  });

  it("asks for the model while its id is being typed", () => {
    expect(parseModel("/model ", LISTED)).toEqual({
      stage: "model",
      query: "",
    });
    expect(parseModel("/model op", LISTED)).toEqual({
      stage: "model",
      query: "op",
    });
  });

  it("moves on to the effort once a listed id has its space", () => {
    expect(parseModel("/model claude-opus-5-5 ", LISTED)).toEqual({
      stage: "effort",
      model: OPUS,
      query: "",
    });
    expect(parseModel("/model claude-opus-5-5 hi", LISTED)).toEqual({
      stage: "effort",
      model: OPUS,
      query: "hi",
    });
  });

  it("keeps asking for the model when the id is not one on the list", () => {
    expect(parseModel("/model claude-nope ", LISTED)).toEqual({
      stage: "model",
      query: "claude-nope ",
    });
  });

  // An id typed while the list is on its way would otherwise be taken as an
  // unlisted one, with efforts the model may not accept.
  it("waits for the list before it takes an id as whole", () => {
    expect(parseModel("/model claude-opus-5-5 ", null)).toEqual({
      stage: "model",
      query: "claude-opus-5-5 ",
    });
  });

  // Settings takes a typed id when the runtime could not be asked; so does this.
  it("takes any id, with every effort, when there is no list", () => {
    expect(parseModel("/model my-own-model x", [])).toEqual({
      stage: "effort",
      model: {
        id: "my-own-model",
        label: "my-own-model",
        efforts: [...AGENT_EFFORTS],
      },
      query: "x",
    });
  });
});

describe("the /model rows", () => {
  it("narrows models by label or id and marks the settings model", () => {
    expect(modelOptions(LISTED, "", "claude-haiku-5-5")).toEqual([
      { value: OPUS.id, label: "Opus 5.5", hint: OPUS.id, desc: "" },
      {
        value: HAIKU.id,
        label: "Haiku 5.5",
        hint: HAIKU.id,
        desc: "your default",
      },
    ]);
    expect(modelOptions(LISTED, "OPUS").map((o) => o.value)).toEqual([OPUS.id]);
    expect(modelOptions(LISTED, "haiku-5").map((o) => o.value)).toEqual([
      HAIKU.id,
    ]);
    expect(modelOptions(LISTED, "gpt")).toEqual([]);
  });

  it("shows no id beside a model labelled by its id", () => {
    const bare = { id: "claude-opus-5", label: "claude-opus-5", efforts: [] };
    expect(modelOptions([bare], "")[0].hint).toBe("");
  });

  it("offers the efforts the model accepts and marks the settings effort", () => {
    expect(effortOptions(OPUS, "", "medium")).toEqual([
      { value: "low", label: "low", hint: "", desc: "" },
      { value: "medium", label: "medium", hint: "", desc: "your default" },
      { value: "high", label: "high", hint: "", desc: "" },
    ]);
    expect(effortOptions(OPUS, " H").map((o) => o.value)).toEqual(["high"]);
    expect(effortOptions(HAIKU, "")).toEqual([]);
  });
});

describe("typedPick", () => {
  it("takes a model that has no effort to ask for", () => {
    expect(
      typedPick({ stage: "effort", model: HAIKU, query: "" }, LISTED),
    ).toEqual({ id: HAIKU.id, label: "Haiku 5.5" });
  });

  it("leaves a model with efforts to the menu", () => {
    expect(
      typedPick({ stage: "effort", model: OPUS, query: "zz" }, LISTED),
    ).toBeNull();
  });

  it("takes a typed id only where there is no list", () => {
    expect(typedPick({ stage: "model", query: "my-own " }, [])).toEqual({
      id: "my-own",
      label: "my-own",
    });
    expect(typedPick({ stage: "model", query: "" }, [])).toBeNull();
    expect(typedPick({ stage: "model", query: "my-own" }, LISTED)).toBeNull();
    expect(typedPick({ stage: "model", query: "my-own" }, null)).toBeNull();
  });
});

describe("pickOf", () => {
  it("carries the effort only when one was picked", () => {
    expect(pickOf(OPUS, "high")).toEqual({
      id: OPUS.id,
      label: "Opus 5.5",
      effort: "high",
    });
    expect(pickOf(OPUS)).toEqual({ id: OPUS.id, label: "Opus 5.5" });
  });
});
