'use strict';
/* The part that makes this a companion rather than a matcher: the day, the memory, the delta.

   - Today: the picks as an AM/PM checklist you tick off. Kept per day in this browser.
   - Memory: every read and every day's ticks are stored, so a second visit knows what happened.
   - Verify: a new read is shown against the last one — the delta pair, which is the whole claim.
   - Check-in: a demo control fast-forwards the timeline and writes a read whose movement follows
     how much of the routine was actually used. It is labelled simulated wherever it shows.

   Storage is localStorage, per browser: sync.demo.days, sync.demo.reads. Shares globals with app.js. */

const DAYS_KEY = 'sync.demo.days', READS_KEY = 'sync.demo.reads', CHECK_EVERY = 14;
const day = { days: {}, reads: [], offset: 0 };   // offset = simulated days ahead, demo only

const iso = d => new Date(d).toISOString().slice(0, 10);
const todayISO = () => iso(Date.now() + day.offset * 864e5);
const prettyDay = s => new Date(s + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const load = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
day.days = load(DAYS_KEY, {});
day.reads = load(READS_KEY, []);

const stepsToday = () => {
  const { am, pm } = routineOrder(state.items);
  return [...am.map(x => ['AM', ...x]), ...pm.map(x => ['PM', ...x])];
};
const stepId = (phase, p) => `${phase}:${p.id}`;
const doneSet = d => new Set((day.days[d] || {}).done || []);
function toggleStep(phase, p) {
  const d = todayISO(), rec = day.days[d] || (day.days[d] = { done: [] });
  const id = stepId(phase, p), i = rec.done.indexOf(id);
  i < 0 ? rec.done.push(id) : rec.done.splice(i, 1);
  save(DAYS_KEY, day.days);
  renderDay();
}

// how much of the plan actually got used, over the last week of recorded days
function adherence() {
  const ds = Object.keys(day.days).sort().slice(-7);
  if (!ds.length) return { rate: 0, used: 0, planned: 0, days: 0 };
  const planned = Math.max(1, stepsToday().length) * ds.length;
  const used = ds.reduce((t, d) => t + (day.days[d].done || []).length, 0);
  return { rate: Math.min(1, used / planned), used, planned, days: ds.length };
}
function streak() {
  let n = 0;
  for (let i = 0; ; i++) {
    const d = iso(Date.now() + (day.offset - i) * 864e5);
    if ((day.days[d] || {}).done?.length) n++;
    else if (i > 0) break;
  }
  return n;
}
const lastRead = () => day.reads[day.reads.length - 1];
const prevRead = () => day.reads[day.reads.length - 2];
function recordRead(read) {
  if (read.sample && day.reads.length) return;   // a sample never overwrites a real history
  day.reads.push({ at: todayISO(), sample: !!read.sample, scores: { ...read.scores } });
  save(READS_KEY, day.reads);
}
function deltas(a, b) {   // b - a, biggest movers first
  if (!a || !b) return [];
  return Object.keys(AXIS_WEIGHT).filter(k => a.scores[k] != null && b.scores[k] != null)
    .map(k => ({ axis: k, from: a.scores[k], to: b.scores[k], d: b.scores[k] - a.scores[k] }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const nextCheckIn = () => { const l = lastRead(); return l ? iso(new Date(l.at).getTime() + CHECK_EVERY * 864e5) : todayISO(); };

/* ── the day panel ── */
function renderDay() {
  const on = !!state.items.length;
  $('day').hidden = !on;
  if (!on) return;
  const d = todayISO(), done = doneSet(d), steps = stepsToday();
  const a = adherence(), st = streak(), watch = state.read ? rankAxes(state.read.scores)[0] : null;
  const last = lastRead(), due = daysBetween(d, nextCheckIn());

  $('day-date').textContent = prettyDay(d) + (day.offset ? ' · simulated' : '');
  $('day-count').textContent = day.reads.length ? `Day ${Math.max(1, daysBetween(day.reads[0].at, d) + 1)} with SYNC` : 'Day 1 with SYNC';

  const list = (phase) => steps.filter(s => s[0] === phase).map(([ph, p, role]) => {
    const id = stepId(ph, p), isDone = done.has(id);
    return `<li class="${isDone ? 'done' : ''}"><button data-step="${esc(ph)}" data-pid="${esc(p.id)}" aria-pressed="${isDone}"><span class="tick">${isDone ? '✓' : ''}</span><span><b>${esc(p.brand)} ${esc(ROLE_NOUN[role])}</b><i>${esc(p.name)}</i></span></button></li>`;
  }).join('') || '<li class="empty">Nothing here yet.</li>';
  $('day-am').innerHTML = list('AM');
  $('day-pm').innerHTML = list('PM');
  $('day-list').querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
    const p = state.items.find(([q]) => q.id === b.dataset.pid);
    if (p) toggleStep(b.dataset.step, p[0]);
  });

  $('day-stats').innerHTML = [
    `<div><b>${st}</b><span>day${st === 1 ? '' : 's'} in a row</span></div>`,
    `<div><b>${a.days ? Math.round(a.rate * 100) + '%' : '—'}</b><span>of the plan used${a.days ? `, ${a.days} day${a.days === 1 ? '' : 's'}` : ''}</span></div>`,
    watch ? `<div><b>${watch.value}</b><span>${esc(AXIS_WORD[watch.axis])} · what I'm watching</span></div>` : '',
    `<div><b>${due <= 0 ? 'now' : due + 'd'}</b><span>${due <= 0 ? 'time to re-scan' : 'until your next read'}</span></div>`,
  ].join('');

  const ds = deltas(prevRead(), last).filter(x => x.d !== 0).slice(0, 3);
  $('day-delta').innerHTML = ds.length
    ? `<span class="eyebrow">SINCE ${esc(prettyDay(prevRead().at).toUpperCase())}</span>` + ds.map(x =>
      `<div class="dline ${x.d > 0 ? 'up' : 'down'}"><span>${esc(AXIS_WORD[x.axis])}</span><b>${x.from}</b><i>→</i><b>${x.to}</b><em>${x.d > 0 ? '+' : ''}${x.d}</em></div>`).join('')
    : `<span class="eyebrow">NOTHING TO COMPARE YET</span><p>Read again after a week or two and I'll show you what moved.</p>`;
  $('day-line').textContent = dayLine();
}

function dayLine() {
  const a = adherence(), watch = state.read ? rankAxes(state.read.scores)[0] : null, ds = deltas(prevRead(), lastRead());
  const moved = ds.find(x => Math.abs(x.d) >= 3);
  if (moved) return `${capital(AXIS_WORD[moved.axis])} went ${moved.d > 0 ? 'up' : 'down'} ${Math.abs(moved.d)} since the last read.${moved.d > 0 ? ' Keep going.' : ' Let’s change one thing.'}`;
  if (!a.used) return watch ? `Two things today. ${capital(AXIS_WORD[watch.axis])} is the one I'm watching.` : 'Tick them off as you use them.';
  if (a.rate > .7) return `${a.used} steps used this week. That's the part that makes the next read mean something.`;
  return `${a.used} of ${a.planned} steps so far. Even half counts — just keep the order.`;
}

/* ── the check-in: fast-forward the timeline, with movement earned by use ── */
function simulateCheckIn() {
  const base = lastRead();
  if (!base) { toast('Read your skin first.'); return; }
  const a = adherence(), rate = Math.max(.25, a.rate);   // a demo with nothing ticked still moves a little
  const targets = new Set(targetAxes().map(t => t.axis));
  const scores = {};
  for (const [k, v] of Object.entries(base.scores)) {
    const lift = targets.has(k) ? 6 + Math.round(9 * rate) : Math.round(3 * rate) - 1;
    scores[k] = Math.max(0, Math.min(99, v + lift + (Math.random() < .3 ? -1 : 0)));
  }
  day.offset += CHECK_EVERY;
  day.reads.push({ at: todayISO(), sample: true, simulated: true, scores });
  save(READS_KEY, day.reads);
  const read = { ...state.read, sample: state.read.sample, simulated: true, scores,
    diagnosis: 'Two weeks on. The steps you used are showing.' };
  state.read = read;
  renderRead(read, $('read-frame').src || 'assets/sample_face.jpg', null);
  build(false);
  renderDay();
  const ds = deltas(prevRead(), lastRead()).filter(x => x.d !== 0).slice(0, 2);
  $('day').scrollIntoView({ behavior: 'smooth' });
  say(`Two weeks on. ${ds.map(x => `${AXIS_WORD[x.axis]} ${x.from} to ${x.to}`).join(', ')}. ${ds[0] && ds[0].d > 0 ? 'That’s the routine working.' : 'Let’s change one thing.'}`, true);
  toast('Simulated check-in — the demo jumped ahead two weeks.');
}

/* ── hooks ── */
$('day-check').onclick = simulateCheckIn;
$('day-reset').onclick = () => {
  day.days = {}; day.reads = []; day.offset = 0;
  save(DAYS_KEY, day.days); save(READS_KEY, day.reads);
  renderDay(); toast('Cleared this browser’s history.');
};

// a returning visit starts with what the agent remembers
addEventListener('load', () => {
  if (day.reads.length) {
    const l = lastRead();
    $('buddy-bubble').textContent = `${prettyDay(l.at) === prettyDay(todayISO()) ? 'Back already' : `It's been ${daysBetween(l.at, todayISO())} days`}. ${dayLine()}`;
    $('buddy-bubble').hidden = false;
  }
  renderDay();
});

// what the agent should know about the day when it answers
function dayContext() {
  const a = adherence(), st = streak(), l = lastRead(), p = prevRead();
  const ds = deltas(p, l).filter(x => x.d !== 0).slice(0, 3);
  const done = doneSet(todayISO());
  return `TODAY (${todayISO()}${day.offset ? ', simulated in this demo' : ''}): ${st} day streak; used ${a.used} of ${a.planned} planned steps over ${a.days} recorded day(s).
Ticked off today: ${[...done].join(', ') || 'nothing yet'}.
Reads on file: ${day.reads.length}${l ? `, last on ${l.at}` : ''}. Next read due ${nextCheckIn()}.
${ds.length ? `Since the read before: ${ds.map(x => `${AXIS_WORD[x.axis]} ${x.from}→${x.to} (${x.d > 0 ? '+' : ''}${x.d})`).join(', ')}.` : 'No second read yet, so nothing to compare.'}
You are their daily companion, not a shop: ask about what they used, tell them when to re-read, and say plainly when something moved or didn't.`;
}

// the read screen leads with the change, when there is one to lead with
function renderReadDelta() {
  const el = $('read-delta'), a = prevRead(), b = lastRead();
  const ds = deltas(a, b).filter(x => x.d !== 0).slice(0, 3);
  el.hidden = !ds.length;
  if (!ds.length) return;
  el.innerHTML = `<span class="eyebrow">WHAT MOVED SINCE ${esc(prettyDay(a.at).toUpperCase())}</span>` + ds.map(x =>
    `<div class="dline ${x.d > 0 ? 'up' : 'down'}"><span>${esc(AXIS_WORD[x.axis])}</span><b>${x.from}</b><i>→</i><b>${x.to}</b><em>${x.d > 0 ? '+' : ''}${x.d}</em></div>`).join('');
}
