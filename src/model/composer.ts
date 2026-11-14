import masksData from '../library/data/masks.json';
import type { Item, LayoutMode, ObjectId } from './types';

export interface ComposeInput {
  mains: ObjectId[];
  bgs: ObjectId[];
  w: number;
  h: number;
  mode: LayoutMode;
  /** Одинаковое зерно даёт одинаковую раскладку; новое зерно — новый вариант. */
  seed: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `i${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Силуэт объекта на сетке: какие клетки он закрывает (вместе с собственной тенью). */
interface Mask {
  w: number;
  h: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  /** Силуэт, расширенный на клетку во все стороны: с ним сравнивают соседей, чтобы между объектами оставался зазор. */
  fat: Uint8Array;
  /** Координаты занятых клеток. */
  xs: Int16Array;
  ys: Int16Array;
  count: number;
  /** Центр масс и условный радиус в клетках. */
  cx: number;
  cy: number;
  radius: number;
}

const CELL: number = masksData.cell;

function toMask(raw: { w: number; h: number; rows: string[] }): Mask {
  const rows = raw.rows.length;
  const cols = raw.rows[0].length;
  const cells = new Uint8Array(cols * rows);
  const xs: number[] = [];
  const ys: number[] = [];
  let sx = 0;
  let sy = 0;
  raw.rows.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      if (row[x] !== '#') continue;
      cells[y * cols + x] = 1;
      xs.push(x);
      ys.push(y);
      sx += x;
      sy += y;
    }
  });
  const count = xs.length;
  const fatCols = cols + 2;
  const fat = new Uint8Array(fatCols * (rows + 2));
  for (let k = 0; k < count; k++) {
    for (let dy = 0; dy <= 2; dy++) {
      for (let dx = 0; dx <= 2; dx++) fat[(ys[k] + dy) * fatCols + xs[k] + dx] = 1;
    }
  }
  return {
    w: raw.w,
    h: raw.h,
    cols,
    rows,
    cells,
    fat,
    xs: Int16Array.from(xs),
    ys: Int16Array.from(ys),
    count,
    cx: sx / count + 0.5,
    cy: sy / count + 0.5,
    radius: Math.sqrt(count / Math.PI),
  };
}

const MASKS = Object.fromEntries(
  Object.entries(masksData.objects).map(([id, raw]) => [id, toMask(raw)]),
) as Record<ObjectId, Mask>;

/** У этих объектов узнаваемая часть наверху: срезать верх краем холста нельзя. */
const TOP_HEAVY = new Set<ObjectId>(['lamp', 'vase']);

/** Положение объекта: клетка, в которой стоит левый верхний угол его силуэта. */
interface Placed {
  object: ObjectId;
  mask: Mask;
  ox: number;
  oy: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Сколько клеток меньшего силуэта попадает на больший. С `gap` больший силуэт берётся
 * расширенным на клетку: тогда ноль означает, что объекты ещё и не касаются.
 */
function overlap(a: Placed, b: Placed, gap = false): number {
  if (a.mask.count > b.mask.count) return overlap(b, a, gap);
  const pad = gap ? 1 : 0;
  const cols = b.mask.cols + 2 * pad;
  const rows = b.mask.rows + 2 * pad;
  const cells = gap ? b.mask.fat : b.mask.cells;
  const dx = a.ox - b.ox + pad;
  const dy = a.oy - b.oy + pad;
  if (dx >= cols || dy >= rows || dx + a.mask.cols <= 0 || dy + a.mask.rows <= 0) return 0;
  const { xs, ys, count } = a.mask;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const x = xs[k] + dx;
    const y = ys[k] + dy;
    if (x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x]) n++;
  }
  return n;
}

function inside(p: Placed, r: Rect): number {
  const { xs, ys, count } = p.mask;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const x = xs[k] + p.ox;
    const y = ys[k] + p.oy;
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) n++;
  }
  return n;
}

const centerX = (p: Placed) => p.ox + p.mask.cx;
const centerY = (p: Placed) => p.oy + p.mask.cy;

/** Отклонение направления от изометрических осей (±30° к горизонтали), в долях от 30°. */
function isoDeviation(dx: number, dy: number): number {
  const angle = (Math.abs(Math.atan2(dy, dx)) * 180) / Math.PI; // 0…180
  const folded = angle > 90 ? 180 - angle : angle; // 0…90
  return Math.abs(folded - 30) / 30;
}

interface Scene {
  canvas: Rect;
  /** Зона, которую объекты не занимают (место под заголовок или свободная сторона). */
  keepOut: Rect | null;
  keepOutWeight: number;
  focusX: number;
  focusY: number;
  size: number;
}

function sceneFor(w: number, h: number, mode: LayoutMode, flip: number): Scene {
  const gw = Math.round(w / CELL);
  const gh = Math.round(h / CELL);
  const canvas = { x0: 0, y0: 0, x1: gw, y1: gh };
  const scene: Scene = { canvas, keepOut: null, keepOutWeight: 0, focusX: gw / 2, focusY: gh / 2, size: Math.min(gw, gh) };
  if (mode === 'offset') {
    const cut = Math.round(gw * 0.34);
    scene.keepOut = flip < 0 ? { ...canvas, x0: gw - cut } : { ...canvas, x1: cut };
    scene.keepOutWeight = 14;
    scene.focusX = flip < 0 ? (gw - cut) / 2 : cut + (gw - cut) / 2;
  } else if (mode === 'headline') {
    scene.keepOutWeight = 40;
    if (w / h >= 1.2) {
      const cut = Math.round(gw * 0.42);
      scene.keepOut = { ...canvas, x1: cut };
      scene.focusX = cut + (gw - cut) / 2;
    } else {
      const cut = Math.round(gh * 0.36);
      scene.keepOut = { ...canvas, y1: cut };
      scene.focusY = cut + (gh - cut) / 2;
    }
  }
  return scene;
}

/**
 * Оценка раскладки главных объектов: чем меньше, тем лучше. Объекты должны стоять рядом
 * на одной плоскости, а не лежать друг на друге, — так устроены примеры библиотеки.
 */
function mainCost(items: Placed[], scene: Scene): number {
  const canvasCells = (scene.canvas.x1 - scene.canvas.x0) * (scene.canvas.y1 - scene.canvas.y0);
  let cost = 0;
  let massX = 0;
  let massY = 0;
  let mass = 0;

  for (const p of items) {
    const visible = inside(p, scene.canvas);
    // Объект, который в холст не помещается, может быть обрезан краем — как книга в примерах.
    const target = Math.min(0.96, Math.max(0.36, (0.42 * canvasCells) / p.mask.count));
    const lack = Math.max(0, target - visible / p.mask.count);
    // Небольшой объект обязан поместиться целиком: резать краем можно только крупные.
    cost += 110 * lack * lack + (p.mask.count < 0.2 * canvasCells ? 16 : 6) * lack;
    if (scene.keepOut) cost += scene.keepOutWeight * (inside(p, scene.keepOut) / p.mask.count);
    if (TOP_HEAVY.has(p.object) && p.oy < 0) cost += 1.2 * -p.oy;
    massX += centerX(p) * visible;
    massY += centerY(p) * visible;
    mass += visible;
  }

  for (let i = 0; i < items.length; i++) {
    let nearest = Infinity;
    let nearestIso = 0;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i];
      const b = items[j];
      if (j > i) {
        // Наложение — главный запрет: дешевле уйти за край холста, чем лечь на соседа.
        const shared = overlap(a, b, true) / Math.min(a.mask.count, b.mask.count);
        if (shared > 0) cost += 6 + 500 * shared;
      }
      const dx = centerX(b) - centerX(a);
      const dy = centerY(b) - centerY(a);
      const gap = Math.hypot(dx, dy) - 0.85 * (a.mask.radius + b.mask.radius);
      if (gap < nearest) {
        nearest = gap;
        nearestIso = isoDeviation(dx, dy);
      }
    }
    if (nearest !== Infinity) {
      // Объекты держатся группой и выстраиваются вдоль изометрических осей.
      cost += 0.012 * Math.max(0, nearest) ** 2;
      cost += 0.5 * nearestIso * nearestIso;
    }
  }

  if (mass > 0) {
    const dx = (massX / mass - scene.focusX) / scene.size;
    const dy = (massY / mass - scene.focusY) / scene.size;
    cost += 9 * (dx * dx + dy * dy);
  }
  return cost;
}

/** Фоновый объект стоит поодаль и уходит за край холста; на главные он не заходит. */
function backCost(p: Placed, mains: Placed[], others: Placed[], scene: Scene): number {
  let cost = 0;
  const count = p.mask.count;
  const visible = inside(p, scene.canvas) / count;
  cost += 30 * Math.max(0, 0.45 - visible) ** 2 + 2 * Math.max(0, 0.45 - visible);
  if (scene.keepOut) cost += scene.keepOutWeight * (inside(p, scene.keepOut) / count);

  let covered = 0;
  let nearest = Infinity;
  let mainsY = 0;
  for (const m of mains) {
    covered += overlap(p, m, true);
    mainsY += centerY(m) / mains.length;
    const gap = Math.hypot(centerX(m) - centerX(p), centerY(m) - centerY(p)) - 0.85 * (m.mask.radius + p.mask.radius);
    nearest = Math.min(nearest, gap);
  }
  const hidden = covered / count;
  if (hidden > 0) cost += 6 + 500 * hidden;
  if (nearest !== Infinity) cost += 0.006 * Math.max(0, nearest) ** 2;
  // Задний план в изометрии — выше на экране.
  cost += 5 * Math.max(0, (centerY(p) - mainsY) / scene.size + 0.15);
  for (const o of others) {
    const shared = overlap(p, o, true) / Math.min(count, o.mask.count);
    if (shared > 0) cost += 6 + 500 * shared;
  }
  return cost;
}

const DIRECTIONS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

/** Спуск по координатам: двигаем объекты по одному, пока раскладка улучшается. */
function refine(movable: Placed[], cost: () => number): number {
  let best = cost();
  for (const step of [8, 4, 2, 1]) {
    for (let sweep = 0; sweep < 6; sweep++) {
      let improved = false;
      for (const p of movable) {
        for (const [dx, dy] of DIRECTIONS) {
          p.ox += dx * step;
          p.oy += dy * step;
          const next = cost();
          if (next < best - 1e-9) {
            best = next;
            improved = true;
          } else {
            p.ox -= dx * step;
            p.oy -= dy * step;
          }
        }
      }
      if (!improved) break;
    }
  }
  return best;
}

function scatter(p: Placed, scene: Scene, rand: () => number) {
  const { canvas } = scene;
  const cx = canvas.x0 + rand() * (canvas.x1 - canvas.x0);
  const cy = canvas.y0 + rand() * (canvas.y1 - canvas.y0);
  p.ox = Math.round(cx - p.mask.cx);
  p.oy = Math.round(cy - p.mask.cy);
}

function search(movable: Placed[], scene: Scene, rand: () => number, restarts: number, cost: () => number) {
  let best = Infinity;
  let bestPos: [number, number][] = [];
  for (let r = 0; r < restarts; r++) {
    for (const p of movable) scatter(p, scene, rand);
    const value = refine(movable, cost);
    if (value < best) {
      best = value;
      bestPos = movable.map((p) => [p.ox, p.oy]);
    }
  }
  movable.forEach((p, i) => {
    [p.ox, p.oy] = bestPos[i];
  });
}

/**
 * Автоматическая раскладка. Масштаб объектов не меняется: в примерах библиотеки все объекты
 * стоят в натуральную величину, а крупные обрезаются краем холста. Подбираются только
 * положение и порядок слоёв — перебором с оценкой по реальным силуэтам объектов.
 */
export function compose({ mains, bgs, w, h, mode, seed }: ComposeInput): Item[] {
  const rand = rng(seed);
  const flip = rand() < 0.5 ? -1 : 1;
  const scene = sceneFor(w, h, mode, flip);
  const place = (object: ObjectId): Placed => ({ object, mask: MASKS[object], ox: 0, oy: 0 });

  const front = mains.map(place);
  if (front.length) search(front, scene, rand, front.length === 1 ? 4 : 24, () => mainCost(front, scene));

  const back: Placed[] = [];
  for (const object of bgs) {
    const p = place(object);
    search([p], scene, rand, 16, () => backCost(p, front, back, scene));
    // Фоновый объект необязателен: если чисто встать некуда, композиция обходится без него.
    const clean = [...front, ...back].every((o) => overlap(p, o) === 0);
    if (clean && inside(p, scene.canvas) / p.mask.count >= 0.2) back.push(p);
  }

  const toItem = (p: Placed, role: Item['role']): Item => ({
    id: newId(),
    object: p.object,
    role,
    x: Math.round(p.ox * CELL + p.mask.w / 2),
    y: Math.round(p.oy * CELL + p.mask.h / 2),
    rot: 0,
  });

  // В изометрии ближний объект ниже на экране — он и рисуется последним.
  const ordered = [...front].sort((a, b) => centerY(a) - centerY(b));
  return [...back.map((p) => toItem(p, 'bg')), ...ordered.map((p) => toItem(p, 'main'))];
}

/** Доля меньшего из двух объектов, накрытая другим (поворот не учитывается). Нужна проверкам. */
export function overlapShare(a: Item, b: Item): number {
  const at = (item: Item): Placed => {
    const mask = MASKS[item.object];
    return { object: item.object, mask, ox: Math.round((item.x - mask.w / 2) / CELL), oy: Math.round((item.y - mask.h / 2) / CELL) };
  };
  const pa = at(a);
  const pb = at(b);
  return overlap(pa, pb) / Math.min(pa.mask.count, pb.mask.count);
}
