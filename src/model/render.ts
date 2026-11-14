import { OBJECT_LABEL } from './library';
import type { Art, Decor, DecorId, Doc, Item, LibraryData, Scheme } from './types';

const n = (v: number) => String(Math.round(v * 100) / 100);

/** Контуры объекта в цветах схемы. Геометрия (атрибут d) копируется из библиотеки дословно. */
export function artMarkup(art: Art, colors: string[]): string {
  let out = '';
  for (const [slot, d, tx, ty] of art.shapes) {
    const shift = tx !== undefined ? ` transform="translate(${n(tx)} ${n(ty ?? 0)})"` : '';
    out += `<path d="${d}" fill="${colors[slot]}"${shift}/>`;
  }
  return out;
}

/** Фон холста и декор используют только цвета фона: слоты 0–2 и бумагу. */
export function decorMarkup(decor: Decor, colors: string[]): string {
  let out = '';
  for (const el of decor.els) {
    const stroke = el.s !== undefined ? ` stroke="${colors[el.s]}" stroke-width="${el.sw}"` : '';
    if (el.k === 'line') {
      out += `<line x1="${n(el.x1)}" y1="${n(el.y1)}" x2="${n(el.x2)}" y2="${n(el.y2)}"${stroke}/>`;
    } else {
      const fill = el.f !== undefined ? ` fill="${colors[el.f]}"` : '';
      out += `<path d="${el.d}"${fill}${stroke}/>`;
    }
  }
  return out;
}

/**
 * Декор нарисован под квадрат. На других форматах конфетти растягивается до покрытия холста
 * по центру, а клин с линиями прижимается к правому нижнему углу — как в примерах библиотеки.
 */
export function decorTransform(id: Exclude<DecorId, 'none'>, decor: Decor, w: number, h: number): string {
  if (id === 'confetti') {
    const s = Math.max(w / decor.w, h / decor.h);
    return `translate(${n((w - decor.w * s) / 2)} ${n((h - decor.h * s) / 2)}) scale(${n(s)})`;
  }
  const s = Math.max(0.75, Math.min(w / decor.w, h / decor.h));
  return `translate(${n(w - decor.w * s)} ${n(h - decor.h * s)}) scale(${n(s)})`;
}

export function itemTransform(item: Item, art: Art, unit: number): string {
  const rot = item.rot ? ` rotate(${n(item.rot)})` : '';
  return `translate(${n(item.x * unit)} ${n(item.y * unit)})${rot} translate(${n(-art.w / 2)} ${n(-art.h / 2)})`;
}

/**
 * Итоговый SVG. Каждый объект — отдельная группа с читаемым id, внутри — исходные контуры.
 * Растровых вставок, фильтров и масок нет, поэтому файл остаётся редактируемым.
 */
export function renderSvg(doc: Doc, lib: LibraryData, scheme: Scheme, title = 'Композиция'): string {
  const u = lib.unit;
  const w = doc.w * u;
  const h = doc.h * u;
  const c = scheme.colors;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" fill="none">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect id="background" width="${n(w)}" height="${n(h)}" fill="${c[0]}"/>`,
  ];
  if (doc.decor !== 'none') {
    const decor = lib.decor[doc.decor];
    parts.push(
      `<g id="decor-${doc.decor}" transform="${decorTransform(doc.decor, decor, w, h)}">${decorMarkup(decor, c)}</g>`,
    );
  }
  doc.items.forEach((item, i) => {
    const art = lib.objects[item.object][item.role];
    parts.push(
      `<g id="${item.object}-${item.role}-${i + 1}" data-name="${escapeXml(OBJECT_LABEL[item.object])}" transform="${itemTransform(item, art, u)}">${artMarkup(art, c)}</g>`,
    );
  });
  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] as string);
}
