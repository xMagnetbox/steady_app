'use strict';

/* ---------- storage (IndexedDB) ---------- */
const STORES = { worries: 'id', surprises: 'id', episodes: 'id', checkins: 'date' };
let DB;
let D = { worries: [], surprises: [], episodes: [], checkins: [] };
let view = 'today';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('steady', 1);
    r.onupgradeneeded = () => {
      for (const [s, k] of Object.entries(STORES)) {
        if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: k });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (s, mode, fn) => new Promise((res, rej) => {
  const t = DB.transaction(s, mode);
  const req = fn(t.objectStore(s));
  t.oncomplete = () => res(req && req.result);
  t.onerror = () => rej(t.error);
});
const dbAll = s => tx(s, 'readonly', o => o.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', o => o.put(v));
const dbDel = (s, k) => tx(s, 'readwrite', o => o.delete(k));
const dbClear = s => tx(s, 'readwrite', o => o.clear());
async function load() { for (const s of Object.keys(STORES)) D[s] = await dbAll(s); }

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dtlocal = d => `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = s => (s.length === 10 ? parseD(s) : new Date(s))
  .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const num = v => (v === '' || v == null ? null : Number(v));
// Sleep is entered as hours + minutes but stored as decimal hours, so the insights math is unchanged.
const hmToHours = (h, m) => {
  const hh = num(h), mm = num(m);
  if (hh == null && mm == null) return null;
  return Math.round((hh || 0) * 60 + (mm || 0)) / 60;
};
const hoursToHM = x => {
  if (x == null) return { h: '', m: '' };
  const t = Math.round(x * 60);
  return { h: Math.floor(t / 60), m: t % 60 };
};
const DAY = 86400000;
const daysSince = iso => Math.floor((Date.now() - new Date(iso)) / DAY) + 1;
const avg = a => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null);
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f1 = x => (x == null ? '–' : (Math.round(x * 10) / 10).toString());

const KIND = { headache: 'Headache', cold: 'Cold-like symptoms', muscle: 'Muscle pain', digestive: 'Digestive', other: 'Other' };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const slider = (name, min, max, val, suf = '') =>
  `<div class="slider"><input type="range" name="${name}" min="${min}" max="${max}" value="${val}" data-suffix="${suf}">` +
  `<output>${val}${suf}</output></div>`;

// Optional slider: stays "idle" and records nothing until the person actually touches it.
const optSlider = (name, min, max, val) => {
  const set = val != null;
  const start = Math.round((min + max) / 2);
  return `<div class="slider${set ? '' : ' idle'}"><input type="range" name="${name}" min="${min}" max="${max}" ` +
    `value="${set ? val : start}" data-opt="1" data-touched="${set ? 1 : 0}"><output>${set ? val : '–'}</output></div>`;
};

/* ---------- views ---------- */
function worryCard(w) {
  const due = w.resolveBy <= dstr(new Date());
  return `<div class="item"><div>${esc(w.text)}</div>
    <div class="muted small">Severity ${w.severity}/10 · Likelihood ${w.likelihood}% · ${due ? 'due' : 'resolve by'} ${fmtD(w.resolveBy)}</div>
    <div class="btns">
      <button data-action="outcome" data-id="${w.id}" data-v="true">Happened</button>
      <button data-action="outcome" data-id="${w.id}" data-v="partial">Partly</button>
      <button data-action="outcome" data-id="${w.id}" data-v="false">Didn't happen</button>
    </div></div>`;
}

function vToday() {
  const today = dstr(new Date());
  const c = D.checkins.find(x => x.date === today) || {};
  const sleepHM = hoursToHM(c.sleep);
  const due = D.worries.filter(w => !w.outcome && w.resolveBy <= today)
    .sort((a, b) => a.resolveBy.localeCompare(b.resolveBy));
  const active = D.episodes.filter(e => !e.end);
  const last = lsGet('steady.lastExport');
  const hasData = Object.values(D).some(a => a.length);
  const stale = hasData && (!last || (Date.now() - Number(last)) / DAY > 30);
  return `<h1>Today</h1>
  ${stale ? `<section class="card"><h2>Back up your data</h2>
    <p class="muted">${last ? 'It has been over a month since your last export.' : 'You have not exported a backup yet.'}</p>
    <button data-action="export">Export now</button></section>` : ''}
  ${due.length ? `<section class="card"><h2>Ready to review</h2>
    <p class="muted small">These worries have reached their date. Did they happen?</p>${due.map(worryCard).join('')}</section>` : ''}
  ${active.length ? `<section class="card"><h2>Ongoing</h2>${active.map(e =>
    `<div class="row"><span>${esc(KIND[e.kind])}${e.detail ? ' — ' + esc(e.detail) : ''}</span>
     <span class="muted">day ${daysSince(e.start)}</span></div>`).join('')}</section>` : ''}
  <section class="card"><h2>Daily check-in</h2>
  <p class="muted small">Takes under a minute. Leave anything blank that you don't know.</p>
  <form data-form="checkin">
    <label>Sleep last night</label>
    <div class="hm"><input name="sleepH" type="number" min="0" max="24" step="1" inputmode="numeric" placeholder="0" aria-label="Hours slept" value="${esc(sleepHM.h)}"><span>h</span>
      <input name="sleepM" type="number" min="0" max="59" step="1" inputmode="numeric" placeholder="0" aria-label="Minutes slept" value="${esc(sleepHM.m)}"><span>min</span></div>
    <label>Caffeine (servings)<input name="caffeine" type="number" step="1" min="0" inputmode="numeric" value="${esc(c.caffeine ?? '')}"></label>
    <label>Screen time (hours)<input name="screen" type="number" step="0.5" min="0" max="24" inputmode="decimal" value="${esc(c.screen ?? '')}"></label>
    <label>Mood today (1 = among the worst days, 10 = among the best)</label>${optSlider('mood', 1, 10, c.mood)}
    <label>Stress today (0–10)</label>${optSlider('stress', 0, 10, c.stress)}
    <label>Worry / anxiety today (0–10)</label>${optSlider('worry', 0, 10, c.worry)}
    <label>Headache today (0 = none)</label>${slider('headache', 0, 10, c.headache ?? 0)}
    <label>Notes<textarea name="notes">${esc(c.notes ?? '')}</textarea></label>
    <button class="primary" type="submit">${c.date ? 'Update' : 'Save'} today's check-in</button>
  </form></section>`;
}

function resolvedWorryCard(w) {
  const label = { true: 'Happened', partial: 'Partly', false: "Didn't happen" }[w.outcome];
  return `<div class="item"><div><span class="tag ${w.outcome}">${label}</span>${esc(w.text)}</div>
    <div class="muted small">Predicted ${w.likelihood}% · severity ${w.severity}/10 · logged ${fmtD(w.created)}</div>
    <div class="btns"><button class="danger" data-action="del" data-store="worries" data-id="${w.id}">Delete</button></div></div>`;
}

function vWorries() {
  const today = dstr(new Date());
  const open = D.worries.filter(w => !w.outcome).sort((a, b) => a.resolveBy.localeCompare(b.resolveBy));
  const done = D.worries.filter(w => w.outcome).sort((a, b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || ''));
  const surprises = [...D.surprises].sort((a, b) => b.created.localeCompare(a.created));
  const chip = (d, l) => `<button type="button" data-action="chip" data-days="${d}">${l}</button>`;
  return `<h1>Worries</h1>
  <section class="card"><h2>Log a worry</h2>
  <form data-form="worry">
    <label>What are you worried about?<input name="text" required maxlength="300" autocomplete="off"></label>
    <label>How bad would it be?</label>${slider('severity', 1, 10, 5, '/10')}
    <label>How likely do you think it is?</label>${slider('likelihood', 0, 100, 30, '%')}
    <label>Check back on<input name="resolveBy" type="date" required min="${today}" value="${dstr(addDays(new Date(), 7))}"></label>
    <div class="chips">${chip(1, 'Tomorrow')}${chip(7, '1 week')}${chip(30, '1 month')}${chip(90, '3 months')}</div>
    <button class="primary" type="submit">Save worry</button>
  </form></section>
  ${open.length ? `<section class="card"><h2>Open (${open.length})</h2>${open.map(worryCard).join('')}</section>` : ''}
  <section class="card"><h2>Log a surprise</h2>
  <p class="muted small">Something bad that happened without you having worried about it first.</p>
  <details><summary>Add one</summary>
  <form data-form="surprise">
    <label>What happened?<input name="text" required maxlength="300" autocomplete="off"></label>
    <label>How bad was it?</label>${slider('severity', 1, 10, 5, '/10')}
    <button class="primary" type="submit">Save surprise</button>
  </form></details>
  ${surprises.length ? `<h3>Logged surprises</h3>${surprises.map(s => `<div class="item"><div>${esc(s.text)}</div>
    <div class="muted small">Severity ${s.severity}/10 · ${fmtD(s.created)}</div>
    <div class="btns"><button class="danger" data-action="del" data-store="surprises" data-id="${s.id}">Delete</button></div></div>`).join('')}` : ''}
  </section>
  ${done.length ? `<section class="card"><h2>Resolved (${done.length})</h2>${done.map(resolvedWorryCard).join('')}</section>` : ''}`;
}

function episodeActive(e) {
  const reads = [...e.readings].reverse().slice(0, 4);
  return `<div class="item">
    <div><strong>${esc(KIND[e.kind])}</strong>${e.detail ? ' — ' + esc(e.detail) : ''}</div>
    <div class="muted small">Started ${new Date(e.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · day ${daysSince(e.start)}</div>
    ${reads.length ? `<div class="small" style="margin-top:6px">${reads.map(r =>
      `<div class="muted">${new Date(r.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}: severity ${r.severity}/10${r.temp != null ? ', ' + r.temp + '°F' : ''}${r.note ? ' — ' + esc(r.note) : ''}</div>`).join('')}</div>` : ''}
    <details><summary>Add a reading</summary>
      <form data-form="reading" data-id="${e.id}">
        <label>Temperature (°F, optional)<input name="temp" type="number" step="0.1" inputmode="decimal"></label>
        <label>Severity now</label>${slider('severity', 1, 10, reads[0]?.severity ?? e.severity, '/10')}
        <label>Note<input name="note" maxlength="200" autocomplete="off"></label>
        <button class="primary" type="submit">Save reading</button>
      </form></details>
    <div class="btns">
      ${e.kind === 'cold'
        ? `<button data-action="resolve" data-id="${e.id}" data-v="real">It turned into a cold</button>
           <button data-action="resolve" data-id="${e.id}" data-v="nothing">It blew over</button>`
        : `<button data-action="resolve" data-id="${e.id}" data-v="">It's over</button>`}
      <button class="danger" data-action="del" data-store="episodes" data-id="${e.id}">Delete</button>
    </div></div>`;
}

function episodePast(e) {
  const days = Math.max(1, Math.round((new Date(e.end) - new Date(e.start)) / DAY * 10) / 10);
  const out = e.outcome === 'real' ? '<span class="tag true">Became a cold</span>'
    : e.outcome === 'nothing' ? '<span class="tag false">Blew over</span>' : '';
  const peak = Math.max(e.severity, ...e.readings.map(r => r.severity));
  const temps = e.readings.map(r => r.temp).filter(t => t != null);
  return `<div class="item"><div>${out}<strong>${esc(KIND[e.kind])}</strong>${e.detail ? ' — ' + esc(e.detail) : ''}</div>
    <div class="muted small">${fmtD(e.start)} → ${fmtD(e.end)} (${days} day${days === 1 ? '' : 's'}) · peak ${peak}/10${temps.length ? ' · max temp ' + Math.max(...temps) + '°F' : ''}</div>
    <div class="btns"><button class="danger" data-action="del" data-store="episodes" data-id="${e.id}">Delete</button></div></div>`;
}

function vBody() {
  const active = D.episodes.filter(e => !e.end).sort((a, b) => b.start.localeCompare(a.start));
  const past = D.episodes.filter(e => e.end).sort((a, b) => b.end.localeCompare(a.end));
  return `<h1>Body</h1>
  <section class="card"><h2>Log a symptom</h2>
  <form data-form="episode">
    <label>Type<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>Details (optional)<input name="detail" maxlength="150" placeholder="e.g. scratchy throat, left shoulder" autocomplete="off"></label>
    <label>Severity</label>${slider('severity', 1, 10, 3, '/10')}
    <label>When did it start?<input name="start" type="datetime-local" required value="${dtlocal(new Date())}"></label>
    <label>Notes<textarea name="notes"></textarea></label>
    <button class="primary" type="submit">Start tracking</button>
  </form></section>
  ${active.length ? `<section class="card"><h2>Ongoing (${active.length})</h2>${active.map(episodeActive).join('')}</section>` : ''}
  ${past.length ? `<section class="card"><h2>History</h2>${past.map(episodePast).join('')}</section>` : ''}`;
}

function vInsights() {
  let h = '<h1>Insights</h1>';

  // --- worry calibration
  const res = D.worries.filter(w => w.outcome);
  const score = w => (w.outcome === 'true' ? 1 : w.outcome === 'partial' ? 0.5 : 0);
  h += '<section class="card"><h2>How accurate are your worries?</h2>';
  if (!res.length) {
    h += '<p class="muted">Nothing resolved yet. Once you mark a few worries as happened or not, the comparison appears here.</p>';
  } else {
    const pred = avg(res.map(w => w.likelihood)), act = avg(res.map(score)) * 100;
    h += `<p>${res.length} resolved. You predicted <strong>${Math.round(pred)}%</strong> on average; <strong>${Math.round(act)}%</strong> actually happened.</p>`;
    if (res.length < 15) h += '<p class="muted small">Small sample. This gets more meaningful after about 15–20 resolved worries.</p>';
    const buckets = [[0, 25], [25, 50], [50, 75], [75, 101]];
    h += '<h3>Predicted vs. actual</h3><div class="bars">';
    for (const [lo, hi] of buckets) {
      const b = res.filter(w => w.likelihood >= lo && w.likelihood < hi);
      const label = `${lo}–${Math.min(hi, 100)}%`;
      if (!b.length) { h += `<span>${label}</span><span class="muted small">no data</span><span></span>`; continue; }
      const p = avg(b.map(w => w.likelihood)), a = avg(b.map(score)) * 100;
      h += `<span>${label}</span><div><div class="bar pred" title="predicted"><i style="width:${p}%"></i></div><div class="bar act" style="margin-top:3px" title="actual"><i style="width:${a}%"></i></div></div><span class="muted">n=${b.length}</span>`;
    }
    h += '</div><p class="muted small">Grey = what you predicted. Teal = what happened. If teal is usually shorter, the worries are overestimating.</p>';
    const happened = res.filter(w => w.outcome !== 'false');
    const not = res.filter(w => w.outcome === 'false');
    if (happened.length && not.length) {
      h += `<p class="small">Average predicted severity: ${f1(avg(happened.map(w => w.severity)))}/10 for worries that happened, ${f1(avg(not.map(w => w.severity)))}/10 for ones that didn't.</p>`;
    }
  }
  h += '</section>';

  // --- foreseen vs surprises
  const happenedN = res.filter(w => w.outcome !== 'false').length;
  h += `<section class="card"><h2>Worries vs. surprises</h2>`;
  if (!happenedN && !D.surprises.length) {
    h += '<p class="muted">Log surprises (bad things you hadn\'t worried about) to see how much of what goes wrong is foreseen.</p>';
  } else {
    const tot = happenedN + D.surprises.length;
    h += `<p>${happenedN} bad thing${happenedN === 1 ? '' : 's'} you worried about beforehand, ${D.surprises.length} surprise${D.surprises.length === 1 ? '' : 's'}. That's <strong>${Math.round(happenedN / tot * 100)}%</strong> foreseen.</p>
    <p class="muted small">This only counts surprises you remembered to log, so treat it as rough.</p>`;
  }
  h += '</section>';

  // --- symptom episodes
  const done = D.episodes.filter(e => e.end);
  h += '<section class="card"><h2>Symptoms</h2>';
  const colds = done.filter(e => e.kind === 'cold' && e.outcome);
  if (colds.length) {
    const real = colds.filter(e => e.outcome === 'real').length;
    h += `<p>"Maybe I'm getting a cold": <strong>${real} of ${colds.length}</strong> turned into a real cold.</p>`;
  }
  const kinds = Object.keys(KIND).filter(k => done.some(e => e.kind === k));
  if (kinds.length) {
    h += '<table><tr><th>Type</th><th class="n">Count</th><th class="n">Median days</th></tr>';
    for (const k of kinds) {
      const es = done.filter(e => e.kind === k);
      const m = median(es.map(e => (new Date(e.end) - new Date(e.start)) / DAY));
      h += `<tr><td>${KIND[k]}</td><td class="n">${es.length}</td><td class="n">${f1(m)}</td></tr>`;
    }
    h += '</table>';
  } else if (!colds.length) {
    h += '<p class="muted">Resolve a few symptom episodes to see typical durations.</p>';
  }
  h += '</section>';

  // --- mood
  const cs = D.checkins;
  const withMood = cs.filter(c => c.mood != null);
  h += '<section class="card"><h2>Mood</h2>';
  if (!withMood.length) {
    h += '<p class="muted">Log your mood in the daily check-in to see trends here.</p>';
  } else {
    const within = n => withMood.filter(c => (Date.now() - parseD(c.date)) / DAY < n).map(c => c.mood);
    const w7 = within(7), w30 = within(30);
    h += `<p>${withMood.length} day${withMood.length === 1 ? '' : 's'} logged. Average <strong>${f1(avg(withMood.map(c => c.mood)))}</strong>` +
      (w7.length ? ` · last 7 days ${f1(avg(w7))}` : '') + (w30.length ? ` · last 30 days ${f1(avg(w30))}` : '') + '.</p>';
    const lo = withMood.filter(c => c.sleep != null && c.sleep < 7), hi = withMood.filter(c => c.sleep != null && c.sleep >= 7);
    if (lo.length >= 5 && hi.length >= 5) {
      h += `<p class="small">Mood after under 7h of sleep: ${f1(avg(lo.map(c => c.mood)))} (${lo.length} days) vs. 7h or more: ${f1(avg(hi.map(c => c.mood)))} (${hi.length} days).</p>`;
    }
  }
  h += '</section>';

  // --- daily worry level
  const withWorry = cs.filter(c => c.worry != null);
  if (withWorry.length) {
    h += '<section class="card"><h2>Daily worry level</h2>';
    h += `<p>${withWorry.length} day${withWorry.length === 1 ? '' : 's'} logged. Average <strong>${f1(avg(withWorry.map(c => c.worry)))}</strong>/10.</p>`;
    const hiW = withWorry.filter(c => c.worry >= 6), loW = withWorry.filter(c => c.worry < 6);
    const mHi = hiW.filter(c => c.mood != null), mLo = loW.filter(c => c.mood != null);
    const byDate = new Map(cs.map(c => [c.date, c]));
    const pairs = withWorry.map(c => [c, byDate.get(dstr(addDays(parseD(c.date), 1)))]).filter(p => p[1]);
    const pHi = pairs.filter(p => p[0].worry >= 6), pLo = pairs.filter(p => p[0].worry < 6);
    let shown = false;
    if (mHi.length >= 5 && mLo.length >= 5) {
      h += `<p class="small">Same-day mood on high-worry days (6+): ${f1(avg(mHi.map(c => c.mood)))} (${mHi.length} days) vs. other days: ${f1(avg(mLo.map(c => c.mood)))} (${mLo.length} days).</p>`;
      shown = true;
    }
    if (pHi.length >= 5 && pLo.length >= 5) {
      const rate = a => Math.round(a.filter(p => p[1].headache > 0).length / a.length * 100);
      h += `<p class="small">Headache the next day: ${rate(pHi)}% after high-worry days (${pHi.length}) vs. ${rate(pLo)}% after other days (${pLo.length}).</p>`;
      shown = true;
    }
    if (!shown) h += '<p class="muted small">Comparisons appear once you have at least 5 high-worry (6+) and 5 lower-worry days logged.</p>';
    h += '</section>';
  }

  // --- headache patterns
  const hd = cs.filter(c => c.headache > 0), nd = cs.filter(c => c.headache === 0);
  h += `<section class="card"><h2>Headache patterns</h2><p class="muted small">${cs.length} check-in${cs.length === 1 ? '' : 's'} · ${hd.length} headache day${hd.length === 1 ? '' : 's'}</p>`;
  if (hd.length >= 3 && nd.length >= 3) {
    const col = k => [hd, nd].map(a => avg(a.map(x => x[k]).filter(v => v != null && !isNaN(v))));
    h += '<table><tr><th></th><th class="n">Headache days</th><th class="n">Other days</th></tr>';
    for (const [k, l] of [['sleep', 'Sleep (h)'], ['caffeine', 'Caffeine'], ['stress', 'Stress'], ['screen', 'Screen (h)'], ['mood', 'Mood'], ['worry', 'Worry']]) {
      const [a, b] = col(k);
      h += `<tr><td>${l}</td><td class="n">${f1(a)}</td><td class="n">${f1(b)}</td></tr>`;
    }
    h += '</table>';
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    h += '<h3>By weekday</h3><div class="bars">';
    for (let i = 0; i < 7; i++) {
      const day = cs.filter(c => parseD(c.date).getDay() === i);
      if (!day.length) continue;
      const rate = day.filter(c => c.headache > 0).length / day.length * 100;
      h += `<span>${names[i]}</span><div class="bar act"><i style="width:${rate}%"></i></div><span class="muted">${Math.round(rate)}% (${day.length})</span>`;
    }
    h += '</div><p class="muted small">Small samples and many factors at once: treat these as hints to test, not conclusions.</p>';
  } else {
    h += '<p class="muted">Comparisons appear once you have at least 3 headache days and 3 headache-free days logged.</p>';
  }
  h += '</section>';
  return h;
}

function vData() {
  const last = lsGet('steady.lastExport');
  const n = k => D[k].length;
  return `<h1>Data</h1>
  <section class="card"><h2>What's stored</h2>
    <p>${n('worries')} worries · ${n('surprises')} surprises · ${n('episodes')} symptom episodes · ${n('checkins')} check-ins</p>
    <p class="muted small">Everything lives only in this browser on this device. Last export: ${last ? new Date(Number(last)).toLocaleDateString() : 'never'}.</p>
    <p class="muted small" id="persistNote"></p></section>
  <section class="card"><h2>Backup</h2>
    <p class="muted small">Export saves a JSON file you can keep in Files or iCloud Drive. Import merges a backup back in.</p>
    <div class="btns"><button data-action="export">Export</button><button data-action="import">Import</button></div></section>
  <section class="card"><h2>Danger zone</h2>
    <button class="danger" data-action="wipe">Delete all data</button></section>`;
}

/* ---------- render ---------- */
const VIEWS = { today: vToday, worries: vWorries, body: vBody, insights: vInsights, data: vData };
function render() {
  $('#app').innerHTML = VIEWS[view]();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'data') updatePersistNote();
}
async function refresh() { await load(); render(); }
function go(v) { view = v; render(); window.scrollTo(0, 0); }

async function updatePersistNote() {
  const el = $('#persistNote');
  if (!el || !navigator.storage?.persisted) return;
  const p = await navigator.storage.persisted();
  el.textContent = p ? 'Storage is marked persistent.' : 'Storage is not marked persistent, so the browser could clear it under pressure. Export regularly.';
}

/* ---------- export / import ---------- */
async function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'steady', version: 1, exportedAt: new Date().toISOString(), data: D }, null, 2)],
    { type: 'application/json' });
  const name = `steady-backup-${dstr(new Date())}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      lsSet('steady.lastExport', String(Date.now()));
      return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  lsSet('steady.lastExport', String(Date.now()));
  toast('Exported');
}

async function importData(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (obj.app !== 'steady' || !obj.data) throw new Error('Not a Steady backup');
    let count = 0;
    for (const s of Object.keys(STORES)) {
      for (const rec of obj.data[s] || []) { await dbPut(s, rec); count++; }
    }
    await refresh();
    toast(`Imported ${count} records`);
  } catch (e) { alert('Import failed: ' + e.message); }
}

/* ---------- events ---------- */
function touchSlider(t) {
  if (t.type !== 'range') return;
  if (t.dataset.opt) { t.dataset.touched = '1'; t.parentElement.classList.remove('idle'); }
  const o = t.parentElement.querySelector('output');
  if (o) o.textContent = t.value + (t.dataset.suffix || '');
}
document.addEventListener('input', e => touchSlider(e.target));
// A plain tap on an idle slider (no drag) still counts as choosing that value.
document.addEventListener('pointerup', e => { if (e.target.dataset && e.target.dataset.opt) touchSlider(e.target); });

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  const now = new Date().toISOString();
  // Optional sliders only count if the person touched them (or a value was already saved).
  const opt = n => {
    const el = f.querySelector(`[name="${n}"]`);
    return el && el.dataset.touched === '1' ? Number(fd[n]) : null;
  };
  switch (f.dataset.form) {
    case 'checkin':
      await dbPut('checkins', {
        date: dstr(new Date()), sleep: hmToHours(fd.sleepH, fd.sleepM), caffeine: num(fd.caffeine), screen: num(fd.screen),
        mood: opt('mood'), stress: opt('stress'), worry: opt('worry'), headache: Number(fd.headache), notes: fd.notes || '', savedAt: now,
      });
      toast('Check-in saved'); break;
    case 'worry':
      await dbPut('worries', {
        id: uid(), text: fd.text.trim(), severity: Number(fd.severity), likelihood: Number(fd.likelihood),
        created: now, resolveBy: fd.resolveBy, outcome: null, resolvedAt: null,
      });
      toast('Worry logged'); break;
    case 'surprise':
      await dbPut('surprises', { id: uid(), text: fd.text.trim(), severity: Number(fd.severity), created: now });
      toast('Surprise logged'); break;
    case 'episode': {
      const start = new Date(fd.start).toISOString();
      await dbPut('episodes', {
        id: uid(), kind: fd.kind, detail: (fd.detail || '').trim(), severity: Number(fd.severity),
        start, end: null, outcome: null, notes: fd.notes || '',
        readings: [{ t: start, temp: null, severity: Number(fd.severity), note: '' }],
      });
      toast('Tracking started'); break;
    }
    case 'reading': {
      const ep = D.episodes.find(x => x.id === f.dataset.id);
      if (!ep) return;
      ep.readings.push({ t: now, temp: num(fd.temp), severity: Number(fd.severity), note: (fd.note || '').trim() });
      await dbPut('episodes', ep);
      toast('Reading saved'); break;
    }
  }
  await refresh();
});

document.addEventListener('click', async e => {
  const tab = e.target.closest('#tabs button');
  if (tab) { go(tab.dataset.view); return; }
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action, id, v, store } = b.dataset;
  const now = new Date().toISOString();
  switch (action) {
    case 'outcome': {
      const w = D.worries.find(x => x.id === id);
      if (!w) return;
      w.outcome = v; w.resolvedAt = now;
      await dbPut('worries', w); await refresh(); toast('Recorded'); break;
    }
    case 'resolve': {
      const ep = D.episodes.find(x => x.id === id);
      if (!ep) return;
      ep.end = now; ep.outcome = v || null;
      await dbPut('episodes', ep); await refresh(); toast('Marked as over'); break;
    }
    case 'chip': {
      const inp = b.closest('form').querySelector('[name=resolveBy]');
      inp.value = dstr(addDays(new Date(), Number(b.dataset.days))); break;
    }
    case 'del':
      if (confirm('Delete this entry? This cannot be undone.')) { await dbDel(store, id); await refresh(); }
      break;
    case 'export': await exportData(); if (view === 'today' || view === 'data') render(); break;
    case 'import': $('#importFile').click(); break;
    case 'wipe':
      if (confirm('Delete ALL data on this device? Export a backup first if unsure.') &&
          confirm('Really delete everything?')) {
        for (const s of Object.keys(STORES)) await dbClear(s);
        await refresh(); toast('All data deleted');
      }
      break;
  }
});

$('#importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = '';
});

/* ---------- boot ---------- */
(async function init() {
  try {
    DB = await openDB();
    await load();
    render();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (err) {
    $('#app').innerHTML = `<h1>Steady</h1><p>Could not open local storage: ${esc(err.message || err)}.
      Private browsing can cause this.</p>`;
  }
})();
