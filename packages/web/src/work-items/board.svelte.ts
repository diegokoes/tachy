import { setLanding } from "../shell/router.svelte";
import { az } from "./az.svelte";
import { BOARD_SOURCE, boardListPath } from "./board";

const REMEMBERED = "tachy.board.project";

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

export function rememberProject(projectId: string): void {
  try {
    localStorage.setItem(REMEMBERED, projectId);
  } catch {
    // Without storage the board opens on the first project each visit.
  }
}

/** The project last open when it is still one of the caller's, else their first. */
export function landingProject(): string | null {
  const projects = az.projects ?? [];
  const last = remembered();
  if (last && projects.some((p) => p.id === last)) return last;
  return projects[0]?.id ?? null;
}

setLanding("board", () => {
  const projectId = landingProject();
  return projectId ? boardListPath(projectId) : `/board/${BOARD_SOURCE}`;
});
