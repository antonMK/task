// Persistencia: toda la base de datos vive en una sola clave de chrome.storage.local.
// Sin chrome.storage (p. ej. al previsualizar la página en un servidor local) usa localStorage.

import { DEFAULT_SETTINGS, LEGACY_TAG_COLORS, mergeDB } from './core.js';

export const KEY = 'gt_db';

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const listeners = new Set();

const emptyDB = () => ({ v: 1, tasks: [], tags: [], settings: { ...DEFAULT_SETTINGS }, meta: {} });

export function normalize(raw) {
  const db = raw && typeof raw === 'object' ? raw : emptyDB();
  db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
  db.tags = Array.isArray(db.tags) ? db.tags : [];
  db.meta = db.meta && typeof db.meta === 'object' ? db.meta : {};
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  for (const tag of db.tags) tag.color = LEGACY_TAG_COLORS[String(tag.color).toLowerCase()] || tag.color;
  for (const t of db.tasks) {
    t.steps = Array.isArray(t.steps) ? t.steps : [];
    t.log = Array.isArray(t.log) ? t.log : [];
    t.tags = Array.isArray(t.tags) ? t.tags : [];
    if (t.remind === undefined) t.remind = 'auto';
    if (t.parentId === undefined) t.parentId = null;
    if (t.priority === undefined) t.priority = 0;
    if (t.repeat === undefined) t.repeat = null;
  }
  return db;
}

async function rawGet() {
  if (hasChrome) return (await chrome.storage.local.get(KEY))[KEY];
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return undefined;
  }
}

async function rawSet(db) {
  if (hasChrome) return chrome.storage.local.set({ [KEY]: db });
  localStorage.setItem(KEY, JSON.stringify(db));
}

let chain = Promise.resolve();
function withLock(fn) {
  // Web Locks serializa también entre popup, pestaña y service worker.
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request(KEY, fn);
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export async function load() {
  return normalize(await rawGet());
}

/**
 * Lee la base de datos, ejecuta `fn(db)` (que la modifica en el sitio) y guarda
 * solo si hubo cambios. Devuelve lo que devuelva `fn`.
 */
export function mutate(fn) {
  return withLock(async () => {
    const db = await load();
    const before = JSON.stringify(db);
    const result = await fn(db);
    if (JSON.stringify(db) !== before) {
      await rawSet(db);
      if (!hasChrome) emit(db);
    }
    return result;
  });
}

export async function replaceAll(raw) {
  return withLock(async () => {
    const db = normalize(raw);
    await rawSet(db);
    if (!hasChrome) emit(db);
  });
}

/** Combina una copia de datos de otro dispositivo con la actual (ver mergeDB). Devuelve { added, updated, removed }. */
export function mergeIn(raw) {
  return mutate((db) => mergeDB(db, normalize(structuredClone(raw))));
}

function emit(db) {
  listeners.forEach((cb) => cb(normalize(structuredClone(db))));
}

/** Avisa cuando cambian los datos (desde cualquier contexto). Devuelve la función para cancelar. */
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (hasChrome) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) emit(changes[KEY].newValue ?? emptyDB());
  });
} else if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) emit(JSON.parse(e.newValue));
  });
}
