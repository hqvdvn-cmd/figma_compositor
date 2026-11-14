import { useCallback, useState } from 'react';
import type { Doc } from './model/types';

interface EditorState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
}

const LIMIT = 100;

/** Документ с историей. `commit` — шаг истории, `replace` — промежуточное состояние (перетаскивание). */
export function useEditor(initial: Doc) {
  const [state, setState] = useState<EditorState>({ doc: initial, past: [], future: [] });

  const commit = useCallback((fn: (doc: Doc) => Doc) => {
    setState((s) => {
      const doc = fn(s.doc);
      if (doc === s.doc) return s;
      return { doc, past: [...s.past, s.doc].slice(-LIMIT), future: [] };
    });
  }, []);

  const replace = useCallback((fn: (doc: Doc) => Doc) => {
    setState((s) => ({ ...s, doc: fn(s.doc) }));
  }, []);

  /** Запомнить текущее состояние как шаг истории перед серией `replace`. */
  const checkpoint = useCallback(() => {
    setState((s) => ({ ...s, past: [...s.past, s.doc].slice(-LIMIT), future: [] }));
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      const next = s.future[0];
      if (!next) return s;
      return { doc: next, past: [...s.past, s.doc], future: s.future.slice(1) };
    });
  }, []);

  return {
    doc: state.doc,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    replace,
    checkpoint,
    undo,
    redo,
  };
}
