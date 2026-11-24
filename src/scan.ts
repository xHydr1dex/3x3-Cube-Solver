// Camera scanning + color classification.
import { CORNER_COLOR, CORNER_FACELET, EDGE_COLOR, EDGE_FACELET, Face, FACES, validate } from './cube';

export type RGB = [number, number, number];

/** Order the user scans faces in, with how to hold the cube for each. */
export const SCAN_STEPS: { face: Face; title: string; hold: string }[] = [
  { face: 'F', title: 'Green face', hold: 'Green center facing you, yellow on top.' },
  { face: 'R', title: 'Orange face', hold: 'Turn the cube left: orange center facing you, yellow still on top.' },
  { face: 'B', title: 'Blue face', hold: 'Turn left again: blue center facing you, yellow on top.' },
  { face: 'L', title: 'Red face', hold: 'Turn left again: red center facing you, yellow on top.' },
  { face: 'U', title: 'Yellow face', hold: 'Tilt so yellow faces you, with green at the bottom.' },
  { face: 'D', title: 'White face', hold: 'Flip so white faces you, with green at the top.' },
];

/** Fraction of the (square) viewport the 3x3 guide grid covers. Shared with the CSS overlay. */
export const GRID_FRACTION = 0.72;

export class Camera {
  private stream: MediaStream | null = null;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

  constructor(private video: HTMLVideoElement) {
    this.canvas.width = this.canvas.height = 90;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Median color of the middle of each of the 9 grid cells, in reading order. */
  sample(): RGB[] | null {
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!w || !h) return null;
    const side = Math.min(w, h) * GRID_FRACTION;
    this.ctx.drawImage(this.video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 90, 90);
    const data = this.ctx.getImageData(0, 0, 90, 90).data;
    const out: RGB[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const ch: number[][] = [[], [], []];
        for (let y = r * 30 + 8; y < r * 30 + 22; y++) {
          for (let x = c * 30 + 8; x < c * 30 + 22; x++) {
            const i = (y * 90 + x) * 4;
            ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
          }
        }
        out.push(ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]) as RGB);
      }
    }
    return out;
  }
}

// ---------- Classification ----------

/**
 * Brightness-independent color features: the share of red/green/blue (chromaticity),
 * plus a small brightness term so white and grey-ish stickers still separate.
 * Shadows scale all three channels together, so they barely move these numbers.
 */
function features([r, g, b]: RGB): RGB {
  const s = r + g + b + 1;
  return [r / s, g / s, (s / 765) * 0.12];
}

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every color gets exactly 9 stickers; closest matches are assigned first. */
function assign(feat: RGB[], refs: RGB[]): number[] {
  const result = new Array(54).fill(-1);
  const used = new Array(6).fill(1);
  for (let k = 0; k < 6; k++) result[k * 9 + 4] = k; // centers are fixed
  const pairs: [number, number, number][] = [];
  feat.forEach((c, i) => { if (i % 9 !== 4) refs.forEach((ref, k) => pairs.push([dist(c, ref), i, k])); });
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, k] of pairs) {
    if (result[i] >= 0 || used[k] >= 9) continue;
    result[i] = k;
    used[k]++;
  }
  return result;
}

/**
 * Turn 54 raw colors (facelet order) into a facelet string.
 * Start from the 6 centers as reference colors, then refine each reference to the
 * average of the stickers assigned to it (handles a center that sits in shadow).
 */
/**
 * Turn 54 raw colors (facelet order) into a facelet string.
 * 1. Reference colors start at the 6 centers and are refined to the average of their stickers.
 * 2. Then, instead of judging stickers one by one, pick which real piece sits in each slot:
 *    every corner and edge must be used exactly once, which resolves red/orange and
 *    white/yellow mix-ups using the whole cube instead of a single sticker.
 */
export function classify(raw: RGB[]): string {
  const feat = raw.map(features);
  let refs = FACES.map((_, k) => feat[k * 9 + 4]);
  let result = assign(feat, refs);
  for (let iter = 0; iter < 3; iter++) {
    refs = averageRefs(feat, result);
    result = assign(feat, refs);
  }
  let facelets = '';
  for (let iter = 0; iter < 3; iter++) {
    facelets = matchPieces(feat, refs);
    refs = averageRefs(feat, [...facelets].map((f) => FACES.indexOf(f as Face)));
  }
  return facelets;
}

function averageRefs(feat: RGB[], result: number[]): RGB[] {
  return FACES.map((_, k) => {
    const members = feat.filter((_, i) => result[i] === k);
    return [0, 1, 2].map((d) => members.reduce((s, m) => s + m[d], 0) / members.length) as RGB;
  });
}

const sq = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

interface PieceSet {
  slots: number[][]; colors: Face[][]; w: number;
  cost: number[][][]; // cost[slot][piece][orientation]
  match: number[]; ori: number[];
}

function matchPieces(feat: RGB[], refs: RGB[]): string {
  const build = (slots: number[][], colors: Face[][]): PieceSet => {
    const w = slots[0].length;
    const cost = slots.map((fl) => colors.map((cols) => Array.from({ length: w }, (_, o) => {
      let c = 0;
      for (let t = 0; t < w; t++) c += sq(feat[fl[(t + o) % w]], refs[FACES.indexOf(cols[t])]);
      return c;
    })));
    const bestOf = (p: number, j: number) => Math.min(...cost[p][j]);
    const match = hungarian(cost.map((row, p) => row.map((_, j) => bestOf(p, j))));
    const ori = match.map((j, p) => cost[p][j].indexOf(bestOf(p, j)));
    return { slots, colors, w, cost, match, ori };
  };
  const sets = [build(CORNER_FACELET, CORNER_COLOR), build(EDGE_FACELET, EDGE_COLOR)];

  const render = (s: { match: number[]; ori: number[] }[]) => {
    const out = FACES.map((f) => f.repeat(9)).join('').split('');
    sets.forEach((set, k) => set.slots.forEach((fl, p) => {
      for (let t = 0; t < set.w; t++) out[fl[(t + s[k].ori[p]) % set.w]] = set.colors[s[k].match[p]][t];
    }));
    return out.join('');
  };
  const base = sets.map((s) => ({ match: s.match, ori: s.ori }));
  const first = render(base);
  if (validate(first).ok) return first;

  // The reading breaks a cube rule (a twisted corner, flipped edge, or two swapped pieces):
  // try the cheapest re-twists, flips and swaps, alone or in pairs, until the cube is valid.
  type Fix = { k: number; delta: number; apply: (m: number[], o: number[]) => void };
  const fixes: Fix[] = [];
  sets.forEach((s, k) => {
    const n = s.slots.length;
    const cur = (p: number) => s.cost[p][s.match[p]][s.ori[p]];
    for (let p = 0; p < n; p++) {
      for (let o = 0; o < s.w; o++) {
        if (o === s.ori[p]) continue;
        fixes.push({ k, delta: s.cost[p][s.match[p]][o] - cur(p), apply: (_m, ori) => { ori[p] = o; } });
      }
      for (let q = p + 1; q < n; q++) {
        const op = s.cost[p][s.match[q]], oq = s.cost[q][s.match[p]];
        const bp = op.indexOf(Math.min(...op)), bq = oq.indexOf(Math.min(...oq));
        fixes.push({
          k, delta: op[bp] + oq[bq] - cur(p) - cur(q),
          apply: (m, ori) => { [m[p], m[q]] = [m[q], m[p]]; ori[p] = bp; ori[q] = bq; },
        });
      }
    }
  });
  fixes.sort((a, b) => a.delta - b.delta);
  const combos: { list: Fix[]; delta: number }[] = fixes.map((f) => ({ list: [f], delta: f.delta }));
  const top = fixes.slice(0, 80);
  for (let a = 0; a < top.length; a++) {
    for (let b = a + 1; b < top.length; b++) combos.push({ list: [top[a], top[b]], delta: top[a].delta + top[b].delta });
  }
  combos.sort((a, b) => a.delta - b.delta);
  for (const { list } of combos) {
    const s = base.map((b) => ({ match: b.match.slice(), ori: b.ori.slice() }));
    for (const f of list) f.apply(s[f.k].match, s[f.k].ori);
    const f = render(s);
    if (validate(f).ok) return f;
  }
  return first; // couldn't fix automatically: the review screen will point at the problem
}

/** Minimum-cost assignment (Hungarian algorithm). Returns match[row] = column. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const match = new Array(n);
  for (let j = 1; j <= n; j++) match[p[j] - 1] = j - 1;
  return match;
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;
