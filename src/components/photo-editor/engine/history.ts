// Undo/redo unlimited berbasis snapshot Scene JSON.
// Snapshot ringan (JSON string) — untuk foto 12MP editor umumnya
// punya <100 objek, jadi memori aman.

import type { Scene } from "./scene";
import { serializeScene, deserializeScene, emptyScene } from "./scene";

export type HistoryState = { past: string[]; present: string; future: string[] };

export function initHistory(scene: Scene): HistoryState {
  return { past: [], present: serializeScene(scene), future: [] };
}

export function pushHistory(h: HistoryState, next: Scene): HistoryState {
  const nextStr = serializeScene(next);
  if (nextStr === h.present) return h;
  return { past: [...h.past, h.present], present: nextStr, future: [] };
}

export function canUndo(h: HistoryState): boolean { return h.past.length > 0; }
export function canRedo(h: HistoryState): boolean { return h.future.length > 0; }

export function undo(h: HistoryState): HistoryState {
  if (!canUndo(h)) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: HistoryState): HistoryState {
  if (!canRedo(h)) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export function readScene(h: HistoryState): Scene {
  return deserializeScene(h.present, emptyScene(0, 0));
}