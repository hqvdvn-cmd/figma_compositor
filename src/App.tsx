import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compose, newId, overlapShare } from './model/composer';
import { FORMATS, loadLibrary, OBJECT_BOX, OBJECT_LABEL } from './model/library';
import { LEXICON, matchByNames, pickByMeaning } from './model/matcher';
import { BUILTIN_SCHEMES, parsePaletteFile, schemeToJson, SLOT_LABELS } from './model/palette';
import { artMarkup, renderSvg } from './model/render';
import {
  OBJECT_IDS,
  type DecorId,
  type Doc,
  type Item,
  type LayoutMode,
  type LibraryData,
  type ObjectId,
  type Role,
  type Scheme,
  type SizeId,
} from './model/types';
import { Segmented } from './ui/Segmented';
import { Stage } from './ui/Stage';
import { useEditor } from './useEditor';

const STORAGE_KEY = 'illustration-composer.palettes';
const BACKDROP_POOL: ObjectId[] = ['lamp', 'vase', 'book', 'headphones', 'folder'];

const INITIAL: Doc = { w: 1000, h: 1000, size: 'L', schemeId: 'figma-1', decor: 'confetti', items: [] };

interface Pick {
  object: ObjectId;
  why: string;
}

function loadCustomSchemes(): Scheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => Array.isArray(s?.colors) && s.colors.length === 8) : [];
  } catch {
    return [];
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const editor = useEditor(INITIAL);
  const { doc, commit, replace, checkpoint, undo, redo } = editor;
  const [lib, setLib] = useState<LibraryData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Scheme[]>(loadCustomSchemes);
  const [paletteError, setPaletteError] = useState('');

  const [scenario, setScenario] = useState<'meaning' | 'names'>('meaning');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<LayoutMode>('center');
  const [withBackdrop, setWithBackdrop] = useState(true);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [note, setNote] = useState('');
  const [layoutNote, setLayoutNote] = useState('');
  const [addRole, setAddRole] = useState<Role>('main');
  const seed = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    loadLibrary(doc.size).then((data) => alive && setLib(data));
    return () => {
      alive = false;
    };
  }, [doc.size]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  }, [custom]);

  const schemes = useMemo(() => [...BUILTIN_SCHEMES, ...custom], [custom]);
  const scheme = schemes.find((s) => s.id === doc.schemeId) ?? schemes[0];
  const selected = doc.items.find((i) => i.id === selectedId) ?? null;

  const patchItem = useCallback(
    (id: string, patch: Partial<Item>, history: boolean) => {
      const fn = (d: Doc): Doc => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
      if (history) commit(fn);
      else replace(fn);
    },
    [commit, replace],
  );

  const removeItem = useCallback(
    (id: string) => {
      commit((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
      setSelectedId(null);
    },
    [commit],
  );

  const duplicateItem = useCallback(
    (id: string) => {
      const copyId = newId();
      commit((d) => {
        const index = d.items.findIndex((i) => i.id === id);
        if (index < 0) return d;
        const src = d.items[index];
        const copy = { ...src, id: copyId, x: src.x + 40, y: src.y + 40 };
        return { ...d, items: [...d.items.slice(0, index + 1), copy, ...d.items.slice(index + 1)] };
      });
      setSelectedId(copyId);
    },
    [commit],
  );

  const reorder = useCallback(
    (id: string, delta: number) => {
      commit((d) => {
        const from = d.items.findIndex((i) => i.id === id);
        const to = Math.min(d.items.length - 1, Math.max(0, from + delta));
        if (from < 0 || from === to) return d;
        const items = [...d.items];
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        return { ...d, items };
      });
    },
    [commit],
  );

  const addObject = (object: ObjectId) => {
    const id = newId();
    const shift = (doc.items.length % 5) * 30;
    const item: Item = { id, object, role: addRole, x: doc.w / 2 + shift, y: doc.h / 2 + shift, rot: 0 };
    // Фоновый объект встаёт под главные, главный — поверх всего.
    commit((d) => ({ ...d, items: addRole === 'bg' ? [item, ...d.items] : [...d.items, item] }));
    setSelectedId(id);
  };

  const build = (list: Pick[], nextSeed: number) => {
    const mains = list.map((p) => p.object);
    const used = new Set(mains);
    const pool = BACKDROP_POOL.filter((o) => !used.has(o));
    const bgs = withBackdrop && pool.length ? [pool[nextSeed % pool.length]] : [];
    const items = compose({ mains, bgs, w: doc.w, h: doc.h, mode, seed: nextSeed });
    commit((d) => ({ ...d, items }));
    setSelectedId(null);
    // Раскладка не накладывает объекты друг на друга. Если места не хватило, говорим об этом прямо.
    const crowded = items.some((a, i) => items.slice(i + 1).some((b) => overlapShare(a, b) > 0));
    const notes: string[] = [];
    if (crowded) notes.push('На этом формате объекты не помещаются без наложения. Уберите один из них или раздвиньте вручную.');
    if (bgs.length && !items.some((i) => i.role === 'bg')) notes.push('Фоновому объекту не хватило места, композиция собрана без него.');
    setLayoutNote(notes.join(' '));
  };

  const runCompose = () => {
    const text = query.trim();
    if (!text) {
      setNote(scenario === 'meaning' ? 'Введите метафору или заголовок.' : 'Перечислите названия объектов.');
      return;
    }
    let list: Pick[] = [];
    if (scenario === 'meaning') {
      const ranked = pickByMeaning(text);
      if (!ranked.length) {
        setPicks([]);
        setNote('В словаре смыслов нет совпадений с этим текстом. Перечислите объекты по названиям или добавьте их из библиотеки.');
        return;
      }
      list = ranked.map((m) => ({ object: m.object, why: `по словам: ${m.hits.join(', ')}` }));
      setNote('');
    } else {
      const parsed = matchByNames(text);
      if (!parsed.objects.length) {
        setPicks([]);
        setNote(`Не узнал ни одного названия. В библиотеке есть: ${OBJECT_IDS.map((o) => OBJECT_LABEL[o].toLowerCase()).join(', ')}.`);
        return;
      }
      list = parsed.objects.map((object) => ({ object, why: 'по названию' }));
      setNote(parsed.unknown.length ? `Не нашёл в библиотеке: ${parsed.unknown.join(', ')}.` : '');
    }
    setPicks(list);
    seed.current += 1;
    build(list, seed.current);
  };

  const reshuffle = () => {
    seed.current += 1;
    build(picks, seed.current);
  };

  const onPaletteFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parsePaletteFile(await file.text(), file.name);
      setCustom((list) => [...list, ...parsed]);
      commit((d) => ({ ...d, schemeId: parsed[0].id }));
      setPaletteError('');
    } catch (err) {
      setPaletteError(err instanceof Error ? err.message : 'Не удалось прочитать файл палитры.');
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const removeScheme = (id: string) => {
    setCustom((list) => list.filter((s) => s.id !== id));
    if (doc.schemeId === id) commit((d) => ({ ...d, schemeId: BUILTIN_SCHEMES[0].id }));
  };

  const exportSvg = () => {
    if (!lib) return;
    const title = query.trim() || 'Композиция';
    download(`composition-${doc.w}x${doc.h}-${doc.size}.svg`, renderSvg(doc, lib, scheme, title), 'image/svg+xml');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.closest('textarea, select, input:not([type="radio"]):not([type="checkbox"])')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }
      if (!selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeItem(selectedId);
      } else if (mod && e.code === 'KeyD') {
        e.preventDefault();
        duplicateItem(selectedId);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (e.code === 'BracketRight') {
        reorder(selectedId, 1);
      } else if (e.code === 'BracketLeft') {
        reorder(selectedId, -1);
      } else if (e.key.startsWith('Arrow') && !target.closest('input')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit((d) => ({
          ...d,
          items: d.items.map((i) => (i.id === selectedId ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
        }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, undo, redo, removeItem, duplicateItem, reorder, commit]);

  const format = FORMATS.find((f) => f.w === doc.w && f.h === doc.h);
  const selectedIndex = selected ? doc.items.indexOf(selected) : -1;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Конструктор иллюстраций</h1>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={undo} disabled={!editor.canUndo}>
            Отменить
          </button>
          <button type="button" className="btn" onClick={redo} disabled={!editor.canRedo}>
            Вернуть
          </button>
          <button type="button" className="btn btn-primary" onClick={exportSvg} disabled={!lib || !doc.items.length}>
            Скачать SVG
          </button>
        </div>
      </header>

      <aside className="panel panel-left" aria-label="Сборка и библиотека">
        <section className="block">
          <h2>Собрать автоматически</h2>
          <Segmented
            label="Способ подбора"
            value={scenario}
            onChange={(v) => {
              setScenario(v);
              setNote('');
            }}
            options={[
              { value: 'meaning', label: 'По смыслу' },
              { value: 'names', label: 'По названиям' },
            ]}
          />
          <label className="field">
            <span>{scenario === 'meaning' ? 'Метафора или заголовок' : 'Названия объектов'}</span>
            <textarea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCompose();
              }}
              placeholder={
                scenario === 'meaning' ? 'Например: как копить деньги на обучение' : 'Например: лампа, наушники, телефон'
              }
            />
          </label>
          <Segmented
            label="Раскладка"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'center', label: 'По центру' },
              { value: 'offset', label: 'Сбоку' },
              { value: 'headline', label: 'Под заголовок' },
            ]}
          />
          <label className="check">
            <input type="checkbox" checked={withBackdrop} onChange={(e) => setWithBackdrop(e.target.checked)} />
            <span>Добавить фоновый объект</span>
          </label>
          <div className="row">
            <button type="button" className="btn btn-primary grow" onClick={runCompose}>
              Собрать
            </button>
            <button type="button" className="btn" onClick={reshuffle} disabled={!picks.length}>
              Другой вариант
            </button>
          </div>
          <div aria-live="polite">
            {note && <p className="note">{note}</p>}
            {layoutNote && <p className="note">{layoutNote}</p>}
            {picks.length > 0 && (
              <ul className="picks">
                {picks.map((p, i) => (
                  <li key={`${p.object}-${i}`}>
                    <strong>{OBJECT_LABEL[p.object]}</strong>
                    <span>
                      {LEXICON[p.object].meaning} — {p.why}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="block">
          <h2>Библиотека</h2>
          <Segmented
            label="Добавлять как"
            value={addRole}
            onChange={setAddRole}
            options={[
              { value: 'main', label: 'Главный' },
              { value: 'bg', label: 'Фоновый' },
            ]}
          />
          <div className="library">
            {OBJECT_IDS.map((object) => (
              <button type="button" key={object} className="tile" onClick={() => addObject(object)} disabled={!lib}>
                <Thumb lib={lib} object={object} role={addRole} scheme={scheme} />
                <span>{OBJECT_LABEL[object]}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        {lib ? (
          <Stage
            doc={doc}
            lib={lib}
            scheme={scheme}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onGestureStart={checkpoint}
            onChange={(id, patch) => patchItem(id, patch, false)}
          />
        ) : (
          <p className="loading">Загружаю библиотеку…</p>
        )}
        {lib && doc.items.length === 0 && (
          <p className="empty">
            Холст пуст. Опишите смысл слева и нажмите «Собрать» или добавьте объекты из библиотеки.
          </p>
        )}
      </main>

      <aside className="panel panel-right" aria-label="Настройки холста и объекта">
        <section className="block">
          <h2>Холст</h2>
          <label className="field">
            <span>Формат</span>
            <select
              value={format?.id ?? ''}
              onChange={(e) => {
                const f = FORMATS.find((x) => x.id === e.target.value);
                if (f) commit((d) => ({ ...d, w: f.w, h: f.h }));
              }}
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} · {f.w * (doc.size === 'L' ? 1 : 0.5)} × {f.h * (doc.size === 'L' ? 1 : 0.5)}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Размер иллюстраций"
            value={doc.size}
            onChange={(size: SizeId) => commit((d) => ({ ...d, size }))}
            options={[
              { value: 'L', label: 'L · детальные' },
              { value: 'S', label: 'S · упрощённые' },
            ]}
          />
          <Segmented
            label="Декор фона"
            value={doc.decor}
            onChange={(decor: DecorId) => commit((d) => ({ ...d, decor }))}
            options={[
              { value: 'none', label: 'Нет' },
              { value: 'confetti', label: 'Конфетти' },
              { value: 'wedge', label: 'Клин' },
            ]}
          />
        </section>

        <section className="block">
          <h2>Цветовая схема</h2>
          <div className="schemes" role="radiogroup" aria-label="Цветовая схема">
            {schemes.map((s) => (
              <div key={s.id} className="scheme-row">
                <label className={`scheme ${s.id === scheme.id ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="scheme"
                    checked={s.id === scheme.id}
                    onChange={() => commit((d) => ({ ...d, schemeId: s.id }))}
                  />
                  <span className="swatches" aria-hidden="true">
                    {s.colors.map((c, i) => (
                      <i key={i} style={{ background: c }} title={`${SLOT_LABELS[i]}: ${c}`} />
                    ))}
                  </span>
                  <span className="scheme-name">{s.name}</span>
                </label>
                {s.id.startsWith('custom-') && (
                  <button type="button" className="btn btn-quiet" onClick={() => removeScheme(s.id)} aria-label={`Удалить палитру ${s.name}`}>
                    Удалить
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn grow" onClick={() => fileInput.current?.click()}>
              Загрузить палитру
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => download('palette-example.json', schemeToJson(scheme), 'application/json')}
            >
              Образец
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.svg,application/json,image/svg+xml"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Файл палитры"
            onChange={(e) => onPaletteFile(e.target.files?.[0])}
          />
          <p className="hint">JSON с тремя цветами фона и тремя цветами объектов или SVG-палитра из Figma.</p>
          {paletteError && (
            <p className="note note-error" role="alert">
              {paletteError}
            </p>
          )}
        </section>

        {selected && (
          <section className="block">
            <h2>{OBJECT_LABEL[selected.object]}</h2>
            <Segmented
              label="Состояние"
              value={selected.role}
              onChange={(role: Role) => patchItem(selected.id, { role }, true)}
              options={[
                { value: 'main', label: 'Главный' },
                { value: 'bg', label: 'Фоновый' },
              ]}
            />
            <div className="coords">
              <NumberField label="X" value={selected.x} onChange={(x) => patchItem(selected.id, { x }, true)} />
              <NumberField label="Y" value={selected.y} onChange={(y) => patchItem(selected.id, { y }, true)} />
              <NumberField label="Поворот, °" value={selected.rot} onChange={(rot) => patchItem(selected.id, { rot }, true)} />
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={() => reorder(selected.id, 1)} disabled={selectedIndex === doc.items.length - 1}>
                Выше
              </button>
              <button type="button" className="btn" onClick={() => reorder(selected.id, -1)} disabled={selectedIndex === 0}>
                Ниже
              </button>
              <button type="button" className="btn" onClick={() => duplicateItem(selected.id)}>
                Дублировать
              </button>
              <button type="button" className="btn btn-danger" onClick={() => removeItem(selected.id)}>
                Удалить
              </button>
            </div>
          </section>
        )}

        <section className="block">
          <h2>Слои</h2>
          {doc.items.length === 0 ? (
            <p className="hint">Пока нет объектов.</p>
          ) : (
            <ol className="layers">
              {[...doc.items].reverse().map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`layer ${item.id === selectedId ? 'is-active' : ''}`}
                    aria-pressed={item.id === selectedId}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>{OBJECT_LABEL[item.object]}</span>
                    <span className="layer-role">{item.role === 'main' ? 'главный' : 'фоновый'}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function Thumb({ lib, object, role, scheme }: { lib: LibraryData | null; object: ObjectId; role: Role; scheme: Scheme }) {
  const html = useMemo(
    () => (lib ? artMarkup(lib.objects[object][role], scheme.colors) : ''),
    [lib, object, role, scheme],
  );
  const art = lib?.objects[object][role];
  const box = art ?? OBJECT_BOX[object];
  return (
    <span className="thumb" style={{ background: scheme.colors[0] }}>
      <svg viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
    </span>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.round(v));
        }}
      />
    </label>
  );
}
