export const OBJECT_IDS = [
  'book',
  'phone',
  'puzzle',
  'coin',
  'headphones',
  'lamp',
  'vase',
  'wallet',
  'folder',
  'pen',
] as const;
export type ObjectId = (typeof OBJECT_IDS)[number];

/** Главный объект цветной, фоновый — монохромный. Оба берутся из библиотеки как есть. */
export type Role = 'main' | 'bg';
export type SizeId = 'L' | 'S';
export type DecorId = 'none' | 'confetti' | 'wedge';

/** Контур: [слот палитры, геометрия, необязательное смещение x, y]. */
export type Shape = [slot: number, d: string, tx?: number, ty?: number];

export interface Art {
  w: number;
  h: number;
  shapes: Shape[];
}

export type DecorEl =
  | { k: 'path'; d: string; f?: number; s?: number; sw?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; s: number; sw: number };

export interface Decor {
  w: number;
  h: number;
  els: DecorEl[];
}

export interface LibraryData {
  size: SizeId;
  /** Во сколько раз координаты этого размера меньше базовых (L = 1, S = 0.5). */
  unit: number;
  objects: Record<ObjectId, Record<Role, Art>>;
  decor: Record<Exclude<DecorId, 'none'>, Decor>;
}

/**
 * Восемь слотов: 0–2 цвета фона (светлый, средний, тёмный), 3 контур,
 * 4–6 цвета объектов, 7 бумага. Фон холста и декор берут только слоты 0–2 и 7.
 */
export interface Scheme {
  id: string;
  name: string;
  colors: string[];
}

export interface Item {
  id: string;
  object: ObjectId;
  role: Role;
  /** Центр объекта в базовых единицах холста (как в размере L). */
  x: number;
  y: number;
  /** Поворот в градусах. Масштаба нет намеренно: пропорции объектов между собой фиксированы. */
  rot: number;
}

export interface Doc {
  /** Размер холста в базовых единицах. */
  w: number;
  h: number;
  size: SizeId;
  schemeId: string;
  decor: DecorId;
  /** Порядок массива — порядок слоёв: первый элемент лежит ниже всех. */
  items: Item[];
}

export type LayoutMode = 'center' | 'offset' | 'headline';
