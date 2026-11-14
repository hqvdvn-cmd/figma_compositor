// Записывает короткую демонстрацию сервиса: запускает браузер, управляет им настоящими
// событиями мыши и клавиатуры через Chrome DevTools Protocol и собирает кадры в mp4.
// Нужны: запущенный `npm run dev`, Edge или Chrome, ffmpeg в PATH.
//   node scripts/record-demo.mjs [url] [путь к браузеру]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://localhost:5173/';
const browser =
  process.argv[3] ??
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(
    existsSync,
  );
const W = 1280;
const H = 800;
const PORT = 9339;

const work = mkdtempSync(join(tmpdir(), 'composer-demo-'));
const frames = join(work, 'frames');
mkdirSync(frames);
const palette = join(work, 'forest.json');
writeFileSync(
  palette,
  JSON.stringify({ name: 'Лесная', background: ['#DDEBD0', '#A9CF8E', '#4F8A4B'], objects: ['#FFE08A', '#FF8F6B', '#FFD9C7'] }),
);

const proc = spawn(browser, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(work, 'profile')}`,
  `--window-size=${W},${H}`,
  '--hide-scrollbars',
  '--disable-gpu',
  '--no-first-run',
  url,
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // браузер ещё поднимается
    }
    await sleep(200);
  }
  throw new Error('браузер не ответил');
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const js = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'ошибка в странице');
  return r.result.value;
};

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: work });
// Пока страница грузится, контекст выполнения может смениться — поэтому опрашиваем с повторами.
for (let i = 0; ; i++) {
  const ready = await js(`!!document.querySelector('.tile:not([disabled])')`).catch(() => false);
  if (ready) break;
  if (i > 150) throw new Error('сервис не загрузился');
  await sleep(200);
}
await sleep(500);

// Курсор и подпись рисуем сами: в headless-режиме системного курсора в кадре нет.
await js(`(() => {
  const cur = document.createElement('div');
  cur.id = 'demo-cursor';
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8.5-6.6 1.6L8.5 19z" fill="#fff" stroke="#17151f" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  cur.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;transform:translate(640px,400px)';
  document.body.appendChild(cur);
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  const cap = document.createElement('div');
  cap.id = 'demo-caption';
  cap.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99998;pointer-events:none;max-width:560px;padding:10px 16px;border-radius:8px;background:rgba(21,20,26,.94);border:1px solid #383744;color:#eeecf5;font:550 15px/1.35 "Onest Variable",sans-serif;text-align:center;opacity:0;transition:opacity .2s';
  document.body.appendChild(cap);
  // Подсказку пустого холста прячем стилем: удалять узел, которым управляет React, нельзя.
  const hide = document.createElement('style');
  hide.textContent = '.empty{display:none}';
  document.head.appendChild(hide);
})()`);

// --- запись кадров ---------------------------------------------------------
let recording = true;
const shots = [];
const recorder = (async () => {
  while (recording) {
    const started = Date.now();
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    const name = `${String(shots.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(frames, name), Buffer.from(data, 'base64'));
    shots.push({ name, at: started });
    await sleep(Math.max(0, 66 - (Date.now() - started)));
  }
})();

// --- действия --------------------------------------------------------------
let mouse = { x: W / 2, y: H / 2 };

async function moveTo(x, y, ms = 450) {
  const steps = Math.max(6, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = t * t * (3 - 2 * t);
    mouse = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouse.x, y: mouse.y, buttons: 0 });
    await sleep(16);
  }
}

async function press(button = 'left') {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button, buttons: 1, clickCount: 1 });
}
async function release(button = 'left') {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button, buttons: 0, clickCount: 1 });
}

async function dragTo(x, y, ms = 900) {
  await press();
  const steps = Math.round(ms / 16);
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = t * t * (3 - 2 * t);
    mouse = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouse.x, y: mouse.y, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await release();
}

/** Центр элемента, найденного выражением; элемент прокручивается в видимую область. */
async function centerOf(finder) {
  const p = await js(`(() => { const el = ${finder}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) {
    const seen = await js(`document.body.innerText.slice(0, 400)`);
    throw new Error(`не найден элемент: ${finder}
на странице: ${seen}`);
  }
  return p;
}
const byText = (text, scope = 'button,label') =>
  `[...document.querySelectorAll(${JSON.stringify(scope)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)})`;

async function click(finder, pause = 500) {
  const p = await centerOf(finder);
  await moveTo(p.x, p.y);
  await sleep(120);
  await press();
  await sleep(60);
  await release();
  await sleep(pause);
}

async function typeText(text) {
  for (const ch of text) {
    await cdp('Input.insertText', { text: ch });
    await sleep(38);
  }
}

async function caption(text) {
  await js(`(() => { const c = document.getElementById('demo-caption'); c.textContent = ${JSON.stringify(text)}; c.style.opacity = ${text ? 1 : 0}; })()`);
  await sleep(350);
}

/** Точка на самом маленьком объекте холста, где он действительно под курсором. */
async function pointOnSmallest() {
  const p = await js(`(() => {
    const area = (e) => { const b = e.getBoundingClientRect(); return b.width * b.height; };
    const el = [...document.querySelectorAll('.stage-item')].sort((a, b) => area(a) - area(b))[0];
    const canvas = document.querySelector('.stage-art').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, canvas.left + 20), x1 = Math.min(r.right, canvas.right - 20);
    const y0 = Math.max(r.top, canvas.top + 20), y1 = Math.min(r.bottom, canvas.bottom - 20);
    let best = null;
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const x = x0 + (x1 - x0) * i / 12, y = y0 + (y1 - y0) * j / 12;
      if (document.elementFromPoint(x, y)?.closest('.stage-item') !== el) continue;
      const d = Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best;
  })()`);
  if (!p) throw new Error('не нашёл точку на объекте');
  return p;
}

try {
  await sleep(600);

  await caption('Сценарий 1. Человек вводит заголовок — сервис подбирает объекты по смыслу');
  await click(`document.querySelector('textarea')`, 300);
  await typeText('Онлайн-оплата покупок: быстро и выгодно');
  await sleep(500);
  await click(byText('Собрать'), 2300);

  await caption('«Другой вариант»: те же объекты, новая раскладка. Объекты не накладываются');
  await click(byText('Другой вариант'), 1900);
  await click(byText('Другой вариант'), 1900);

  await caption('Формат и место под заголовок');
  const sel = await centerOf(`document.querySelector('select')`);
  await moveTo(sel.x, sel.y);
  await js(`(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'wide'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(900);
  await click(byText('Под заголовок'), 500);
  await click(byText('Собрать'), 2300);

  await caption('Цветовая схема: меняются только цвета, контуры те же');
  await click(byText('Персиковая', '.scheme'), 1500);
  await click(byText('Бирюзовая', '.scheme'), 1500);

  await caption('Размер S подгружает упрощённые версии объектов');
  await click(byText('S · упрощённые'), 1700);
  await click(byText('L · детальные'), 1200);

  await caption('Ручная правка: перемещение, поворот, состояние, слои');
  let p = await pointOnSmallest();
  await moveTo(p.x, p.y);
  await dragTo(p.x - 270, p.y - 60);
  await sleep(500);
  const handle = await centerOf(`document.querySelector('.sel-handle')`).catch(() => null);
  if (handle && handle.y > 70 && handle.y < H - 40) {
    await moveTo(handle.x, handle.y);
    await dragTo(handle.x + 110, handle.y + 70);
    await sleep(600);
  }
  await click(byText('Фоновый', '.panel-right label'), 1200);
  await click(byText('Главный', '.panel-right label'), 800);
  await click(byText('Дублировать'), 1100);
  await click(byText('Удалить'), 900);
  await click(byText('Отменить'), 700);
  await click(byText('Отменить'), 900);

  await caption('Сценарий 2. Человек перечисляет названия объектов');
  await click(byText('По названиям'), 400);
  await click(`document.querySelector('textarea')`, 200);
  await js(`document.querySelector('textarea').select()`);
  await typeText('наушники, телефон, ручка');
  await sleep(400);
  await click(byText('По центру'), 400);
  const go = await centerOf(byText('Собрать'));
  await moveTo(go.x, go.y);
  // Формат меняем прямо перед сборкой, чтобы в кадре не висела старая раскладка на новом холсте.
  await js(`(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'tall'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await press();
  await sleep(60);
  await release();
  await sleep(2400);

  await caption('Своя палитра из файла — композиция перекрашивается сразу');
  const loadBtn = await centerOf(byText('Загрузить палитру'));
  await moveTo(loadBtn.x, loadBtn.y);
  const { root: doc } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.nodeId, selector: 'input[type=file]' });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [palette] });
  await sleep(2200);

  await caption('Экспорт: SVG, где каждый объект — отдельная группа исходных контуров');
  await click(byText('Скачать SVG'), 2200);
  await caption('');
  await sleep(500);
} finally {
  recording = false;
  // Последний снимок может не вернуться, если браузер занят загрузкой файла: ждём недолго.
  await Promise.race([recorder, sleep(3000)]);
  ws.close();
  proc.kill();
}

// --- сборка видео ----------------------------------------------------------
const list = shots
  .map((s, i) => {
    const next = shots[i + 1]?.at ?? s.at + 66;
    return `file '${join(frames, s.name).replace(/\\/g, '/')}'\nduration ${((next - s.at) / 1000).toFixed(3)}`;
  })
  .join('\n');
writeFileSync(join(work, 'list.txt'), `${list}\nfile '${join(frames, shots[shots.length - 1].name).replace(/\\/g, '/')}'\n`);
// Видео кладём в public: оно публикуется вместе с сервисом.
mkdirSync(join(root, 'public'), { recursive: true });
const out = join(root, 'public', 'demo.mp4');
const ff = spawnSync(
  'ffmpeg',
  ['-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-vf', 'setpts=PTS/1.5,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out],
  { encoding: 'utf8' },
);
if (ff.status !== 0) {
  console.error(ff.stderr.slice(-800));
  process.exit(1);
}
const seconds = (shots[shots.length - 1].at - shots[0].at) / 1000;
console.log(`кадров: ${shots.length}, длительность: ${seconds.toFixed(1)} с, файл: ${out}`);
try {
  rmSync(work, { recursive: true, force: true });
} catch {
  // профиль браузера может ещё освобождаться
}
process.exit(0);
