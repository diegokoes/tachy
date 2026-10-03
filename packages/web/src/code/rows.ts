import type { RepoRow, RepoIndexRun } from "@tachy/contract";

export type Repo = RepoRow & { active_run?: RepoIndexRun | null };
