import type {
  NotificationKind,
  ReportDirection,
  ReportStatus,
  ReportType,
} from "./vocabulary";

/** What the feedback form sends when a person files a report. */
export interface ReportInput {
  type: ReportType;
  title?: string;
  body: string;
  /** Where the person was and what they were running when they filed. */
  context?: Record<string, unknown>;
}

/**
 * The advisory the configured model gives back on a draft. `available` is false
 * when no token resolves for the caller — the form then submits with no review
 * rather than trapping the person behind a model they never set up.
 */
export interface ReportReview {
  available: boolean;
  ok: boolean;
  suggestions: string[];
}

export interface ReportMessageRow {
  id: string;
  report_id: string;
  author_id: string | null;
  author_name: string | null;
  direction: ReportDirection;
  body_text: string;
  created_at: string;
}

export interface ReportRow {
  id: string;
  reporter_id: string | null;
  reporter_name: string | null;
  type: ReportType;
  status: ReportStatus;
  title: string | null;
  body_text: string;
  context: Record<string, unknown>;
  ai_review: ReportReview | null;
  created_at: string;
  updated_at: string;
  messages?: ReportMessageRow[];
}

export interface ReportsCensus {
  reports: number;
  open: number;
  in_progress: number;
  resolved: number;
  bugs: number;
  features: number;
  oldest_open_at: string | null;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string | null;
  body_text: string | null;
  ref: Record<string, unknown>;
  read_at: string | null;
  seen_at: string | null;
  created_at: string;
}
