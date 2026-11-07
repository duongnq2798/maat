/** Brand colours for exported files (PNG/SVG cannot read CSS variables). brand.test.ts keeps them equal to app/globals.css. */
export const PALETTE = {
  paper: "#FFFFFF",
  ink: "#0B0D12",
  ink2: "#5A6170",
  line: "#E6E8EC",
  lineSoft: "#F1F2F5",
  grid: "#EEF0F4",
  accent: "#1F3BFF",
  accentTint: "#EEF1FF",
  refuse: "#C2410C",
  refuseTint: "#FFF1EA",
  feather: "#6E83FF",
} as const;

/** The mark on a 30×30 grid (spec §2.4): a balance, Ma'at's feather on the left, an order block on the right. */
export const MARK = {
  size: 30,
  radius: 9,
  beam: "M15 7v15M11 22h8M7 10h16",
  beamWidth: 1.8,
  feather: "M9 11.5c-2 2.6-2 5.4 0 7.5 2-2.1 2-4.9 0-7.5z",
  order: { x: 19, y: 12.5, size: 5, radius: 1 },
} as const;
