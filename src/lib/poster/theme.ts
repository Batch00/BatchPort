// Poster palettes.
//
// The app is dark-only and that is not negotiable in the UI, but a poster is
// an object that leaves the app: a dark A2 print costs a fortune in ink, dries
// unevenly, and reads as a different (much heavier) piece of design on paper
// than it does on a backlit screen. So the export offers a light variant.
// Every token below exists in both, which is what stops the light theme from
// being the dark one with the background swapped.

export type PosterThemeId = "midnight" | "paper";

export interface PosterTheme {
  id: PosterThemeId;
  label: string;
  /** One line under the swatch in the dialog. */
  note: string;
  background: string;
  /** A second wash behind the map, for depth. Null leaves the flat ground. */
  vignette: string | null;
  /** Inside the projection boundary but not on land. Sits between the page
   * and the land tone so the continents read as figure rather than as holes. */
  ocean: string;
  /** Countries with nothing recorded in them. */
  land: string;
  landStroke: string;
  /** Countries the traveller has been to. */
  visited: string;
  visitedStroke: string;
  /** Unfulfilled bucket list countries. */
  bucket: string;
  bucketStroke: string;
  graticule: string;
  /** The projection boundary: the sphere's edge or the map's frame. */
  sphere: string;
  arc: string;
  arcGlow: string | null;
  pin: string;
  pinStroke: string;
  title: string;
  body: string;
  muted: string;
  rule: string;
  accent: string;
}

const BRAND = "#2563eb";

export const POSTER_THEMES: PosterTheme[] = [
  {
    id: "midnight",
    label: "Midnight",
    note: "The app's own palette. Best on screen.",
    background: "#07080b",
    vignette: "rgba(37, 99, 235, 0.10)",
    ocean: "#0c0e14",
    land: "#15171d",
    landStroke: "#262a33",
    visited: "rgba(37, 99, 235, 0.62)",
    visitedStroke: "#5b96f7",
    bucket: "rgba(245, 158, 11, 0.26)",
    bucketStroke: "rgba(245, 158, 11, 0.55)",
    graticule: "rgba(255, 255, 255, 0.045)",
    sphere: "rgba(255, 255, 255, 0.16)",
    arc: "rgba(122, 173, 255, 0.85)",
    arcGlow: "rgba(37, 99, 235, 0.30)",
    pin: "#ffffff",
    pinStroke: "rgba(7, 8, 11, 0.9)",
    title: "#ffffff",
    body: "rgba(255, 255, 255, 0.82)",
    muted: "rgba(255, 255, 255, 0.42)",
    rule: "rgba(255, 255, 255, 0.16)",
    accent: BRAND,
  },
  {
    id: "paper",
    label: "Paper",
    note: "Warm off-white. Made to be printed.",
    background: "#f6f3ec",
    vignette: null,
    ocean: "#f1eee4",
    land: "#e0dacc",
    landStroke: "#cec7b7",
    visited: "rgba(29, 78, 216, 0.55)",
    visitedStroke: "#1d4ed8",
    bucket: "rgba(180, 83, 9, 0.24)",
    bucketStroke: "rgba(180, 83, 9, 0.55)",
    graticule: "rgba(59, 51, 38, 0.07)",
    sphere: "rgba(59, 51, 38, 0.28)",
    arc: "rgba(29, 78, 216, 0.72)",
    arcGlow: null,
    pin: "#12213f",
    pinStroke: "rgba(246, 243, 236, 0.95)",
    title: "#14161a",
    body: "rgba(20, 22, 26, 0.82)",
    muted: "rgba(20, 22, 26, 0.48)",
    rule: "rgba(20, 22, 26, 0.20)",
    accent: "#1d4ed8",
  },
];

export function posterTheme(id: PosterThemeId): PosterTheme {
  return POSTER_THEMES.find((theme) => theme.id === id) ?? POSTER_THEMES[0];
}
