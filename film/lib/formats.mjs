// The two cuts. Each is captured at its own viewport, so the 9:16 cut shows the site's phone layout at twice the
// pixel density instead of a crop of the 16:9 frame.

export const FORMATS = Object.freeze({
  wide: Object.freeze({ id: "wide", label: "16:9", file: "16x9", width: 1920, height: 1080, viewport: { width: 1920, height: 1080 }, dpr: 1 }),
  tall: Object.freeze({ id: "tall", label: "9:16", file: "9x16", width: 1080, height: 1920, viewport: { width: 540, height: 960 }, dpr: 2 }),
});

export const FORMAT_IDS = Object.freeze(Object.keys(FORMATS));
