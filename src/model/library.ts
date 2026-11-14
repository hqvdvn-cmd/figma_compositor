import type { LibraryData, ObjectId, SizeId } from './types';

const cache = new Map<SizeId, Promise<LibraryData>>();

/** Наборы L и S лежат в отдельных чанках: грузится только выбранный размер. */
export function loadLibrary(size: SizeId): Promise<LibraryData> {
  let pending = cache.get(size);
  if (!pending) {
    pending = (size === 'L' ? import('../library/data/L.json') : import('../library/data/S.json')).then(
      (m) => m.default as unknown as LibraryData,
    );
    cache.set(size, pending);
  }
  return pending;
}

/** Габариты объектов в базовых единицах — нужны раскладке до загрузки самих контуров. */
export const OBJECT_BOX: Record<ObjectId, { w: number; h: number }> = {
  book: { w: 1446, h: 977 },
  phone: { w: 797, h: 462 },
  puzzle: { w: 544, h: 314 },
  coin: { w: 287, h: 189 },
  headphones: { w: 888, h: 692 },
  lamp: { w: 946, h: 1129 },
  vase: { w: 591, h: 747 },
  wallet: { w: 630, h: 396 },
  folder: { w: 1241, h: 659 },
  pen: { w: 508, h: 285 },
};

export const OBJECT_LABEL: Record<ObjectId, string> = {
  book: 'Книга',
  phone: 'Телефон',
  puzzle: 'Пазл',
  coin: 'Монета',
  headphones: 'Наушники',
  lamp: 'Лампа',
  vase: 'Ваза с цветами',
  wallet: 'Кошелёк',
  folder: 'Папка',
  pen: 'Ручка',
};

export const FORMATS = [
  { id: 'square', label: 'Квадрат', w: 1000, h: 1000 },
  { id: 'wide', label: 'Горизонталь', w: 1200, h: 630 },
  { id: 'tall', label: 'Вертикаль', w: 800, h: 1200 },
] as const;
