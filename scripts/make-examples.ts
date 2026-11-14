// Собирает примеры композиций тем же кодом, что и сервис: текст → подбор → раскладка → SVG.
import { mkdirSync, writeFileSync } from 'node:fs';
import L from '../src/library/data/L.json';
import S from '../src/library/data/S.json';
import { compose } from '../src/model/composer';
import { matchByNames, pickByMeaning } from '../src/model/matcher';
import { BUILTIN_SCHEMES } from '../src/model/palette';
import { renderSvg } from '../src/model/render';
import type { DecorId, Doc, LayoutMode, LibraryData, ObjectId, SizeId } from '../src/model/types';

const libs = { L: L as unknown as LibraryData, S: S as unknown as LibraryData };

interface Example {
  file: string;
  text: string;
  by: 'meaning' | 'names';
  w: number;
  h: number;
  size: SizeId;
  scheme: number;
  decor: DecorId;
  mode: LayoutMode;
  bg: ObjectId[];
  seed: number;
}

const examples: Example[] = [
  { file: '1-money-for-study', text: 'Как копить деньги на обучение', by: 'meaning', w: 1000, h: 1000, size: 'L', scheme: 0, decor: 'confetti', mode: 'center', bg: ['lamp'], seed: 4 },
  { file: '2-online-payment', text: 'Онлайн-оплата покупок: быстро и выгодно', by: 'meaning', w: 1200, h: 630, size: 'L', scheme: 1, decor: 'wedge', mode: 'headline', bg: ['book'], seed: 2 },
  { file: '3-podcast', text: 'наушники, телефон, ручка', by: 'names', w: 800, h: 1200, size: 'S', scheme: 2, decor: 'confetti', mode: 'center', bg: ['vase'], seed: 5 },
];

mkdirSync('examples', { recursive: true });
for (const ex of examples) {
  const mains =
    ex.by === 'meaning'
      ? pickByMeaning(ex.text).map((m) => m.object)
      : matchByNames(ex.text).objects;
  const doc: Doc = {
    w: ex.w,
    h: ex.h,
    size: ex.size,
    schemeId: BUILTIN_SCHEMES[ex.scheme].id,
    decor: ex.decor,
    items: compose({ mains, bgs: ex.bg, w: ex.w, h: ex.h, mode: ex.mode, seed: ex.seed }),
  };
  writeFileSync(`examples/${ex.file}.svg`, renderSvg(doc, libs[ex.size], BUILTIN_SCHEMES[ex.scheme], ex.text));
  console.log(`${ex.file}: «${ex.text}» → ${mains.join(', ')}`);
}
