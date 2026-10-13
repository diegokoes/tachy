import { AGENT_EFFORTS, type AgentEffort } from "@tachy/contract";
import { matches } from "../work-items/azCommand";
import type { ModelChoice } from "../settings/prefs.svelte";

/** Where the `/model` line is, for the menu to offer the next thing to pick. */
export type ModelStage =
  | { stage: "model"; query: string }
  | { stage: "effort"; model: ModelChoice; query: string };

/** What a conversation runs on in place of the settings model and effort. */
export interface ModelPick {
  id: string;
  label: string;
  /** Unset when the model takes none, or the settings effort is kept. */
  effort?: AgentEffort;
}

export const pickOf = (
  model: ModelChoice,
  effort?: AgentEffort,
): ModelPick => ({
  id: model.id,
  label: model.label,
  ...(effort ? { effort } : {}),
});

/**
 * An id nobody listed, taken as typed. Every effort is on offer, since nothing
 * says which ones the model accepts.
 */
const typedModel = (id: string): ModelChoice => ({
  id,
  label: id,
  efforts: [...AGENT_EFFORTS],
});

/**
 * The models on offer: null until the server has answered, empty when it
 * answered with nothing to list. Only the second takes an id as typed, as
 * Settings does; an id typed while the list is on its way waits for it.
 */
export type OfferedModels = readonly ModelChoice[] | null;

function modelNamed(
  id: string,
  models: OfferedModels,
): ModelChoice | undefined {
  if (!models) return undefined;
  return models.length ? models.find((m) => m.id === id) : typedModel(id);
}

/**
 * Null when the line is not a `/model` argument being typed. The id is whole
 * once a space follows it, and the line moves on to the effort.
 */
export function parseModel(
  input: string,
  models: OfferedModels,
): ModelStage | null {
  const match = input.match(/^\/model[ \t]+([^\n]*)$/);
  if (!match) return null;
  const rest = match[1];
  const idEnd = rest.search(/[ \t]/);
  if (idEnd < 0) return { stage: "model", query: rest };
  const model = modelNamed(rest.slice(0, idEnd), models);
  if (!model) return { stage: "model", query: rest };
  return { stage: "effort", model, query: rest.slice(idEnd).trim() };
}

export interface ModelOption {
  value: string;
  label: string;
  hint: string;
  /** Marks the one the settings would have used. */
  desc: string;
}

const YOUR_DEFAULT = "your default";

/** The models on offer, narrowed by what is typed. */
export function modelOptions(
  models: readonly ModelChoice[],
  query: string,
  defaultId?: string,
): ModelOption[] {
  return models
    .filter((m) => matches(query, m.label, m.id))
    .map((m) => ({
      value: m.id,
      label: m.label,
      hint: m.id,
      desc: m.id === defaultId ? YOUR_DEFAULT : "",
    }));
}

/** The efforts the model accepts, narrowed by what is typed. */
export function effortOptions(
  model: ModelChoice,
  query: string,
  defaultEffort?: string,
): ModelOption[] {
  return model.efforts
    .filter((e) => e.startsWith(query.trim().toLowerCase()))
    .map((e) => ({
      value: e,
      label: e,
      hint: "",
      desc: e === defaultEffort ? YOUR_DEFAULT : "",
    }));
}

/**
 * What Enter takes when the menu has no row to pick: a model that has no
 * effort to ask for, or an id typed where nothing is listed. Null otherwise.
 */
export function typedPick(
  stage: ModelStage,
  models: OfferedModels,
): ModelPick | null {
  if (stage.stage === "effort")
    return stage.model.efforts.length ? null : pickOf(stage.model);
  const id = stage.query.trim();
  return models && !models.length && id ? pickOf(typedModel(id)) : null;
}
