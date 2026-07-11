export const csv = (v: string | undefined) =>
  v
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
