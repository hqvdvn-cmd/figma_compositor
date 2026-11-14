import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { artMarkup, decorMarkup, decorTransform, itemTransform } from '../model/render';
import type { Doc, Item, LibraryData, Scheme } from '../model/types';

interface Props {
  doc: Doc;
  lib: LibraryData;
  scheme: Scheme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Начало жеста: сохранить шаг истории. */
  onGestureStart: () => void;
  onChange: (id: string, patch: Partial<Item>) => void;
}

type Gesture =
  | { kind: 'move'; id: string; startX: number; startY: number; itemX: number; itemY: number; moved: boolean }
  | { kind: 'rotate'; id: string; moved: boolean };

const HANDLE_GAP = 34;

export function Stage({ doc, lib, scheme, selectedId, onSelect, onGestureStart, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const u = lib.unit;
  const vw = doc.w * u;
  const vh = doc.h * u;
  // Сколько экранных пикселей приходится на базовую единицу холста.
  const scale = box.w && box.h ? Math.min(box.w / doc.w, box.h / doc.h) : 0;
  const width = doc.w * scale;
  const height = doc.h * scale;

  // Разметка объекта зависит только от пары «объект + роль» и схемы, но не от положения:
  // при перетаскивании тысячи контуров не пересоздаются.
  const markup = useMemo(() => {
    const cache = new Map<string, string>();
    return (item: Item) => {
      const key = `${item.object}:${item.role}`;
      let html = cache.get(key);
      if (html === undefined) {
        html = artMarkup(lib.objects[item.object][item.role], scheme.colors);
        cache.set(key, html);
      }
      return html;
    };
  }, [lib, scheme]);

  const decorHtml = useMemo(
    () => (doc.decor === 'none' ? '' : decorMarkup(lib.decor[doc.decor], scheme.colors)),
    [doc.decor, lib, scheme],
  );

  const toBase = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const capture = (pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      // Указатель уже отпущен — жест просто не начнётся.
    }
  };

  const startMove = (e: ReactPointerEvent, item: Item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(item.id);
    const p = toBase(e);
    gesture.current = { kind: 'move', id: item.id, startX: p.x, startY: p.y, itemX: item.x, itemY: item.y, moved: false };
    capture(e.pointerId);
  };

  const startRotate = (e: ReactPointerEvent, item: Item) => {
    e.stopPropagation();
    gesture.current = { kind: 'rotate', id: item.id, moved: false };
    capture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toBase(e);
    if (!g.moved) {
      if (g.kind === 'move' && Math.hypot(p.x - g.startX, p.y - g.startY) * scale < 3) return;
      g.moved = true;
      onGestureStart();
    }
    if (g.kind === 'move') {
      onChange(g.id, { x: Math.round(g.itemX + p.x - g.startX), y: Math.round(g.itemY + p.y - g.startY) });
    } else {
      const item = doc.items.find((i) => i.id === g.id);
      if (!item) return;
      let deg = (Math.atan2(p.y - item.y, p.x - item.x) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((Math.round(deg) % 360) + 360) % 360;
      onChange(g.id, { rot: deg > 180 ? deg - 360 : deg });
    }
  };

  const endGesture = (e: ReactPointerEvent) => {
    if (gesture.current && svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
    gesture.current = null;
  };

  const selected = doc.items.find((i) => i.id === selectedId) ?? null;
  const selBox = selected ? lib.objects[selected.object][selected.role] : null;

  return (
    <div className="stage" ref={wrapRef} onPointerDown={() => onSelect(null)}>
      {scale > 0 && (
        <div className="stage-canvas" style={{ width, height }}>
          <svg
            ref={svgRef}
            className="stage-art"
            viewBox={`0 0 ${vw} ${vh}`}
            width={width}
            height={height}
            role="img"
            aria-label={`Холст ${doc.w} на ${doc.h}, объектов: ${doc.items.length}`}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <rect width={vw} height={vh} fill={scheme.colors[0]} />
            {doc.decor !== 'none' && (
              <g
                transform={decorTransform(doc.decor, lib.decor[doc.decor], vw, vh)}
                dangerouslySetInnerHTML={{ __html: decorHtml }}
              />
            )}
            {doc.items.map((item) => (
              <g
                key={item.id}
                className="stage-item"
                transform={itemTransform(item, lib.objects[item.object][item.role], u)}
                onPointerDown={(e) => startMove(e, item)}
                dangerouslySetInnerHTML={{ __html: markup(item) }}
              />
            ))}
          </svg>
          {selected && selBox && (
            <svg className="stage-overlay" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
              <g transform={`translate(${selected.x * scale} ${selected.y * scale}) rotate(${selected.rot})`}>
                <rect
                  className="sel-box"
                  x={(-selBox.w / u / 2) * scale}
                  y={(-selBox.h / u / 2) * scale}
                  width={(selBox.w / u) * scale}
                  height={(selBox.h / u) * scale}
                />
                <line
                  className="sel-stem"
                  x1={0}
                  y1={(-selBox.h / u / 2) * scale}
                  x2={0}
                  y2={(-selBox.h / u / 2) * scale - HANDLE_GAP}
                />
                <circle
                  className="sel-handle"
                  cx={0}
                  cy={(-selBox.h / u / 2) * scale - HANDLE_GAP}
                  r={8}
                  onPointerDown={(e) => startRotate(e, selected)}
                />
              </g>
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
