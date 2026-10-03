import type {
  JobDefinition,
  JobQueueName,
  JobRun,
  JobRunListed,
} from "@tachy/contract";

export type JsonSchema = {
  type?: string;
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};
export type JobKindInfo = {
  kind: string;
  title: string;
  description: string | null;
  connection: string | null;
  default_schedule: string | null;
  queue: JobQueueName;
  resource_class: "light" | "heavy";
  overlap: "skip" | "queue";
  missed: "run-once" | "skip";
  timeout: string;
  max_attempts: number;
  params_schema: JsonSchema;
};
export type JobRunRow = JobRun;
export type JobRunListedRow = JobRunListed;
export type JobDefinitionRow = JobDefinition & {
  next_run: string | null;
  last_run: Pick<JobRun, "id" | "status" | "created_at" | "error"> | null;
};
export type JobChange = {
  id: string;
  action: string;
  changed_by: string | null;
  created_at: string;
};
