import builtin from '../library/data/schemes.json';
import type { Scheme } from './types';

export const BUILTIN_SCHEMES: Scheme[] = builtin;

export const SLOT_LABELS = [
  'Фон, светлый',
  'Фон, средний',
  'Фон, тёмный',
  'Контур',
  'Объект, цвет 1',
  'Объект, цвет 2',
  'Объект, цвет 3',
  'Бумага',
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'white') return '#FFFFFF';
  if (v === 'black') return '#000000';
  const m = v.match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

function fromList(list: unknown[], name: string, id: string): Scheme {
  if (list.length !== 8) throw new Error(`В палитре «${name}» ${list.length} цветов, а нужно 8.`);
  const colors = list.map((c, i) => {
    const hex = normalizeHex(c);
    if (!hex) throw new Error(`Палитра «${name}»: «${String(c)}» в слоте «${SLOT_LABELS[i]}» — не hex-цвет.`);
    return hex;
  });
  return { id, name, colors };
}

function fromObject(raw: Record<string, unknown>, index: number): Scheme {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Палитра ${index + 1}`;
  const id = `custom-${Date.now().toString(36)}-${index}`;
  if (Array.isArray(raw.colors)) return fromList(raw.colors, name, id);
  const bg = raw.background;
  const obj = raw.objects;
  if (Array.isArray(bg) && Array.isArray(obj)) {
    if (bg.length !== 3 || obj.length !== 3) {
      throw new Error(`Палитра «${name}»: нужно по три цвета в background и objects.`);
    }
    return fromList([...bg, raw.ink ?? '#181817', ...obj, raw.paper ?? '#FFFFFF'], name, id);
  }
  throw new Error(`Палитра «${name}»: нет ни поля colors, ни пары background + objects.`);
}

/** SVG-палитра в раскладке библиотеки: восемь прямоугольников, слева фон, справа объекты. */
function fromSvg(text: string, fileName: string): Scheme[] {
  const rects = [...text.matchAll(/<rect\b[^>]*>/g)].map((m) => {
    const get = (k: string) => m[0].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
    return { x: Number(get('x') ?? 0), y: Number(get('y') ?? 0), fill: get('fill') };
  });
  if (rects.length !== 8) {
    throw new Error(`В SVG ${rects.length} прямоугольников, а палитра состоит из 8 (2 столбца по 4).`);
  }
  const midX = (Math.min(...rects.map((r) => r.x)) + Math.max(...rects.map((r) => r.x))) / 2;
  const column = (left: boolean) =>
    rects
      .filter((r) => r.x <= midX === left)
      .sort((a, b) => a.y - b.y)
      .map((r) => r.fill);
  const name = fileName.replace(/\.[^.]+$/, '') || 'Палитра из SVG';
  return [fromList([...column(true), ...column(false)], name, `custom-${Date.now().toString(36)}-0`)];
}

/**
 * Разбирает загруженный файл палитры. Принимает JSON (одна палитра или массив)
 * и SVG-экспорт палитры из Figma. Бросает ошибку с понятным человеку текстом.
 */
export function parsePaletteFile(text: string, fileName: string): Scheme[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) return fromSvg(trimmed, fileName);
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error('Файл не читается как JSON или SVG.');
  }
  const list = Array.isArray(data) && data.every((d) => typeof d === 'object' && d !== null) ? data : [data];
  if (Array.isArray(data) && data.every((d) => typeof d === 'string')) {
    return [fromList(data, fileName.replace(/\.[^.]+$/, '') || 'Палитра', `custom-${Date.now().toString(36)}-0`)];
  }
  return list.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) throw new Error('Палитра должна быть объектом.');
    return fromObject(raw as Record<string, unknown>, i);
  });
}

export function schemeToJson(scheme: Scheme): string {
  const c = scheme.colors;
  return JSON.stringify(
    { name: scheme.name, background: c.slice(0, 3), objects: c.slice(4, 7), ink: c[3], paper: c[7] },
    null,
    2,
  );
}
