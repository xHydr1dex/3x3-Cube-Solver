import './style.css';
import {
  applyMove, applyMoves, Cubies, describeMove, describeRotation, Face, FACE_COLOR, HOME_HOLD, Hold, invertMove,
  randomScramble, rotateHold, solvedCubies, SOLVED, toFacelets, validate,
} from './cube';
import { Camera, classify, RGB, rgbCss, SCAN_STEPS } from './scan';
import { Net } from './net';
import { Player } from './player';
import { solveBeginnerStages, solveShortest, Stage, Step } from './solver';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Navigation ----------
type Screen = 'home' | 'scan' | 'review' | 'solve';
const history: Screen[] = ['home'];
let current: Screen = 'home';

function show(s: Screen, push = true) {
  if (current === 'scan' && s !== 'scan') camera.stop();
  if (current === 'solve' && s !== 'solve') stopPlaying();
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === s));
  if (push && history[history.length - 1] !== s) history.push(s);
  current = s;
}
function back() {
  history.pop();
  show(history[history.length - 1] ?? 'home', false);
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

// ---------- Home ----------
$('go-scan').onclick = startScan;
$('go-manual').onclick = () => openReview(SOLVED.split('').map((c, i) => (i % 9 === 4 ? c : '?')).join(''));
$('go-random').onclick = () => openSolve(applyMoves(solvedCubies(), randomScramble()));

// ---------- Scan ----------
const camera = new Camera($<HTMLVideoElement>('video'));
let scanned: RGB[][] = [];
let liveTimer = 0;
const guide = $('guide');
for (let i = 0; i < 9; i++) guide.appendChild(Object.assign(document.createElement('div'), { innerHTML: '<i></i>' }));

async function startScan() {
  scanned = [];
  show('scan');
  renderScanStep();
  $('scan-error').textContent = '';
  try {
    await camera.start();
    clearInterval(liveTimer);
    liveTimer = window.setInterval(updateLive, 120);
  } catch {
    $('scan-error').textContent = 'Camera unavailable — allow camera access, or go back and enter colors by hand.';
  }
}

function updateLive() {
  if (current !== 'scan') return clearInterval(liveTimer);
  const s = camera.sample();
  if (!s) return;
  guide.querySelectorAll('i').forEach((dot, k) => ((dot as HTMLElement).style.background = rgbCss(s[k])));
}

function renderScanStep() {
  const k = scanned.length;
  const step = SCAN_STEPS[Math.min(k, 5)];
  $('scan-step').textContent = `Scan ${Math.min(k + 1, 6)} / 6`;
  $('scan-title').textContent = step.title;
  $('scan-hold').textContent = step.hold;
  $<HTMLButtonElement>('scan-undo').disabled = k === 0;
  $('scan-progress').innerHTML = SCAN_STEPS.map((st, i) => {
    const cells = scanned[i]
      ? scanned[i].map((c) => `<span style="background:${rgbCss(c)}"></span>`).join('')
      : Array(9).fill(`<span style="background:${i === k ? '#2a2e3a' : '#1a1d26'}"></span>`).join('');
    return `<div class="p ${i === k ? 'current' : ''}" style="border-color:${i === k ? '' : FACE_COLOR[st.face].hex + '55'}">${cells}</div>`;
  }).join('');
}

$('scan-capture').onclick = () => {
  const s = camera.sample();
  if (!s) return;
  scanned.push(s);
  navigator.vibrate?.(30);
  if (scanned.length < 6) return renderScanStep();
  // Reorder from scan order into facelet order (U R F D L B) and classify.
  const byFace = Object.fromEntries(SCAN_STEPS.map((st, i) => [st.face, scanned[i]]));
  const raw = ['U', 'R', 'F', 'D', 'L', 'B'].flatMap((f) => byFace[f]);
  openReview(classify(raw), true);
};
$('scan-undo').onclick = () => { scanned.pop(); renderScanStep(); };

// ---------- Review ----------
let net: Net;
function openReview(facelets: string, replaceScan = false) {
  net = new Net($('net'), $('palette'), facelets, () => { $('review-msg').textContent = ''; net.highlight(); });
  $('review-msg').textContent = '';
  if (replaceScan && history[history.length - 1] === 'scan') history.pop();
  show('review');
}
$('review-solve').onclick = () => {
  const v = validate(net.value);
  if (!v.ok) {
    $('review-msg').textContent = v.message!;
    net.highlight(v.bad);
    return;
  }
  openSolve(v.cubies!);
};

// ---------- Solve ----------
let player: Player | null = null;
let start: Cubies = solvedCubies();
let method: 'shortest' | 'beginner' = 'shortest';
let steps: (Step & { stage: number })[] = [];
let stages: Stage[] = [];
let states: string[] = []; // states[i] = facelets after i steps
let holds: Hold[] = []; // holds[i] = hand position after i steps
let idx = 0;
let playing = false;
let token = 0; // bumps whenever the solution changes, cancelling stale async work

// Seconds per quarter turn: slider 0 = 2.5s (very slow), 100 = 0.15s. Exponential so each notch feels even.
const speed = () => 2.5 * (0.15 / 2.5) ** (Number($<HTMLInputElement>('ctl-speed').value) / 100);
const moveCount = () => steps.filter((s) => s.kind === 'move').length;

async function openSolve(c: Cubies) {
  start = c;
  show('solve');
  player ??= new Player($('view3d'));
  await loadSolution();
}

async function loadSolution() {
  const my = ++token;
  stopPlaying();
  player!.setState(toFacelets(start), HOME_HOLD);
  $('solve-loading').classList.add('show');
  try {
    stages = method === 'shortest' ? await solveShortest(toFacelets(start)) : solveBeginnerStages(start);
  } catch (e) {
    stages = [];
    $('now-desc').textContent = `Could not solve: ${(e as Error).message}`;
  }
  if (my !== token) return;
  $('solve-loading').classList.remove('show');
  steps = stages.flatMap((st, s) => st.steps.map((step) => ({ ...step, stage: s })));
  states = [toFacelets(start)];
  holds = [HOME_HOLD];
  let cur = start;
  let hold = HOME_HOLD;
  for (const s of steps) {
    if (s.kind === 'move') cur = applyMove(cur, s.move);
    else hold = rotateHold(hold, s.rot);
    states.push(toFacelets(cur));
    holds.push(hold);
  }
  idx = 0;
  renderStrip();
  renderStep();
}

document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.method === method) return;
    method = b.dataset.method as typeof method;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    loadSolution();
  };
});

function renderStrip() {
  const strip = $('strip');
  strip.innerHTML = '';
  steps.forEach((s, i) => {
    const prev = i > 0 ? stages[steps[i - 1].stage] : null;
    const st = stages[s.stage];
    if (stages.length > 1 && (!prev || prev !== st)) {
      // New stage → its name; new pattern inside the same stage → the pattern name.
      const newGroup = !prev || prev.group !== st.group;
      strip.appendChild(Object.assign(document.createElement('span'), {
        className: 'chip-sep' + (newGroup ? ' group' : ''),
        textContent: newGroup ? st.group : st.name,
      }));
    }
    const chip = Object.assign(document.createElement('button'), {
      className: 'chip' + (s.kind === 'rotate' ? ' rot' : ''),
      textContent: s.kind === 'rotate' ? `⟳ ${s.label}` : s.label,
      title: s.kind === 'rotate' ? 'Turn the whole cube' : '',
    });
    chip.onclick = () => jumpTo(i);
    strip.appendChild(chip);
  });
}

let shownHold = '';
function renderHold(h: Hold) {
  const tip = $('hold-tip');
  const swatch = (f: Face) => `<b style="color:${FACE_COLOR[f].hex}">${FACE_COLOR[f].name}</b>`;
  const html = `Hold: ${swatch(h.U)} on top, ${swatch(h.F)} facing you`;
  if (html === shownHold) return;
  const first = shownHold === '';
  shownHold = html;
  tip.innerHTML = html;
  if (!first) { tip.classList.remove('flash'); void tip.offsetWidth; tip.classList.add('flash'); }
}

function renderStep() {
  const total = steps.length;
  const chips = $('strip').querySelectorAll<HTMLElement>('.chip');
  chips.forEach((c, i) => { c.classList.toggle('done', i < idx); c.classList.toggle('cur', i === idx); });
  const cur = chips[Math.min(idx, total - 1)];
  if (cur) {
    const strip = $('strip');
    strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2;
  }
  renderHold(holds[Math.min(idx, holds.length - 1)] ?? HOME_HOLD);

  const algo = $('algo');
  algo.hidden = true;
  $('now').classList.remove('rot');
  if (total === 0) {
    $('stage-name').textContent = 'Already solved!';
    $('step-count').textContent = '';
    $('stage-hint').textContent = '';
    $('now-move').textContent = '✓';
    $('now-desc').textContent = 'Nothing to do here.';
  } else if (idx >= total) {
    $('stage-name').textContent = 'Solved! 🎉';
    $('step-count').textContent = `${moveCount()} moves`;
    $('stage-hint').textContent = '';
    $('now-move').textContent = '✓';
    $('now-desc').textContent = 'Your cube is solved. Tap restart to watch again.';
  } else {
    const step = steps[idx];
    const st = stages[step.stage];
    const groups = [...new Set(stages.map((x) => x.group))];
    $('stage-name').textContent = groups.length > 1
      ? `${groups.indexOf(st.group) + 1}. ${st.group}${st.name ? ` · ${st.name}` : ''}`
      : st.group;
    $('step-count').textContent = `Step ${idx + 1} / ${total}`;
    $('stage-hint').textContent = st.hint;
    if (st.alg) {
      algo.hidden = false;
      $('algo-moves').textContent = st.alg;
      $('algo-does').textContent = st.algDoes ?? '';
    }
    $('now-move').textContent = step.label;
    if (step.kind === 'rotate') {
      $('now').classList.add('rot');
      $('now-desc').textContent = describeRotation(step.rot, holds[idx + 1]);
    } else {
      $('now-desc').textContent = describeMove(step.move, holds[idx]);
    }
  }
  $<HTMLButtonElement>('ctl-prev').disabled = idx === 0;
  $<HTMLButtonElement>('ctl-restart').disabled = idx === 0;
  $<HTMLButtonElement>('ctl-next').disabled = idx >= total;
  $('ctl-play').classList.toggle('playing', playing);
}

// Steps run one at a time through this chain, so rapid taps never overlap or desync.
let chain = Promise.resolve();
function enqueue(fn: () => Promise<void> | void) {
  player?.finishNow(); // tapping again skips the rest of the current animation
  chain = chain.then(fn, fn);
  return chain;
}

function animateStep(i: number, forward: boolean) {
  const s = steps[i];
  if (s.kind === 'move') return player!.turn(forward ? s.move : invertMove(s.move), speed());
  return player!.rotateTo(holds[forward ? i + 1 : i], speed() * 1.6);
}

function next() {
  const my = token;
  return enqueue(async () => {
    if (my !== token || idx >= steps.length) return;
    const i = idx++;
    renderStep();
    await animateStep(i, true);
  });
}

function prev() {
  const my = token;
  return enqueue(async () => {
    if (my !== token || idx <= 0) return;
    idx--;
    renderStep();
    await animateStep(idx, false);
  });
}

function jumpTo(i: number) {
  stopPlaying();
  const my = token;
  enqueue(() => {
    if (my !== token) return;
    idx = i;
    player!.setState(states[i], holds[i]);
    renderStep();
  });
}

async function play() {
  if (idx >= steps.length) jumpTo(0);
  playing = true;
  renderStep();
  const my = token;
  while (playing && my === token && idx < steps.length) {
    const wasRotate = steps[idx].kind === 'rotate';
    await next();
    // Pause a little longer after a hand-position change so it registers.
    await new Promise((r) => setTimeout(r, speed() * (wasRotate ? 900 : 250)));
  }
  playing = false;
  renderStep();
}

function stopPlaying() {
  playing = false;
  $('ctl-play').classList.remove('playing');
}

$('ctl-next').onclick = () => { stopPlaying(); next(); };
$('ctl-prev').onclick = () => { stopPlaying(); prev(); };
$('ctl-restart').onclick = () => jumpTo(0);
$('ctl-play').onclick = () => (playing ? stopPlaying() : play());

// ---------- Installable app ----------
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (!installed && isIOS) $('install-ios').hidden = false; // Safari has no install button: show how

// Android / desktop Chrome: offer a one-tap install button when the browser allows it.
let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
  $('install-btn').hidden = false;
});
$('install-btn').onclick = async () => {
  await installEvent?.prompt();
  installEvent = null;
  $('install-btn').hidden = true;
};
addEventListener('appinstalled', () => { $('install-btn').hidden = true; });
