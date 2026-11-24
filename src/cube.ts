// Cube model: facelets <-> cubies, moves, validation.
// Facelet string layout (Kociemba): U1..U9 R1..R9 F1..F9 D1..D9 L1..L9 B1..B9.
// Solve orientation: U = yellow, F = green, R = orange, D = white, L = red, B = blue.

export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';
export const FACES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
export const SOLVED = FACES.map((f) => f.repeat(9)).join('');

export const FACE_COLOR: Record<Face, { name: string; hex: string }> = {
  U: { name: 'yellow', hex: '#ffd500' },
  R: { name: 'orange', hex: '#ff6a00' },
  F: { name: 'green', hex: '#00a650' },
  D: { name: 'white', hex: '#f4f4f4' },
  L: { name: 'red', hex: '#d0021b' },
  B: { name: 'blue', hex: '#0051ba' },
};

export const CORNER_FACELET = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
export const CORNER_COLOR: Face[][] = [
  ['U', 'R', 'F'], ['U', 'F', 'L'], ['U', 'L', 'B'], ['U', 'B', 'R'],
  ['D', 'F', 'R'], ['D', 'L', 'F'], ['D', 'B', 'L'], ['D', 'R', 'B'],
];
export const EDGE_FACELET = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];
export const EDGE_COLOR: Face[][] = [
  ['U', 'R'], ['U', 'F'], ['U', 'L'], ['U', 'B'], ['D', 'R'], ['D', 'F'],
  ['D', 'L'], ['D', 'B'], ['F', 'R'], ['F', 'L'], ['B', 'L'], ['B', 'R'],
];

export interface Cubies { cp: number[]; co: number[]; ep: number[]; eo: number[] }

const BASIC: Record<Face, Cubies> = {
  U: { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) },
  R: { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2], ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: Array(12).fill(0) },
  F: { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0], ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
  D: { cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11], eo: Array(12).fill(0) },
  L: { cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0], ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11], eo: Array(12).fill(0) },
  B: { cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1], ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1] },
};

export function solvedCubies(): Cubies {
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: Array(8).fill(0), ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: Array(12).fill(0) };
}

export function clone(c: Cubies): Cubies {
  return { cp: c.cp.slice(), co: c.co.slice(), ep: c.ep.slice(), eo: c.eo.slice() };
}

function multiply(a: Cubies, b: Cubies): Cubies {
  const r = solvedCubies();
  for (let i = 0; i < 8; i++) {
    r.cp[i] = a.cp[b.cp[i]];
    r.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    r.ep[i] = a.ep[b.ep[i]];
    r.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
  }
  return r;
}

// ---------- Moves ----------

export interface Move { face: Face; turns: 1 | 2 | 3 } // 3 = prime

export function parseMoves(s: string): Move[] {
  return s.trim().split(/\s+/).filter(Boolean).map((tok) => {
    const face = tok[0] as Face;
    if (!FACES.includes(face)) throw new Error(`Bad move: ${tok}`);
    const suffix = tok.slice(1);
    const turns = suffix === '' ? 1 : suffix === '2' ? 2 : suffix === "'" ? 3 : 0;
    if (!turns) throw new Error(`Bad move: ${tok}`);
    return { face, turns };
  });
}

export function moveToString(m: Move): string {
  return m.face + (m.turns === 1 ? '' : m.turns === 2 ? '2' : "'");
}

export function movesToString(ms: Move[]): string {
  return ms.map(moveToString).join(' ');
}

export function invertMove(m: Move): Move {
  return { face: m.face, turns: (4 - m.turns) as 1 | 2 | 3 };
}

/** Merge adjacent same-face moves: U U -> U2, R R' -> (nothing). */
export function simplify(ms: Move[]): Move[] {
  const out: Move[] = [];
  for (const m of ms) {
    const last = out[out.length - 1];
    if (last && last.face === m.face) {
      const t = (last.turns + m.turns) % 4;
      out.pop();
      if (t) out.push({ face: m.face, turns: t as 1 | 2 | 3 });
    } else out.push({ ...m });
  }
  return out;
}

export function applyMove(c: Cubies, m: Move): Cubies {
  let r = c;
  for (let i = 0; i < m.turns; i++) r = multiply(r, BASIC[m.face]);
  return r;
}

export function applyMoves(c: Cubies, ms: Move[]): Cubies {
  return ms.reduce(applyMove, c);
}

export function isSolved(c: Cubies): boolean {
  return c.cp.every((v, i) => v === i) && c.ep.every((v, i) => v === i)
    && c.co.every((v) => v === 0) && c.eo.every((v) => v === 0);
}

// ---------- Facelets <-> cubies ----------

export function toFacelets(c: Cubies): string {
  const f: string[] = SOLVED.split('');
  for (let i = 0; i < 8; i++) {
    for (let n = 0; n < 3; n++) f[CORNER_FACELET[i][(n + c.co[i]) % 3]] = CORNER_COLOR[c.cp[i]][n];
  }
  for (let i = 0; i < 12; i++) {
    for (let n = 0; n < 2; n++) f[EDGE_FACELET[i][(n + c.eo[i]) % 2]] = EDGE_COLOR[c.ep[i]][n];
  }
  return f.join('');
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
  /** Facelet indices worth highlighting for the user. */
  bad?: number[];
  cubies?: Cubies;
}

/** Validate a facelet string. '?' marks an unknown sticker. */
export function validate(facelets: string): ValidationResult {
  const unknown = [...facelets].flatMap((ch, i) => (ch === '?' ? [i] : []));
  if (unknown.length) return { ok: false, message: `${unknown.length} sticker${unknown.length > 1 ? 's are' : ' is'} still blank.`, bad: unknown };

  const counts = Object.fromEntries(FACES.map((f) => [f, 0])) as Record<Face, number>;
  for (const ch of facelets) counts[ch as Face]++;
  const over = FACES.filter((f) => counts[f] > 9);
  const under = FACES.filter((f) => counts[f] < 9);
  if (over.length) {
    const describe = (fs: Face[]) => fs.map((f) => `${FACE_COLOR[f].name} (${counts[f]})`).join(', ');
    return {
      ok: false,
      message: `Each color needs exactly 9 stickers. Too many: ${describe(over)}. Too few: ${describe(under)}.`,
      bad: [...facelets].flatMap((ch, i) => (over.includes(ch as Face) && i % 9 !== 4 ? [i] : [])),
    };
  }

  const c = solvedCubies();
  const seenC = new Array(8).fill(false);
  for (let i = 0; i < 8; i++) {
    const fl = CORNER_FACELET[i];
    let ori = 0;
    while (ori < 3 && facelets[fl[ori]] !== 'U' && facelets[fl[ori]] !== 'D') ori++;
    const c1 = facelets[fl[(ori + 1) % 3]], c2 = facelets[fl[(ori + 2) % 3]];
    const j = ori < 3 ? CORNER_COLOR.findIndex((cc) => cc[1] === c1 && cc[2] === c2) : -1;
    if (j < 0) return { ok: false, message: 'A corner has a color combination that doesn\'t exist on a real cube. Check the highlighted stickers.', bad: fl };
    if (seenC[j]) return { ok: false, message: 'The same corner appears twice. Check the highlighted stickers.', bad: fl };
    seenC[j] = true;
    c.cp[i] = j;
    c.co[i] = ori;
  }

  const seenE = new Array(12).fill(false);
  for (let i = 0; i < 12; i++) {
    const [a, b] = EDGE_FACELET[i];
    let found = false;
    for (let j = 0; j < 12; j++) {
      if (facelets[a] === EDGE_COLOR[j][0] && facelets[b] === EDGE_COLOR[j][1]) { c.ep[i] = j; c.eo[i] = 0; found = true; }
      else if (facelets[a] === EDGE_COLOR[j][1] && facelets[b] === EDGE_COLOR[j][0]) { c.ep[i] = j; c.eo[i] = 1; found = true; }
      if (found) break;
    }
    if (!found) return { ok: false, message: 'An edge has a color combination that doesn\'t exist on a real cube. Check the highlighted stickers.', bad: [a, b] };
    if (seenE[c.ep[i]]) return { ok: false, message: 'The same edge appears twice. Check the highlighted stickers.', bad: [a, b] };
    seenE[c.ep[i]] = true;
  }

  if (c.co.reduce((s, v) => s + v, 0) % 3 !== 0) {
    return { ok: false, message: 'One corner looks twisted — usually one sticker was read wrong. Re-check the corners.' };
  }
  if (c.eo.reduce((s, v) => s + v, 0) % 2 !== 0) {
    return { ok: false, message: 'One edge looks flipped — usually one sticker was read wrong. Re-check the edges.' };
  }
  if (parity(c.cp) !== parity(c.ep)) {
    return { ok: false, message: 'Two pieces look swapped — re-check the scan (this can\'t happen on a real cube).' };
  }
  return { ok: true, cubies: c };
}

function parity(p: number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) s++;
  return s % 2;
}

export function randomScramble(n = 25): Move[] {
  const out: Move[] = [];
  while (out.length < n) {
    const face = FACES[Math.floor(Math.random() * 6)];
    if (out.length && out[out.length - 1].face === face) continue;
    out.push({ face, turns: (1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3 });
  }
  return out;
}

// ---------- Hand position (how the cube is held) ----------
// Moves are always stored in the cube's own fixed frame (yellow U, green F as scanned).
// A Hold says which of those faces is currently on top, in front, etc., so moves can be shown
// relative to the hands — the way tutorials write them.

/** hold[relative face] = the cube face currently in that position. */
export type Hold = Record<Face, Face>;
export const HOME_HOLD: Hold = { U: 'U', R: 'R', F: 'F', D: 'D', L: 'L', B: 'B' };

export type Rotation = 'x' | "x'" | 'x2' | 'y' | "y'" | 'y2' | 'z' | "z'" | 'z2';

// [new position, takes the face that was at] for one clockwise quarter rotation.
const ROT_CYCLES: Record<'x' | 'y' | 'z', [Face, Face][]> = {
  x: [['U', 'F'], ['F', 'D'], ['D', 'B'], ['B', 'U']], // like R: the front comes up
  y: [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']], // like U: the right side comes to the front
  z: [['R', 'U'], ['D', 'R'], ['L', 'D'], ['U', 'L']], // like F: the top goes to the right
};

export function rotateHold(h: Hold, r: Rotation): Hold {
  const times = r.endsWith('2') ? 2 : r.endsWith("'") ? 3 : 1;
  let cur = { ...h };
  for (let t = 0; t < times; t++) {
    const next = { ...cur };
    for (const [to, from] of ROT_CYCLES[r[0] as 'x' | 'y' | 'z']) next[to] = cur[from];
    cur = next;
  }
  return cur;
}

/** Where (relative to the hands) a cube face currently is. */
export const relFace = (h: Hold, abs: Face) => FACES.find((f) => h[f] === abs)!;

/** Notation for a move as seen from the current hand position. */
export const relLabel = (h: Hold, m: Move) => moveToString({ face: relFace(h, m.face), turns: m.turns });

/** Convert hand-relative notation ("R U R' U'") into cube-frame moves for the current hold. */
export const fromRel = (h: Hold, notation: string): Move[] =>
  parseMoves(notation).map((m) => ({ face: h[m.face], turns: m.turns }));

export function describeHold(h: Hold): string {
  return `${FACE_COLOR[h.U].name} on top, ${FACE_COLOR[h.F].name} facing you`;
}

/** Plain-English hint for a move, e.g. "Turn the right (orange) face clockwise". */
export function describeMove(m: Move, h: Hold = HOME_HOLD): string {
  const side: Record<Face, string> = { U: 'top', D: 'bottom', R: 'right', L: 'left', F: 'front', B: 'back' };
  const dir = m.turns === 2 ? 'twice (180°)' : m.turns === 1 ? 'clockwise' : 'counter-clockwise';
  return `Turn the ${side[relFace(h, m.face)]} (${FACE_COLOR[m.face].name}) face ${dir}`;
}

export function describeRotation(r: Rotation, after: Hold): string {
  const how: Record<Rotation, string> = {
    y: 'Turn the whole cube to the left', "y'": 'Turn the whole cube to the right', y2: 'Turn the whole cube around',
    x: 'Tip the whole cube away from you', "x'": 'Tip the whole cube towards you', x2: 'Flip the whole cube over front-to-back',
    z: 'Tilt the whole cube to the right', "z'": 'Tilt the whole cube to the left', z2: 'Turn the cube upside down',
  };
  return `${how[r]} — now ${describeHold(after)}`;
}
