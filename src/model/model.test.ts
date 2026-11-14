import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import L from '../library/data/L.json';
import S from '../library/data/S.json';
import { compose, overlapShare } from './composer';
import { OBJECT_BOX } from './library';
import { matchByMeaning, matchByNames, pickByMeaning } from './matcher';
import { BUILTIN_SCHEMES, parsePaletteFile, schemeToJson } from './palette';
import { renderSvg } from './render';
import { OBJECT_IDS, type Doc, type LibraryData, type ObjectId } from './types';

const libL = L as unknown as LibraryData;
const libS = S as unknown as LibraryData;

describe('библиотека', () => {
  it('геометрия контуров совпадает с выгрузкой из Figma', () => {
    for (const id of OBJECT_IDS) {
      for (const role of ['main', 'bg'] as const) {
        const source = readFileSync(`source/figma/L-${role}-${id}.svg`, 'utf8');
        const sourcePaths = [...source.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
        const own = libL.objects[id][role].shapes.filter((s) => s[2] === undefined).map((s) => s[1]);
        expect(own).toEqual(sourcePaths);
      }
    }
  });

  it('габариты для раскладки соответствуют реальным объектам', () => {
    for (const id of OBJECT_IDS) {
      expect(Math.abs(libL.objects[id].main.w - OBJECT_BOX[id].w)).toBeLessThan(2);
      // Ваза в S нарисована чуть крупнее половины L — берём её как есть, отсюда допуск.
      expect(Math.abs(libS.objects[id].main.w * 2 - OBJECT_BOX[id].w) / OBJECT_BOX[id].w).toBeLessThan(0.1);
    }
  });

  it('фоновые объекты монохромны: только цвета фона', () => {
    for (const id of OBJECT_IDS) {
      for (const [slot] of libL.objects[id].bg.shapes) expect(slot).toBeLessThanOrEqual(2);
    }
  });
});

describe('подбор объектов', () => {
  it('находит объекты по смыслу заголовка', () => {
    const ranked = matchByMeaning('Как копить деньги на обучение').map((m) => m.object);
    expect(ranked).toContain('coin');
    expect(ranked).toContain('book');
  });

  it('прямое название объекта побеждает смыслы', () => {
    expect(matchByMeaning('наушники для работы')[0].object).toBe('headphones');
  });

  it('не выдумывает совпадения', () => {
    expect(matchByMeaning('абракадабра')).toEqual([]);
    expect(matchByMeaning('центр города').map((m) => m.object)).not.toContain('coin');
  });

  it('понимает разные формулировки', () => {
    const cases: [string, ObjectId][] = [
      ['Оплата по подписке без комиссии', 'wallet'],
      ['Сколько стоит ипотека в этом году', 'coin'],
      ['Подпишите договор за пять минут', 'pen'],
      ['Плейлист для спокойного вечера', 'headphones'],
      ['Мозговой штурм: десять свежих идей', 'lamp'],
      ['Поздравляем с днём рождения', 'vase'],
      ['Наведите порядок в отчётности', 'folder'],
      ['Как устроена наша экосистема', 'puzzle'],
      ['Скачайте приложение и следите за заказом', 'phone'],
      ['Чему учиться в этом семестре', 'book'],
    ];
    for (const [text, object] of cases) {
      expect(pickByMeaning(text).map((m) => m.object), text).toContain(object);
    }
  });

  it('не путает похожие слова', () => {
    // «подписка» не подпись, «платформа» не платёж, «копия» не накопления, «центр» не цена.
    expect(matchByMeaning('подписка на платформу').map((m) => m.object)).not.toContain('pen');
    expect(matchByMeaning('копия платья в центре')).toEqual([]);
  });

  it('разбирает перечисление названий', () => {
    const parsed = matchByNames('лампа, наушники, ваза с цветами и самолёт');
    expect(parsed.objects).toEqual(['lamp', 'headphones', 'vase']);
    expect(parsed.unknown).toEqual(['самолет']);
  });
});

describe('палитра', () => {
  it('читает JSON и возвращает восемь слотов', () => {
    const [scheme] = parsePaletteFile(
      JSON.stringify({ name: 'Тест', background: ['#111', '#222222', '#333333'], objects: ['#444444', '#555555', '#666666'] }),
      'p.json',
    );
    expect(scheme.colors).toEqual(['#111111', '#222222', '#333333', '#181817', '#444444', '#555555', '#666666', '#FFFFFF']);
  });

  it('читает SVG-палитру из Figma', () => {
    const [scheme] = parsePaletteFile(readFileSync('source/figma/L-palette-3.svg', 'utf8'), 'teal.svg');
    expect(scheme.colors).toEqual(BUILTIN_SCHEMES[2].colors);
  });

  it('образец палитры читается обратно', () => {
    const [scheme] = parsePaletteFile(schemeToJson(BUILTIN_SCHEMES[1]), 'x.json');
    expect(scheme.colors).toEqual(BUILTIN_SCHEMES[1].colors);
  });

  it('объясняет ошибку в файле', () => {
    expect(() => parsePaletteFile('{"background":["#111"],"objects":[]}', 'p.json')).toThrow(/по три цвета/);
    expect(() => parsePaletteFile('не json', 'p.json')).toThrow(/JSON или SVG/);
  });
});

describe('раскладка и экспорт', () => {
  const doc = (schemeId: string): Doc => ({
    w: 1200,
    h: 630,
    size: 'L',
    schemeId,
    decor: 'confetti',
    items: compose({ mains: ['phone', 'coin', 'wallet'], bgs: ['lamp'], w: 1200, h: 630, mode: 'headline', seed: 7 }),
  });

  it('одно зерно — одна раскладка, фоновый объект лежит ниже главных', () => {
    const a = compose({ mains: ['phone', 'coin'], bgs: ['lamp'], w: 1000, h: 1000, mode: 'center', seed: 3 });
    const b = compose({ mains: ['phone', 'coin'], bgs: ['lamp'], w: 1000, h: 1000, mode: 'center', seed: 3 });
    expect(a.map(({ id: _id, ...rest }) => rest)).toEqual(b.map(({ id: _id, ...rest }) => rest));
    expect(a.findIndex((i) => i.role === 'bg')).toBeLessThanOrEqual(0);
  });

  it('главные объекты стоят рядом, а не лежат друг на друге', () => {
    const sets: ObjectId[][] = [
      ['headphones', 'phone'],
      ['coin', 'book'],
      ['wallet', 'coin', 'folder'],
      ['vase', 'pen', 'coin'],
      ['puzzle', 'pen', 'phone'],
    ];
    const formats = [
      [1000, 1000],
      [1200, 630],
      [800, 1200],
    ];
    for (const mains of sets) {
      for (const [w, h] of formats) {
        for (const seed of [1, 2, 3]) {
          // Фоновый объект тоже не должен ложиться под главные; если места нет, его просто не будет.
          const items = compose({ mains, bgs: ['lamp'], w, h, mode: 'center', seed });
          expect(items.filter((i) => i.role === 'main')).toHaveLength(mains.length);
          for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
              expect(overlapShare(items[i], items[j]), `${mains.join('+')} ${w}×${h} #${seed}`).toBe(0);
            }
          }
        }
      }
    }
  });

  it('под заголовок: слева остаётся свободное место', () => {
    const items = compose({ mains: ['phone', 'coin', 'pen'], bgs: [], w: 1200, h: 630, mode: 'headline', seed: 7 });
    for (const item of items) {
      expect(item.x - OBJECT_BOX[item.object].w / 2).toBeGreaterThanOrEqual(0.36 * 1200);
    }
  });

  it('экспорт остаётся вектором и сохраняет все контуры', () => {
    const d = doc('figma-1');
    const svg = renderSvg(d, libL, BUILTIN_SCHEMES[0]);
    expect(svg).not.toMatch(/<image|<foreignObject|<filter|base64/);
    const expected = d.items.reduce((n, i) => n + libL.objects[i.object][i.role].shapes.length, 0);
    const decorPaths = libL.decor.confetti.els.filter((e) => e.k === 'path').length;
    expect((svg.match(/<path /g) ?? []).length).toBe(expected + decorPaths);
    expect((svg.match(/<g id="[a-z]+-(main|bg)-\d+"/g) ?? []).length).toBe(d.items.length);
  });

  it('смена схемы меняет только цвета', () => {
    const d = doc('figma-1');
    const strip = (s: string) => s.replace(/#[0-9A-F]{6}/g, '#');
    const a = renderSvg(d, libL, BUILTIN_SCHEMES[0]);
    const b = renderSvg(d, libL, BUILTIN_SCHEMES[2]);
    expect(a).not.toBe(b);
    expect(strip(a)).toBe(strip(b));
    expect(b).not.toContain(BUILTIN_SCHEMES[0].colors[0]);
  });
});
