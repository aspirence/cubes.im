/**
 * The Drive picker's state machine, kept out of the component so it can be
 * tested without a browser or a Google account.
 *
 * WHY A REDUCER AND NOT A HANDFUL OF useState: picking a source has four
 * overlapping concerns — where the user is (idle / Picker open / browsing a
 * folder / done), how deep into a folder tree, what they have typed, and what
 * went wrong. Held as separate flags those drift: a stale error survives a new
 * pick, a search term from one folder filters the next, a "picking" spinner
 * hangs when the Picker is closed. As one transition table, each of those is a
 * rule you can read and a test you can write.
 */

import type { DriveAttachment, DriveFolderRef, DriveVideo } from "./drive-api";

export type PickingState =
  /** Nothing chosen. */
  | { step: "idle"; error: string | null }
  /** Waiting on Google's Picker (or on the token that opens it). */
  | { step: "picking"; error: null }
  /** Waiting on our backend to resolve a pasted link or a picked id. */
  | { step: "resolving"; error: null }
  /** Inside a folder: `trail` is root-first and its last entry is where we are. */
  | { step: "browsing"; trail: DriveFolderRef[]; search: string; error: string | null }
  /** A video is attached and ready to save. */
  | { step: "attached"; attachment: DriveAttachment; error: null };

export type PickingAction =
  | { type: "reset" }
  | { type: "openPicker" }
  | { type: "resolve" }
  | { type: "cancelled" }
  | { type: "failed"; message: string }
  | { type: "enterFolder"; folder: DriveFolderRef }
  | { type: "crumb"; index: number }
  | { type: "search"; value: string }
  | { type: "attach"; connectionId: string; video: DriveVideo }
  | { type: "detach" };

export const initialPickingState: PickingState = { step: "idle", error: null };

/**
 * Where a cancel or a failure lands. Both return the user to something they can
 * act on rather than a dead spinner: if they were browsing a folder they stay
 * in it (their place in the tree is the expensive thing to lose), otherwise
 * they go back to idle with the Pick button.
 */
function settle(state: PickingState, error: string | null): PickingState {
  if (state.step === "browsing") return { ...state, error };
  if (state.step === "attached" && !error) return state;
  return { step: "idle", error };
}

export function pickingReducer(state: PickingState, action: PickingAction): PickingState {
  switch (action.type) {
    case "reset":
      return initialPickingState;

    case "openPicker":
      return { step: "picking", error: null };

    case "resolve":
      return { step: "resolving", error: null };

    case "cancelled":
      return settle(state, null);

    case "failed":
      return settle(state, action.message);

    case "enterFolder": {
      // Re-entering a folder already in the trail is a step BACK, not a deeper
      // level — otherwise a user who clicks a breadcrumb's own tile grows an
      // endless path of the same folder.
      const trail = state.step === "browsing" ? state.trail : [];
      const seen = trail.findIndex((f) => f.id === action.folder.id);
      const next = seen >= 0 ? trail.slice(0, seen + 1) : [...trail, action.folder];
      // The search box is per folder: a term that matched here almost never
      // matches the folder you just opened, and an empty grid with a filter
      // silently applied reads as "this folder is empty".
      return { step: "browsing", trail: next, search: "", error: null };
    }

    case "crumb": {
      if (state.step !== "browsing") return state;
      const trail = state.trail.slice(0, Math.max(1, action.index + 1));
      return { step: "browsing", trail, search: "", error: null };
    }

    case "search":
      if (state.step !== "browsing") return state;
      return { ...state, search: action.value };

    case "attach":
      return {
        step: "attached",
        attachment: { connectionId: action.connectionId, video: action.video },
        error: null,
      };

    case "detach":
      return initialPickingState;

    default:
      return state;
  }
}

/** The folder currently being shown, or null when we are not browsing one. */
export function currentFolder(state: PickingState): DriveFolderRef | null {
  if (state.step !== "browsing") return null;
  return state.trail[state.trail.length - 1] ?? null;
}

/** True while the picker is waiting on Google or on us — drives the spinner. */
export function isBusy(state: PickingState): boolean {
  return state.step === "picking" || state.step === "resolving";
}
