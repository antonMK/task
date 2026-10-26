// Lógica pura (sin DOM ni chrome.*): fechas, tareas, cronómetro, recordatorios y entrada rápida.
// La comparten la interfaz, el service worker y los tests.

export const PRIORITIES = [
  { value: 3, label: 'Alta' },
  { value: 2, label: 'Media' },
  { value: 1, label: 'Baja' },
  { value: 0, label: 'Sin prioridad' },
];

// Colores del sistema de Apple (azul, verde, naranja, morado, rosa, turquesa, índigo, rojo)
export const TAG_COLORS = ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#30b0c7', '#5856d6', '#ff3b30'];
// Paleta anterior → equivalente de Apple del mismo tono (se migra al cargar)
export const LEGACY_TAG_COLORS = {
  '#5b5bd6': '#5856d6',
  '#12a594': '#30b0c7',
  '#f76b15': '#ff9500',
  '#0091ff': '#007aff',
  '#30a46c': '#34c759',
  '#8e4ec6': '#af52de',
  '#d6409f': '#ff2d55',
  '#e5484d': '#ff3b30',
};

export const REMIND_OPTIONS = [
  { value: null, label: 'Sin recordatorio' },
  { value: 0, label: 'A la hora' },
  { value: 5, label: '5 min antes' },
  { value: 10, label: '10 min antes' },
  { value: 15, label: '15 min antes' },
  { value: 30, label: '30 min antes' },
  { value: 60, label: '1 h antes' },
  { value: 1440, label: '1 día antes' },
];

export const ESTIMATE_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

export const REPEAT_OPTIONS = [
  { value: null, label: 'No se repite' },
  { value: 'daily', label: 'Cada día' },
  { value: 'weekly', label: 'Cada semana' },
  { value: 'monthly', label: 'Cada mes' },
];
export const repeatLabel = (v) => REPEAT_OPTIONS.find((o) => o.value === v)?.label || '';

export const DEFAULT_SETTINGS = {
  notifications: true,
  defaultReminder: 10, // minutos antes; null = sin recordatorio
  allDayTime: '09:00', // hora de referencia para tareas con fecha pero sin hora
  digest: true,
  digestTime: '09:00',
  theme: 'system',
  voiceAuto: true, // añadir la tarea en cuanto termina el dictado (con aviso para editar o deshacer)
  voiceLang: 'es-ES',
};

export const VOICE_LANGS = [
  ['es-ES', 'Español (España)'],
  ['es-MX', 'Español (México)'],
  ['es-AR', 'Español (Argentina)'],
  ['es-CO', 'Español (Colombia)'],
  ['es-US', 'Español (EE. UU.)'],
];

export const STALE_MS = 12 * 3600e3; // un recordatorio que llega con más retraso se descarta sin avisar
export const SNOOZE_MS = 10 * 60e3;

// ---------- utilidades ----------

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');

// ---------- fechas (cadenas 'YYYY-MM-DD' en hora local) ----------

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayStr = (now = Date.now()) => ymd(new Date(now));
export const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
/** Suma meses conservando el día; si el mes destino es más corto, usa su último día (31 ene + 1 mes = 28 feb). */
export function addMonths(s, n) {
  const d = parseYmd(s);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(d.getDate(), last));
  return ymd(first);
}
export const atTime = (s, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseYmd(s);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const validDate = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fMonthDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fMonthDayYear = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fWeekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long' });
const fLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fMonthYear = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

export const fmtLong = (s) => cap(fLong.format(parseYmd(s)));
export const fmtMonthYear = (s) => cap(fMonthYear.format(parseYmd(s)).replace(' de ', ' '));
export const fmtWeekdayShort = (s) => cap(fWeekday.format(parseYmd(s)).slice(0, 3));

export function fmtDay(s, today) {
  const diff = diffDays(s, today);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 1 && diff < 7) return cap(fWeekday.format(parseYmd(s)));
  const d = parseYmd(s);
  return d.getFullYear() === parseYmd(today).getFullYear() ? fMonthDay.format(d) : fMonthDayYear.format(d);
}

export const fmtClock = (ms) => {
  const t = Math.floor(Math.max(0, ms) / 1000);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};

export function fmtDur(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return ms >= 1000 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

// ---------- tareas ----------

export const getTask = (db, id) => db.tasks.find((t) => t.id === id) || null;
export const childrenOf = (db, id) => db.tasks.filter((t) => t.parentId === id);

export function createTask(db, init = {}, now = Date.now()) {
  if (init.parentId) {
    const parent = getTask(db, init.parentId);
    if (!parent || parent.parentId) return null; // solo un nivel de subtareas
  }
  const t = {
    id: uid(),
    title: '',
    notes: '',
    done: false,
    completedAt: null,
    priority: 0,
    tags: [],
    due: null,
    time: null,
    remind: 'auto', // 'auto' = recordatorio por defecto si hay hora; null = ninguno; número = minutos antes
    estimate: null, // minutos
    steps: [], // [{ id, text, done }]
    parentId: null,
    log: [], // sesiones del cronómetro: [{ s, e|null, manual? }]
    notified: null,
    snoozeUntil: null,
    estimateNotified: false,
    repeat: null, // null | 'daily' | 'weekly' | 'monthly'
    repeatAnchor: null, // fecha original de la serie (evita que 31 ene → 28 feb → 28 mar derive)
    spawnedId: null, // siguiente instancia creada al completar esta
    createdAt: now,
    updatedAt: now,
    ...init,
  };
  db.tasks.push(t);
  return t;
}

const RESET_REMINDER_ON = ['due', 'time', 'remind'];

export function updateTask(db, id, patch, now = Date.now()) {
  const t = getTask(db, id);
  if (!t) return null;
  Object.assign(t, patch);
  if (RESET_REMINDER_ON.some((k) => k in patch)) {
    t.notified = null;
    t.snoozeUntil = null;
  }
  if ('estimate' in patch) t.estimateNotified = false;
  if ('due' in patch || 'repeat' in patch) t.repeatAnchor = null; // la serie se re-ancla en la nueva fecha
  if (!t.due) {
    // sin fecha no hay hora ni repetición
    t.time = null;
    t.repeat = null;
    t.repeatAnchor = null;
  }
  t.updatedAt = now;
  return t;
}

// ---------- repetición ----------

const REPEAT_STEP_DAYS = { daily: 1, weekly: 7, monthly: 31 }; // cota inferior para saltar directo cerca de la fecha
const shiftDate = (s, rule, k) => (rule === 'daily' ? addDays(s, k) : rule === 'weekly' ? addDays(s, 7 * k) : addMonths(s, k));

/**
 * Próxima fecha de una tarea repetitiva: la primera de su serie posterior a su fecha actual Y a hoy.
 * Así, completar con retraso no deja una instancia ya vencida, y completar antes no se salta ninguna.
 */
export function nextDue(t, today) {
  if (!REPEAT_STEP_DAYS[t.repeat] || !t.due) return null;
  const anchor = t.repeatAnchor || t.due;
  const from = t.due > today ? t.due : today;
  let k = Math.max(1, Math.floor(diffDays(from, anchor) / REPEAT_STEP_DAYS[t.repeat]) - 1);
  for (let i = 0; i < 1000; i++, k++) {
    const c = shiftDate(anchor, t.repeat, k);
    if (c > from) return c;
  }
  return null;
}

const resetSteps = (steps) => steps.map((s) => ({ id: uid(), text: s.text, done: false }));

/** Crea la instancia siguiente: misma tarea con nueva fecha, pasos sin marcar, sin tiempo y con sus subtareas copiadas. */
function spawnNext(db, t, now) {
  const due = nextDue(t, todayStr(now));
  if (!due) return null;
  const next = createTask(
    db,
    {
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      tags: [...t.tags],
      due,
      time: t.time,
      remind: t.remind,
      estimate: t.estimate,
      steps: resetSteps(t.steps),
      repeat: t.repeat,
      repeatAnchor: t.repeatAnchor || t.due,
    },
    now,
  );
  const delta = diffDays(due, t.due);
  for (const k of childrenOf(db, t.id)) {
    createTask(
      db,
      {
        title: k.title,
        notes: k.notes,
        priority: k.priority,
        tags: [...k.tags],
        due: k.due ? addDays(k.due, delta) : null,
        time: k.due ? k.time : null,
        remind: k.remind,
        estimate: k.estimate,
        steps: resetSteps(k.steps),
        parentId: next.id,
      },
      now,
    );
  }
  t.spawnedId = next.id;
  return next;
}

/** Marca/desmarca una tarea. Al completar una repetitiva devuelve la instancia siguiente creada (o null). */
export function setDone(db, id, done, now = Date.now()) {
  const t = getTask(db, id);
  if (!t) return null;
  let spawned = null;
  if (done && !t.done) {
    closeSessions(t, now);
    t.done = true;
    t.completedAt = now;
    t.snoozeUntil = null;
    if (t.repeat && t.due && !t.parentId) spawned = spawnNext(db, t, now);
  } else if (!done && t.done) {
    t.done = false;
    t.completedAt = null;
    // deshacer: la instancia siguiente se retira si nadie la ha tocado todavía
    const s = t.spawnedId && getTask(db, t.spawnedId);
    if (s && !s.done && !s.log.length) deleteTask(db, s.id, now);
    t.spawnedId = null;
  }
  t.updatedAt = now;
  return spawned;
}

export function deleteTask(db, id, now = Date.now()) {
  const removed = db.tasks.filter((t) => t.id === id || t.parentId === id);
  const ids = new Set(removed.map((t) => t.id));
  removed.forEach((t) => closeSessions(t, now));
  db.tasks = db.tasks.filter((t) => !ids.has(t.id));
  // lápidas: sin ellas, al combinar con otra copia la tarea borrada "resucitaría"
  db.meta.deleted = db.meta.deleted || {};
  removed.forEach((t) => (db.meta.deleted[t.id] = now));
  return removed;
}

export function restoreTasks(db, tasks, now = Date.now()) {
  for (const t of tasks) {
    if (getTask(db, t.id)) continue;
    t.updatedAt = now; // más reciente que la lápida, para que una copia antigua no la vuelva a borrar
    db.tasks.push(t);
    if (db.meta.deleted) delete db.meta.deleted[t.id];
  }
}

// ---------- combinar copias de dos dispositivos ----------

const TOMBSTONE_TTL = 90 * 864e5;

/**
 * Combina en `db` (muta) una copia de datos procedente de otro dispositivo.
 * - Cada tarea: gana la edición más reciente (`updatedAt`); las que solo existen en un lado se conservan.
 * - Borrados: una tarea eliminada en un lado y no editada después en el otro se elimina (lápidas en meta.deleted).
 * - Etiquetas: se emparejan por nombre. Ajustes y avisos pendientes: se conservan los locales.
 * Devuelve { added, updated, removed }.
 */
export function mergeDB(db, incoming, now = Date.now()) {
  const stats = { added: 0, updated: 0, removed: 0 };
  const inTasks = Array.isArray(incoming?.tasks) ? incoming.tasks : [];
  const inTags = Array.isArray(incoming?.tags) ? incoming.tags : [];

  const tagMap = new Map(); // id de la otra copia → id local
  for (const tag of inTags) {
    let mine = db.tags.find((t) => t.name.toLowerCase() === String(tag.name).toLowerCase());
    if (!mine) {
      mine = { id: db.tags.some((t) => t.id === tag.id) ? uid() : tag.id, name: tag.name, color: tag.color };
      db.tags.push(mine);
    }
    tagMap.set(tag.id, mine.id);
  }

  const dead = { ...(db.meta.deleted || {}) };
  for (const [id, ts] of Object.entries(incoming?.meta?.deleted || {})) dead[id] = Math.max(dead[id] || 0, ts);
  for (const id of Object.keys(dead)) if (now - dead[id] > TOMBSTONE_TTL) delete dead[id];
  db.meta.deleted = dead;

  const index = new Map(db.tasks.map((t) => [t.id, t]));
  for (const raw of inTasks) {
    const t = { ...raw, tags: (raw.tags || []).map((id) => tagMap.get(id)).filter(Boolean) };
    const mine = index.get(t.id);
    if (!mine) {
      db.tasks.push(t);
      index.set(t.id, t);
      stats.added++;
    } else if ((t.updatedAt || 0) > (mine.updatedAt || 0)) {
      db.tasks[db.tasks.indexOf(mine)] = t;
      index.set(t.id, t);
      stats.updated++;
    }
  }

  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => !(dead[t.id] && dead[t.id] >= (t.updatedAt || 0)));
  const ids = new Set(db.tasks.map((t) => t.id));
  db.tasks = db.tasks.filter((t) => !t.parentId || ids.has(t.parentId)); // subtareas cuyo padre se eliminó
  stats.removed = before - db.tasks.length;

  // un solo cronómetro activo: si ambos dispositivos tenían uno en marcha, gana el que empezó más tarde
  const lastStart = (t) => Math.max(...t.log.filter((s) => s.e == null).map((s) => s.s));
  const running = db.tasks.filter(isRunning).sort((a, b) => lastStart(b) - lastStart(a));
  running.slice(1).forEach((t) => closeSessions(t, now));
  return stats;
}

export function snoozeTask(db, id, ms = SNOOZE_MS, now = Date.now()) {
  const t = getTask(db, id);
  if (t) t.snoozeUntil = now + ms;
}

// ---------- etiquetas ----------

export function ensureTag(db, name) {
  const n = name.trim();
  const found = db.tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (found) return found;
  const tag = { id: uid(), name: n, color: TAG_COLORS[db.tags.length % TAG_COLORS.length] };
  db.tags.push(tag);
  return tag;
}

export function deleteTag(db, id) {
  db.tags = db.tags.filter((t) => t.id !== id);
  db.tasks.forEach((t) => {
    t.tags = t.tags.filter((x) => x !== id);
  });
}

// ---------- cronómetro ----------

export const sessionMs = (s, now) => Math.max(0, (s.e ?? now) - s.s);
export const taskMs = (t, now) => t.log.reduce((a, s) => a + sessionMs(s, now), 0);
export const totalMs = (db, t, now) => childrenOf(db, t.id).reduce((a, c) => a + taskMs(c, now), taskMs(t, now));
export const isRunning = (t) => t.log.some((s) => s.e == null);
export const runningTask = (db) => db.tasks.find(isRunning) || null;

function closeSessions(t, now) {
  let changed = false;
  for (const s of t.log) {
    if (s.e == null) {
      s.e = now;
      changed = true;
    }
  }
  if (changed) {
    // una pulsación accidental de play/pausa no deja sesiones vacías
    t.log = t.log.filter((s) => s.manual || s.e - s.s >= 1000);
    t.updatedAt = now;
  }
}

export function stopTimers(db, now = Date.now()) {
  db.tasks.forEach((t) => closeSessions(t, now));
}

export function startTimer(db, id, now = Date.now()) {
  const t = getTask(db, id);
  if (!t || t.done) return;
  stopTimers(db, now); // un solo cronómetro activo a la vez
  t.log.push({ s: now, e: null });
  t.updatedAt = now;
}

export function addManualTime(db, id, ms, now = Date.now()) {
  const t = getTask(db, id);
  if (!t || ms <= 0) return;
  t.log.push({ s: now - ms, e: now, manual: true });
  t.updatedAt = now;
}

export function resetTime(db, id, now = Date.now()) {
  const t = getTask(db, id);
  if (!t) return;
  t.log = [];
  t.estimateNotified = false;
  t.updatedAt = now;
}

function eachDaySlice(s, e, cb) {
  let cur = s;
  while (cur < e) {
    const day = ymd(new Date(cur));
    const next = parseYmd(addDays(day, 1)).getTime();
    const end = Math.min(e, next);
    cb(day, end - cur);
    cur = end;
  }
}

/** Informe de tiempo de los últimos 7 días (incluido hoy). */
export function timeReport(db, now = Date.now()) {
  const today = todayStr(now);
  const from = addDays(today, -6);
  const fromTs = parseYmd(from).getTime();
  const perDay = {};
  for (let i = 0; i < 7; i++) perDay[addDays(from, i)] = 0;
  const perTag = new Map();
  const perTask = new Map();

  for (const t of db.tasks) {
    const tagIds = t.tags.length ? t.tags : (t.parentId && getTask(db, t.parentId)?.tags) || [];
    for (const s of t.log) {
      const start = Math.max(s.s, fromTs);
      const end = s.e ?? now;
      if (end <= start) continue;
      eachDaySlice(start, end, (day, ms) => {
        if (!(day in perDay)) return;
        perDay[day] += ms;
        perTask.set(t.id, (perTask.get(t.id) || 0) + ms);
        const keys = tagIds.length ? tagIds : [null];
        keys.forEach((k) => perTag.set(k, (perTag.get(k) || 0) + ms / keys.length));
      });
    }
  }
  return {
    days: Object.entries(perDay).map(([date, ms]) => ({ date, ms })),
    today: perDay[today],
    week: Object.values(perDay).reduce((a, b) => a + b, 0),
    byTag: [...perTag].map(([tagId, ms]) => ({ tagId, ms })).sort((a, b) => b.ms - a.ms),
    top: [...perTask].map(([taskId, ms]) => ({ taskId, ms })).sort((a, b) => b.ms - a.ms).slice(0, 5),
  };
}

// ---------- recordatorios y avisos ----------

export const effectiveRemind = (t, settings) => (t.remind === 'auto' ? (t.time ? settings.defaultReminder : null) : t.remind);
export const dueTimestamp = (t, settings) => atTime(t.due, t.time || settings.allDayTime);

export function reminderAt(t, settings) {
  if (!t.due) return null;
  const r = effectiveRemind(t, settings);
  if (r == null) return null;
  return dueTimestamp(t, settings) - r * 60000;
}

export const pendingDue = (db, today) => db.tasks.filter((t) => !t.done && t.due && t.due <= today);

function reminderText(db, t, now) {
  const today = todayStr(now);
  const when = `${fmtDay(t.due, today)}${t.time ? ' · ' + t.time : ''}`;
  const parent = t.parentId ? getTask(db, t.parentId) : null;
  const done = t.steps.filter((s) => s.done).length;
  const bits = [];
  if (parent) bits.push(`en «${parent.title}»`);
  if (t.steps.length) bits.push(`${done}/${t.steps.length} pasos`);
  return { message: when, context: bits.join(' · ') || undefined };
}

/**
 * Calcula qué avisos toca mostrar ahora y los marca como emitidos en `db` (muta).
 * Devuelve [{ id, kind, taskId?, title, message, context?, buttons }].
 */
export function collectAlerts(db, now = Date.now()) {
  const s = db.settings;
  const alerts = [];
  if (!s.notifications) return alerts;

  for (const t of db.tasks) {
    if (t.done) continue;

    if (t.snoozeUntil && now >= t.snoozeUntil) {
      t.snoozeUntil = null;
      alerts.push({ id: `rem:${t.id}`, kind: 'snooze', taskId: t.id, title: t.title, ...reminderText(db, t, now), buttons: true });
      continue;
    }

    const at = reminderAt(t, s);
    if (at != null && now >= at && t.notified !== at) {
      t.notified = at;
      if (now - at <= STALE_MS) {
        alerts.push({ id: `rem:${t.id}`, kind: 'reminder', taskId: t.id, title: t.title, ...reminderText(db, t, now), buttons: true });
      }
    }

    if (t.estimate && !t.estimateNotified && isRunning(t) && taskMs(t, now) >= t.estimate * 60000) {
      t.estimateNotified = true;
      alerts.push({
        id: `est:${t.id}`,
        kind: 'estimate',
        taskId: t.id,
        title: t.title,
        message: `Has alcanzado el tiempo estimado (${fmtMinutes(t.estimate)})`,
        buttons: false,
      });
    }
  }

  const today = todayStr(now);
  if (s.digest && db.meta.lastDigest !== today && now >= atTime(today, s.digestTime)) {
    db.meta.lastDigest = today;
    const items = pendingDue(db, today);
    if (items.length) {
      const titles = items.slice(0, 4).map((t) => t.title).join(' · ');
      alerts.push({
        id: 'digest',
        kind: 'digest',
        title: items.length === 1 ? 'Tienes 1 tarea para hoy' : `Tienes ${items.length} tareas para hoy`,
        message: items.length > 4 ? `${titles} · y ${items.length - 4} más` : titles,
        buttons: false,
      });
    }
  }
  return alerts;
}

export function badgeInfo(db, now = Date.now()) {
  const run = runningTask(db);
  if (run) {
    const m = Math.floor(taskMs(run, now) / 60000);
    return { text: m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad(m % 60)}`, color: '#30a46c' };
  }
  const n = pendingDue(db, todayStr(now)).length;
  return { text: n ? String(Math.min(n, 99)) : '', color: '#5b5bd6' };
}

// ---------- entrada rápida ----------

const WEEKDAYS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Interpreta "Llamar a Ana mañana 10:30 #trabajo !alta".
 * Reconoce: #etiqueta, !alta|media|baja|1|2|3, hoy, mañana, pasado mañana, lunes…domingo,
 * en N días, dd/mm[/aaaa], aaaa-mm-dd, HH:MM, "a las N", "@N" y repeticiones
 * ("cada día", "cada semana", "cada mes", "cada lunes", "todos los días"…).
 * Solo se reconocen las frases con "cada/todos/todas": palabras sueltas como "semanal" son títulos legítimos.
 */
export function parseQuick(input, now = Date.now()) {
  const original = input.trim();
  const out = { title: '', due: null, time: null, priority: null, tags: [], repeat: null };
  let text = ` ${original} `;
  const today = todayStr(now);
  const nextWeekday = (name) => addDays(today, (WEEKDAYS[strip(name)] - parseYmd(today).getDay() + 7) % 7 || 7);

  text = text.replace(/(?<=\s)#([\p{L}\p{N}_-]+)(?=\s)/gu, (_, name) => {
    out.tags.push(name);
    return ' ';
  });

  text = text.replace(/(?<=\s)!(alta|media|baja|urgente|[123])(?=\s)/giu, (_, p) => {
    const v = strip(p);
    if (out.priority == null) out.priority = { alta: 3, urgente: 3, media: 2, baja: 1 }[v] ?? Number(v);
    return ' ';
  });

  const repeatRules = [
    [/(?<=\s)cada\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?=\s)/i, 'weekly', (m) => nextWeekday(m[1])],
    [/(?<=\s)(?:cada\s+d[ií]a|todos\s+los\s+d[ií]as)(?=\s)/i, 'daily'],
    [/(?<=\s)(?:cada\s+semana|todas\s+las\s+semanas)(?=\s)/i, 'weekly'],
    [/(?<=\s)(?:cada\s+mes|todos\s+los\s+meses)(?=\s)/i, 'monthly'],
  ];
  for (const [re, rule, dateFn] of repeatRules) {
    const m = re.exec(text);
    if (!m) continue;
    out.repeat = rule;
    if (dateFn) out.due = dateFn(m);
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    break;
  }

  const dateRules = [
    // "para mañana", "el viernes", "este lunes", "el próximo martes", "para el 15/11": el artículo y "para" se consumen con la fecha
    [/(?<=\s)(?:para\s+)?pasado\s+ma[ñn]ana(?=\s)/i, () => addDays(today, 2)],
    [/(?<=\s)(?:para\s+)?ma[ñn]ana(?=\s)/i, () => addDays(today, 1)],
    [/(?<=\s)(?:para\s+)?hoy(?=\s)/i, () => today],
    [
      /(?<=\s)(?:para\s+)?(?:(?:el|este)\s+)?(?:pr[oó]ximo\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?=\s)/i,
      (m) => nextWeekday(m[1]),
    ],
    [/(?<=\s)en\s+(\d{1,3})\s+d[ií]as?(?=\s)/i, (m) => addDays(today, Number(m[1]))],
    [
      /(?<=\s)(?:para\s+)?(?:el\s+)?(\d{4})-(\d{2})-(\d{2})(?=\s)/,
      (m) => (validDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null),
    ],
    [
      /(?<=\s)(?:para\s+)?(?:el\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s)/,
      (m) => {
        const d = +m[1];
        const mo = +m[2];
        let y = m[3] ? +m[3] : parseYmd(today).getFullYear();
        if (m[3] && m[3].length === 2) y += 2000;
        if (!validDate(y, mo, d)) return null;
        let r = ymd(new Date(y, mo - 1, d));
        if (!m[3] && r < today) r = ymd(new Date(y + 1, mo - 1, d));
        return r;
      },
    ],
  ];
  for (const [re, fn] of dateRules) {
    if (out.due) break; // "cada lunes" ya fijó la fecha
    const m = re.exec(text);
    if (!m) continue;
    const date = fn(m);
    if (!date) continue;
    out.due = date;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    break;
  }

  const timeRules = [
    /(?<=\s)(?:a\s+las\s+|@)(\d{1,2})(?::(\d{2}))?(?=\s)/i,
    /(?<=\s)(\d{1,2}):(\d{2})(?=\s)/,
  ];
  for (const re of timeRules) {
    const m = re.exec(text);
    if (!m) continue;
    const h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h > 23 || min > 59) continue;
    out.time = `${pad(h)}:${pad(min)}`;
    text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
    break;
  }

  out.title = text.replace(/\s+/g, ' ').trim();
  // si se consumió una fecha/hora/repetición, no dejar preposiciones colgando ("Llamar a Ana para" ← "para mañana")
  if (out.due || out.time || out.repeat) out.title = out.title.replace(/(?:\s+(?:para|el|la|a|de|del|al|en|y))+$/i, '');
  if (!out.title) return { title: original, due: null, time: null, priority: null, tags: [], repeat: null };
  return out;
}

// ---------- dictado: de lenguaje hablado a la sintaxis rápida ----------

const NUM_WORDS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, treinta: 30,
};
// las más largas primero para que "veintiuna" no se quede en "veinti…"
const NUM_WORDS_RE = 'veinticuatro|veinticinco|veintitr[eé]s|veintid[oó]s|veintiuna|veintiuno|diecinueve|dieciocho|diecisiete|diecis[eé]is|catorce|veinte|treinta|trece|quince|once|doce|diez|nueve|ocho|siete|seis|cinco|cuatro|tres|dos|una|uno|un';
const MIN_WORDS = { 'cuarenta y cinco': 45, veinticinco: 25, cuarenta: 40, cincuenta: 50, treinta: 30, veinte: 20, quince: 15, diez: 10, cinco: 5, cuarto: 15, media: 30 };
const MIN_WORDS_RE = 'cuarenta\\s+y\\s+cinco|veinticinco|cuarenta|cincuenta|treinta|veinte|quince|diez|cinco|cuarto|media';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[strip(w)]);

const SPOKEN_TIME_RE = new RegExp(
  `(?<=\\s)a\\s+las?\\s+(\\d{1,2}(?::\\d{2})?|${NUM_WORDS_RE})` + // hora: 10, 10:30, diez
    `(?:\\s+(?:y\\s+(${MIN_WORDS_RE}|\\d{1,2})|menos\\s+(${MIN_WORDS_RE}|\\d{1,2})|en\\s+punto))?` + // y media, menos cuarto, en punto
    `(?:\\s+(?:de\\s+la\\s+(ma[ñn]ana|tarde|noche|madrugada)|del\\s+(mediod[ií]a)))?(?=\\s)`,
  'i',
);
const SPOKEN_DATE_RE = new RegExp(
  `(?<=\\s)(?:(?:para\\s+)?el\\s+)?(?:d[ií]a\\s+)?(\\d{1,2}|${NUM_WORDS_RE})\\s+de\\s+(${MONTHS.map((m) => (m === 'septiembre' ? 'se[pt]iembre' : m)).join('|')})(?:\\s+(?:de|del)\\s+(\\d{4}))?(?=\\s)`,
  'i',
);
const SPOKEN_RELATIVE_RE = new RegExp(`(?<=\\s)(?:dentro\\s+de|en)\\s+(\\d{1,3}|${NUM_WORDS_RE})\\s+(d[ií]as?|semanas?|mes(?:es)?)(?=\\s)`, 'i');

function spokenTime(m) {
  let h = num(m[1].split(':')[0]);
  let min = m[1].includes(':') ? Number(m[1].split(':')[1]) : 0;
  const minutes = (w) => (/^\d+$/.test(w) ? Number(w) : MIN_WORDS[w.toLowerCase().replace(/\s+/g, ' ')]);
  const period = (m[4] || '').toLowerCase().replace('mañana', 'manana');
  if (h === undefined || h > 24) return null;
  if (period === 'tarde' && h >= 1 && h < 12) h += 12;
  else if (period === 'noche') h = h === 12 ? 0 : h >= 6 && h < 12 ? h + 12 : h;
  else if (m[5] && h >= 1 && h <= 4) h += 12; // "a las 2 del mediodía"
  if (m[2]) min = minutes(m[2]);
  else if (m[3]) {
    h -= 1;
    min = 60 - minutes(m[3]);
    if (h < 0) h = 23;
  }
  if (min === undefined || Number.isNaN(min) || min > 59) return null;
  return `${pad(h % 24)}:${pad(min)}`;
}

/**
 * Convierte lo que devuelve el reconocimiento de voz ("añade tarea llamar a Ana mañana a las diez y media
 * con prioridad alta etiqueta trabajo") a la sintaxis rápida ("Llamar a Ana mañana 10:30 !alta #trabajo"),
 * que parseQuick ya entiende. El resultado se muestra al usuario, así que puede revisarlo y corregirlo.
 */
export function normalizeSpoken(raw) {
  let t = ` ${String(raw || '')} `
    .replace(/[«»"“”]/g, '')
    .replace(/[,;¿?¡!]+/g, ' ')
    .replace(/[.:](?=\s)/g, ' ')
    .replace(/\s+/g, ' ');

  // órdenes iniciales: "añade tarea…", "recuérdame que…", "tengo que…"
  t = t
    .replace(/^ (?:por favor )?(?:a[ñn]ade|a[ñn]adir|crea|crear|agrega|agregar|apunta|apuntar|registra|registrar|nueva)\s+(?:una\s+|la\s+)?(?:nueva\s+)?(?:tarea|recordatorio)\s*(?:de|para|que)?\s+/i, ' ')
    .replace(/^ (?:por favor )?recu[eé]rdame\s+(?:que\s+|de\s+)?/i, ' ')
    .replace(/^ (?:tengo que|hay que)\s+/i, ' ');

  // prioridad y etiquetas dichas en voz alta
  t = t.replace(/(?<=\s)(?:con\s+)?(?:la\s+)?prioridad\s+(alta|media|baja)(?=\s)/gi, (_, p) => ` !${p.toLowerCase()}`);
  const RESERVED = 'ma[ñn]ana|hoy|pasado|el|la|los|las|a|de|para|con|cada|todos|todas|en|dentro';
  t = t.replace(
    new RegExp(`(?<=\\s)(?:con\\s+)?(?:la\\s+)?etiquetas?\\s+([\\p{L}\\p{N}_-]+)(?:\\s+y\\s+(?!(?:${RESERVED})(?=\\s))([\\p{L}\\p{N}_-]+))?(?=\\s)`, 'giu'),
    (_, a, b) => ` #${a}${b ? ` #${b}` : ''}`,
  );

  // horas: "a las diez y media de la noche" → 22:30
  t = t.replace(SPOKEN_TIME_RE, (m0, ...g) => {
    const out = spokenTime([m0, ...g]);
    return out ? ` ${out}` : m0;
  });
  t = t.replace(/(?<=\s)a(?:l)?\s+mediod[ií]a(?=\s)/gi, ' 12:00');

  // fechas: "el 15 de noviembre" → 15/11, "dentro de tres días" → en 3 días
  t = t.replace(SPOKEN_DATE_RE, (m0, d, mon, y) => {
    const day = num(d);
    const name = strip(mon) === 'setiembre' ? 'septiembre' : strip(mon);
    const month = MONTHS.indexOf(name) + 1;
    return day >= 1 && day <= 31 && month ? ` ${pad(day)}/${pad(month)}${y ? `/${y}` : ''}` : m0;
  });
  t = t.replace(SPOKEN_RELATIVE_RE, (m0, n, unit) => {
    const k = num(n);
    if (!k) return m0;
    const days = /^d/i.test(unit) ? k : /^s/i.test(unit) ? k * 7 : k * 30;
    return ` en ${days} días`;
  });
  t = t.replace(/(?<=\s)(?:la\s+semana\s+que\s+viene|la\s+pr[oó]xima\s+semana|la\s+semana\s+pr[oó]xima)(?=\s)/gi, ' en 7 días');
  t = t.replace(/(?<=\s)(?:esta\s+(?:tarde|noche|ma[ñn]ana)|hoy\s+mismo)(?=\s)/gi, ' hoy');

  t = t.replace(/\s+/g, ' ').trim();
  return cap(t);
}

/**
 * Crea una tarea a partir de texto libre. `defaults`: { due, priority, tags, parentId }.
 * `opts.capitalize`: pone en mayúscula la primera letra del título (el dictado devuelve minúsculas).
 */
export function addFromQuick(db, text, defaults = {}, now = Date.now(), opts = {}) {
  const p = parseQuick(text, now);
  if (!p.title) return null;
  if (opts.capitalize) p.title = cap(p.title);
  const tagIds = p.tags.map((n) => ensureTag(db, n).id);
  let due = p.due ?? defaults.due ?? null;
  if ((p.time || p.repeat) && !due) due = todayStr(now); // la hora y la repetición necesitan una fecha
  return createTask(
    db,
    {
      title: p.title,
      due,
      time: p.time,
      repeat: p.repeat,
      priority: p.priority ?? defaults.priority ?? 0,
      tags: [...new Set([...(defaults.tags || []), ...tagIds])],
      parentId: defaults.parentId ?? null,
    },
    now,
  );
}

// ---------- orden y agrupación ----------

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');
const byPrio = (a, b) => b.priority - a.priority;
const byCreated = (a, b) => a.createdAt - b.createdAt;
const byDueStr = (a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99');

export const SORTS = {
  date: { label: 'Fecha', fn: (a, b) => byDueStr(a, b) || byTime(a, b) || byPrio(a, b) || byCreated(a, b) },
  priority: { label: 'Prioridad', fn: (a, b) => byPrio(a, b) || byDueStr(a, b) || byTime(a, b) || byCreated(a, b) },
  name: { label: 'Nombre', fn: (a, b) => a.title.localeCompare(b.title, 'es') || byCreated(a, b) },
  recent: { label: 'Recientes', fn: (a, b) => b.createdAt - a.createdAt },
};

export const GROUPS = { date: 'Fecha', priority: 'Prioridad', tag: 'Etiqueta', none: 'Sin agrupar' };

/** Devuelve [{ key, label, tone?, tasks }] sin grupos vacíos. */
export function groupTasks(tasks, mode, today, tags = [], sortKey = 'date') {
  const cmp = SORTS[sortKey].fn;
  const buckets = new Map();
  const add = (key, label, tone, t) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, tone, tasks: [] });
    buckets.get(key).tasks.push(t);
  };

  if (mode === 'none') {
    return tasks.length ? [{ key: 'all', label: '', tasks: [...tasks].sort(cmp) }] : [];
  }

  const order = [];
  if (mode === 'priority') {
    PRIORITIES.forEach((p) => order.push(`p${p.value}`));
    tasks.forEach((t) => add(`p${t.priority}`, PRIORITIES.find((p) => p.value === t.priority).label, t.priority === 3 ? 'danger' : '', t));
  } else if (mode === 'tag') {
    tags.forEach((tag) => order.push(tag.id));
    order.push('none');
    tasks.forEach((t) => {
      const ids = t.tags.filter((id) => tags.some((x) => x.id === id));
      if (!ids.length) add('none', 'Sin etiqueta', '', t);
      ids.forEach((id) => add(id, tags.find((x) => x.id === id).name, '', t));
    });
  } else {
    const keys = ['overdue', 'today', 'tomorrow'];
    for (let i = 2; i <= 6; i++) keys.push(addDays(today, i));
    keys.push('later', 'nodate');
    order.push(...keys);
    tasks.forEach((t) => {
      if (!t.due) return add('nodate', 'Sin fecha', '', t);
      const d = diffDays(t.due, today);
      if (d < 0) return add('overdue', 'Atrasadas', 'danger', t);
      if (d === 0) return add('today', 'Hoy', 'accent', t);
      if (d === 1) return add('tomorrow', 'Mañana', '', t);
      if (d <= 6) return add(t.due, `${cap(fWeekday.format(parseYmd(t.due)))} · ${fMonthDay.format(parseYmd(t.due))}`, '', t);
      return add('later', 'Más adelante', '', t);
    });
  }
  return order
    .filter((k) => buckets.has(k))
    .map((k) => {
      const g = buckets.get(k);
      g.tasks.sort(cmp);
      return g;
    });
}

// ---------- datos iniciales ----------

export function seedWelcome(db, now = Date.now()) {
  if (db.meta.seeded || db.tasks.length) return;
  db.meta.seeded = true;
  const work = ensureTag(db, 'ejemplo');
  const today = todayStr(now);
  const t = createTask(
    db,
    {
      title: 'Bienvenido: explora tu gestor de tareas',
      notes: 'Pulsa la tarea para ver el detalle. Puedes borrar esta tarea cuando quieras.',
      due: today,
      priority: 2,
      tags: [work.id],
      estimate: 15,
      steps: [
        { id: uid(), text: 'Inicia el cronómetro con ▶', done: false },
        { id: uid(), text: 'Marca un paso como hecho', done: false },
        { id: uid(), text: 'Abre el calendario y arrastra una tarea a otro día', done: false },
      ],
    },
    now,
  );
  createTask(db, { title: 'Probar una subtarea con sus propios pasos', parentId: t.id, steps: [{ id: uid(), text: 'Paso de ejemplo', done: false }] }, now);
  createTask(
    db,
    { title: 'Escribe aquí: "Llamar a Ana mañana 10:30 #trabajo !alta"', due: addDays(today, 1), priority: 1, tags: [work.id] },
    now,
  );
}
