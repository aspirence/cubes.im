/**
 * The two grid rhythms every CRM screen uses.
 *
 * `min(100%, …)` is load-bearing: without it the grid refuses to go below the
 * track minimum and the row overflows its container on a narrow laptop.
 */

/** A row of `StatTile`s that reflows from 4-up to 1-up. */
export const TILE_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
  gap: 12,
  marginBottom: 16,
};

/** The 2-up panel/chart grid that sits under the tiles. */
export const CONTENT_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
  gap: 16,
};
