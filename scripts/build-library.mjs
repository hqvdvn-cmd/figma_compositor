// Превращает SVG, выгруженные из Figma (source/figma), в данные библиотеки.
// Геометрия контуров переносится без изменений: меняется только способ записи цвета —
// вместо hex хранится номер слота палитры, чтобы схему можно было подменить.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'source', 'figma');
const out = join(root, 'src', 'library', 'data');

// Порядок слотов повторяет палитру в Figma: левый столбец — цвета фона, правый — цвета объектов.
const SLOT_OF = {
  '#D7CDF5': 0, // фон 1 (светлый)
  '#AA9BF0': 1, // фон 2 (средний)
  '#7864D7': 2, // фон 3 (тёмный)
  '#181817': 3, // контур
  '#F9ECB0': 4, // объект 1
  '#F9A3AA': 5, // объект 2
  '#FFE3E1': 6, // объект 3
  WHITE: 7, // бумага
  // Второй фон в Figma нарисован в персиковой схеме — приводим его к тем же слотам.
  '#FDD7B9': 0,
  '#FAC896': 1,
  '#D27532': 2,
};

const OBJECTS = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'vase', 'wallet', 'folder', 'pen'];

// В L-размере у книги один контур лежит в Figma рядом с группой, а не внутри неё.
// Возвращаем его на место: смещение = разница абсолютных координат в файле.
const STRAY = { L: { book: { tx: 1026.41, ty: 447.62 } } };

function slot(color, file) {
  const key = color.toLowerCase() === 'white' ? 'WHITE' : color.toUpperCase();
  if (!(key in SLOT_OF)) throw new Error(`${file}: цвет ${color} не входит в палитру`);
  return SLOT_OF[key];
}

function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
}

function read(name) {
  return readFileSync(join(src, `${name}.svg`), 'utf8');
}

function parseArt(name) {
  const svg = read(name);
  const head = attrs(svg.match(/<svg[^>]*>/)[0]);
  const [, , w, h] = head.viewBox.split(' ').map(Number);
  const shapes = [];
  for (const m of svg.matchAll(/<path[^>]*\/>/g)) {
    const a = attrs(m[0]);
    shapes.push([slot(a.fill, name), a.d]);
  }
  if (!shapes.length) throw new Error(`${name}: нет контуров`);
  return { w, h, shapes };
}

function parseDecor(name) {
  const svg = read(name);
  const head = attrs(svg.match(/<svg[^>]*>/)[0]);
  const [, , w, h] = head.viewBox.split(' ').map(Number);
  const body = svg.replace(/<defs>[\s\S]*<\/defs>/, '');
  const els = [];
  let skippedBackground = false;
  for (const m of body.matchAll(/<(path|line|rect)[^>]*\/>/g)) {
    const a = attrs(m[0]);
    if (m[1] === 'rect') {
      // Первый прямоугольник — заливка холста, её рисует сам конструктор.
      if (!skippedBackground) skippedBackground = true;
      continue;
    }
    const el = { k: m[1] };
    if (m[1] === 'path') el.d = a.d;
    else Object.assign(el, { x1: +a.x1, y1: +a.y1, x2: +a.x2, y2: +a.y2 });
    if (a.fill && a.fill !== 'none') el.f = slot(a.fill, name);
    if (a.stroke) {
      el.s = slot(a.stroke, name);
      el.sw = +(a['stroke-width'] ?? 1);
    }
    els.push(el);
  }
  return { w, h, els };
}

mkdirSync(out, { recursive: true });
for (const size of ['L', 'S']) {
  const objects = {};
  for (const id of OBJECTS) {
    objects[id] = {};
    for (const role of ['main', 'bg']) {
      const art = parseArt(`${size}-${role}-${id}`);
      const stray = STRAY[size]?.[id];
      if (stray) {
        const piece = parseArt(`${size}-${role}-stray`);
        art.shapes.unshift([piece.shapes[0][0], piece.shapes[0][1], stray.tx, stray.ty]);
      }
      objects[id][role] = art;
    }
  }
  const data = {
    size,
    unit: size === 'L' ? 1 : 0.5,
    objects,
    decor: { confetti: parseDecor(`${size}-scene-1`), wedge: parseDecor(`${size}-scene-2`) },
  };
  writeFileSync(join(out, `${size}.json`), JSON.stringify(data));
  const count = Object.values(objects).reduce((n, o) => n + o.main.shapes.length + o.bg.shapes.length, 0);
  console.log(`${size}: ${OBJECTS.length} объектов, ${count} контуров`);
}

// Палитры читаем из тех же выгрузок, чтобы значения не расходились с Figma.
const schemes = ['Сиреневая', 'Персиковая', 'Бирюзовая'].map((name, i) => {
  const fills = [...read(`L-palette-${i + 1}`).matchAll(/<rect[^>]*fill="([^"]+)"/g)].map((m) =>
    m[1] === 'white' ? '#FFFFFF' : m[1].toUpperCase(),
  );
  // В файле прямоугольники идут парами «фон, объект» сверху вниз.
  const left = [fills[0], fills[2], fills[4], fills[6]];
  const right = [fills[1], fills[3], fills[5], fills[7]];
  return { id: `figma-${i + 1}`, name, colors: [...left, ...right] };
});
writeFileSync(join(out, 'schemes.json'), JSON.stringify(schemes, null, 2));
console.log('палитры:', schemes.map((s) => s.name).join(', '));
