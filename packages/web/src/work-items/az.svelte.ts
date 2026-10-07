import type { WorkItemTypeOption, ComposerProject } from "@tachy/contract";
import { api } from "../api";

/**
 * What the `/az new` menu offers, fetched the first time it is needed and kept
 * for the session: a project's types change about as often as its process.
 */
export const az = $state({
  projects: null as ComposerProject[] | null,
  projectsError: null as string | null,
  types: {} as Record<
    string,
    WorkItemTypeOption[] | "loading" | { error: string }
  >,
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let projectsCall: Promise<ComposerProject[]> | null = null;
const typeCalls = new Map<string, Promise<WorkItemTypeOption[]>>();

export function ensureProjects(): Promise<ComposerProject[]> {
  if (az.projects) return Promise.resolve(az.projects);
  projectsCall ??= api
    .get<ComposerProject[]>("/compose/projects?source_type=azure-devops")
    .then((p) => (az.projects = p))
    .catch((e) => {
      az.projectsError = errText(e);
      projectsCall = null;
      return [];
    });
  return projectsCall;
}

export function ensureTypes(projectId: string): Promise<WorkItemTypeOption[]> {
  const known = az.types[projectId];
  if (Array.isArray(known)) return Promise.resolve(known);
  let call = typeCalls.get(projectId);
  if (!call) {
    az.types[projectId] = "loading";
    call = api
      .get<WorkItemTypeOption[]>(`/compose/projects/${projectId}/types`)
      .then((t) => (az.types[projectId] = t))
      .catch((e) => {
        az.types[projectId] = { error: errText(e) };
        typeCalls.delete(projectId);
        return [];
      });
    typeCalls.set(projectId, call);
  }
  return call;
}

export const typesOf = (projectId: string): WorkItemTypeOption[] => {
  const types = az.types[projectId];
  return Array.isArray(types) ? types : [];
};

/** Why the type list is empty, for the menu to say instead of rows. */
export function typesNote(projectId: string): string {
  const types = az.types[projectId];
  if (!types || types === "loading") return "loading types…";
  if (!Array.isArray(types)) return types.error;
  return "no type matches; Enter opens the composer to pick one there";
}
