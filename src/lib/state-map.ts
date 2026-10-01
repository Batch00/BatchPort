// The states map's model (pure, client-safe).
//
// Turns v_state_coverage rows into what the map draws. The rows are the whole
// truth: which states count as visited, and from when, is decided in SQL
// (v_presence_state, v_state_coverage) and nothing here second-guesses it.
// What this adds is the drawing's own concerns: a grid with a slot for every
// shape even when the view returned no rows, and the "N of 50" count.

import { US_STATE_SHAPES } from "@/lib/us-states-geometry";

/** One v_state_coverage row, as the data layer returns it. */
export interface StateCoverageRow {
  state_code: string;
  state_name: string;
  visited: boolean;
  first_visit_date: string | null;
}

export interface MapState {
  code: string;
  name: string;
  visited: boolean;
  /** YYYY-MM-DD, or null when visited with no date (an undated stop, or a
   * place with no visits) as well as when not visited. */
  firstVisitDate: string | null;
}

export interface StateMapModel {
  /** Every drawn shape, keyed by postal code. */
  states: Record<string, MapState>;
  /** Of the 50: DC is drawn and deliberately not counted. */
  visitedCount: number;
  total: number;
  dcVisited: boolean;
}

/** DC is on the map and is not a state; every count here leaves it out. */
export const DC = "DC";

/**
 * The states too small to find, let alone tap, at phone width. Each gets a
 * labelled chip under the map so it can be read and selected on a phone; on
 * a 360px screen Rhode Island is about four pixels wide. North to south down
 * the coast, which is the order somebody scanning for one expects.
 */
export const SMALL_STATES = ["VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", DC];

export function buildStateMap(rows: StateCoverageRow[]): StateMapModel {
  const byCode = new Map(rows.map((row) => [row.state_code, row]));
  const states: Record<string, MapState> = {};
  for (const shape of US_STATE_SHAPES) {
    const row = byCode.get(shape.code);
    states[shape.code] = {
      code: shape.code,
      name: shape.name,
      // No rows at all is v_state_coverage's "no presence yet" state, not an
      // error: every shape is simply unvisited.
      visited: row?.visited ?? false,
      firstVisitDate: row?.visited ? row.first_visit_date : null,
    };
  }
  const counted = Object.values(states).filter((s) => s.code !== DC);
  return {
    states,
    visitedCount: counted.filter((s) => s.visited).length,
    total: counted.length,
    dcVisited: states[DC]?.visited ?? false,
  };
}

/**
 * States in the order they were first reached, for the text list under the
 * map. Undated visits go last, alphabetically, rather than being dropped: a
 * state that is filled on the map must also be named in the list.
 */
export function visitedInOrder(model: StateMapModel): MapState[] {
  return Object.values(model.states)
    .filter((s) => s.visited)
    .sort((a, b) => {
      if (a.firstVisitDate && b.firstVisitDate) {
        return a.firstVisitDate.localeCompare(b.firstVisitDate) || a.name.localeCompare(b.name);
      }
      if (a.firstVisitDate) return -1;
      if (b.firstVisitDate) return 1;
      return a.name.localeCompare(b.name);
    });
}
