import type { AdoTypeOption, ComposerProject } from "@tachy/contract";
import { api } from "../api";

/**
 * What the `/az new` menu offers, fetched the first time it is needed and kept
 * for the session: a project's types change about as often as its process.
 */
export const az = $state({
  projects: null as ComposerProject[] | null,
  projectsError: null as string | null,
  types: {} as Record<string, AdoTypeOption[] | "loading" | { error: string }>,
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let projectsCall: Promise<ComposerProject[]> | null = null;
const typeCalls = new Map<string, Promise<AdoTypeOption[]>>();

export function ensureProjects(): Promise<ComposerProject[]> {
  if (az.projects) return Promise.resolve(az.projects);
  projectsCall ??= api
    .get<ComposerProject[]>("/az/projects")
    .then((p) => (az.projects = p))
    .catch((e) => {
      az.projectsError = errText(e);
      projectsCall = null;
      return [];
    });
  return projectsCall;
}

export function ensureTypes(projectId: string): Promise<AdoTypeOption[]> {
  const known = az.types[projectId];
  if (Array.isArray(known)) return Promise.resolve(known);
  let call = typeCalls.get(projectId);
  if (!call) {
    az.types[projectId] = "loading";
    call = api
      .get<AdoTypeOption[]>(`/az/projects/${projectId}/types`)
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

export const typesOf = (projectId: string): AdoTypeOption[] => {
  const t = az.types[projectId];
  return Array.isArray(t) ? t : [];
};

/** Why the type list is empty, for the menu to say instead of rows. */
export function typesNote(projectId: string): string {
  const t = az.types[projectId];
  if (!t || t === "loading") return "loading types…";
  if (!Array.isArray(t)) return t.error;
  return "no type matches; Enter opens the composer to pick one there";
}
