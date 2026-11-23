'use strict';
/* SYNC web demo — scan → the read → Olive Young picks.
   Forked from SYNC_Web_Source/dist/app.js (2026-09-19). The original stays untouched.

   The read is the mirror's read, ported from sync-mirror (app/mirror/page.tsx + lib/catalogue.ts):
   15 axes, SYNC SCORE with the locked weights, band, per-region observations anchored to the face
   with MediaPipe landmarks, profile, diagnosis. Same backend: POST /analyze/face on :8000.
   No camera / backend offline → the mirror's sample read, labelled "not measured".

   Picks come from the read, not a menu: axes ranked by weighted deficit (the pickFour rule),
   each target axis matched to one of 89 Olive Young Global products (prices 2026-04-13),
   inside the budget, with what was ruled out and why. */

const $ = id => document.getElementById(id);
const API = new URLSearchParams(location.search).get('api')
  || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:8000' : '/api');

const state = { concern: 'Hydration', budget: 60, keep: true, read: null, override: false, items: [], skipped: [], selected: new Set() };
let catalog = [];
let toastTimer, stream = null, scanGeneration = 0;

/* ── the read: constants ported from the mirror ───────────────────────── */
const AXIS_WEIGHT = {
  hydration: .11, barrier: .11, redness: .09, texture: .08, brightness: .08,
  pores: .07, oiliness: .07, elasticity: .05, eye: .05,
  pigmentation: .07, wrinkles: .07, dark_circles: .04,
  puffiness: .03, blemishes: .04, congestion: .04,
};
const SCORE_ORDER = ['hydration', 'barrier', 'redness', 'brightness', 'pigmentation', 'texture', 'congestion', 'pores', 'oiliness', 'blemishes', 'wrinkles', 'elasticity', 'eye', 'dark_circles', 'puffiness'];
const AXIS_WORD = {
  hydration: 'hydration', barrier: 'barrier', redness: 'redness', texture: 'texture', brightness: 'brightness',
  pores: 'pores', oiliness: 'oiliness', elasticity: 'firmness', eye: 'eye area', pigmentation: 'pigmentation',
  wrinkles: 'lines', dark_circles: 'dark circles', puffiness: 'puffiness', blemishes: 'breakouts', congestion: 'congestion',
};
const CONCERN_COPY = {
  hydration: 'skin reads dehydrated', brightness: 'tone looks dull', redness: 'visible flush',
  barrier: 'barrier stressed', pores: 'enlarged pores', oiliness: 'excess shine',
  texture: 'uneven texture', elasticity: 'loss of firmness', eye: 'eye area reads tired',
  pigmentation: 'dark marks showing', wrinkles: 'lines are setting',
  dark_circles: 'shadow under the eye', puffiness: 'holding fluid',
  blemishes: 'active breakout', congestion: 'clogged and grainy',
};
const REGION_ANCHORS = { forehead: 10, t_zone: 168, nose: 4, left_cheek: 50, right_cheek: 280, under_eye_left: 145, under_eye_right: 374, chin: 152, jawline: 199 };
const REGION_ORDER = ['forehead', 'under_eye_left', 'under_eye_right', 'left_cheek', 'right_cheek', 'jawline', 't_zone', 'chin'];
const STATIC_POS = {   // fraction of the image, when no face is found
  forehead: [.5, .24], t_zone: [.5, .42], nose: [.5, .46], under_eye_left: [.36, .38], under_eye_right: [.64, .38],
  left_cheek: [.33, .52], right_cheek: [.67, .52], chin: [.5, .66], jawline: [.5, .62],
};
const REGION_METRIC = { forehead: 'brightness', t_zone: 'oiliness', nose: 'pores', left_cheek: 'hydration', right_cheek: 'redness', under_eye_left: 'eye', under_eye_right: 'eye', chin: 'oiliness', jawline: 'elasticity' };
const AXIS_REGION = {
  hydration: 'left_cheek', barrier: 'right_cheek', brightness: 'forehead', redness: 'right_cheek', oiliness: 't_zone', pores: 'nose',
  texture: 'left_cheek', elasticity: 'jawline', eye: 'under_eye_left', pigmentation: 'right_cheek', wrinkles: 'forehead',
  dark_circles: 'under_eye_left', puffiness: 'under_eye_right', blemishes: 'chin', congestion: 't_zone',
};
const BARRIER_GATE = 55, DEFICIT_AT = 68, WEAK_AT = 65;
const BAND_GLOSS = {
  'IN SYNC': 'what your skin is asking for and what it’s getting line up',
  'RE-SYNCING': 'closing the gap, not closed yet',
  'OUT OF SYNC': 'your skin is asking for more than it’s getting',
};
const syncScore = s => { let t = 0, w = 0; for (const [k, wt] of Object.entries(AXIS_WEIGHT)) if (s[k] != null) { t += s[k] * wt; w += wt; } return w ? Math.round(t / w) : 50; };
const band = n => n >= 80 ? 'IN SYNC' : n >= 55 ? 'RE-SYNCING' : 'OUT OF SYNC';

// the mirror's sample read (dry skin), widened to 15 axes — only ever shown labelled
const SAMPLE_READ = {
  sample: true,
  scores: { hydration: 34, barrier: 47, brightness: 54, redness: 60, oiliness: 72, texture: 50, pores: 66, elasticity: 64, eye: 62, pigmentation: 63, wrinkles: 71, dark_circles: 58, puffiness: 70, blemishes: 78, congestion: 69 },
  regions: { forehead: 'tight, slight flaking', under_eye_left: 'thin, shadowed', under_eye_right: 'thin, shadowed', left_cheek: 'dry patches', right_cheek: 'dry patches', chin: 'tight' },
  diagnosis: 'Your skin’s running dry. Hydration is down in the thirties and the barrier is thin. It needs water and a seal today, not actives.',
  skin_type: 'dry', age_range: '30s', fitzpatrick: 'II', top_concern: 'moisturising',
};

/* ── axis → what to look for in the Olive Young list ──────────────────── */
const AXIS_LEX = {
  hydration: { ing: ['hyaluronic_acid', 'panthenol'], words: /hyalu|hydrat|moist|aqua|water|dive.?in|squalane|birch/i, why: 'water in, before anything else' },
  barrier: { ing: ['ceramide', 'panthenol'], words: /ceramide|barrier|atobarrier|relief|madeca|dailimune|squalane/i, why: 'the lipid it’s short of' },
  redness: { ing: ['centella', 'panthenol'], words: /centella|cica|madeca|heartleaf|calm|sooth|relief|sensitive/i, why: 'the fewest things touching your face' },
  brightness: { ing: ['niacinamide'], words: /vitamin|vita-?c\b|bright|tone|dark spot|txa|truffle|glow|rice/i, why: 'tone, not another layer' },
  pigmentation: { ing: ['niacinamide'], words: /dark spot|txa|vita-?c\b|vitamin|bright|tone|niacinamide/i, why: 'marks fade from the tone step' },
  texture: { ing: ['collagen'], words: /pdrn|peptide|reedle|texture|smooth|retin/i, why: 'resurfaces without scrubbing' },
  wrinkles: { ing: ['collagen'], words: /pdrn|peptide|collagen|lifting|firm|egf|retin/i, why: 'the one that rebuilds rather than tops up' },
  elasticity: { ing: ['collagen'], words: /pdrn|peptide|collagen|lifting|firm|egf/i, why: 'firmness comes back slowly, this is the slow step' },
  pores: { ing: ['niacinamide'], words: /pore|sebum|mung bean|clay|zinc|bha/i, why: 'what sits in the pore, not the pore itself' },
  oiliness: { ing: ['niacinamide'], words: /pore|sebum|mung bean|zinc|oil.?control|heartleaf/i, why: 'balance, not stripping' },
  congestion: { ing: ['niacinamide'], words: /pore|sebum|clay|mung bean|zinc|bha|trouble/i, why: 'clears what’s clogged' },
  blemishes: { ing: ['centella'], words: /trouble|zinc|acne|blemish|tea ?tree|heartleaf|cica/i, why: 'calms the breakout, doesn’t dry it out' },
  eye: { ing: [], words: /eye/i, why: 'made for the thinnest skin on your face', slot: 'spot' },
  dark_circles: { ing: [], words: /eye/i, why: 'made for the shadow under the eye', slot: 'spot' },
  puffiness: { ing: [], words: /eye/i, why: 'the eye step, cool and light', slot: 'spot' },
};
const AXIS_FOCUS = {
  hydration: 'Hydration', barrier: 'Hydration', texture: 'Hydration',
  redness: 'Comfort', blemishes: 'Comfort', congestion: 'Comfort', pores: 'Comfort', oiliness: 'Comfort', puffiness: 'Comfort',
  brightness: 'Glow', pigmentation: 'Glow', dark_circles: 'Glow', eye: 'Glow', wrinkles: 'Glow', elasticity: 'Glow',
};
const FOCUS_AXIS = { Hydration: 'hydration', Comfort: 'redness', Glow: 'brightness' };
const HARSH = /retin|peel|zero pore|acid(ic)? pad|exfol/i;
const PRICE_W = .04;   // score points per dollar
const SLOT_LABEL = { serum: 'TREAT', spot: 'TREAT', cream: 'MOISTURIZE', sunscreen: 'PROTECT' };

/* ── the pick ─────────────────────────────────────────────────────────── */
const scoresNow = () => state.read ? state.read.scores : null;
const canRetinoid = () => { const s = scoresNow(); return !!s && s.barrier >= BARRIER_GATE; };

// what the skin is asking for, most first — weighted deficit, the pickFour rule.
// The read screen and the picks both use this one ranking, so they can't disagree.
const rankAxes = s => Object.keys(AXIS_WEIGHT).filter(k => s[k] != null)
  .map(k => ({ axis: k, value: s[k], fix: s[k] < DEFICIT_AT, d: AXIS_WEIGHT[k] * (100 - s[k]) }))
  .sort((a, b) => b.d - a.d);

// which axes the routine answers
function targetAxes() {
  const s = scoresNow();
  if (!s || state.override) {
    const a = FOCUS_AXIS[state.concern];
    return [{ axis: a, value: s ? s[a] : null, fix: s ? s[a] < DEFICIT_AT : true }];
  }
  const ranked = rankAxes(s);
  // two targets, from different product families, so the second isn't the first again
  const out = [ranked[0]];
  const next = ranked.slice(1).find(r => AXIS_FOCUS[r.axis] !== AXIS_FOCUS[out[0].axis]);
  if (next && (next.fix || !out[0].fix)) out.push(next);
  return out;
}

/* the evidence: which ingredients on this product's own label act on the axis, earliest first.
   Positions come from the label list itself (see ../enrich_oy.py), so "#6 of 40" is checkable. */
const evidenceFor = (p, axis) => ((p.enriched && p.enriched.key_actives) || [])
  .filter(a => a.axes.includes(axis)).sort((a, b) => a.position - b.position);
const syncStatus = v => v < DEFICIT_AT ? 'out of sync' : v < 80 ? 're-syncing' : 'in sync';
const regionWord = axis => (AXIS_REGION[axis] || '').replace(/_?(left|right)_?/, '').replace(/_/g, ' ');

function fit(p, axis) {
  const L = AXIS_LEX[axis], ev = evidenceFor(p, axis);
  let s = ev.reduce((t, a) => t + 2 + (1 - a.position / a.of), 0);   // proof on the label, earlier counts more
  if (!ev.length) s += L.ing.filter(i => p.featured_ingredients.includes(i)).length * .5;
  if (L.words.test(p.name)) s += 1;
  if (p.is_set) s -= .5;
  if (HARSH.test(p.name)) s -= /retin/i.test(p.name) && canRetinoid() && /texture|wrinkles/.test(axis) ? 0 : 6;
  return s;
}
const ranked = (slots, axis) => catalog.filter(p => slots.includes(p.slot) && (AXIS_LEX[axis].slot !== 'spot' || /eye/i.test(p.name)))
  .map(p => ({ p, s: fit(p, axis) })).sort((a, b) => b.s - a.s || a.p.price_usd - b.p.price_usd);

function choose() {
  const budget = state.budget, s = scoresNow();
  const targets = targetAxes();
  const primarySlots = AXIS_LEX[targets[0].axis].slot === 'spot' ? ['spot'] : ['serum'];
  const prim = ranked(primarySlots, targets[0].axis).filter((t, i) => i < 3 || t.s > 0);
  const creamAxis = s && s.barrier < s.hydration ? 'barrier' : 'hydration';
  const creamT = { axis: creamAxis, value: s ? s[creamAxis] : null };
  const creams = state.keep ? [] : ranked(['cream'], creamAxis);
  const skipped = [];

  let best = null;
  for (const t of prim) {
    // a small price term: between two that both do the job, the cheaper one leaves room for the next step
    if (!creams.length) { const v = t.s - t.p.price_usd * PRICE_W; if (t.p.price_usd <= budget && (!best || v > best.s)) best = { items: [[t.p, primarySlots[0], targets[0]]], s: v, cost: t.p.price_usd }; continue; }
    for (const c of creams) {
      const cost = t.p.price_usd + c.p.price_usd, sc = t.s + c.s - cost * PRICE_W;
      if (cost <= budget && (!best || sc > best.s)) best = { items: [[t.p, primarySlots[0], targets[0]], [c.p, 'cream', creamT]], s: sc, cost };
    }
  }
  if (!best && creams.length) {
    const t = prim.find(t => t.p.price_usd <= budget), c = creams.find(c => c.p.price_usd <= budget);
    const one = t ? [t, primarySlots[0], targets[0]] : c ? [c, 'cream', creamT] : null;
    if (one) {
      best = { items: [[one[0].p, one[1], one[2]]], s: one[0].s, cost: one[0].p.price_usd };
      skipped.push({ name: one[1] === 'cream' ? 'A treatment step' : 'A moisturizer', reason: `Both don’t fit under $${budget}. Start with this one.` });
    }
  }
  if (!best) return { items: [], skipped: [{ name: 'Everything', reason: `Nothing fits under $${budget}. Move the budget up a little.` }] };

  // the second target, if the read has one and the budget allows
  if (targets[1]) {
    const slots2 = AXIS_LEX[targets[1].axis].slot === 'spot' ? ['spot'] : ['serum'];
    const c2 = ranked(slots2, targets[1].axis).find(c => c.s > 0 && !best.items.some(([p]) => p.id === c.p.id) && c.p.price_usd <= budget - best.cost);
    if (c2) { best.items.splice(1, 0, [c2.p, slots2[0], targets[1]]); best.cost += c2.p.price_usd; }
    else skipped.push({ name: `A ${AXIS_WORD[targets[1].axis]} step`, reason: `${capital(AXIS_WORD[targets[1].axis])} ${targets[1].value} is next in line. Not inside $${budget} today.` });
  }
  // SPF only if it fits what's left
  const sun = ranked(['sunscreen'], s && s.hydration < s.redness ? 'hydration' : 'redness').find(x => x.p.price_usd <= budget - best.cost);
  if (sun) best.items.push([sun.p, 'sunscreen', null]);

  // what was ruled out, and why — the part a store wouldn't show you
  if (state.keep) skipped.push({ name: 'A new moisturizer', reason: 'You already have one you like. Keep it.' });
  const retinol = catalog.find(p => /retinol/i.test(p.name) && p.slot === 'serum');
  if (retinol && !best.items.some(([p]) => p.id === retinol.id))
    skipped.push({ name: `${retinol.brand} ${retinol.name}`, reason: s ? (s.barrier < BARRIER_GATE ? `Barrier ${s.barrier}. A retinoid makes that worse before better.` : 'Not today. One new active at a time, and this isn’t the one your read asked for.') : 'Not without a read. A retinoid needs a barrier that can take it.' });
  if (s && (s.redness < DEFICIT_AT || s.barrier < DEFICIT_AT)) {
    const peel = catalog.find(p => p.slot === 'exfoliate');
    if (peel) skipped.push({ name: `${peel.brand} ${peel.name}`, reason: `${s.barrier < s.redness ? 'Barrier ' + s.barrier : 'Redness ' + s.redness}. Nothing that strips this week.` });
  }
  const topMatch = prim[0];
  if (topMatch && !best.items.some(([p]) => p.id === topMatch.p.id) && topMatch.p.price_usd > budget)
    skipped.push({ name: `${topMatch.p.brand} ${topMatch.p.name}`, reason: `The closest match, but $${topMatch.p.price_usd.toFixed(2)} breaks the budget.` });
  if (!sun) skipped.push({ name: 'Sunscreen', reason: 'No room left in the budget. Use the one you have.' });

  return { items: best.items, skipped: skipped.slice(0, 4) };
}

function reasonFor(p, role, t) {
  if (role === 'sunscreen') return 'Room left in the budget, so: daytime cover. Everything above works better under it.';
  const axis = t ? t.axis : FOCUS_AXIS[state.concern];
  const L = AXIS_LEX[axis], ev = evidenceFor(p, axis)[0];
  const ing = ev ? ` ${ev.inci} is #${ev.position} of ${ev.of} on the label: ${ev.does.replace(/\.$/, '').toLowerCase()}.` : '';
  if (role === 'cream') return (t && t.value != null ? `${capital(AXIS_WORD[axis])} ${t.value}. ` : '') + 'The seal. Holds in what the step before put there.' + ing;
  if (!t || t.value == null) return capital(L.why) + '.' + ing;
  return `${capital(AXIS_WORD[axis])} ${t.value}. ${t.fix ? capital(L.why) : 'The one to hold, not fix'}.${ing}`;
}

/* ── UI helpers (from the original) ───────────────────────────────────── */
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const money = n => '$' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(t) { $('toast').textContent = t; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function say(t, speak = false) {
  $('speech').textContent = t; $('reply').textContent = t;
  $('buddy-bubble').textContent = t; $('buddy-bubble').hidden = chat.open;
  chatAdd('agent', t);
  react();
  if (speak && !chat.mute) speakOut(t);
  else if (speak) setMood('idle');   // muted: don't leave the companion stuck on "thinking"
}

/* ── voice: ElevenLabs through the mirror backend (POST /say), browser voice if that fails.
   The conversation loop is the mirror's: speak → listen → /chat → speak, until you stop it. ── */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
const voice = { audio: new Audio(), unlocked: false, convo: false, listening: false, rec: null, history: [], seq: 0, misses: 0 };

// autoplay: the same element has to be played once inside a tap, then it can talk on its own
function unlockAudio() {
  if (voice.unlocked) return;
  voice.unlocked = true;
  voice.audio.src = SILENT; voice.audio.play().catch(() => {});
  try {
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 256;
    ctx.createMediaElementSource(voice.audio).connect(an); an.connect(ctx.destination);
    voice.ctx = ctx;
    const d = new Uint8Array(an.frequencyBinCount);
    const meter = () => {   // voice level drives the companion's ring
      an.getByteTimeDomainData(d);
      let m = 0; for (const x of d) m = Math.max(m, Math.abs(x - 128));
      document.documentElement.style.setProperty('--level', (m / 128).toFixed(3));
      requestAnimationFrame(meter);
    };
    meter();
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function setMood(m) {
  document.body.dataset.sync = m;
  $('buddy-state').textContent = { listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }[m] || (voice.convo ? 'Tap to stop' : 'Tap to talk');
  $('stage').classList.toggle('speaking', m === 'speaking');
}

async function speakOut(t) {
  const my = ++voice.seq;
  voice.audio.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (voice.rec) try { voice.rec.abort(); } catch {}
  setMood('speaking');
  let finished = false;
  const done = () => { if (finished) return; finished = true; clearTimeout(guard); if (my !== voice.seq) return; setMood('idle'); if (voice.convo) listen(); };
  const guard = setTimeout(done, 4000 + t.split(/\s+/).length * 450);   // never hang on audio that won't play
  try {
    voice.ctx?.resume();
    const r = await fetch(`${API}/say`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) });
    if (!r.ok) throw new Error('say ' + r.status);
    const url = URL.createObjectURL(await r.blob());
    if (my !== voice.seq) return;
    voice.audio.src = url;
    voice.audio.onended = voice.audio.onerror = () => { URL.revokeObjectURL(url); done(); };
    await voice.audio.play();
  } catch {
    if (my !== voice.seq) return;
    if (!('speechSynthesis' in window)) { done(); return; }
    const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = .98;
    u.onend = u.onerror = done; speechSynthesis.speak(u);
  }
}

function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input needs Chrome. You can type below.'); voice.convo = false; setMood('idle'); return; }
  if (voice.listening) return;
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
  let final = '';
  rec.onresult = e => {
    let interim = '';
    for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
    const heard = '“' + (final + interim).trim() + '”';
    $('buddy-bubble').textContent = heard; $('buddy-bubble').hidden = chat.open;
    $('chat-heard').textContent = chat.open ? heard : '';
  };
  rec.onerror = () => {};
  rec.onend = () => {
    voice.listening = false; voice.rec = null;
    if (final.trim()) { voice.misses = 0; converse(final.trim()); return; }
    setMood('idle');
    if (voice.convo && ++voice.misses < 2) listen();      // one quiet stretch is fine, two ends the conversation
    else { voice.convo = false; voice.misses = 0; setMood('idle'); }
  };
  voice.rec = rec; voice.listening = true; setMood('listening');
  try { rec.start(); } catch { voice.listening = false; setMood('idle'); }
}

function toggleConvo() {
  unlockAudio();
  if (voice.convo || voice.listening) {
    voice.convo = false; voice.seq++;
    if (voice.rec) try { voice.rec.abort(); } catch {}
    voice.audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel();
    setMood('idle'); return;
  }
  voice.convo = true; voice.misses = 0;
  if (document.body.dataset.sync !== 'speaking') {
    if (!voice.history.length) say(state.read ? 'I’m listening. Ask me about your read, or tell me your budget.' : 'Hey. Tell me what your skin’s doing, or tap scan and I’ll look.', true);
    else listen();
  }
}

// everything the agent knows right now, handed to the model on every turn
function agentSystem() {
  const r = state.read, s = r && r.scores;
  const readTxt = r ? [
    `${r.sample ? 'SAMPLE read (not measured, say so if asked)' : 'Live read of the person in front of the camera'}.`,
    `SYNC SCORE ${syncScore(s)}, ${band(syncScore(s))}. Profile: ${[r.skin_type, r.age_range, r.fitzpatrick && 'fitz ' + r.fitzpatrick].filter(Boolean).join(', ')}.`,
    `Diagnosis: ${r.diagnosis || '-'}`,
    `Asking most (weighted): ${rankAxes(s).slice(0, 4).map(x => `${AXIS_WORD[x.axis]} ${x.value}`).join(', ')}. All axes (higher is better): ${SCORE_ORDER.map(k => `${AXIS_WORD[k]} ${s[k]}`).join(', ')}.`,
    `Regions: ${Object.entries(r.regions || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ')}.`,
  ].join('\n') : 'No read yet. Suggest the scan if it would help.';
  const picks = state.items.map(([p, role, t]) => { const e = p.enriched || {}; return `- ${p.brand} ${p.name}, $${p.price_usd.toFixed(2)} (${role}; ${whereItGoes(p, role, state.items)}) — ${reasonFor(p, role, t)}\n  What it is: ${e.what || '-'}\n  Key ingredients (label position): ${(e.key_actives || []).map(a => `${a.inci} #${a.position}/${a.of} (${a.does})`).join('; ') || '-'}\n  How to use (${e.when || 'AM and PM'}): ${(e.how_to_use || []).join(' ')}${e.caution ? `\n  Caution: ${e.caution}` : ''}`; }).join('\n') || '- none yet';
  const left = state.skipped.map(x => `- ${x.name} — ${x.reason}`).join('\n') || '- none';
  return `You are Doona, K-SYNC’s K-beauty companion, speaking with one person.
${state.name ? `The person's name is ${state.name}. Use it now and then, not every reply.` : ''}
Voice: a trusted older friend who knows skin. Warm, direct, opinionated, concrete. Not a teacher, not customer service.
Reply ONLY with JSON, no code fences: {"say": string, "set": {"budget": number|null, "focus": "Hydration"|"Comfort"|"Glow"|null, "keepMoisturizer": true|false|null}}
"say": 1-2 short spoken sentences in English, with contractions and real rhythm. No lists, no markdown, no emoji.
"set": only fill a field when the person asks to change it (budget $15-$120, what to focus on, whether they already own a moisturizer). Otherwise null.
When you set a field, keep "say" to one short acknowledgment. The app reads out the new picks right after you.
Only talk about products listed under PICKS or LEFT OUT, and only with the prices given. If they want something else, say what you'd change and set the field.
If they ask why something was left out, give the reason written under LEFT OUT, in your own words. If they ask why a pick, use its reason.
Sometimes the right answer is not to buy anything; say so when it's true.
No medical claims or diagnoses ("can help", never "cures" or "treats"). Never say: elevate, transform, journey, empower, best self, I'm here to help.
Use "in sync / out of sync / re-syncing" only when it fits naturally.
"Barrier" always means the skin's own protective layer, never a product. Scores are 0-100, higher is better.

READ:
${readTxt}

BUDGET: $${state.budget}. Already owns a moisturizer: ${state.keep ? 'yes' : 'no'}.
${window.dayContext ? dayContext() : ''}
PICKS:
${picks}
LEFT OUT:
${left}`;
}

const ROLE_NOUN = { serum: 'serum', spot: 'eye cream', cream: 'cream', sunscreen: 'sunscreen' };
function picksLine() {
  if (!state.items.length) return `Nothing fits under $${state.budget}.`;
  const names = state.items.map(([p, role]) => `the ${p.brand} ${ROLE_NOUN[role]}`);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
  return `Now it's ${list}, ${money(state.items.reduce((t, [p]) => t + p.price_usd, 0))} together.`;
}
function parseAgent(answer) {
  if (!answer) return null;
  const t = answer.replace(/^```(?:json)?|```$/g, '').trim();
  try { const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); if (j && typeof j.say === 'string') return { say: j.say, set: j.set || {} }; } catch {}
  return /^[{\[]/.test(t) ? null : { say: t, set: {} };
}

// returns the spoken acknowledgment of what changed, or '' — written here, not by the model,
// because the model only ever saw the state from before this turn
function applySet(set) {
  const said = [];
  if (typeof set.budget === 'number' && set.budget >= 15 && set.budget <= 120 && Math.round(set.budget / 5) * 5 !== state.budget) { state.budget = Math.round(set.budget / 5) * 5; said.push(`$${state.budget}.`); }
  if (FOCUS_AXIS[set.focus] && (set.focus !== state.concern || (state.read && !state.override))) { state.concern = set.focus; state.override = !!state.read; said.push(`${set.focus} first.`); }
  if (typeof set.keepMoisturizer === 'boolean' && set.keepMoisturizer !== state.keep) { state.keep = set.keepMoisturizer; said.push(state.keep ? 'Your moisturizer stays.' : 'A moisturizer goes in.'); }
  if (!said.length) return '';
  syncControls();
  return 'Got it. ' + said.join(' ');
}

async function converse(text) {
  unlockAudio();
  chatAdd('me', text);
  setMood('thinking');
  $('buddy-bubble').textContent = '“' + text + '”'; $('buddy-bubble').hidden = chat.open;
  let out = null;
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ question: text, system: agentSystem(), history: voice.history.slice(-8) }) });
    clearTimeout(tm);
    if (r.ok) out = parseAgent((await r.json()).answer);
  } catch {}
  if (!out) { handleMessage(text, true); return; }      // backend down: the keyword path still answers
  voice.history.push({ role: 'user', content: text }, { role: 'assistant', content: out.say });
  const ack = applySet(out.set);
  if (ack) { build(false); toast('Your picks are updated below.'); }
  say(ack ? `${ack} ${picksLine()}` : out.say, true);
}
function react() { $('stage').classList.remove('reacting'); void $('stage').offsetWidth; $('stage').classList.add('reacting'); setTimeout(() => $('stage').classList.remove('reacting'), 750); }

$('stage').addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = $('stage').getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  $('portrait').style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 5}deg) translate3d(${x * 12}px,${y * 8}px,15px)`;
});
$('stage').addEventListener('pointerleave', () => $('portrait').style.transform = '');
$('avatar-touch').onclick = () => say(['Your routine should fit you. Not the other way around.', 'Keep the good stuff. Let’s find what’s missing.', 'Sometimes the right answer is: don’t buy it.'][Math.floor(Math.random() * 3)]);
$('sound').onclick = () => { unlockAudio(); voice.convo = true; say("Hey, I'm Doona. Let me look at your skin, then tell me your budget. I'll find what's missing.", true); };
/* ── the companion's chat: typing is the main way in, the mic is optional ── */
const chat = { open: false, mute: false, log: [] };
function chatAdd(role, text) {
  if (!text) return;
  const last = chat.log[chat.log.length - 1];
  if (last && last.role === role && last.text === text) return;    // spoken line already logged
  chat.log.push({ role, text });
  const el = document.createElement('div');
  el.className = 'msg ' + role; el.textContent = text;
  $('chat-log').append(el);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
function chatOpen(on = true) {
  chat.open = on;
  $('chat').hidden = !on;
  $('buddy').classList.toggle('chatting', on);
  $('buddy-bubble').hidden = on || !$('buddy-bubble').textContent;
  $('buddy-state').textContent = on ? 'Chatting' : 'Tap to chat';
  if (on) { unlockAudio(); setTimeout(() => $('buddy-input').focus(), 60); $('chat-log').scrollTop = $('chat-log').scrollHeight; }
}
$('buddy-face').onclick = () => chatOpen(!chat.open);
$('chat-x').onclick = () => chatOpen(false);
$('chat-mute').onclick = () => {
  chat.mute = !chat.mute;
  if (chat.mute) { voice.seq++; voice.audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); setMood('idle'); }
  $('chat-mute').textContent = chat.mute ? '🔇' : '🔊';
  $('chat-mute').setAttribute('aria-pressed', String(!chat.mute));
  $('chat-mute').title = chat.mute ? 'Voice off' : 'Voice on';
};
$('buddy-form').onsubmit = e => { e.preventDefault(); const t = $('buddy-input').value.trim(); if (!t) return; $('buddy-input').value = ''; converse(t); };
$('buddy-mic').onclick = toggleConvo;          // speak instead of typing
$('talk').onclick = () => { chatOpen(true); $('buddy').classList.remove('away'); };
addEventListener('keydown', e => { if (e.key === 'Escape' && chat.open) chatOpen(false); });
// the companion follows you once the big one scrolls away
const companionVisibility = new Map();
const companionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) companionVisibility.set(entry.target, entry.isIntersecting);
  $('buddy').classList.toggle('away', [...companionVisibility.values()].some(Boolean));
}, { threshold: .2 });
companionObserver.observe($('stage'));
companionObserver.observe($('meet'));

function syncControls() {
  document.querySelectorAll('[data-concern]').forEach(b => { const a = b.dataset.concern === state.concern; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
  $('budget').value = state.budget; $('budget-value').textContent = '$' + state.budget; $('keep').checked = state.keep;
}
document.querySelectorAll('[data-concern]').forEach(b => b.onclick = () => {
  state.concern = b.dataset.concern; state.override = !!state.read; syncControls();
  say({ Hydration: 'Hydration. Water first, then something to hold it.', Comfort: 'Comfort first. Fewer, gentler things.', Glow: 'A little glow, without a shelf full of products.' }[state.concern]);
  if (!$('routine').hidden) build(false);
});
$('budget').oninput = e => { state.budget = Number(e.target.value); syncControls(); if (!$('routine').hidden) build(false); };
$('keep').onchange = e => { state.keep = e.target.checked; if (!$('routine').hidden) build(false); };

/* ── render: picks ────────────────────────────────────────────────────── */
const STEP_ORDER = { serum: 1, spot: 2, cream: 3, sunscreen: 4 };
const inWhen = (p, t) => (p.enriched?.when || 'AM and PM').includes(t);
function routineOrder(items) {
  const sorted = [...items].sort((a, b) => STEP_ORDER[a[1]] - STEP_ORDER[b[1]]);
  const am = sorted.filter(([p, r]) => r === 'sunscreen' || inWhen(p, 'AM'));
  const pm = sorted.filter(([p, r]) => r !== 'sunscreen' && inWhen(p, 'PM'));
  return { am, pm, sorted };
}
function whereItGoes(p, role, items) {
  const { sorted } = routineOrder(items), i = sorted.findIndex(([q]) => q.id === p.id), n = sorted.length;
  const before = sorted[i - 1], after = sorted[i + 1];
  const nm = ([q, r]) => `the ${q.brand} ${ROLE_NOUN[r]}`;
  const pos = role === 'sunscreen' ? 'last, mornings only' : before ? `after ${nm(before)}` : 'right after cleansing';
  return `Step ${i + 1} of ${n} · ${pos}${after && role !== 'sunscreen' ? `, before ${nm(after)}` : ''}`;
}
function renderRoutine(items) {
  const { am, pm } = routineOrder(items);
  const line = (label, list) => list.length ? `<div><b>${label}</b>${list.map(([p, r], i) => `<span>${i + 1}. ${esc(p.brand)} ${esc(ROLE_NOUN[r])}</span>`).join('<i>→</i>')}</div>` : '';
  $('routine-steps').innerHTML = items.length ? `<span class="eyebrow">YOUR ROUTINE</span>${line('AM', am)}${line('PM', pm)}<small>Cleanse first, the way you already do.</small>` : '';
}
function whyBlock(p, role, t) {
  const read = !!state.read && !state.override;
  if (role === 'sunscreen') {
    const top = (p.enriched?.key_actives || []).slice(0, 2);
    return `<div class="why"><span class="why-h">WHY THIS</span>
      <div class="why-row"><b>Your routine</b><span>Every morning ends with SPF. Budget had room.</span></div>
      ${top.map(a => `<div class="why-row"><b>In this</b><span>${esc(a.inci)} · #${a.position} of ${a.of} · ${esc(a.does)}</span></div>`).join('')}</div>`;
  }
  const axis = t ? t.axis : FOCUS_AXIS[state.concern];
  const v = t && t.value != null ? t.value : null;
  const ev = evidenceFor(p, axis).slice(0, 2);
  const readRow = read && v != null
    ? `<b>Your read</b><span>${esc(capital(regionWord(axis) || 'face'))} · ${esc(AXIS_WORD[axis])} ${v} · ${syncStatus(v)}</span>`
    : `<b>Your focus</b><span>${esc(state.concern)} · ${esc(AXIS_WORD[axis])}</span>`;
  return `<div class="why"><span class="why-h">WHY THIS, FOR YOU</span>
    <div class="why-row">${readRow}</div>
    ${ev.length ? ev.map(a => `<div class="why-row"><b>In this</b><span>${esc(a.inci)} · #${a.position} of ${a.of} on the label · ${esc(a.does)}</span></div>`).join('')
      : `<div class="why-row"><b>In this</b><span>${esc(capital(AXIS_LEX[axis].why))}.</span></div>`}</div>`;
}
function howBlock(p, role, items) {
  const e = p.enriched || {};
  const steps = (e.how_to_use || []).map(x => `<li>${esc(x)}</li>`).join('');
  const what = capital((e.what || '').replace(/^(this product is|this is|it is|it's)\s+/i, '').replace(/^[a-z0-9 .&'’-]*? is (a|an) /i, m => m.match(/ (a|an) $/i)[0].trim() + ' '));
  return `<p class="what">${esc(what)}</p>
    <details class="howto"><summary>How to use · ${esc(role === 'sunscreen' ? 'AM' : (e.when || 'AM and PM'))}</summary>
      <span class="where">${esc(whereItGoes(p, role, items))}</span>
      ${steps ? `<ol>${steps}</ol>` : ''}
      ${e.caution ? `<span class="caution">${esc(e.caution)}</span>` : ''}
      ${e.fragrance_free ? '<span class="chip-ff">Fragrance-free</span>' : ''}
    </details>`;
}

function build(scroll = true) {
  if (!catalog.length) { toast('Catalogue is still loading.'); return; }
  const { items, skipped } = choose();
  state.items = items; state.skipped = skipped;
  state.selected = new Set(items.map(([p]) => p.id));
  $('routine').hidden = false;

  const t = targetAxes();
  const readBit = state.read && !state.override
    ? `${state.read.sample ? 'Sample read' : 'From your read'} · answering ${t.map(x => `${AXIS_WORD[x.axis]} ${x.value}`).join(' and ')} · `
    : `${state.concern} · `;
  $('routine-summary').textContent = `${readBit}$${state.budget} budget · ` + (state.keep ? 'keeping your moisturizer · ' : '') +
    (items.length ? `${items.length} ${items.length === 1 ? 'pick' : 'picks'}, ${money(items.reduce((s, [p]) => s + p.price_usd, 0))} together.` : 'nothing fits yet.');

  renderRoutine(items);
  if (window.renderDay) renderDay();
  $('products').replaceChildren();
  items.forEach(([p, role, tg], i) => {
    const a = document.createElement('article');
    a.className = 'product';
    const vol = /[가-힣]/.test(p.volume || '') ? '' : (p.volume || '');
    a.innerHTML = `
      <div class="product-top"><span>${SLOT_LABEL[role]}${tg && tg.axis && role !== 'cream' ? ' · ' + AXIS_WORD[tg.axis].toUpperCase() : ''}</span><span class="product-number">${String(i + 1).padStart(2, '0')}</span></div>
      <div class="product-img"><img src="data/${esc(p.image)}" alt="" loading="lazy"></div>
      <span class="product-brand">${esc(p.brand)}</span>
      <h3>${esc(p.name)}</h3>
      ${whyBlock(p, role, tg)}
      ${howBlock(p, role, items)}
      <div class="product-meta">${esc(vol)}${p.is_set ? ' · set' : ''}</div>
      <div class="price">${money(p.price_usd)}</div>
      <a class="product-link" href="${esc(p.url)}" target="_blank" rel="noopener">View on Olive Young ↗</a>
      <button aria-pressed="true">Added to bag ✓</button>`;
    a.querySelector('button').onclick = e => {
      const on = !state.selected.has(p.id);
      on ? state.selected.add(p.id) : state.selected.delete(p.id);
      e.target.textContent = on ? 'Added to bag ✓' : 'Add to bag';
      e.target.setAttribute('aria-pressed', String(on));
      totals();
    };
    const alternatives = document.createElement('button');
    alternatives.className = 'ed-alternatives';
    alternatives.textContent = 'Compare alternatives';
    alternatives.onclick = () => document.dispatchEvent(new CustomEvent('compare-alternatives', { detail: p }));
    a.append(alternatives);
    $('products').append(a);
  });

  $('skipped').replaceChildren();
  $('skipped-wrap').hidden = !skipped.length;
  skipped.forEach(s => {
    const li = document.createElement('li');
    const b = document.createElement('strong'), sp = document.createElement('span');
    b.textContent = s.name; sp.textContent = s.reason;
    li.append(b, sp); $('skipped').append(li);
  });

  totals();
  if (scroll) {
    say(items.length ? 'Here’s where I’d start. Keep what works, add only what fits.' : 'Nothing fits that budget yet. Move it up a little?');
    $('routine').scrollIntoView({ behavior: 'smooth' });
  }
  return { budget: state.budget, targets: t.map(x => x.axis), products: items.map(([p]) => ({ brand: p.brand, name: p.name, price: p.price_usd })) };
}
function totals() {
  const sel = state.items.filter(([p]) => state.selected.has(p.id));
  $('total').textContent = money(sel.reduce((s, [p]) => s + p.price_usd, 0));
  $('count').textContent = sel.length;
  $('checkout').disabled = !sel.length;
}
$('build').onclick = () => build();
$('edit').onclick = () => { $('concerns').scrollIntoView({ behavior: 'smooth', block: 'center' }); document.querySelector('.chip.active').focus({ preventScroll: true }); };
$('routine-nav').onclick = () => { if ($('routine').hidden) build(); else $('routine').scrollIntoView({ behavior: 'smooth' }); };

/* ── render: the read ─────────────────────────────────────────────────── */
function dialSVG(score) {
  const R = 72, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, score)) / 100;
  const marks = SCORE_ORDER.map((_, i) => `<line class="grad" x1="100" y1="${100 - R - 7}" x2="100" y2="${100 - R - 11}" transform="rotate(${(360 / SCORE_ORDER.length) * i} 100 100)"/>`).join('');
  return `<svg class="dial" viewBox="0 0 200 200" aria-hidden="true"><circle class="track" cx="100" cy="100" r="${R}"/>${marks}
    <circle class="arc" cx="100" cy="100" r="${R}" style="stroke-dasharray:${C};--c:${C};--off:${C * (1 - p)}"/></svg>`;
}

function renderRead(read, frameUrl, live = null) {
  const s = read.scores;
  const score = syncScore(s), b = band(score);
  const axes = SCORE_ORDER.filter(k => s[k] != null).map(k => ({ key: k, value: s[k] }));
  const order = rankAxes(s).map(r => ({ key: r.axis, value: r.value }));
  let weak = order.filter(a => a.value < WEAK_AT).slice(0, 4);
  const relative = !weak.length;                      // a good read still names what's costing the score most
  if (relative) weak = order.slice(0, 3);
  const accent = AXIS_REGION[weak[0].key];

  $('read-score').innerHTML = `${dialSVG(score)}<div class="dialcore"><span class="dialnum">${score}</span><span class="dialband">${b}</span></div>`;
  $('read-line').textContent = `${score}. You’re ${b.toLowerCase()}. ${capital(BAND_GLOSS[b])}.`;
  if (window.renderReadDelta) renderReadDelta();
  $('read-title').textContent = state.name && !read.sample ? `${state.name}, here’s what I see.` : 'Here’s what I see.';
  $('read-diagnosis').textContent = read.diagnosis || '';
  $('read-profile').textContent = [read.skin_type, read.age_range, read.fitzpatrick && `fitz ${read.fitzpatrick}`].filter(Boolean).join(' · ');
  $('read-flag').textContent = read.sample ? 'Sample read · not measured' : 'Your read · just now';
  $('read-flag').classList.toggle('sample', !!read.sample);
  $('read-concerns').replaceChildren(...weak.map(a => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${esc(capital(AXIS_WORD[a.key]))} ${a.value}</strong><span>${esc(relative ? 'fine, and still the most room on a good read' : CONCERN_COPY[a.key])}</span>`;
    return li;
  }));
  $('read-axes').replaceChildren(...axes.map(a => {
    const row = document.createElement('div');
    row.className = 'axis' + (weak.some(w => w.key === a.key) ? ' weak' : '');
    row.innerHTML = `<span>${esc(AXIS_WORD[a.key])}</span><i><b style="width:${a.value}%"></b></i><strong>${a.value}</strong>`;
    return row;
  }));

  // the face, with the regions the read talked about
  const mirrored = !read.sample;
  stopLive();
  $('read-frame').src = frameUrl;
  $('read-frame').classList.toggle('mirrored', mirrored);
  $('read-labels').replaceChildren();
  const noted = REGION_ORDER.filter(r => read.regions && read.regions[r] && !/^(null|unclear)$/i.test(read.regions[r])).slice(0, 6);
  const els = {};
  noted.forEach((r, i) => {
    const m = r === accent ? weak[0].key : REGION_METRIC[r];   // the accent names the axis it's lit for
    const el = document.createElement('div');
    el.className = 'rlabel' + (r === accent ? ' accent' : '') + (/under_eye|forehead/.test(r) ? ' up' : '');
    el.style.animationDelay = (i * 110) + 'ms';
    el.innerHTML = `<i></i><div><span class="l1">${esc(r.replace(/_/g, ' '))}</span><span class="l2">${esc(read.regions[r])}</span>${s[m] != null ? `<span class="l3">${esc(AXIS_WORD[m])} · ${s[m]}</span>` : ''}</div>`;
    els[r] = el; $('read-labels').append(el);
  });
  const place = pos => {
    for (const [r, el] of Object.entries(els)) {
      const [x, y] = pos[r] || STATIC_POS[r];
      el.style.left = (x * 100) + '%'; el.style.top = (y * 100) + '%';
      el.classList.toggle('left', x < .5);                      // labels open outward, away from the face
    }
  };
  place({});
  $('read').hidden = false;
  $('read-camera-off').hidden = !live;
  if (live) startLive(live, place);
  else { $('read-live').hidden = true; $('read-frame').hidden = false; locateRegions($('read-frame'), mirrored).then(pos => pos && place(pos)).catch(() => {}); }
}

/* live tags: the read stays on your face while you move, like the mirror */
let liveRAF = 0, videoLM = null;
function stopLive() {
  cancelAnimationFrame(liveRAF); liveRAF = 0;
  const v = $('read-live'); if (v) { v.srcObject = null; v.hidden = true; }
  if ($('read-frame')) $('read-frame').hidden = false;
  if ($('read-camera-off')) $('read-camera-off').hidden = true;
}
async function startLive(s, place) {
  const v = $('read-live');
  v.srcObject = s; v.hidden = false; $('read-frame').hidden = true;
  try { await v.play(); } catch {}
  try {
    if (!videoLM) {
      const { v: vision, fileset } = await loadVision();
      videoLM = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LM_MODEL }, runningMode: 'VIDEO', numFaces: 1,
      });
    }
  } catch { return; }   // no model: labels keep the static layout on the live picture
  let last = -1;
  const tick = () => {
    if (!stream || v.hidden) return;
    if (v.readyState >= 2 && v.currentTime !== last) {
      last = v.currentTime;
      const lm = videoLM.detectForVideo(v, performance.now()).faceLandmarks?.[0];
      if (lm) { const pos = {}; for (const [r, i] of Object.entries(REGION_ANCHORS)) pos[r] = [1 - lm[i].x, lm[i].y]; place(pos); }
    }
    liveRAF = requestAnimationFrame(tick);
  };
  liveRAF = requestAnimationFrame(tick);
}

/* MediaPipe FaceLandmarker (same model + indices as the mirror) — finds where each region is on the frozen frame.
   Offline or no face → the static layout. */
const TV = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304';
const LM_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let visionP = null, landmarker = null;
const loadVision = () => visionP ||= (async () => {
  const v = await import(`${TV}/vision_bundle.mjs`);
  return { v, fileset: await v.FilesetResolver.forVisionTasks(`${TV}/wasm`) };
})();
async function locateRegions(img, mirrored) {
  await (img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; }));
  try {
    if (!landmarker) {
      const { v, fileset } = await loadVision();
      landmarker = await v.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: LM_MODEL }, runningMode: 'IMAGE', numFaces: 1 });
    }
    const lm = landmarker.detect(img).faceLandmarks?.[0];
    if (!lm) return null;
    const pos = {};
    for (const [r, idx] of Object.entries(REGION_ANCHORS)) pos[r] = [mirrored ? 1 - lm[idx].x : lm[idx].x, lm[idx].y];
    return pos;
  } catch { return null; }
}

/* ── chat (keyword, as before) ────────────────────────────────────────── */
function handleMessage(t, speak = false) {
  let used = false; const lower = t.toLowerCase();
  if (/hydrat|dry|dehydrat|tight/.test(lower)) { state.concern = 'Hydration'; used = true; }
  else if (/comfort|sensitiv|gentle|sooth|red|irritat/.test(lower)) { state.concern = 'Comfort'; used = true; }
  else if (/glow|dull|bright|tone|spot/.test(lower)) { state.concern = 'Glow'; used = true; }
  if (used && state.read) state.override = true;
  const m = t.match(/(?:\$|under\s*|budget\s*(?:of\s*)?)(\d+)/i);
  if (m) {
    const n = Number(m[1]);
    if (n < 15 || n > 120) { say('Pick a budget between $15 and $120.', speak); return; }
    state.budget = n; used = true;
  }
  if (/(?:need|want|no|don.t have|do not have).*moisturi[sz]er/i.test(t)) { state.keep = false; used = true; }
  else if (/(?:have|keep|own).*moisturi[sz]er/i.test(t)) { state.keep = true; used = true; }
  if (used) {
    syncControls(); build(false);
    say(`Got it. ${state.override || !state.read ? state.concern + ', ' : ''}$${state.budget}. ${state.keep ? 'Your moisturizer stays.' : 'I’ll make room for a moisturizer.'}`, speak);
    toast('Your picks are updated below.');
  } else say('Tell me a focus (hydration, comfort or glow) and a budget. And whether you already have a moisturizer.', speak);
  return { concern: state.concern, budget: state.budget, keepMoisturizer: state.keep };
}
$('chat-form').onsubmit = e => { e.preventDefault(); const t = $('message').value.trim(); if (!t) return; $('message').value = ''; converse(t); };
document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => converse(b.dataset.prompt));

/* ── scan ─────────────────────────────────────────────────────────────── */
function stopCamera() {
  scanGeneration++;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('camera').srcObject = null; $('camera').hidden = true; $('scan-sample').hidden = false;
  $('scan-view').classList.remove('scanning'); $('start-scan').disabled = false;
  stopLive();
}
function openSkinCheck() {
  stopCamera();
  $('scan-status').textContent = 'Camera off';
  $('camera-note').textContent = 'Scanning sends three camera frames to the analysis service.';
  $('camera-button').hidden = false; $('camera-button').disabled = false;
  $('start-scan').hidden = true;
  $('scan-dialog').showModal();
}
$('open-scan').onclick = openSkinCheck;
$('close-scan').onclick = () => $('scan-dialog').close();
$('scan-dialog').addEventListener('close', stopCamera);
$('camera-button').onclick = async () => {
  const gen = scanGeneration;
  $('camera-button').disabled = true;
  try {
    const incoming = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    if(gen !== scanGeneration || !$('scan-dialog').open) {incoming.getTracks().forEach(t=>t.stop()); return;}
    stream = incoming; $('camera').srcObject = incoming;
    $('camera').hidden = false; $('scan-sample').hidden = true;
    $('camera-button').hidden = true; $('start-scan').hidden = false;
    $('scan-status').textContent = 'Center your face';
  } catch {
    if(gen !== scanGeneration || !$('scan-dialog').open) return;
    $('camera-button').disabled = false;
    $('scan-status').textContent = 'Camera unavailable';
    $('camera-note').textContent = 'Allow camera access, try the sample, or choose your goal.';
  }
};
function grabFrame() {
  const v = $('camera'); if (!stream || !v.videoWidth) return null;
  const s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .9);
}

async function analyze(frames) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(`${API}/analyze/face`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images_b64: frames }), signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

$('start-scan').onclick = async () => {
  const gen = scanGeneration;
  const active = () => gen === scanGeneration && $('scan-dialog').open;
  $('start-scan').disabled = true; $('scan-view').classList.add('scanning');
  $('scan-status').textContent = 'Hold still…';
  try {
    const frames = [];
    for(let i=0;i<3;i++) {
      if(!active()) return;
      const frame = grabFrame();
      if(!frame) throw Error('The camera isn’t ready. Try again in a moment.');
      frames.push(frame);
      await new Promise(resolve=>setTimeout(resolve,220));
    }
    if(!active()) return;
    $('scan-status').textContent = 'Finding your focus…';
    const response = await analyze(frames).catch(()=>{throw Error('Live analysis is unavailable. Try the sample or choose your goal.');});
    if(!active()) return;
    if(response.quality?.usable === false) throw Error('Try brighter lighting and face the camera.');
    const scores = Object.fromEntries(Object.entries(response.scores || {}).filter(([key,entry]) =>
      Object.hasOwn(AXIS_WEIGHT,key) && Number.isFinite(entry?.value) && entry.value>=0 && entry.value<=100
    ).map(([key,entry])=>[key,entry.value]));
    if(!Object.keys(scores).length) throw Error('No usable read. Try again or choose your goal.');
    finishSkinCheck({scores,sample:false});
  } catch(error) {
    if(active()) { $('scan-status').textContent='Scan incomplete'; $('camera-note').textContent=error.message; }
  } finally {
    if(active()) { $('start-scan').disabled=false; $('scan-view').classList.remove('scanning'); }
  }
};
function finishSkinCheck(read) {
  $('scan-dialog').close();
  document.dispatchEvent(new CustomEvent('skin-check-finished',{detail:read}));
}
$('sample-scan').onclick = () => finishSkinCheck(SAMPLE_READ);
$('skip-scan').onclick = () => finishSkinCheck(null);
$('read-to-picks').onclick = () => $('routine').scrollIntoView({ behavior: 'smooth' });
$('read-again').onclick = () => $('open-scan').click();
$('read-camera-off').onclick = () => { stopCamera(); $('read-camera-off').hidden = true; };

/* ── bag ──────────────────────────────────────────────────────────────── */
$('checkout').onclick = () => {
  const items = state.items.filter(([p]) => state.selected.has(p.id));
  $('bag-items').replaceChildren();
  items.forEach(([p]) => {
    const r = document.createElement('div'); r.className = 'bag-row';
    const name = document.createElement('a'), price = document.createElement('strong');
    name.textContent = `${p.brand} — ${p.name}`; name.href = p.url; name.target = '_blank'; name.rel = 'noopener';
    price.textContent = money(p.price_usd);
    r.append(name, price); $('bag-items').append(r);
  });
  $('bag-total').textContent = 'Subtotal: ' + money(items.reduce((s, [p]) => s + p.price_usd, 0));
  $('bag-dialog').showModal();
};
$('close-bag').onclick = $('back-routine').onclick = () => $('bag-dialog').close();
window.addEventListener('pagehide', () => { stopCamera(); if ('speechSynthesis' in window) speechSynthesis.cancel(); });

/* ── boot ─────────────────────────────────────────────────────────────── */
fetch('data/oy_catalog.json').then(r => r.json()).then(d => { catalog = d.products; document.dispatchEvent(new Event('catalog-ready')); }).catch(() => { document.dispatchEvent(new Event('catalog-error')); toast('Couldn’t load the product list. Reload to try again.'); });
syncControls();

if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'configure_demo_routine', title: 'Configure SYNC demo routine',
      description: 'Set preferences and show picks from the Olive Young sample catalogue. Does not buy products or place orders.',
      inputSchema: { type: 'object', properties: { concern: { type: 'string', enum: ['Hydration', 'Comfort', 'Glow'] }, budget: { type: 'number', minimum: 15, maximum: 120 }, keepMoisturizer: { type: 'boolean' } }, required: ['concern', 'budget', 'keepMoisturizer'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !FOCUS_AXIS[input.concern] || typeof input.budget !== 'number' || input.budget < 15 || input.budget > 120 || typeof input.keepMoisturizer !== 'boolean') throw new Error('Expected a supported focus, budget from 15 to 120, and keepMoisturizer boolean.');
        state.concern = input.concern; state.override = !!state.read; state.budget = input.budget; state.keep = input.keepMoisturizer; syncControls(); return build(false);
      },
    })).catch(() => {});
  } catch {}
}
