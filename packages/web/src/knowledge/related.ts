/** A related link as listed: without its scheme or a trailing slash. */
export const linkLabel = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");
