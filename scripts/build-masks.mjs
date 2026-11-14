// Строит грубые силуэты объектов для раскладки: сетка с шагом CELL базовых единиц,
// клетка занята, если в неё попадает хоть какая-то заливка объекта (включая его тень).
// Силуэты нужны только алгоритму раскладки; в итоговый SVG они не попадают.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'src', 'library', 'data');
const lib = JSON.parse(readFileSync(join(data, 'L.json'), 'utf8'));

const CELL = 25;
const SUB = 3; // проб на клетку по каждой оси

/** Контур → список замкнутых ломаных. В выгрузке Figma встречаются только M L H V C Z. */
function flatten(d, tx = 0, ty = 0) {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const polys = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let i = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLHVCZ]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'M') {
      x = num();
      y = num();
      cur = [[x + tx, y + ty]];
      polys.push(cur);
      cmd = 'L';
    } else if (cmd === 'L') {
      x = num();
      y = num();
      cur.push([x + tx, y + ty]);
    } else if (cmd === 'H') {
      x = num();
      cur.push([x + tx, y + ty]);
    } else if (cmd === 'V') {
      y = num();
      cur.push([x + tx, y + ty]);
    } else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        const u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3 + tx,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 + ty,
        ]);
      }
      x = x3;
      y = y3;
    } else if (cmd === 'Z') {
      cmd = '';
    } else {
      throw new Error(`неизвестная команда контура рядом с «${tokens[i]}»`);
    }
  }
  return polys;
}

function mask(art) {
  const cols = Math.ceil(art.w / CELL);
  const rows = Math.ceil(art.h / CELL);
  const grid = Array.from({ length: rows }, () => new Uint8Array(cols));
  const step = CELL / SUB;
  for (const [, d, tx, ty] of art.shapes) {
    const edges = [];
    for (const poly of flatten(d, tx ?? 0, ty ?? 0)) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
      }
    }
    for (let sy = 0; sy < rows * SUB; sy++) {
      const y = (sy + 0.5) * step;
      const hits = [];
      for (const [x0, y0, x1, y1] of edges) {
        if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
          hits.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
        }
      }
      if (!hits.length) continue;
      hits.sort((p, q) => p[0] - q[0]);
      // Правило nonzero: закрашено там, где сумма направлений пересечений слева не равна нулю.
      let winding = 0;
      let h = 0;
      for (let sx = 0; sx < cols * SUB; sx++) {
        const x = (sx + 0.5) * step;
        while (h < hits.length && hits[h][0] < x) winding += hits[h++][1];
        if (winding !== 0) grid[Math.floor(sy / SUB)][Math.floor(sx / SUB)] = 1;
      }
    }
  }
  return grid.map((row) => [...row].map((v) => (v ? '#' : '.')).join(''));
}

const out = { cell: CELL, objects: {} };
for (const [id, roles] of Object.entries(lib.objects)) {
  const rows = mask(roles.main);
  out.objects[id] = { w: roles.main.w, h: roles.main.h, rows };
  const filled = rows.join('').split('#').length - 1;
  console.log(`${id}: ${rows[0].length}×${rows.length} клеток, занято ${filled}`);
}
writeFileSync(join(data, 'masks.json'), JSON.stringify(out));
