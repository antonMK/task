// Interfaz: una sola base de código para el popup (compacto) y la pestaña completa (responsive).

import * as C from './core.js';
import { load, mutate, subscribe, replaceAll, mergeIn } from './store.js';
import { icon } from './icons.js';

const IS_POPUP = document.documentElement.classList.contains('popup');
const HAS_EXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- estado ----------

const PREF_KEY = 'gt_prefs';
const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY)) || {};
  } catch {
    return {};
  }
};
const prefs = readPrefs();

const state = {
  db: null,
  view: ['today', 'calendar', 'all', 'done', 'time'].includes(prefs.view) ? prefs.view : 'today',
  tag: null,
  q: '',
  prio: '',
  sort: C.SORTS[prefs.sort] ? prefs.sort : 'date',
  group: prefs.group in C.GROUPS ? prefs.group : 'date',
  selected: null,
  month: C.todayStr().slice(0, 7),
  day: C.todayStr(),
  showDoneToday: false,
  micState: 'unknown',
  collapsed: new Set(prefs.collapsed || []),
  today: C.todayStr(),
  detailDirty: false,
};

function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ view: state.view, sort: state.sort, group: state.group, collapsed: [...state.collapsed] }));
  } catch {
    // sin localStorage: no se recuerdan las preferencias de vista
  }
}

const task = (id) => C.getTask(state.db, id);
const tagById = (id) => state.db.tags.find((t) => t.id === id);
const tagColor = (t) => {
  const tag = t.tags.map(tagById).find(Boolean);
  return tag ? tag.color : null;
};

// ---------- pintado con foco preservado ----------

const TEXTLIKE = 'textarea, input:not([type]), input[type=text], input[type=search]';

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** Sustituye el HTML de `el` conservando foco, selección y texto en curso de los campos marcados con data-fk. */
function paint(el, html) {
  const a = document.activeElement;
  let snap = null;
  if (a && el.contains(a) && a.dataset.fk) {
    snap = { fk: a.dataset.fk, text: a.matches(TEXTLIKE), value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  el.innerHTML = html;
  el.querySelectorAll('textarea').forEach(autosize);
  if (snap) {
    const n = el.querySelector(`[data-fk="${CSS.escape(snap.fk)}"]`);
    if (n) {
      if (snap.text) n.value = snap.value;
      n.focus({ preventScroll: true });
      if (snap.text) {
        try {
          n.setSelectionRange(snap.s, snap.e);
        } catch {
          // algunos tipos de input no admiten selección
        }
        if (n.matches('textarea')) autosize(n);
      }
    }
  }
}

// ---------- vistas: piezas comunes ----------

function matches(t) {
  if (state.tag && !t.tags.includes(state.tag)) return false;
  if (state.prio !== '' && String(t.priority) !== state.prio) return false;
  if (state.q) {
    const q = norm(state.q);
    if (!norm(t.title).includes(q) && !norm(t.notes).includes(q) && !t.steps.some((s) => norm(s.text).includes(q))) return false;
  }
  return true;
}

const pending = (t) => !t.done;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function sidebarHTML() {
  const db = state.db;
  const nToday = C.pendingDue(db, state.today).length;
  const nAll = db.tasks.filter((t) => pending(t) && !t.parentId).length;
  // colores del sistema de Apple, como las insignias de Ajustes / Recordatorios
  const items = [
    ['today', 'Hoy', 'sun', nToday, '#007aff'],
    ['calendar', 'Calendario', 'calendar', '', '#ff3b30'],
    ['all', 'Todas', 'list', nAll, '#5e5ce6'],
    ['done', 'Hechas', 'doneAll', '', '#34c759'],
    ['time', 'Tiempo', 'chart', '', '#ff9500'],
  ];
  const nav = items
    .map(
      ([v, label, ic, n, color]) =>
        `<button class="nav-item ${state.view === v && !state.tag ? 'active' : ''}" data-action="nav" data-view="${v}"><span class="nav-badge" style="--b:${color}">${icon(ic, 14)}</span><span class="label">${label}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`,
    )
    .join('');
  const tags = db.tags
    .map((tag) => {
      const n = db.tasks.filter((t) => pending(t) && t.tags.includes(tag.id)).length;
      return `<button class="tag-item ${state.tag === tag.id ? 'active' : ''}" data-action="tag-filter" data-id="${tag.id}"><i class="dot" style="--c:${esc(tag.color)}"></i><span class="label">${esc(tag.name)}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`;
    })
    .join('');
  return `
    <nav class="nav">${nav}</nav>
    ${db.tags.length ? `<div class="side-title">Etiquetas</div>` : ''}
    <div class="tags-section">${tags}</div>
    <div class="side-foot">
      <button class="nav-item" data-action="settings-open"><span class="nav-badge" style="--b:#8e8e93">${icon('sliders', 14)}</span><span class="label">Ajustes</span></button>
      ${IS_POPUP ? `<button class="nav-item" data-action="open-tab"><span class="nav-badge" style="--b:#8e8e93">${icon('external', 14)}</span><span class="label">Abrir en pestaña</span></button>` : ''}
    </div>`;
}

function topbarHTML() {
  const db = state.db;
  const tag = state.tag && tagById(state.tag);
  let title = { today: 'Hoy', calendar: 'Calendario', all: 'Todas', done: 'Hechas', time: 'Tiempo' }[state.view];
  let sub = '';
  if (tag) title = `# ${tag.name}`;
  else if (state.view === 'today') sub = `${C.fmtLong(state.today)} · ${plural(C.pendingDue(db, state.today).length, 'pendiente', 'pendientes')}`;
  else if (state.view === 'all') sub = plural(db.tasks.filter((t) => pending(t) && !t.parentId).length, 'tarea pendiente', 'tareas pendientes');
  else if (state.view === 'time') sub = 'Últimos 7 días';

  const showSearch = ['today', 'all', 'done'].includes(state.view);
  const showOrg = state.view === 'all';
  const opts = (map, cur, prefix) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${prefix} · ${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
  const prioOpts = [`<option value="">Prioridad · Todas</option>`, ...C.PRIORITIES.map((p) => `<option value="${p.value}" ${state.prio === String(p.value) ? 'selected' : ''}>Prioridad · ${p.label}</option>`)].join('');

  return `
    <div>
      <h1 class="title">${esc(title)}</h1>
      ${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}
    </div>
    <div class="tools">
      ${tag ? `<span class="filter-chip"><i class="dot" style="--c:${esc(tag.color)}"></i>${esc(tag.name)}<button class="icon-btn" style="width:20px;height:20px" data-action="clear-tag" aria-label="Quitar filtro">${icon('x', 12)}</button></span>` : ''}
      ${showSearch ? `<label class="search">${icon('search', 15)}<input type="search" data-field="search" data-fk="search" placeholder="Buscar" value="${esc(state.q)}" autocomplete="off"></label>` : ''}
      ${showOrg ? `<select class="select" data-field="sort" aria-label="Ordenar">${opts(C.SORTS, state.sort, 'Orden')}</select>
      <select class="select" data-field="group" aria-label="Agrupar">${opts(C.GROUPS, state.group, 'Grupo')}</select>
      <select class="select" data-field="prio" aria-label="Filtrar por prioridad">${prioOpts}</select>` : ''}
      <button class="icon-btn narrow-only" data-action="settings-open" title="Ajustes" aria-label="Ajustes">${icon('sliders', 18)}</button>
      ${IS_POPUP ? `<button class="icon-btn narrow-only" data-action="open-tab" title="Abrir en pestaña" aria-label="Abrir en pestaña">${icon('external', 18)}</button>` : ''}
    </div>`;
}

function micButton(kind) {
  if (!voiceSupported()) return '';
  const on = voice.active && voice.kind === kind;
  return `<button type="button" class="qa-mic ${kind === 'sub' ? 'sm' : ''} ${on ? 'on' : ''}" data-action="mic" data-mic="${kind}" title="${on ? 'Detener dictado (Esc)' : 'Dictar por voz (V)'}" aria-label="${on ? 'Detener dictado' : 'Dictar por voz'}" aria-pressed="${on}">${icon('mic', kind === 'sub' ? 16 : 18)}</button>`;
}

function qaHTML(ctx) {
  const listening = voice.active && voice.kind === 'quick';
  const placeholder = listening ? 'Escuchando…  di la tarea con su fecha, etiqueta o prioridad' : 'Nueva tarea…  prueba: reunión mañana 10:30 #trabajo !alta';
  return `<div class="qa-wrap">
    <label class="qa ${listening ? 'listening' : ''}" title="Sintaxis: #etiqueta  !alta|media|baja  hoy  mañana  lunes…  15/11  10:30  a las 9  cada día|semana|mes|lunes"><span class="qa-plus">${icon('plus', 14)}</span><input type="text" data-quick="${ctx}" data-fk="quick" placeholder="${placeholder}" value="${listening ? esc(voice.shown) : ''}" autocomplete="off">${micButton('quick')}</label>
    <div class="qa-preview"></div>
  </div>`;
}

function emptyHTML(ic, title, text) {
  return `<div class="empty">${icon(ic)}<strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}

function rowHTML(t, { child = false, withKids = false, flat = false, draggable = false } = {}) {
  const db = state.db;
  const today = state.today;
  const now = Date.now();
  const running = C.isRunning(t);
  const kids = C.childrenOf(db, t.id);
  const meta = [];

  if (t.due) {
    const tone = !t.done && t.due < today ? 'overdue' : !t.done && t.due === today ? 'today' : '';
    meta.push(`<span class="meta ${tone}" ${t.repeat ? `title="${esc(C.repeatLabel(t.repeat))}"` : ''}>${icon('calendar', 13)}${esc(C.fmtDay(t.due, today))}${t.time ? ` · ${t.time}` : ''}${t.repeat ? icon('repeat', 12) : ''}</span>`);
  }
  if (flat && t.parentId) {
    const p = task(t.parentId);
    if (p) meta.push(`<span class="meta">${icon('sub', 13)}${esc(p.title)}</span>`);
  }
  if (kids.length && !withKids) {
    const done = kids.filter((k) => k.done).length;
    meta.push(`<span class="meta">${icon('sub', 13)}${done}/${kids.length}</span>`);
  } else if (kids.length) {
    const done = kids.filter((k) => k.done).length;
    meta.push(`<button class="meta" data-action="collapse" data-id="${t.id}" title="Mostrar u ocultar subtareas">${icon(state.collapsed.has(t.id) ? 'right' : 'down', 13)}${done}/${kids.length} subtareas</button>`);
  }
  if (t.steps.length) meta.push(`<span class="meta">${icon('steps', 13)}${t.steps.filter((s) => s.done).length}/${t.steps.length}</span>`);
  const total = C.totalMs(db, t, now);
  if (total >= 1000 || t.estimate) {
    const over = t.estimate && total > t.estimate * 60000;
    meta.push(`<span class="meta ${over ? 'over-est' : ''}">${icon('timer', 13)}${C.fmtDur(total)}${t.estimate ? ` / ${C.fmtMinutes(t.estimate)}` : ''}</span>`);
  }
  t.tags.map(tagById).filter(Boolean).slice(0, 3).forEach((tag) => {
    meta.push(`<span class="tagchip"><i class="dot" style="--c:${esc(tag.color)}"></i>${esc(tag.name)}</span>`);
  });

  const play = t.done
    ? ''
    : `<button class="play ${running ? 'on' : ''}" data-action="timer" data-id="${t.id}" title="${running ? 'Pausar cronómetro' : 'Iniciar cronómetro'}" aria-label="${running ? 'Pausar' : 'Iniciar'} cronómetro">${icon(running ? 'pause' : 'play', 13)}${running ? `<span data-elapsed="own:${t.id}">${C.fmtClock(C.taskMs(t, now))}</span>` : ''}</button>`;

  return `<div class="row ${t.done ? 'is-done' : ''} ${running ? 'is-running' : ''} ${child ? 'nested' : ''} ${state.selected === t.id ? 'selected' : ''}" data-action="open" data-id="${t.id}" ${draggable ? `draggable="true" data-drag="${t.id}"` : ''}>
    <button class="check p${t.priority} ${t.done ? 'done' : ''}" data-action="toggle" data-id="${t.id}" aria-label="${t.done ? 'Marcar como pendiente' : 'Completar'}">${icon('check')}</button>
    <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-meta">${meta.join('')}</div></div>
    ${play}
  </div>`;
}

function groupsHTML(groups, rowOpts) {
  return groups
    .map(
      (g) => `<section class="group">
        ${g.label ? `<div class="group-head ${g.tone || ''}"><span>${esc(g.label)}</span><span class="count">${g.tasks.length}</span></div>` : ''}
        <div class="rows">${g.tasks.map((t) => rowsWithKids(t, rowOpts)).join('')}</div>
      </section>`,
    )
    .join('');
}

function rowsWithKids(t, opts) {
  let html = rowHTML(t, opts);
  if (opts.withKids && !state.collapsed.has(t.id)) {
    const kids = C.childrenOf(state.db, t.id).sort(C.SORTS.date.fn);
    html += kids.map((k) => rowHTML(k, { child: true })).join('');
  }
  return html;
}

// ---------- vista: Hoy / Todas ----------

function listHTML() {
  const db = state.db;
  const today = state.today;
  const isToday = state.view === 'today';
  const filtersOn = !!(state.tag || state.q || state.prio !== '');
  let list;
  let groups;
  let nested = false;

  if (isToday) {
    list = db.tasks.filter((t) => pending(t) && t.due && t.due <= today && matches(t));
    groups = C.groupTasks(list, 'date', today, db.tags, 'date');
  } else {
    nested = !filtersOn;
    list = db.tasks.filter((t) => pending(t) && (!nested || !t.parentId) && matches(t));
    groups = C.groupTasks(list, state.group, today, db.tags, state.sort);
  }

  let html = qaHTML(isToday ? 'today' : 'all');
  const rowOpts = { withKids: nested, flat: !nested };
  html += groupsHTML(groups, rowOpts);

  if (isToday) {
    const doneToday = db.tasks.filter((t) => t.done && t.completedAt && C.todayStr(t.completedAt) === today && matches(t)).sort((a, b) => b.completedAt - a.completedAt);
    if (!list.length) {
      html += doneToday.length
        ? emptyHTML('doneAll', 'Todo hecho por hoy', 'Buen trabajo. Añade algo más o descansa.')
        : emptyHTML('sun', 'Nada pendiente para hoy', 'Escribe arriba para añadir una tarea.');
    }
    if (doneToday.length) {
      html += `<section class="group"><div class="group-head"><span>Completadas hoy</span><span class="count">${doneToday.length}</span><span class="grow"></span><button class="link" data-action="toggle-done-today">${state.showDoneToday ? 'Ocultar' : 'Mostrar'}</button></div>
        ${state.showDoneToday ? `<div class="rows">${doneToday.map((t) => rowHTML(t, { flat: true })).join('')}</div>` : ''}</section>`;
    }
  } else if (!list.length) {
    html += filtersOn
      ? emptyHTML('search', 'Sin resultados', 'Prueba con otros filtros o quita la búsqueda.')
      : emptyHTML('list', 'No hay tareas pendientes', 'Escribe arriba para añadir la primera.');
  }
  return html;
}

// ---------- vista: Hechas ----------

function doneHTML() {
  const db = state.db;
  const today = state.today;
  const list = db.tasks.filter((t) => t.done && matches(t)).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  if (!list.length) return emptyHTML('doneAll', 'Aún no hay tareas completadas', 'Las tareas que completes aparecerán aquí.');
  const byDay = new Map();
  list.forEach((t) => {
    const day = t.completedAt ? C.todayStr(t.completedAt) : '0000-00-00';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  });
  const groups = [...byDay].map(([day, tasks]) => ({ label: day === '0000-00-00' ? 'Sin fecha' : C.fmtDay(day, today), tasks }));
  const first = groups[0];
  const html = groups
    .map(
      (g) => `<section class="group"><div class="group-head"><span>${esc(g.label)}</span><span class="count">${g.tasks.length}</span>${g === first ? `<span class="grow"></span><button class="link" data-action="clear-done">Vaciar todas</button>` : ''}</div>
      <div class="rows">${g.tasks.map((t) => rowHTML(t, { flat: true })).join('')}</div></section>`,
    )
    .join('');
  return html;
}

// ---------- vista: Calendario ----------

function calendarHTML() {
  const db = state.db;
  const today = state.today;
  const [y, m] = state.month.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const weeks = Math.ceil((offset + new Date(y, m, 0).getDate()) / 7);
  const byDay = new Map();
  db.tasks.forEach((t) => {
    if (!t.due) return;
    if (!byDay.has(t.due)) byDay.set(t.due, []);
    byDay.get(t.due).push(t);
  });
  byDay.forEach((arr) => arr.sort((a, b) => Number(a.done) - Number(b.done) || (a.time || '99:99').localeCompare(b.time || '99:99') || b.priority - a.priority));

  const dow = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const date = C.ymd(new Date(y, m - 1, 1 - offset + i));
    const tasks = byDay.get(date) || [];
    const cls = ['cell', date.slice(0, 7) !== state.month ? 'out' : '', date === today ? 'today' : '', date === state.day ? 'sel' : '', i >= (weeks - 1) * 7 ? 'last-row' : ''].join(' ');
    const chips = tasks
      .slice(0, 3)
      .map((t) => `<div class="cchip ${t.done ? 'is-done' : ''}" style="--c:${esc(tagColor(t) || 'var(--p0)')}" draggable="true" data-drag="${t.id}" data-action="open" data-id="${t.id}" title="${esc(t.title)}">${t.time ? `<span class="t">${t.time}</span>` : ''}${esc(t.title)}</div>`)
      .join('');
    const more = tasks.length > 3 ? `<button class="more" data-action="cal-day" data-date="${date}">+${tasks.length - 3} más</button>` : '';
    const dots = tasks
      .slice(0, 4)
      .map((t) => `<i class="dot-s ${t.done ? 'is-done' : ''}" style="--c:${esc(tagColor(t) || 'var(--p0)')}"></i>`)
      .join('');
    cells += `<div class="${cls}" data-action="cal-day" data-date="${date}"><span class="num">${Number(date.slice(8))}</span><div class="chips">${chips}${more}</div><div class="dots">${dots}</div></div>`;
  }

  const dayTasks = byDay.get(state.day) || [];
  const agenda = `<section class="agenda">
    <div class="agenda-head"><h3>${esc(C.fmtLong(state.day))}</h3><span class="muted">${plural(dayTasks.length, 'tarea', 'tareas')}</span></div>
    ${qaHTML('cal')}
    <div class="rows">${dayTasks.length ? dayTasks.map((t) => rowHTML(t, { flat: true, draggable: true })).join('') : `<div class="muted" style="padding:12px">Sin tareas para este día.</div>`}</div>
  </section>`;

  const monthLabel = C.fmtMonthYear(`${state.month}-01`); // "Octubre 2026"
  return `<div class="cal-head">
      <h2>${esc(monthLabel.replace(/\s\d{4}$/, ''))} <span>${esc(monthLabel.match(/\d{4}$/)?.[0] || '')}</span></h2>
      <button class="icon-btn" data-action="cal-prev" aria-label="Mes anterior">${icon('left', 18)}</button>
      <button class="btn btn-ghost" data-action="cal-today">Hoy</button>
      <button class="icon-btn" data-action="cal-next" aria-label="Mes siguiente">${icon('right', 18)}</button>
    </div>
    <div class="cal-grid">${dow}${cells}</div>
    ${agenda}`;
}

// ---------- vista: Tiempo ----------

function timeHTML() {
  const db = state.db;
  const r = C.timeReport(db, Date.now());
  if (r.week < 1000) return emptyHTML('timer', 'Aún no hay tiempo registrado', 'Pulsa ▶ en cualquier tarea para empezar a cronometrar.');
  const max = Math.max(...r.days.map((d) => d.ms), 1);
  const bars = r.days
    .map((d) => {
      const isToday = d.date === state.today;
      return `<div class="bar-col"><span class="bar-val">${d.ms >= 60000 ? C.fmtDur(d.ms) : ''}</span><div class="bar ${isToday ? 'today' : ''}" style="height:${Math.max(3, Math.round((d.ms / max) * 100))}px"></div><span class="bar-lab ${isToday ? 'today' : ''}">${C.fmtWeekdayShort(d.date)}</span></div>`;
    })
    .join('');
  const totalTag = r.byTag.reduce((a, b) => a + b.ms, 0) || 1;
  const tagRows = r.byTag
    .map((x) => {
      const tag = x.tagId && tagById(x.tagId);
      return `<div class="hrow"><span class="name"><i class="dot" style="--c:${esc(tag ? tag.color : 'var(--p0)')}"></i>${esc(tag ? tag.name : 'Sin etiqueta')}</span><span class="track"><span class="fill" style="display:block;width:${Math.round((x.ms / totalTag) * 100)}%;--c:${esc(tag ? tag.color : 'var(--p0)')}"></span></span><span class="val">${C.fmtDur(x.ms)}</span></div>`;
    })
    .join('');
  const topMax = r.top[0]?.ms || 1;
  const topRows = r.top
    .map((x) => {
      const t = task(x.taskId);
      if (!t) return '';
      return `<div class="hrow"><button class="name" data-action="open" data-id="${t.id}">${esc(t.title)}</button><span class="track"><span class="fill" style="display:block;width:${Math.round((x.ms / topMax) * 100)}%"></span></span><span class="val">${C.fmtDur(x.ms)}</span></div>`;
    })
    .join('');
  return `<div class="stats">
      <div class="stat"><div class="v">${C.fmtDur(r.today)}</div><div class="l">Hoy</div></div>
      <div class="stat"><div class="v">${C.fmtDur(r.week)}</div><div class="l">Últimos 7 días</div></div>
      <div class="stat"><div class="v">${C.fmtDur(r.week / 7)}</div><div class="l">Media diaria</div></div>
    </div>
    <div class="card pad"><h3>Por día</h3><div class="bars">${bars}</div></div>
    <div class="card pad"><h3>Por etiqueta</h3>${tagRows}</div>
    <div class="card pad"><h3>Tareas con más tiempo</h3>${topRows}</div>`;
}

function contentHTML() {
  switch (state.view) {
    case 'calendar':
      return calendarHTML();
    case 'time':
      return timeHTML();
    case 'done':
      return doneHTML();
    default:
      return listHTML();
  }
}

// ---------- cronómetro mini ----------

function miniHTML() {
  const run = C.runningTask(state.db);
  if (!run) return '';
  return `<span class="pulse"></span><span class="name" data-action="open" data-id="${run.id}" title="Abrir tarea">${esc(run.title)}</span><span class="clock" data-elapsed="own:${run.id}">${C.fmtClock(C.taskMs(run, Date.now()))}</span><button class="stop" data-action="timer" data-id="${run.id}" title="Pausar" aria-label="Pausar cronómetro">${icon('pause', 14)}</button>`;
}

// ---------- detalle ----------

function detailHTML(t) {
  const db = state.db;
  const now = Date.now();
  const today = state.today;
  const s = db.settings;
  const parent = t.parentId ? task(t.parentId) : null;
  const kids = C.childrenOf(db, t.id).sort((a, b) => a.createdAt - b.createdAt);
  const running = C.isRunning(t);
  const own = C.taskMs(t, now);
  const stepsDone = t.steps.filter((x) => x.done).length;

  const remindLabel = C.REMIND_OPTIONS.find((o) => o.value === s.defaultReminder)?.label || 'Sin recordatorio';
  const remindOpts = [
    `<option value="auto" ${t.remind === 'auto' ? 'selected' : ''}>Auto · ${t.time ? esc(remindLabel.toLowerCase()) : 'necesita hora'}</option>`,
    ...C.REMIND_OPTIONS.map((o) => {
      const v = o.value === null ? 'none' : String(o.value);
      const cur = t.remind === o.value;
      return `<option value="${v}" ${cur ? 'selected' : ''}>${o.label}</option>`;
    }),
  ].join('');
  const estList = C.ESTIMATE_OPTIONS.includes(t.estimate) || !t.estimate ? C.ESTIMATE_OPTIONS : [...C.ESTIMATE_OPTIONS, t.estimate].sort((a, b) => a - b);
  const estOpts = [`<option value="">Sin estimación</option>`, ...estList.map((m) => `<option value="${m}" ${t.estimate === m ? 'selected' : ''}>${C.fmtMinutes(m)}</option>`)].join('');

  const repeatOpts = C.REPEAT_OPTIONS.map((o) => `<option value="${o.value ?? 'none'}" ${t.repeat === o.value ? 'selected' : ''}>${o.label}</option>`).join('');

  const progress = t.estimate
    ? `<div class="progress ${own > t.estimate * 60000 ? 'over' : ''}" data-prog="${t.id}"><i style="width:${Math.min(100, (own / (t.estimate * 60000)) * 100)}%"></i></div>`
    : '';

  const sessions = [...t.log].map((x, i) => ({ ...x, i })).sort((a, b) => b.s - a.s).slice(0, 8);
  const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const sessionsHTML = sessions.length
    ? `<details class="sessions"><summary>Sesiones (${t.log.length})</summary>${sessions
        .map(
          (x) => `<div class="session"><span>${esc(C.fmtDay(C.todayStr(x.s), today))}</span><span class="grow muted">${x.manual ? 'manual' : `${hhmm(x.s)} – ${x.e == null ? 'en curso' : hhmm(x.e)}`}</span><span>${C.fmtDur(C.sessionMs(x, now))}</span>${x.e == null ? '' : `<button class="icon-btn danger" style="width:24px;height:24px" data-action="del-session" data-i="${x.i}" aria-label="Eliminar sesión">${icon('x', 13)}</button>`}</div>`,
        )
        .join('')}</details>`
    : '';

  const prio = C.PRIORITIES.map((p) => `<button class="p${p.value} ${t.priority === p.value ? 'on' : ''}" data-action="priority" data-value="${p.value}">${icon('flag', 13)}${p.value === 0 ? 'Ninguna' : p.label}</button>`).join('');

  const tags = db.tags.map((tag) => `<button class="tagtoggle ${t.tags.includes(tag.id) ? 'on' : ''}" style="--c:${esc(tag.color)}" data-action="tag-toggle" data-id="${tag.id}"><i class="dot" style="--c:${esc(tag.color)}"></i>${esc(tag.name)}</button>`).join('');

  const steps = t.steps
    .map(
      (x, i) => `<div class="step ${x.done ? 'is-done' : ''}"><button class="check ${x.done ? 'done' : ''}" data-action="step-toggle" data-i="${i}" aria-label="Marcar paso">${icon('check')}</button><input class="txt" type="text" value="${esc(x.text)}" data-field="step-text" data-i="${i}" data-fk="step-${i}"><button class="icon-btn danger" data-action="step-del" data-i="${i}" aria-label="Eliminar paso">${icon('x', 14)}</button></div>`,
    )
    .join('');

  const kidsHTML = kids
    .map((k) => {
      const kRun = C.isRunning(k);
      const info = [k.steps.length ? `${k.steps.filter((x) => x.done).length}/${k.steps.length} pasos` : '', C.taskMs(k, now) >= 1000 ? C.fmtDur(C.taskMs(k, now)) : ''].filter(Boolean).join(' · ');
      return `<div class="sub-row ${k.done ? 'is-done' : ''}"><button class="check p${k.priority} ${k.done ? 'done' : ''}" data-action="toggle" data-id="${k.id}" aria-label="Completar subtarea">${icon('check')}</button><button class="sub-title" data-action="open" data-id="${k.id}">${esc(k.title)}</button><span class="sub-info">${esc(info)}</span>${k.done ? '' : `<button class="icon-btn" style="opacity:1;${kRun ? 'color:var(--ok)' : ''}" data-action="timer" data-id="${k.id}" aria-label="Cronómetro">${icon(kRun ? 'pause' : 'play', 13)}</button>`}<button class="icon-btn danger" data-action="delete" data-id="${k.id}" aria-label="Eliminar subtarea">${icon('x', 14)}</button></div>`;
    })
    .join('');

  const created = `${C.fmtDay(C.todayStr(t.createdAt), today)}, ${hhmm(t.createdAt)}`;

  return `<div class="detail-inner">
    <div class="detail-head">
      <button class="icon-btn" data-action="close-detail" title="Cerrar (Esc)" aria-label="Cerrar">${icon(IS_POPUP || matchMedia('(max-width: 719px)').matches ? 'left' : 'x', 18)}</button>
      <div class="crumb">${parent ? `<button data-action="open" data-id="${parent.id}">${esc(parent.title)}</button> › Subtarea` : 'Tarea'}</div>
      <button class="icon-btn danger" data-action="delete" data-id="${t.id}" title="Eliminar tarea" aria-label="Eliminar tarea">${icon('trash', 17)}</button>
    </div>
    <div class="detail-body">
      <div class="card list">
        <div class="d-top">
          <button class="check p${t.priority} ${t.done ? 'done' : ''}" data-action="toggle" data-id="${t.id}" aria-label="Completar">${icon('check')}</button>
          <textarea class="d-title ${t.done ? 'is-done' : ''}" rows="1" data-field="title" data-fk="d-title" placeholder="Título de la tarea" aria-label="Título">${esc(t.title)}</textarea>
        </div>
        <textarea class="notes" data-field="notes" data-fk="notes" placeholder="Notas" aria-label="Notas">${esc(t.notes)}</textarea>
      </div>

      <div class="card timer-card">
        <div class="timer-main">
          <div class="timer-clock ${running ? 'on' : ''}" data-elapsed="own:${t.id}">${C.fmtClock(own)}</div>
          <button class="timer-btn ${running ? 'on' : ''}" data-action="timer" data-id="${t.id}" ${t.done ? 'disabled' : ''}>${icon(running ? 'pause' : 'play', 14)}${running ? 'Pausar' : own > 0 ? 'Continuar' : 'Iniciar'}</button>
        </div>
        ${progress}
        <div class="timer-sub">
          <label class="inline-field">Estimado<select class="select sm" data-field="estimate" data-fk="estimate" aria-label="Tiempo estimado">${estOpts}</select></label>
          ${kids.length ? `<span>Total con subtareas: <b data-elapsed="tot:${t.id}">${C.fmtClock(C.totalMs(db, t, now))}</b></span>` : ''}
          <span class="grow"></span>
          <button class="chip-btn" data-action="add-time" data-min="5">+5 min</button>
          <button class="chip-btn" data-action="add-time" data-min="15">+15 min</button>
          ${own > 0 ? `<button class="chip-btn" data-action="reset-time" title="Borrar el tiempo registrado">Reiniciar</button>` : ''}
        </div>
        ${sessionsHTML}
      </div>

      <div class="d-label">Prioridad</div>
      <div class="card pad-sm"><div class="seg">${prio}</div></div>

      <div class="card list">
        <label class="li"><span class="li-l">Fecha</span><input type="date" class="li-ctl" data-field="due" data-fk="due" value="${t.due || ''}"></label>
        <label class="li"><span class="li-l">Hora</span><input type="time" class="li-ctl" data-field="time" data-fk="time" value="${t.time || ''}" ${t.due ? '' : 'disabled'}></label>
        ${
          parent
            ? ''
            : `<label class="li"><span class="li-l">Repetir</span><select class="li-ctl" data-field="repeat" data-fk="repeat" ${t.due ? '' : 'disabled title="Elige una fecha para poder repetir la tarea"'}>${repeatOpts}</select></label>`
        }
        <label class="li"><span class="li-l">Recordatorio</span><select class="li-ctl" data-field="remind" data-fk="remind">${remindOpts}</select></label>
        <div class="li li-chips">
          <button class="chip-btn" data-action="set-due" data-to="today">Hoy</button>
          <button class="chip-btn" data-action="set-due" data-to="tomorrow">Mañana</button>
          <button class="chip-btn" data-action="set-due" data-to="week">En una semana</button>
          ${t.due ? `<button class="chip-btn" data-action="set-due" data-to="none">Sin fecha</button>` : ''}
        </div>
      </div>

      <div class="d-label">Etiquetas</div>
      <div class="card pad-sm">
        <div class="tagpick">${tags}<input class="input tag-new" type="text" data-field="tag-new" data-fk="tag-new" placeholder="+ Nueva" maxlength="24" autocomplete="off"></div>
      </div>

      <div class="d-label">Pasos<span class="grow"></span>${t.steps.length ? `<span class="aux">${stepsDone}/${t.steps.length}</span>` : ''}</div>
      <div class="card list">
        ${t.steps.length ? `<div class="li li-prog"><div class="progress steps"><i style="width:${(stepsDone / t.steps.length) * 100}%"></i></div></div>` : ''}
        ${steps}
        <div class="add-line">${icon('plus', 17)}<input type="text" data-field="step-new" data-fk="step-new" placeholder="Añadir paso (puedes pegar una lista)" autocomplete="off"></div>
      </div>

      ${
        parent
          ? ''
          : `<div class="d-label">Subtareas<span class="grow"></span>${kids.length ? `<span class="aux">${kids.filter((k) => k.done).length}/${kids.length}</span>` : ''}</div>
      <div class="card list">
        ${kidsHTML}
        <div class="add-line">${icon('plus', 17)}<input type="text" data-field="sub-new" data-fk="sub-new" placeholder="${voice.active && voice.kind === 'sub' ? 'Escuchando…' : 'Añadir subtarea'}" value="${voice.active && voice.kind === 'sub' ? esc(voice.shown) : ''}" autocomplete="off">${micButton('sub')}</div>
      </div>`
      }

      <div class="meta-foot">Creada ${esc(created)}${t.done && t.completedAt ? ` · Completada ${esc(C.fmtDay(C.todayStr(t.completedAt), today))}, ${hhmm(t.completedAt)}` : ''}</div>
    </div>
  </div>`;
}

function renderDetail() {
  const app = $('#app');
  const el = $('#detail');
  const t = state.selected && task(state.selected);
  if (state.selected && !t) state.selected = null;
  app.classList.toggle('detail-open', !!t);
  if (!t) {
    el.innerHTML = '';
    delete el.dataset.id;
    return;
  }
  const a = document.activeElement;
  // Re-pintar mientras se edita una fecha/hora reinicia el segmento activo del campo: se aplaza al salir.
  if (a && el.contains(a) && a.matches('input[type=date], input[type=time]')) {
    state.detailDirty = true;
    return;
  }
  state.detailDirty = false;
  const prevTop = el.querySelector('.detail-body')?.scrollTop || 0;
  const same = el.dataset.id === t.id;
  paint(el, detailHTML(t));
  el.dataset.id = t.id;
  if (same) {
    const body = el.querySelector('.detail-body');
    if (body) body.scrollTop = prevTop;
  }
}

// ---------- ajustes ----------

function settingsHTML() {
  const db = state.db;
  const s = db.settings;
  const remindOpts = C.REMIND_OPTIONS.map((o) => `<option value="${o.value === null ? 'none' : o.value}" ${s.defaultReminder === o.value ? 'selected' : ''}>${o.label}</option>`).join('');
  const sw = (key, checked) => `<label class="switch"><input type="checkbox" data-set="${key}" ${checked ? 'checked' : ''}><i></i></label>`;
  const tags = db.tags
    .map((tag) => {
      const n = db.tasks.filter((t) => t.tags.includes(tag.id)).length;
      return `<div class="tag-edit"><button class="swatch" style="--c:${esc(tag.color)}" data-action="tag-color" data-id="${tag.id}" title="Cambiar color" aria-label="Cambiar color"></button><input type="text" value="${esc(tag.name)}" data-field="tag-name" data-id="${tag.id}" data-fk="tag-name-${tag.id}" maxlength="24"><span class="count">${n}</span><button class="icon-btn danger" data-action="tag-del" data-id="${tag.id}" aria-label="Eliminar etiqueta">${icon('trash', 15)}</button></div>`;
    })
    .join('');
  return `<div class="dlg-head"><h2>Ajustes</h2><button class="icon-btn" data-action="settings-close" aria-label="Cerrar">${icon('x', 18)}</button></div>
  <div class="dlg-body">
    <div class="set-sec">${HAS_EXT ? 'Notificaciones' : 'Avisos'}</div>
    <div class="card list">
      <div class="set-row"><div class="lab">${HAS_EXT ? 'Recordatorios de tareas<small>Aviso del navegador a la hora configurada</small>' : 'Avisos con la app abierta<small>Recordatorios y resumen diario mientras la tienes abierta</small>'}</div>${sw('notifications', s.notifications)}</div>
      <div class="set-row"><div class="lab">Recordatorio predeterminado<small>Para tareas con hora</small></div><select class="li-ctl" data-set="defaultReminder">${remindOpts}</select></div>
      <div class="set-row"><div class="lab">Hora para tareas sin hora<small>Solo si eliges un recordatorio manual</small></div><input class="li-ctl" type="time" data-set="allDayTime" value="${esc(s.allDayTime)}"></div>
      <div class="set-row"><div class="lab">Resumen diario<small>Cuántas tareas tienes para hoy</small></div><input class="li-ctl" type="time" data-set="digestTime" value="${esc(s.digestTime)}" ${s.digest ? '' : 'disabled'}>${sw('digest', s.digest)}</div>
      ${
        !HAS_EXT && 'Notification' in window
          ? `<div class="set-row"><div class="lab">Notificaciones del sistema<small>${{ granted: 'Permitidas', denied: 'Bloqueadas en el navegador', default: 'Aún sin permiso' }[Notification.permission] || ''}</small></div><button class="chip-btn" data-action="notif-permission">Permitir</button></div>`
          : ''
      }
      <button class="li-action" data-action="test-notif">${icon('bell', 17)}${HAS_EXT ? 'Probar notificación' : 'Probar aviso'}</button>
    </div>
    ${HAS_EXT ? '' : '<div class="set-foot">Una página web no puede avisarte con la app cerrada: eso lo hace la extensión del navegador de escritorio. En el móvil, los avisos salen mientras la app está abierta.</div>'}

    <div class="set-sec">Voz</div>
    <div class="card list">
      ${
        voiceSupported()
          ? `<div class="set-row"><div class="lab">Añadir al terminar de hablar<small>Aparece un aviso para editar o deshacer</small></div>${sw('voiceAuto', s.voiceAuto)}</div>
      <div class="set-row"><div class="lab">Idioma del dictado</div><select class="li-ctl" data-set="voiceLang">${C.VOICE_LANGS.map(([v, l]) => `<option value="${v}" ${s.voiceLang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lab">Micrófono<small>${{ granted: 'Permitido', denied: 'Bloqueado en el navegador', prompt: 'Aún sin permiso' }[state.micState] || 'Sin comprobar'}</small></div><button class="chip-btn" data-action="mic-permission">${IS_POPUP ? 'Abrir pestaña' : 'Permitir'}</button></div>`
          : `<div class="set-row"><div class="lab muted">Tu navegador no admite el dictado por voz.</div></div>`
      }
    </div>
    <div class="set-foot">${
      HAS_EXT
        ? 'Pulsa el micrófono o la tecla V; <b>Alt+Shift+V</b> funciona desde cualquier pestaña. El dictado usa el reconocimiento de voz del navegador: el audio se envía a Google (Chrome) o Microsoft (Edge) para transcribirlo, y requiere internet.'
        : 'Pulsa el micrófono o la tecla V. El dictado usa el reconocimiento de voz del navegador: el audio se envía a su servicio en la nube (Apple en Safari, Google en Chrome, Microsoft en Edge) y requiere internet. En el iPhone, con la app instalada en la pantalla de inicio, usa el micrófono del teclado.'
    }</div>

    <div class="set-sec">Apariencia</div>
    <div class="card list">
      <div class="set-row"><div class="lab">Tema</div><select class="li-ctl" data-set="theme">
        ${[['system', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
    </div>

    <div class="set-sec">Etiquetas</div>
    <div class="card list">
      ${tags || '<div class="set-row"><div class="lab muted">Aún no hay etiquetas. Crea una desde una tarea o escribiendo #nombre.</div></div>'}
    </div>

    <div class="set-sec">Datos</div>
    <div class="card list">
      <button class="li-action" data-action="export">${icon('download', 17)}Exportar copia de seguridad</button>
      ${
        IS_POPUP
          ? ''
          : `<button class="li-action" data-action="merge">${icon('repeat', 17)}Combinar con otra copia</button>
      <button class="li-action" data-action="import">${icon('upload', 17)}Importar y reemplazar todo</button>
      <input type="file" id="merge-file" accept="application/json,.json" class="hidden"><input type="file" id="import-file" accept="application/json,.json" class="hidden">`
      }
    </div>
    <div class="set-foot">Todo se guarda solo ${HAS_EXT ? 'en este navegador' : 'en este dispositivo'}. Para tener los mismos datos en dos dispositivos: exporta en uno y usa <b>Combinar</b> en el otro; se conserva la edición más reciente de cada tarea y se respetan los borrados.${IS_POPUP ? ' Para combinar o importar, abre la pestaña completa.' : ''}</div>
  </div>`;
}

// ---------- render global ----------

function applyTheme() {
  const th = state.db.settings.theme;
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('gt_theme', th);
  } catch {
    // sin localStorage
  }
}

function render() {
  if (!state.db) return;
  state.today = C.todayStr();
  applyTheme();
  paint($('#sidebar'), sidebarHTML());
  $('.main').classList.toggle('wide', state.view === 'calendar' || state.view === 'time');
  paint($('#topbar'), topbarHTML());
  paint($('#content'), contentHTML());
  const quick = $('[data-fk="quick"]');
  if (quick?.value) updatePreview(quick); // la vista previa se pierde al repintar
  renderDetail();
  paint($('#mini'), miniHTML());
  const dlg = $('#settings');
  if (dlg.open) paint(dlg, settingsHTML());
  updateLive();
}

function updateLive() {
  const db = state.db;
  const now = Date.now();
  document.querySelectorAll('[data-elapsed]').forEach((el) => {
    const [kind, id] = el.dataset.elapsed.split(':');
    const t = C.getTask(db, id);
    if (t) el.textContent = C.fmtClock(kind === 'tot' ? C.totalMs(db, t, now) : C.taskMs(t, now));
  });
  document.querySelectorAll('[data-prog]').forEach((el) => {
    const t = C.getTask(db, el.dataset.prog);
    if (!t || !t.estimate) return;
    const ms = C.taskMs(t, now);
    el.classList.toggle('over', ms > t.estimate * 60000);
    el.firstElementChild.style.width = `${Math.min(100, (ms / (t.estimate * 60000)) * 100)}%`;
  });
}

let ticks = 0;
function tick() {
  if (document.hidden || !state.db) return;
  ticks++;
  if (C.todayStr() !== state.today || (state.view === 'time' && ticks % 30 === 0)) render();
  else updateLive();
}

// ---------- avisos ----------

/**
 * `action`: { label, fn } o una lista de ellas (hasta dos caben bien en el aviso).
 * `sticky`: no se cierra solo (recordatorios); se añade un botón Cerrar.
 */
function toast(msg, action, { sticky = false } = {}) {
  const actions = [].concat(action || []);
  if (sticky) actions.push({ label: 'Cerrar', fn() {} });
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}`;
  el.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      actions[Number(b.dataset.i)].fn();
      el.remove();
    }),
  );
  box.append(el);
  if (!sticky) setTimeout(() => el.remove(), actions.length ? 7000 : 3200);
}

// ---------- avisos con la app abierta (versión web / móvil) ----------
// Sin servidor, una web no puede despertarse con la app cerrada: los recordatorios se revisan mientras está abierta.
// (En la extensión lo hace el service worker, por eso aquí no se ejecuta.)

async function checkWebReminders() {
  if (HAS_EXT || !state.db?.settings.notifications) return;
  const alerts = await mutate((db) => C.collectAlerts(db, Date.now()));
  alerts.forEach(announce);
}

function announce(a) {
  const actions = a.taskId && a.buttons
    ? [
        { label: 'Hecha', fn: () => mutate((db) => C.setDone(db, a.taskId, true)) },
        { label: '+10 min', fn: () => mutate((db) => C.snoozeTask(db, a.taskId)) },
      ]
    : [];
  toast(`${a.title}${a.message ? ` · ${a.message}` : ''}`, actions, { sticky: true });
  systemNotify(a.title, a.message);
}

async function systemNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) await reg.showNotification(title, { body, icon: 'icons/icon-192.png' });
    else new Notification(title, { body });
  } catch {
    // el sistema no admite notificaciones desde esta página
  }
}

// ---------- acciones ----------

const later = new Map();
function debounced(key, fn, ms = 300) {
  clearTimeout(later.get(key));
  later.set(key, setTimeout(fn, ms));
}

const patch = (id, p) => mutate((db) => C.updateTask(db, id, p));

function select(id) {
  state.selected = id;
  render();
}

async function removeTasks(ids, label) {
  const removed = await mutate((db) => ids.flatMap((id) => C.deleteTask(db, id)));
  const sel = removed.find((r) => r.id === state.selected);
  if (sel) state.selected = sel.parentId && !removed.some((r) => r.id === sel.parentId) ? sel.parentId : null;
  render();
  toast(label || 'Tarea eliminada', { label: 'Deshacer', fn: () => mutate((db) => C.restoreTasks(db, removed)) });
}

/** Crea una tarea desde texto libre según el contexto de la vista (hoy / todas / día del calendario). */
async function addQuickText(text, ctx, { voice: spoken = false } = {}) {
  const defaults = {};
  if (ctx === 'today') defaults.due = state.today;
  if (ctx === 'cal') defaults.due = state.day;
  if (state.tag) defaults.tags = [state.tag];
  const t = await mutate((db) => C.addFromQuick(db, text, defaults, Date.now(), { capitalize: spoken }));
  if (!t) return null;
  if (spoken) toastAdded(t, 'Añadida');
  else if (ctx === 'today' && t.due !== state.today) toast(`Añadida para ${C.fmtDay(t.due || state.today, state.today).toLowerCase()}`);
  else if (ctx === 'all' && state.tag === null && !t.due) toast('Añadida sin fecha');
  return t;
}

async function quickAdd(input) {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  updatePreview(input);
  await addQuickText(text, input.dataset.quick);
}

async function addSubtaskText(text, parentId, { voice: spoken = false } = {}) {
  if (!parentId) return null;
  const t = await mutate((db) => C.addFromQuick(db, text, { parentId }, Date.now(), { capitalize: spoken }));
  if (t && spoken) toastAdded(t, 'Subtarea añadida');
  return t;
}

/** Confirma lo que se ha entendido por voz y deja corregirlo (Editar) o descartarlo (Deshacer). */
function toastAdded(t, label) {
  const when = t.due ? ` · ${C.fmtDay(t.due, state.today).toLowerCase()}${t.time ? ` ${t.time}` : ''}` : '';
  toast(`${label}: ${t.title}${when}`, [
    { label: 'Editar', fn: () => select(t.id) },
    { label: 'Deshacer', fn: () => mutate((db) => C.deleteTask(db, t.id)) },
  ]);
}

// ---------- dictado por voz ----------
// Usa el reconocimiento de voz del navegador (Web Speech API). El texto se convierte con
// normalizeSpoken a la sintaxis rápida, así que se ve y se puede corregir como si se hubiera escrito.

const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
// En iOS, el dictado de la Web Speech API no funciona dentro de una app instalada en la pantalla de inicio
// (navigator.standalone): ahí se usa el micrófono del teclado del iPhone.
const voiceSupported = () => !!getSR() && navigator.standalone !== true;
const voice = { rec: null, active: false, kind: null, ctx: 'all', parentId: null, raw: '', shown: '', error: null, aborted: false };

const VOICE_ERRORS = {
  'no-speech': 'No te he oído. Pulsa el micrófono e inténtalo de nuevo.',
  'audio-capture': 'No encuentro ningún micrófono.',
  network: 'El dictado necesita conexión a internet.',
  'language-not-supported': 'Ese idioma no está disponible para el dictado.',
};

async function micPermission() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return 'prompt'; // sin Permissions API: se intenta y el navegador preguntará
  }
}

async function refreshMicState() {
  state.micState = await micPermission();
  const dlg = $('#settings');
  if (dlg.open) paint(dlg, settingsHTML());
}

function openTab(hash = '') {
  if (HAS_EXT) chrome.runtime.sendMessage({ type: 'open-app', hash }, () => window.close());
}

const voiceInput = () => (voice.kind === 'sub' ? $('[data-field="sub-new"]') : $('[data-quick]'));

async function startVoice(kind) {
  if (voice.active) return stopVoice();
  const SR = getSR();
  if (!SR) return toast('Tu navegador no admite el dictado por voz');
  const perm = await micPermission();
  if (perm === 'denied') return toast('El micrófono está bloqueado. Actívalo desde el candado de la barra de direcciones.');
  if (IS_POPUP && perm !== 'granted') {
    // un popup no puede mostrar el aviso de permiso: se concede una vez desde la pestaña completa
    return toast('Concede permiso al micrófono una vez en la pestaña completa.', { label: 'Abrir', fn: () => openTab('#voice') });
  }
  const input = kind === 'sub' ? $('[data-field="sub-new"]') : $('[data-quick]');
  const rec = new SR();
  rec.lang = state.db.settings.voiceLang || 'es-ES';
  rec.interimResults = true; // el texto aparece mientras hablas
  rec.continuous = false; // se detiene solo al callar
  rec.maxAlternatives = 1;
  Object.assign(voice, { rec, active: true, kind, ctx: input?.dataset.quick || 'all', parentId: state.selected, raw: '', shown: '', error: null, aborted: false });
  rec.onresult = (e) => {
    voice.raw = Array.from(e.results).map((r) => r[0].transcript).join(' ');
    voice.shown = C.normalizeSpoken(voice.raw);
    const field = voiceInput();
    if (field) {
      field.value = voice.shown;
      updatePreview(field);
    }
  };
  rec.onerror = (e) => {
    voice.error = e.error;
  };
  rec.onend = finishVoice;
  try {
    rec.start();
  } catch {
    voice.error = 'start';
    return finishVoice();
  }
  render();
}

function stopVoice(abort = false) {
  if (!voice.active) return;
  voice.aborted = abort;
  try {
    if (abort) voice.rec.abort();
    else voice.rec.stop(); // entrega el resultado final antes de terminar
  } catch {
    finishVoice();
  }
}

async function finishVoice() {
  if (!voice.active) return;
  const { kind, ctx, parentId, raw, error, aborted } = voice;
  voice.active = false;
  voice.rec = null;
  const text = C.normalizeSpoken(raw);
  // Consola (F12): permite distinguir si el fallo es del reconocimiento del navegador (raw) o de la conversión (text)
  console.debug('[voz]', { oído: raw, entendido: text, error, cancelado: aborted });
  const clear = () => {
    const field = voiceInput();
    if (field) {
      field.value = '';
      updatePreview(field);
    }
  };

  if (aborted) {
    clear();
    return render();
  }
  if (error && error !== 'no-speech' && error !== 'aborted') {
    clear();
    render();
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      return toast(
        ios
          ? 'Sin permiso de voz. Activa «Dictado» en Ajustes → General → Teclado y permite el micrófono a este sitio; o usa el micrófono del teclado.'
          : IS_POPUP
            ? 'Sin permiso para el micrófono. Concédelo una vez en la pestaña completa.'
            : 'Sin permiso para el micrófono. Permítelo desde el candado de la barra de direcciones.',
        IS_POPUP ? { label: 'Abrir', fn: () => openTab('#voice') } : undefined,
      );
    }
    return toast(VOICE_ERRORS[error] || 'No se pudo usar el dictado por voz.');
  }
  if (!text) {
    clear();
    render();
    return toast(VOICE_ERRORS['no-speech']);
  }

  if (state.db.settings.voiceAuto) {
    clear();
    render();
    if (kind === 'sub') await addSubtaskText(text, parentId, { voice: true });
    else await addQuickText(text, ctx, { voice: true });
  } else {
    // modo manual: el texto queda en el campo para revisarlo y pulsar Enter
    render();
    const field = voiceInput();
    if (field) {
      field.value = text;
      updatePreview(field);
      field.focus();
    }
    toast('Revisa el texto y pulsa Enter para añadirla');
  }
}

function updatePreview(input) {
  const box = input.closest('.qa-wrap')?.querySelector('.qa-preview');
  if (!box) return;
  const p = input.value.trim() ? C.parseQuick(input.value, Date.now()) : null;
  const chips = [];
  if (p?.due) chips.push(`<span class="pv">${icon('calendar', 12)}${esc(C.fmtDay(p.due, state.today))}${p.time ? ` · ${p.time}` : ''}</span>`);
  else if (p?.time) chips.push(`<span class="pv">${icon('clock', 12)}${p.time}</span>`);
  if (p?.repeat) chips.push(`<span class="pv">${icon('repeat', 12)}${C.repeatLabel(p.repeat)}</span>`);
  if (p?.priority) chips.push(`<span class="pv">${icon('flag', 12)}${C.PRIORITIES.find((x) => x.value === p.priority).label}</span>`);
  p?.tags.forEach((n) => chips.push(`<span class="pv">${icon('tag', 12)}${esc(n)}</span>`));
  box.innerHTML = chips.join('');
}

async function addSteps(texts) {
  const id = state.selected;
  const clean = texts.map((x) => x.replace(/^\s*(?:[-*•]|\[[ xX]\])\s*/, '').trim()).filter(Boolean);
  if (!id || !clean.length) return;
  await mutate((db) => {
    const t = C.getTask(db, id);
    if (t) C.updateTask(db, id, { steps: [...t.steps, ...clean.map((text) => ({ id: C.uid(), text, done: false }))] });
  });
}

const actions = {
  nav(el) {
    state.view = el.dataset.view;
    state.tag = null;
    state.q = '';
    state.prio = '';
    if (IS_POPUP) state.selected = null;
    savePrefs();
    render();
  },
  'tag-filter'(el) {
    state.tag = state.tag === el.dataset.id ? null : el.dataset.id;
    state.view = state.tag ? 'all' : state.view;
    state.q = '';
    if (IS_POPUP) state.selected = null;
    savePrefs();
    render();
  },
  'clear-tag'() {
    state.tag = null;
    render();
  },
  open(el) {
    select(el.dataset.id);
  },
  'close-detail'() {
    state.selected = null;
    render();
  },
  async toggle(el) {
    const t = task(el.dataset.id);
    if (!t) return;
    const next = await mutate((db) => C.setDone(db, t.id, !t.done));
    if (next) {
      const when = `${C.fmtDay(next.due, state.today).toLowerCase()}${next.time ? ` · ${next.time}` : ''}`;
      toast(`Se repetirá: ${when}`, { label: 'Deshacer', fn: () => mutate((db) => C.setDone(db, t.id, false)) });
    }
  },
  async timer(el) {
    const t = task(el.dataset.id);
    if (!t) return;
    await mutate((db) => (C.isRunning(t) ? C.stopTimers(db) : C.startTimer(db, t.id)));
  },
  delete(el) {
    removeTasks([el.dataset.id]);
  },
  priority(el) {
    patch(state.selected, { priority: Number(el.dataset.value) });
  },
  'set-due'(el) {
    const to = el.dataset.to;
    const due = to === 'today' ? state.today : to === 'tomorrow' ? C.addDays(state.today, 1) : to === 'week' ? C.addDays(state.today, 7) : null;
    patch(state.selected, { due });
  },
  'tag-toggle'(el) {
    const t = task(state.selected);
    if (!t) return;
    const id = el.dataset.id;
    patch(t.id, { tags: t.tags.includes(id) ? t.tags.filter((x) => x !== id) : [...t.tags, id] });
  },
  'step-toggle'(el) {
    const t = task(state.selected);
    const i = Number(el.dataset.i);
    if (t) patch(t.id, { steps: t.steps.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) });
  },
  'step-del'(el) {
    const t = task(state.selected);
    const i = Number(el.dataset.i);
    if (t) patch(t.id, { steps: t.steps.filter((_, j) => j !== i) });
  },
  'add-time'(el) {
    mutate((db) => C.addManualTime(db, state.selected, Number(el.dataset.min) * 60000));
  },
  'reset-time'() {
    if (confirm('¿Borrar todo el tiempo registrado de esta tarea?')) mutate((db) => C.resetTime(db, state.selected));
  },
  'del-session'(el) {
    const t = task(state.selected);
    const i = Number(el.dataset.i);
    if (t) patch(t.id, { log: t.log.filter((_, j) => j !== i) });
  },
  collapse(el) {
    const id = el.dataset.id;
    if (!state.collapsed.delete(id)) state.collapsed.add(id);
    savePrefs();
    render();
  },
  'toggle-done-today'() {
    state.showDoneToday = !state.showDoneToday;
    render();
  },
  'clear-done'() {
    const ids = state.db.tasks.filter((t) => t.done && !t.parentId).map((t) => t.id);
    const orphanDone = state.db.tasks.filter((t) => t.done && t.parentId && !ids.includes(t.parentId)).map((t) => t.id);
    if (ids.length + orphanDone.length) removeTasks([...ids, ...orphanDone], 'Tareas completadas eliminadas');
  },
  'cal-prev'() {
    state.month = shiftMonth(state.month, -1);
    render();
  },
  'cal-next'() {
    state.month = shiftMonth(state.month, 1);
    render();
  },
  'cal-today'() {
    state.month = state.today.slice(0, 7);
    state.day = state.today;
    render();
  },
  'cal-day'(el) {
    state.day = el.dataset.date;
    if (state.day.slice(0, 7) !== state.month) state.month = state.day.slice(0, 7);
    render();
  },
  'settings-open'() {
    const dlg = $('#settings');
    paint(dlg, settingsHTML());
    if (!dlg.open) dlg.showModal();
    refreshMicState();
  },
  'settings-close'() {
    $('#settings').close();
  },
  'open-tab'(el) {
    openTab(el.dataset.hash || '');
  },
  mic(el) {
    startVoice(el.dataset.mic);
  },
  async 'mic-permission'() {
    if (IS_POPUP) return openTab('#voice'); // el popup no puede pedir permiso
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      toast('Micrófono permitido');
    } catch (e) {
      toast(e.name === 'NotFoundError' ? 'No encuentro ningún micrófono.' : 'Permiso denegado. Actívalo desde el candado de la barra de direcciones.');
    }
    refreshMicState();
  },
  'test-notif'() {
    if (HAS_EXT) chrome.runtime.sendMessage({ type: 'test-notification' });
    else announce({ title: 'Gestor de Tareas', message: 'Los avisos funcionan correctamente.', buttons: false });
  },
  async 'notif-permission'() {
    if (!('Notification' in window)) return toast('Este navegador no admite notificaciones del sistema');
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? 'Notificaciones permitidas' : 'Notificaciones no permitidas');
    const dlg = $('#settings');
    if (dlg.open) paint(dlg, settingsHTML());
  },
  merge() {
    $('#merge-file')?.click();
  },
  'tag-color'(el) {
    mutate((db) => {
      const tag = db.tags.find((x) => x.id === el.dataset.id);
      if (tag) tag.color = C.TAG_COLORS[(C.TAG_COLORS.indexOf(tag.color) + 1) % C.TAG_COLORS.length];
    });
  },
  'tag-del'(el) {
    const tag = tagById(el.dataset.id);
    if (tag && confirm(`¿Eliminar la etiqueta «${tag.name}»? Se quitará de todas las tareas.`)) {
      if (state.tag === tag.id) state.tag = null;
      mutate((db) => C.deleteTag(db, tag.id));
    }
  },
  export() {
    const blob = new Blob([JSON.stringify(state.db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gestor-tareas-${C.todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() {
    $('#import-file')?.click();
  },
};

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- eventos ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.field;
  if (el.dataset.quick) return updatePreview(el);
  if (!f) return;
  const id = state.selected;
  if (f === 'search') {
    state.q = el.value;
    paint($('#content'), contentHTML());
  } else if (f === 'title') {
    autosize(el);
    const text = el.value.replace(/\n/g, ' ').trim();
    if (text) debounced(`title:${id}`, () => patch(id, { title: text }));
  } else if (f === 'notes') {
    autosize(el);
    debounced(`notes:${id}`, () => patch(id, { notes: el.value }));
  } else if (f === 'step-text') {
    const i = Number(el.dataset.i);
    debounced(`step:${id}:${i}`, () => {
      const t = task(id);
      if (t && t.steps[i]) patch(id, { steps: t.steps.map((s, j) => (j === i ? { ...s, text: el.value } : s)) });
    });
  } else if (f === 'tag-name') {
    const tid = el.dataset.id;
    const name = el.value.trim();
    if (name) debounced(`tag:${tid}`, () => mutate((db) => {
      const tag = db.tags.find((x) => x.id === tid);
      if (tag) tag.name = name;
    }));
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const f = el.dataset.field;
  const id = state.selected;

  if (el.dataset.set) {
    const key = el.dataset.set;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'defaultReminder') val = val === 'none' ? null : Number(val);
    await mutate((db) => {
      db.settings[key] = val;
    });
    return;
  }
  if (el.id === 'import-file' || el.id === 'merge-file') {
    const file = el.files[0];
    el.value = ''; // permite elegir de nuevo el mismo archivo
    return el.id === 'merge-file' ? mergeFile(file) : importFile(file);
  }
  if (!f) return;

  if (f === 'sort' || f === 'group') {
    state[f] = el.value;
    savePrefs();
    render();
  } else if (f === 'prio') {
    state.prio = el.value;
    render();
  } else if (f === 'due') {
    patch(id, { due: el.value || null });
  } else if (f === 'time') {
    patch(id, { time: el.value || null });
  } else if (f === 'remind') {
    patch(id, { remind: el.value === 'auto' ? 'auto' : el.value === 'none' ? null : Number(el.value) });
  } else if (f === 'repeat') {
    patch(id, { repeat: el.value === 'none' ? null : el.value });
  } else if (f === 'estimate') {
    patch(id, { estimate: el.value ? Number(el.value) : null });
  } else if (f === 'title') {
    const text = el.value.replace(/\n/g, ' ').trim();
    if (text) patch(id, { title: text });
    else el.value = task(id)?.title || '';
  } else if (f === 'notes') {
    patch(id, { notes: el.value });
  } else if (f === 'step-text') {
    const i = Number(el.dataset.i);
    const t = task(id);
    if (!t || !t.steps[i]) return;
    if (el.value.trim()) patch(id, { steps: t.steps.map((s, j) => (j === i ? { ...s, text: el.value.trim() } : s)) });
    else patch(id, { steps: t.steps.filter((_, j) => j !== i) });
  } else if (f === 'tag-name') {
    const name = el.value.trim();
    if (!name) el.value = tagById(el.dataset.id)?.name || '';
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target.matches?.('input[type=date], input[type=time]')) {
    setTimeout(() => {
      if (state.detailDirty && !document.activeElement?.matches('input[type=date], input[type=time]')) renderDetail();
    }, 0);
  }
});

document.addEventListener('keydown', async (e) => {
  const el = e.target;
  const typing = el.matches?.('input, textarea, select, [contenteditable]');

  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
    if (el.dataset.quick) {
      e.preventDefault();
      quickAdd(el);
    } else if (el.dataset.field === 'step-new') {
      e.preventDefault();
      const v = el.value;
      el.value = '';
      addSteps([v]);
    } else if (el.dataset.field === 'sub-new') {
      e.preventDefault();
      const v = el.value.trim();
      el.value = '';
      if (v) await addSubtaskText(v, state.selected);
    } else if (el.dataset.field === 'tag-new') {
      e.preventDefault();
      const v = el.value.trim();
      el.value = '';
      if (v && state.selected) {
        await mutate((db) => {
          const tag = C.ensureTag(db, v);
          const t = C.getTask(db, state.selected);
          if (t && !t.tags.includes(tag.id)) C.updateTask(db, t.id, { tags: [...t.tags, tag.id] });
        });
      }
    } else if (el.dataset.field === 'title') {
      e.preventDefault();
      el.blur();
    } else if (el.dataset.field === 'step-text') {
      e.preventDefault();
      el.blur();
      $('[data-fk="step-new"]')?.focus();
    }
    return;
  }

  if (e.key === 'Escape') {
    if (voice.active) {
      stopVoice(true); // Esc cancela el dictado sin crear nada
      return;
    }
    if ($('#settings').open) return; // el diálogo se cierra solo
    if (el.dataset?.quick && el.value) {
      el.value = '';
      updatePreview(el);
    } else if (state.selected) {
      state.selected = null;
      render();
    }
    return;
  }

  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'N') && !$('#settings').open) {
    const q = $('[data-fk="quick"]');
    if (q) {
      e.preventDefault();
      q.focus();
    }
  }

  // V: dictar una tarea
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'v' || e.key === 'V') && !$('#settings').open && voiceSupported() && $('[data-quick]')) {
    e.preventDefault();
    startVoice('quick');
  }
});

document.addEventListener('paste', (e) => {
  const el = e.target;
  if (el.dataset?.field !== 'step-new') return;
  const text = e.clipboardData.getData('text');
  if (!/\r?\n/.test(text.trim())) return;
  e.preventDefault();
  addSteps(text.split(/\r?\n/));
});

// arrastrar tareas a otro día del calendario
let dragId = null;
const clearDrop = () => document.querySelectorAll('.cell.drop').forEach((c) => c.classList.remove('drop'));
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('[data-drag]');
  if (!el) return;
  dragId = el.dataset.drag;
  e.dataTransfer.setData('text/plain', dragId);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
  const cell = e.target.closest?.('.cell');
  if (!dragId || !cell) return;
  e.preventDefault();
  if (!cell.classList.contains('drop')) {
    clearDrop();
    cell.classList.add('drop');
  }
});
document.addEventListener('drop', async (e) => {
  const cell = e.target.closest?.('.cell');
  if (!dragId || !cell) return;
  e.preventDefault();
  const id = dragId;
  dragId = null;
  clearDrop();
  state.day = cell.dataset.date;
  await patch(id, { due: cell.dataset.date });
  toast(`Movida a ${C.fmtDay(cell.dataset.date, state.today).toLowerCase()}`);
});
document.addEventListener('dragend', () => {
  dragId = null;
  clearDrop();
});

async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tasks)) throw new Error('formato');
    if (!confirm(`Se reemplazarán tus datos actuales por los del archivo (${data.tasks.length} tareas). ¿Continuar?`)) return;
    await replaceAll(data);
    state.selected = null;
    toast('Datos importados');
  } catch {
    toast('No se pudo importar: el archivo no es una copia válida');
  }
}

async function mergeFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tasks)) throw new Error('formato');
    const s = await mergeIn(data);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    toast(`Combinado: ${plural(s.added, 'nueva', 'nuevas')}, ${plural(s.updated, 'actualizada', 'actualizadas')}, ${plural(s.removed, 'eliminada', 'eliminadas')}`);
  } catch {
    toast('No se pudo combinar: el archivo no es una copia válida');
  }
}

// ---------- enlaces (#task=ID, #view=calendar) ----------

function applyHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.toString()) return;
  const view = h.get('view');
  if (view && ['today', 'calendar', 'all', 'done', 'time'].includes(view)) {
    state.view = view;
    state.tag = null;
  }
  const id = h.get('task');
  if (id && task(id)) state.selected = id;
  const wantsVoice = h.has('voice') && !IS_POPUP;
  if (wantsVoice) {
    // #voice (atajo global o botón "Abrir" del popup): vuelve a una vista con campo de añadir y empieza a escuchar
    if (!['today', 'all', 'calendar'].includes(state.view)) state.view = 'today';
    state.tag = null;
    state.selected = null;
  }
  history.replaceState(null, '', location.pathname + location.search);
  render();
  if (wantsVoice) startVoice('quick');
}
window.addEventListener('hashchange', applyHash);

// ---------- arranque ----------

async function init() {
  state.db = await load();
  subscribe((db) => {
    state.db = db;
    render();
  });
  render();
  applyHash();
  setInterval(tick, 1000);
  // la barra superior gana un filo y se vuelve translúcida al desplazarse, como en iOS/macOS
  const main = $('.main');
  main.addEventListener('scroll', () => main.classList.toggle('scrolled', main.scrollTop > 4), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      render();
      checkWebReminders();
    }
  });
  if (!HAS_EXT) {
    navigator.storage?.persist?.().catch(() => {}); // pide al navegador que no borre los datos si falta espacio
    setTimeout(checkWebReminders, 2000);
    setInterval(checkWebReminders, 30000);
  }
}

init();
