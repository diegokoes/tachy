/** One kept version of a library item, from /:base/:id/revisions. */
export interface Revision {
  id: string;
  version: number;
  actor: string;
  turn_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  changed_fields: string[];
  created_at: string;
}

export interface ViewSummary {
  views: number;
  viewers: number;
  last_viewed_at: string | null;
  history: { day: string; views: number }[];
}
