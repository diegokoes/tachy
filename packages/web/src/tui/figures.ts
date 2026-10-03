const COMPACT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 1234567 → "1.2M". For a figure that has to fit a column's width. */
export const compact = (n: number) => COMPACT.format(n);

/** Dollars to the cent below a hundred, whole dollars above it. */
export const usd = (n: number) =>
  `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;

/** "2026-09-14" → "14": the day a column stands for, under the column. */
export const dayOfMonth = (iso: string) => String(Number(iso.slice(8, 10)));
