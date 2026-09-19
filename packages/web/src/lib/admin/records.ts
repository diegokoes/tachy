import { segment } from "../router.svelte";

/**
 * Where one record of an admin section opens, or the section itself with no
 * key. The page comes from the current route, so a panel names only its own
 * section and never has to know which admin page it was filed under.
 */
export const recordPath = (section: string, key?: string) =>
  `/admin/${segment(1)}/${section}${key ? `/${key}` : ""}`;

/** The key a record page is opened with to start a new one. */
export const NEW_RECORD = "new";
