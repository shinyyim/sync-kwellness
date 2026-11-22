'use strict';
/* Mirror mode — the scan, full screen, on your own face.
   The mirror's register (sync-mirror app/mirror): white micro labels with ticks, one gold accent,
   IBM Plex Mono annotation, score dial top right, the 15-axis rail bottom right.
   The landing's scan box (06_site/landing_v1.html): one 1px box that glides region to region.

   1. camera   live, mirrored, full bleed
   2. reading  three frames captured; the last one freezes, blurs, and the box walks the face while /analyze/face runs
   3. tour     the frame comes back sharp; each region is zoomed into, with a leader line to a card:
               the model's observation for that region and every axis that lives there
   4. overview zoom out, every region tagged at once, dial + rail + diagnosis
   Shares globals with app.js (loaded first). */

const M = {
  on: false, phase: 'idle', read: null, frame: null, boxes: null, dims: null,
  timers: [], gen: 0,
};
const mm = id => document.getElementById(id);

// which axes live where — the card for a region shows all of them
const REGION_AXES = {
  forehead: ['brightness', 'wrinkles', 'texture'],
  glabella: ['wrinkles', 'barrier'],
  t_zone: ['oiliness', 'congestion', 'pores'],
  nose: ['pores', 'congestion', 'oiliness'],
  left_cheek: ['hydration', 'redness', 'pigmentation', 'texture'],
  right_cheek: ['barrier', 'redness', 'pigmentation', 'hydration'],
  under_eye_left: ['dark_circles', 'puffiness', 'eye'],
  under_eye_right: ['dark_circles', 'puffiness', 'eye'],
  lips: ['hydration', 'barrier'],
  chin: ['blemishes', 'congestion', 'oiliness'],
  jawline: ['elasticity', 'blemishes'],
};
// MediaPipe face-mesh points that outline each region (same mesh as the mirror's anchors)
const REGION_MESH = {
  forehead: [10, 67, 109, 338, 297, 151, 108, 337, 69, 299],
  glabella: [9, 8, 107, 336, 55, 285],
  t_zone: [168, 6, 197, 122, 351, 193, 417],
  nose: [4, 1, 5, 48, 278, 94, 98, 327, 195],
  left_cheek: [50, 101, 118, 123, 147, 187, 205, 36, 142, 117],
  right_cheek: [280, 330, 347, 352, 376, 411, 425, 266, 371, 346],
  under_eye_left: [145, 144, 153, 22, 23, 24, 110, 111, 117, 118, 119],
  under_eye_right: [374, 373, 380, 252, 253, 254, 339, 340, 346, 347, 348],
  lips: [0, 17, 61, 291, 13, 14, 37, 267, 84, 314],
  chin: [152, 175, 199, 200, 18, 83, 313, 208, 428],
  jawline: [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397],
};
const TOUR_ORDER = ['forehead', 'glabella', 'under_eye_left', 'under_eye_right', 'nose', 't_zone', 'left_cheek', 'right_cheek', 'lips', 'chin', 'jawline'];
const status = v => v < DEFICIT_AT ? 'out of sync' : v < 80 ? 're-syncing' : 'in sync';
const slug = r => name(r).replace(/ /g, '-');
function name(r) {
  const b = M.boxes && M.boxes[r];
  if (!b || !/left|right/.test(r)) return r.replace(/_/g, ' ');
  const side = b.x + b.w / 2 < frameSize()[0] / 2 ? 'left' : 'right';
  return r.replace(/left|right/, side).replace(/_/g, ' ');
}

/* ── geometry: normalized image coords → screen, through object-fit: cover + mirror ── */
// coordinates are the frame's own (the rounded lime box), not the window's
const frameSize = () => { const f = mm('m-frame'); return [f.clientWidth, f.clientHeight]; };
function coverMap(iw, ih) {
  const [W, H] = frameSize(), s = Math.max(W / iw, H / ih);
  const dw = iw * s, dh = ih * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  return (x, y) => [ox + (1 - x) * dw, oy + y * dh];   // mirrored, like a mirror
}
function boxesFrom(lm, iw, ih) {
  const map = coverMap(iw, ih), out = {};
  for (const [r, idx] of Object.entries(REGION_MESH)) {
    const pts = idx.map(i => map(lm[i].x, lm[i].y));
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
    let y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    const px = (x1 - x0) * .14 + 6, py = (y1 - y0) * .18 + 6;
    out[r] = { x: x0 - px, y: y0 - py, w: x1 - x0 + 2 * px, h: y1 - y0 + 2 * py };
  }
  return out;
}
function staticBoxes(iw, ih) {   // no face found — the landing's layout, centred
  const map = coverMap(iw, ih), out = {};
  for (const [r, [x, y]] of Object.entries({ ...STATIC_POS, glabella: [.5, .31], lips: [.5, .56] })) {
    const [cx, cy] = map(1 - x, y);
    out[r] = { x: cx - 60, y: cy - 28, w: 120, h: 56 };
  }
  return out;
}

let stillLM = null;
async function faceBoxes(img) {
  try {
    if (!stillLM) {
      const { v, fileset } = await loadVision();
      stillLM = await v.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: LM_MODEL }, runningMode: 'IMAGE', numFaces: 1 });
    }
    const lm = stillLM.detect(img).faceLandmarks?.[0];
    return lm ? boxesFrom(lm, img.naturalWidth, img.naturalHeight) : staticBoxes(img.naturalWidth, img.naturalHeight);
  } catch { return staticBoxes(img.naturalWidth || 960, img.naturalHeight || 1280); }
}

/* ── phase control ── */
const later = (fn, ms) => { const g = M.gen, t = setTimeout(() => g === M.gen && fn(), ms); M.timers.push(t); };
function clearTimers() { M.timers.forEach(clearTimeout); M.timers = []; }
function setPhase(p) { M.phase = p; mm('mirror').dataset.phase = p; }
function mstatus(t) { mm('m-status').textContent = t; }

/* ── onboarding: the name, asked out loud before the first read (the mirror asked it too).
   Remembered in this browser only; "Not you?" asks again. ── */
const NAME_KEY = 'sync.demo.name';
try { state.name = localStorage.getItem(NAME_KEY) || ''; } catch { state.name = ''; }
function setName(n) { state.name = n; try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch {} }
const withName = (line, lead = true) => state.name ? (lead ? `${state.name}, ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line) : line;

// "my name's shiny" / "it's Shiny Yim" / "call me Shiny" → "Shiny"
function parseName(t) {
  t = t.trim().replace(/[.!?,]+$/g, '').replace(/^(hi|hey|hello|um+|uh+|so)[,\s]+/i, '');
  t = t.replace(/^(my name is|my name's|i am|i'm|it is|it's|call me|you can call me|this is|name's)\s+/i, '');
  const w = t.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!w.length || w[0].length > 20) return '';
  return w.map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join(' ');
}

function listenOnce(ms = 7000) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.resolve('');
  return new Promise(resolve => {
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    let final = '', settled = false;
    const end = () => { if (settled) return; settled = true; clearTimeout(t); try { rec.stop(); } catch {} setMood('idle'); resolve(final.trim()); };
    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
      mm('m-heard').textContent = (final + interim).trim() || '…';
      if (final) end();
    };
    rec.onend = end; rec.onerror = end;
    const t = setTimeout(end, ms);
    M.nameRec = rec; setMood('listening');
    try { rec.start(); } catch { end(); }
  });
}

async function askName(g) {
  setPhase('name'); mstatus('Hello');
  mm('m-name').hidden = false; mm('m-go').hidden = true; mm('m-heard').textContent = '…';
  mm('m-q').textContent = 'What should I call you?';
  const field = mm('m-name-field'); field.value = ''; setTimeout(() => field.focus(), 50);
  let typed = null, byHand = false;
  const typedP = new Promise(r => { M.nameTyped = v => { byHand = true; r(v); }; });
  await speakLine('Hey. Before I look, what should I call you?', g);
  if (g !== M.gen) return;
  caption('');
  // whichever comes first: a spoken name or a typed one
  for (let tries = 0; tries < 2 && g === M.gen; tries++) {
    const said = await Promise.race([listenOnce(), typedP]);
    typed = said;
    if (said === ' ' || parseName(typed)) break;   // ' ' = skipped
    if (g !== M.gen) return;
    if (tries === 0) await speakLine('Sorry, didn’t catch that. Just your first name.', g);
  }
  if (g !== M.gen) return;
  try { M.nameRec?.abort(); } catch {}
  let n = parseName(typed || '');
  // a heard name gets a beat to be corrected — speech recognition mangles names ("Shiny" came back "Summer")
  if (n && !byHand) {
    mm('m-q').textContent = `${n}, right?`;
    field.value = n;
    mm('m-heard').textContent = 'say yes or no, or fix it and press return';
    let typedFix = null;
    const fixP = new Promise(r => { M.nameTyped = v => { typedFix = v; r(v); }; });
    await speakLine(`${n}, right?`, g); if (g !== M.gen) return;
    const answer = await Promise.race([listenOnce(5000), fixP]);
    if (g !== M.gen) return;
    if (typedFix != null) { if (parseName(typedFix)) n = parseName(typedFix); }
    else if (/\b(no|nope|nah|wrong|not)\b/i.test(answer)) {
      // speech got it wrong once already; don't make them say it again
      mm('m-q').textContent = 'Type it for me?'; field.value = ''; field.focus();
      mm('m-heard').textContent = 'names are hard to hear. press return when done';
      await speakLine('Sorry. Type it for me?', g); if (g !== M.gen) return;
      const t = await new Promise(r => { M.nameTyped = r; });
      if (g !== M.gen) return;
      n = parseName(t) || n;
    }
  }
  setName(n);
  mm('m-name').hidden = true;
  readyToRead(g, n ? `Nice to meet you, ${n}. Face the light and hold still.` : 'No problem. Face the light and hold still.');
}

function readyToRead(g, line) {
  setPhase('camera'); mstatus(state.name ? `Hi, ${state.name}` : 'Ready');
  mm('m-ready-title').innerHTML = state.name ? `Face the light, <em>${esc(state.name)}.</em>` : 'Face the light.';
  mm('m-go').hidden = false; mm('m-go').disabled = false;
  mm('m-notyou').hidden = !state.name;
  mm('m-notyou').textContent = state.name ? `Not ${state.name}?` : '';
  if (line) speakLine(line, g).then(() => g === M.gen && caption(''));
}

async function openMirror() {
  unlockAudio();
  M.gen++; clearTimers();
  M.on = true; M.read = null; M.boxes = null;
  document.body.classList.add('mirror-open');
  mm('mirror').hidden = false;
  resetZoom(); mm('m-labels').replaceChildren(); mm('m-card').hidden = true; mm('m-lines').innerHTML = ''; mm('m-flines').innerHTML = ''; mm('m-readlist').replaceChildren(); mm('m-foot').textContent = '01 / YOUR FACE';
  mm('m-hud').hidden = mm('m-rail').hidden = mm('m-diag').hidden = true;
  mm('m-still').hidden = true; mm('m-still').classList.remove('blur');
  mm('m-box').hidden = true; mm('m-dots').hidden = true; caption('');
  mm('m-go').hidden = false; mm('m-go').disabled = true; mm('m-after').hidden = true; mm('m-skip').hidden = true; mm('m-name').hidden = true; mm('m-notyou').hidden = true;
  setPhase('camera'); mstatus('Starting camera');
  loadVision().catch(() => {});   // warm the landmark model while you line up
  try {
    if (!stream) stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    const v = mm('m-video'); v.srcObject = stream; v.hidden = false; await v.play().catch(() => {});
    const g = M.gen;
    if (!state.name) askName(g);
    else readyToRead(g, `Hey ${state.name}. Face the light and hold still.`);
  } catch {
    mstatus('No camera · sample read');
    mm('m-go').disabled = false; mm('m-go').textContent = 'Show a sample read';
  }
}

function closeMirror() {
  M.gen++; clearTimers(); M.on = false; caption(''); hush(); try { M.nameRec?.abort(); } catch {}
  mm('mirror').hidden = true; document.body.classList.remove('mirror-open');
  mm('m-video').srcObject = null;
}

function grabM() {
  const v = mm('m-video'); if (!stream || !v.videoWidth) return null;
  const s = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .9);
}

async function startRead() {
  const g = ++M.gen; clearTimers(); hush();
  mm('m-go').hidden = true; mm('m-notyou').hidden = true; caption('');
  const frames = [];
  if (stream) {
    setPhase('capture'); mstatus('Hold still');
    for (let i = 0; i < 3; i++) { const f = grabM(); if (f) frames.push(f); await new Promise(r => setTimeout(r, 350)); }
  }
  const sample = !frames.length;
  M.frame = sample ? 'assets/sample_face.jpg' : frames.at(-1);

  // freeze the last frame: this is the face the read is about
  const img = mm('m-still');
  img.classList.toggle('unmirrored', sample);
  img.src = M.frame; await img.decode().catch(() => {});
  img.hidden = false; mm('m-video').hidden = true; img.classList.add('blur');
  setPhase('reading'); mstatus('Reading · about 10 seconds'); mm('m-dots').hidden = false;

  const boxesP = faceBoxes(img).then(b => { M.boxes = sample ? mirrorBoxes(b) : b; return M.boxes; });
  const readP = sample ? new Promise(r => setTimeout(() => r(SAMPLE_READ), 2600)) : analyze(frames).then(r => r.quality && r.quality.usable === false
    ? { ...SAMPLE_READ, note: `Couldn’t get a clear read (${r.quality.reason || 'face not clear'}). This is a sample.` }
    : { sample: false, scores: Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, Math.round(v.value)])), regions: r.regions || {}, diagnosis: r.diagnosis, skin_type: r.skin_type, age_range: r.age_range, fitzpatrick: r.fitzpatrick, top_concern: r.top_concern })
    .catch(() => ({ ...SAMPLE_READ, note: 'The read service isn’t reachable. This is a sample.' }));

  // while it reads, the box walks the face — the landing's gesture
  boxesP.then(b => walk(b, g));
  const read = await readP; await boxesP;
  if (g !== M.gen) return;
  M.read = read;
  if (read.note) toast(read.note);
  mm('m-dots').hidden = true; mm('m-box').hidden = true; mm('m-walk').hidden = true;
  img.classList.remove('blur');

  // hand the read to the page too: section 01, picks, and the agent's context
  state.read = read; state.override = false; voice.history = [];
  if (window.recordRead) recordRead(read);   // the history that makes the next read mean something
  state.concern = AXIS_FOCUS[targetAxes()[0].axis] || 'Hydration'; syncControls();
  renderRead(read, read.sample ? 'assets/sample_face.jpg' : M.frame, read.sample ? null : stream);
  build(false);

  showHud(read);
  M.brief = null;
  tour(read, g);
}
// the sample photo is shown unmirrored, so its boxes flip back
function mirrorBoxes(b) {
  const W = frameSize()[0], out = {};
  for (const [r, x] of Object.entries(b)) out[r] = { ...x, x: W - x.x - x.w };
  return out;
}

function walk(boxes, g) {
  const order = TOUR_ORDER.filter(r => boxes[r]);
  let i = 0;
  const step = () => {
    if (g !== M.gen || M.phase !== 'reading') return;
    const r = order[i++ % order.length], b = boxes[r];
    placeBox(b, 1);
    const w = mm('m-walk'); w.hidden = false;
    w.style.left = b.x + 'px'; w.style.top = (b.y + b.h + 8) + 'px';
    w.textContent = name(r);
    const list = mm('m-readlist');
    if (!list.querySelector(`[data-r="${r}"]`) && list.children.length < order.length) {
      const li = document.createElement('li'); li.dataset.r = r;
      li.innerHTML = `<span>${esc(name(r))}</span><b>read</b>`; list.append(li);
    }
    later(step, 900);
  };
  step();
}

function placeBox(b, z) {
  const box = mm('m-box'); box.hidden = false;
  box.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;   // border stays 1px through the zoom via the wrapper's --z
}

/* ── zoom ── */
function resetZoom() { const z = mm('m-zoom'); z.style.transform = 'translate(0px,0px) scale(1)'; z.style.setProperty('--z', 1); }
function zoomTo(b) {
  const [W, H] = frameSize();
  const z = Math.min(3.2, Math.max(1.8, W * .42 / b.w));
  const T = [W * .5, H * .44];
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const tx = T[0] - cx * z, ty = T[1] - cy * z;
  const zEl = mm('m-zoom');
  zEl.style.transform = `translate(${tx}px,${ty}px) scale(${z})`; zEl.style.setProperty('--z', z);
  return { x: b.x * z + tx, y: b.y * z + ty, w: b.w * z, h: b.h * z };
}

function tourRegions(read) {
  return TOUR_ORDER.filter(r => M.boxes[r] && ((read.regions && read.regions[r] && !/^(null|unclear)$/i.test(read.regions[r])) || REGION_AXES[r].some(a => read.scores[a] != null)));
}
// the walk-through: six regions, not eleven. The one asking always makes it; the rest are the
// lowest-scoring, one side of each pair only, then put back in face order (top to bottom)
const TOUR_MAX = 6;
const PAIR = { under_eye_left: 'under_eye', under_eye_right: 'under_eye', left_cheek: 'cheek', right_cheek: 'cheek' };
function tourPick(read) {
  const s = read.scores, all = tourRegions(read), accent = accentRegion(read);
  const low = r => Math.min(...REGION_AXES[r].filter(a => s[a] != null).map(a => s[a]), 100);
  const ranked = [...all].sort((a, b) => (b === accent) - (a === accent) || low(a) - low(b) || TOUR_ORDER.indexOf(a) - TOUR_ORDER.indexOf(b));
  const out = [], seen = new Set();
  for (const r of ranked) {
    const k = PAIR[r] || r;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
    if (out.length === TOUR_MAX) break;
  }
  return out.sort((a, b) => TOUR_ORDER.indexOf(a) - TOUR_ORDER.indexOf(b));
}
function accentRegion(read) {
  const t = rankAxes(read.scores)[0].axis;
  return AXIS_REGION[t];
}

function card(read, r, i, n, accent) {
  const s = read.scores;
  const axes = REGION_AXES[r].filter(a => s[a] != null);
  const worst = axes.length ? Math.min(...axes.map(a => s[a])) : 100;
  const rows = axes.map(a => `<div class="mc-row${s[a] < DEFICIT_AT ? ' low' : ''}"><span>${esc(AXIS_WORD[a])}</span><i><b style="width:${s[a]}%"></b></i><strong>${s[a]}</strong><em>${status(s[a])}</em></div>`).join('');
  const note = read.regions && read.regions[r] && !/^(null|unclear)$/i.test(read.regions[r]) ? read.regions[r] : `${capital(status(worst))} here.`;
  return `<div class="mc-top"><span>sync.ai/read/${slug(r)}</span><span>${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</span></div>
    <h3>${esc(name(r))}</h3>
    <p class="mc-note">${esc(capital(note))}</p>
    <div class="mc-rows">${rows}</div>
    ${r === accent ? `<span class="mc-flag">the one asking · ${esc(AXIS_WORD[rankAxes(s)[0].axis])} ${rankAxes(s)[0].value}</span>` : `<span class="mc-state">${status(worst)}</span>`}`;
}

function leader(from, to) {
  mm('m-lines').innerHTML = `<line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}"/><circle cx="${from[0]}" cy="${from[1]}" r="3"/>`;
}

/* ── the briefing: the agent talks you through each region while the tour shows it ──
   The intro is written here and starts speaking at once; the per-region lines come from
   /chat in one call while it plays (templates if that fails). Audio for the next region is
   fetched while the current one plays, so there is no gap between regions. */
const TTS = new Map();
function ttsUrl(text) {
  if (!TTS.has(text)) TTS.set(text, fetch(`${API}/say`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    .then(r => r.ok ? r.blob() : Promise.reject(r.status)).then(b => URL.createObjectURL(b)).catch(() => null));
  return TTS.get(text);
}
const wait = ms => new Promise(r => later(r, ms));   // never resolves if the tour is interrupted — fine, it just stops

// what the companion is saying, in the bubble beside it
function caption(text) {
  const c = $('buddy-bubble'); c.textContent = text; c.hidden = !text || chat.open;
  c.classList.remove('in'); void c.offsetWidth; c.classList.add('in');
  chatAdd('agent', text);      // everything said out loud also lands in the chat log
}

function speakLine(text, g) {
  caption(text);
  if (chat.mute) return wait(Math.min(5000, 1200 + text.split(/\s+/).length * 260));
  $('speech').textContent = text; $('reply').textContent = text; $('buddy-bubble').textContent = text;
  return new Promise(async resolve => {
    const my = ++voice.seq;
    voice.audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel();
    setMood('speaking');
    let finished = false;
    const done = () => { if (finished) return; finished = true; clearTimeout(guard); if (my === voice.seq) setMood('idle'); resolve(); };
    // watchdog: if audio never starts or never ends (autoplay blocked, device asleep), the walk-through
    // must not hang on it — move on after roughly the time the line takes to say
    const guard = setTimeout(done, 4000 + text.split(/\s+/).length * 450);
    const url = await ttsUrl(text);
    if (g !== M.gen || my !== voice.seq) return done();
    if (url) { voice.ctx?.resume(); voice.audio.src = url; voice.audio.onended = voice.audio.onerror = done; voice.audio.play().catch(done); }
    else if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = .98; u.onend = u.onerror = done; speechSynthesis.speak(u); }
    else setTimeout(done, 2500);
  });
}
function hush() { voice.seq++; voice.audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); setMood('idle'); }

const observed = (read, r) => read.regions && read.regions[r] && !/^(null|unclear)$/i.test(read.regions[r]) ? read.regions[r] : '';
function briefLocal(read, r) {
  const s = read.scores, ax = REGION_AXES[r].filter(a => s[a] != null).sort((a, b) => s[a] - s[b]);
  const w = ax[0], note = observed(read, r), where = capital(name(r));
  if (!w) return `${where}: ${note || 'nothing to flag'}.`;
  if (s[w] < DEFICIT_AT) return `${where}. ${capital(note || CONCERN_COPY[w])}. ${capital(AXIS_WORD[w])} ${s[w]}, that's out of sync.`;
  if (s[w] < 80) return `${where}. ${capital(note || CONCERN_COPY[w])}. ${capital(AXIS_WORD[w])} ${s[w]}, not bad, not there yet.`;
  return `${where} is fine. ${capital(note || 'nothing to fix')}.`;
}
function closeLocal(read) {
  const t = rankAxes(read.scores)[0], p = state.items[0];
  return `So ${AXIS_WORD[t.axis]} is where I'd start${state.name ? ', ' + state.name : ''}. Let me show you what I'd use.`;
}

async function briefing(read, regions) {
  const s = read.scores, top = rankAxes(s)[0];
  const out = { lines: Object.fromEntries(regions.map(r => [r, briefLocal(read, r)])), close: closeLocal(read) };
  const facts = regions.map(r => `- ${r}: observed "${observed(read, r) || 'nothing noted'}"; ${REGION_AXES[r].filter(a => s[a] != null).map(a => `${AXIS_WORD[a]} ${s[a]} (${status(s[a])})`).join(', ')}`).join('\n');
  const picks = state.items.map(([p, role]) => `${p.brand} ${p.name} (${ROLE_NOUN[role]})`).join('; ') || 'none';
  const sys = `You are SYNC, a K-wellness companion, walking one person through their skin read out loud, one face region at a time, while each region is zoomed in on screen.
Voice: a trusted older friend who knows skin. Warm, direct, concrete, a little opinionated. Not a teacher, not customer service. English only.
Return ONLY JSON, no code fences: {"regions": {"<region key>": "<line>"}, "close": "<line>"}
Each region line: ONE spoken sentence, 8 to 20 words. Say what you see there and what it means for them. Mention a number only when that axis is out of sync or re-syncing. Vary the openings. Never say left or right (the screen is mirrored). Don't repeat the region name word for word every time.
"close": two short sentences. Tie the one thing asking most (${AXIS_WORD[top.axis]} ${top.value}) to the picks: ${picks}. End by saying you'll show them what you'd use (the products come next, one by one).
Scores are 0-100, higher is better. In sync is 80+, re-syncing 68-79, out of sync below 68. "Barrier" means the skin's own protective layer.
${state.name ? `Their name is ${state.name}. Use it once in the region lines and once in the close, naturally, never at the start of every line.` : ''}
No medical claims or diagnoses. Never say: elevate, transform, journey, empower, best self, I'm here to help. No emoji.
${read.sample ? 'This is a SAMPLE read, not this person. Say "this sample" instead of "you" where it matters.' : ''}
SYNC SCORE ${syncScore(s)}. Diagnosis: ${read.diagnosis || '-'}
REGIONS (use these keys):
${facts}`;
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify({ question: 'Brief me, region by region.', system: sys }) });
    clearTimeout(tm);
    const a = (await r.json()).answer || '';
    const j = JSON.parse(a.slice(a.indexOf('{'), a.lastIndexOf('}') + 1));
    // a line that says left or right is wrong half the time on a mirrored screen — the template stands in
    for (const k of regions) if (typeof j.regions?.[k] === 'string' && j.regions[k].trim() && !/\b(left|right)\b/i.test(j.regions[k])) out.lines[k] = j.regions[k].trim();
    if (typeof j.close === 'string' && j.close.trim()) out.close = j.close.trim();
  } catch {}
  return out;
}

async function tour(read, g) {
  setPhase('tour'); mstatus('The read');
  mm('m-skip').hidden = false;
  voice.convo = false;
  if (voice.rec) try { voice.rec.abort(); } catch {}
  const regions = tourPick(read), accent = accentRegion(read);
  const sc = syncScore(read.scores);
  const intro = withName(`${sc}. You're ${band(sc).toLowerCase()}. Let me walk you through it.`);
  M.brief ||= briefing(read, regions);
  await speakLine(intro, g); if (g !== M.gen) return;
  mstatus('The read · briefing');
  const brief = await M.brief; if (g !== M.gen) return;
  regions.slice(0, 2).forEach(r => ttsUrl(brief.lines[r]));

  for (let i = 0; i < regions.length; i++) {
    if (g !== M.gen) return;
    const r = regions[i];
    if (regions[i + 1]) ttsUrl(brief.lines[regions[i + 1]]);    // next one loads while this one plays
    const z = zoomTo(M.boxes[r]);
    placeBox(M.boxes[r], 1);
    mm('m-box').classList.toggle('gold', r === accent);
    const c = mm('m-card'); c.hidden = true; mm('m-lines').innerHTML = '';
    mm('m-foot').textContent = `${String(i + 1).padStart(2, '0')} / ${name(r).toUpperCase()}`;
    await wait(750);       // the zoom lands
    c.innerHTML = card(read, r, i, regions.length, accent);
    c.classList.toggle('gold', r === accent);
    c.hidden = false; c.classList.remove('in'); void c.offsetWidth; c.classList.add('in');
    const cr = c.getBoundingClientRect(), fr = mm('m-frame').getBoundingClientRect(), narrow = innerWidth < 900;
    leader(narrow ? [fr.left + z.x + z.w / 2, fr.top + z.y + z.h] : [fr.left + Math.min(z.x + z.w, fr.width - 12), fr.top + z.y + z.h / 2], narrow ? [cr.left + 30, cr.top] : [cr.left, cr.top + 44]);
    await Promise.all([speakLine(brief.lines[r], g), wait(2000)]);
    await wait(300);
  }
  if (g !== M.gen) return;
  overview(read, g);
  ttsUrl(brief.close);
  await wait(900);
  await speakLine(brief.close, g);
  if (g !== M.gen) return;
  await wait(1400);                 // a beat on the overview, then the products
  if (state.items.length) { closeMirror(); briefPicks(); }
  else { caption(''); voice.convo = true; listen(); }
}

/* ── the products, spoken: each card is lit and scrolled to while the agent says
   what it is, why it's for this read (the ingredient and where it sits on the label),
   and when and how to use it. One /chat call writes the lines; templates if it fails. ── */
function pickLocal(p, role, t, i, n) {
  const e = p.enriched || {}, first = ['First', 'Then', 'After that', 'Last'][i === n - 1 && n > 1 ? 3 : Math.min(i, 2)];
  const ev = t && t.axis ? evidenceFor(p, t.axis)[0] : null;
  const why = role === 'sunscreen' ? 'Every morning ends with it.'
    : ev ? `It has ${ev.inci}, number ${ev.position} on the label, for your ${AXIS_WORD[t.axis]}${t.value != null ? ` at ${t.value}` : ''}.` : '';
  const when = role === 'sunscreen' ? 'Mornings, last step.' : `${(e.when || 'AM and PM').replace('AM and PM', 'Morning and night')}, ${whereItGoes(p, role, state.items).split(' · ')[1]}.`;
  return `${first}, the ${p.brand} ${ROLE_NOUN[role]}. ${why} ${when}`.replace(/\s+/g, ' ');
}
async function pickLines(items) {
  const out = { lines: items.map(([p, r, t], i) => pickLocal(p, r, t, i, items.length)), close: `That's the whole routine, ${money(items.reduce((a, [p]) => a + p.price_usd, 0))}. Ask me anything${state.name ? ', ' + state.name : ''}.` };
  const facts = items.map(([p, role, t], i) => { const e = p.enriched || {}, ev = t && t.axis ? evidenceFor(p, t.axis).slice(0, 2) : [];
    return `${i + 1}. ${p.brand} ${p.name} ($${p.price_usd.toFixed(2)}), role: ${ROLE_NOUN[role]}; ${whereItGoes(p, role, items)}; when: ${role === 'sunscreen' ? 'AM' : e.when || 'AM and PM'}
   answers: ${t && t.axis ? `${AXIS_WORD[t.axis]}${t.value != null ? ' ' + t.value : ''}` : 'daily protection'}; evidence on its label: ${ev.map(a => `${a.inci} (#${a.position} of ${a.of}: ${a.does})`).join('; ') || '-'}
   what it is: ${e.what || '-'}; how to use: ${(e.how_to_use || []).join(' ')}${e.caution ? '; caution: ' + e.caution : ''}`; }).join('\n');
  const sys = `You are SYNC, a K-wellness companion, talking one person through the products you picked for them, out loud, one at a time, while each product is highlighted on screen.
Voice: a trusted older friend who knows skin. Warm, direct, concrete. Not salesy, not a teacher. English only.
Return ONLY JSON, no code fences: {"items": [one line per product, in order], "close": string}
Each line: 2 or 3 spoken sentences, 25 to 40 words, in this order: (1) open with the brand and what it is, (2) why it's for THEM: say their read with its number (e.g. "your hydration's at 34") and the one ingredient that answers it, (3) when and where it goes in the routine. Don't read out prices. Say "number 6 on the label" style positions at most once.
"close": one or two short sentences: the whole routine costs ${money(items.reduce((a, [p]) => a + p.price_usd, 0))}, and invite a question.
No medical claims. Never say: elevate, transform, journey, empower, best self, I'm here to help. No emoji.
${state.name ? `Their name is ${state.name}; use it once at most.` : ''}
PRODUCTS:
${facts}`;
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify({ question: 'Walk me through the products.', system: sys }) });
    clearTimeout(tm);
    const a = (await r.json()).answer || '';
    const j = JSON.parse(a.slice(a.indexOf('{'), a.lastIndexOf('}') + 1));
    if (Array.isArray(j.items)) j.items.forEach((l, i) => { if (typeof l === 'string' && l.trim() && i < items.length) out.lines[i] = l.trim(); });
    // the close stays ours: it carries the total, and the model's version drifted into customer service
  } catch {}
  return out;
}
async function briefPicks() {
  const g = ++M.gen;
  voice.convo = false; if (voice.rec) try { voice.rec.abort(); } catch {}
  const items = [...state.items];
  if (!items.length) return;
  $('routine').scrollIntoView({ behavior: 'smooth' });
  const linesP = pickLines(items);
  await speakLine(state.name ? `Okay ${state.name}, here's what I'd use.` : "Here's what I'd use.", g); if (g !== M.gen) return;
  const L = await linesP; if (g !== M.gen) return;
  ttsUrl(L.lines[0]);
  const cards = [...document.querySelectorAll('#products .product')];
  for (let i = 0; i < items.length; i++) {
    if (g !== M.gen) break;
    if (L.lines[i + 1]) ttsUrl(L.lines[i + 1]);
    cards.forEach(c => c.classList.remove('talking'));
    const c = cards[i];
    if (c) { c.classList.add('talking'); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const h = c.querySelector('.howto'); if (h) h.open = true; }
    await Promise.all([speakLine(L.lines[i], g), wait(1500)]);
    await wait(300);
  }
  cards.forEach(c => c.classList.remove('talking'));
  if (g !== M.gen) return;
  $('skipped-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  await speakLine(L.close, g);
  if (g !== M.gen) return;
  voice.convo = true; listen();
}

function overview(read, g) {
  if (g !== M.gen) return;
  setPhase('overview'); mstatus('Your read');
  mm('m-skip').hidden = true; mm('m-card').hidden = true; mm('m-box').hidden = true;
  resetZoom();
  const accent = accentRegion(read), s = read.scores;
  const regions = tourRegions(read);
  const all = regions.map(r => M.boxes[r]);
  const fx0 = Math.min(...all.map(b => b.x)), fx1 = Math.max(...all.map(b => b.x + b.w)), fmid = (fx0 + fx1) / 2;
  // centre-line regions alternate sides so the two columns stay even
  let flip = false;
  const items = regions.map(r => {
    const b = M.boxes[r], cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const side = Math.abs(cx - fmid) < (fx1 - fx0) * .12 ? ((flip = !flip) ? 'L' : 'R') : cx < fmid ? 'L' : 'R';
    return { r, cx, cy, side };
  });
  const [FW, FH] = frameSize(), narrow = FW < 560, gap = narrow ? 50 : 60;
  const colX = { L: Math.max(narrow ? 128 : 200, fx0 - (narrow ? 14 : 40)), R: Math.min(FW - (narrow ? 128 : 200), fx1 + (narrow ? 14 : 40)) };
  const lines = [], labels = [];
  for (const side of ['L', 'R']) {
    const col = items.filter(x => x.side === side).sort((a, b) => a.cy - b.cy);
    // spread vertically around their own heights, never closer than one label
    let y = -Infinity;
    col.forEach(x => { x.ly = Math.max(x.cy, y + gap); y = x.ly; });
    const over = y - (FH - 90); if (over > 0) col.forEach(x => x.ly -= over);
    col.forEach(x => {
      const top = REGION_AXES[x.r].filter(a => s[a] != null).sort((a, b2) => s[a] - s[b2])[0];
      const note = read.regions && read.regions[x.r] && !/^(null|unclear)$/i.test(read.regions[x.r]) ? read.regions[x.r] : status(s[top]);
      const el = document.createElement('div');
      el.className = 'm-callout ' + side + (x.r === accent ? ' gold' : '');
      el.style.left = colX[side] + 'px'; el.style.top = x.ly + 'px';
      el.style.animationDelay = (labels.length * 90) + 'ms';
      el.innerHTML = `<span class="l1">${esc(name(x.r))}</span><span class="l2">${esc(note)}</span>${top ? `<span class="l3">${esc(AXIS_WORD[top])} · ${s[top]} · ${status(s[top])}</span>` : ''}`;
      labels.push(el);
      const ex = side === 'L' ? colX.L + 8 : colX.R - 8;
      lines.push(`<polyline class="${x.r === accent ? 'gold' : ''}" points="${ex},${x.ly} ${side === 'L' ? ex + 24 : ex - 24},${x.ly} ${x.cx},${x.cy}"/><circle class="${x.r === accent ? 'gold' : ''}" cx="${x.cx}" cy="${x.cy}" r="2.5"/>`);
    });
  }
  mm('m-labels').replaceChildren(...labels);
  mm('m-lines').innerHTML = '';
  mm('m-flines').innerHTML = lines.join('');
  mm('m-foot').textContent = `${regions.length} REGIONS · 15 AXES`;
  mm('m-rail').hidden = false; mm('m-diag').hidden = false;
  mm('m-after').hidden = false;
}

function showHud(read) {
  const s = read.scores, sc = syncScore(s), b = band(sc);
  const R = 72, C = 2 * Math.PI * R, p = sc / 100;
  mm('m-hud').innerHTML = `<div class="m-dial"><svg viewBox="0 0 200 200" aria-hidden="true">
    <circle class="m-track" cx="100" cy="100" r="${R}"/>
    ${SCORE_ORDER.map((_, i) => `<line class="m-grad" x1="100" y1="${100 - R - 7}" x2="100" y2="${100 - R - 11}" transform="rotate(${(360 / SCORE_ORDER.length) * i} 100 100)"/>`).join('')}
    <circle class="m-arc" cx="100" cy="100" r="${R}" style="stroke-dasharray:${C};--c:${C};stroke-dashoffset:${C * (1 - p)}"/></svg>
    <div class="m-core"><span>${sc}</span></div></div>
    <div class="m-hudtext"><span class="m-band">SYNC SCORE · ${b}</span><strong>${esc(state.name ? state.name + ', y' : 'Y')}ou’re ${esc(b.toLowerCase())}.</strong>${read.sample ? '<span class="m-sample">Sample · not measured</span>' : ''}</div>`;
  mm('m-hud').hidden = false;
  const ranked = rankAxes(s), weak = new Set(ranked.filter(x => x.value < WEAK_AT).map(x => x.axis));
  if (!weak.size) ranked.slice(0, 3).forEach(x => weak.add(x.axis));
  mm('m-rail').innerHTML = `<span class="tick"></span><span class="rt">The read</span>
    <span class="rp">${esc([read.skin_type, read.age_range, read.fitzpatrick && 'fitz ' + read.fitzpatrick].filter(Boolean).join(' · '))}</span>
    <div class="raxes">${SCORE_ORDER.filter(k => s[k] != null).map(k => `<div class="rax${weak.has(k) ? ' weak' : ''}"><span class="rn">${esc(AXIS_WORD[k])}</span><span class="rb"><i style="width:${s[k]}%"></i></span><span class="rv">${s[k]}</span></div>`).join('')}</div>
    <span class="rtop">asking · ${esc(AXIS_WORD[ranked[0].axis])} ${ranked[0].value}</span>`;
  mm('m-diag').innerHTML = `<span class="l1">${sc}. ${esc(b.toLowerCase())}</span><p>${esc(read.diagnosis || '')}</p>`;
}

/* ── wiring ── */
$('open-scan').onclick = openMirror;
mm('m-go').onclick = startRead;
mm('m-name-form').onsubmit = e => { e.preventDefault(); const v = mm('m-name-field').value.trim(); if (v && M.nameTyped) { try { M.nameRec?.abort(); } catch {} M.nameTyped(v); } };
mm('m-name-skip').onclick = () => { if (M.nameTyped) { try { M.nameRec?.abort(); } catch {} M.nameTyped(' '); } };
mm('m-notyou').onclick = () => { setName(''); hush(); askName(M.gen); };
mm('m-close').onclick = closeMirror;
mm('m-skip').onclick = () => { if (M.read) { M.gen++; clearTimers(); hush(); caption(''); overview(M.read, M.gen); } };
mm('m-replay').onclick = () => { if (M.read) { const g = ++M.gen; clearTimers(); hush(); if (voice.rec) try { voice.rec.abort(); } catch {} mm('m-labels').replaceChildren(); mm('m-lines').innerHTML = ''; mm('m-flines').innerHTML = ''; mm('m-rail').hidden = mm('m-diag').hidden = true; mm('m-after').hidden = true; tour(M.read, g); } };
mm('m-again').onclick = openMirror;
mm('m-picks').onclick = () => { closeMirror(); briefPicks(); };
$('walk-picks').onclick = () => { unlockAudio(); briefPicks(); };
addEventListener('keydown', e => { if (e.key === 'Escape' && M.on) closeMirror(); });
addEventListener('resize', () => { if (M.on && M.read && M.phase === 'overview') faceBoxes(mm('m-still')).then(b => { M.boxes = M.read.sample ? mirrorBoxes(b) : b; overview(M.read, M.gen); }); });
