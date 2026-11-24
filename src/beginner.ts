// Beginner method, the way it's usually taught, including when to turn the whole cube:
//   (yellow up)  Daisy → White cross
//   (turn over, white up)  White corners with R' D' R D
//   (turn over, yellow up)  Middle layer → Yellow cross → Yellow face → Yellow corners → Yellow edges
// Notation is relative to the current hand position, so algorithms always look like the textbook.

import {
  applyMove, applyMoves, clone, CORNER_COLOR, CORNER_FACELET, Cubies, EDGE_COLOR, FACE_COLOR, FACES, Face, fromRel,
  HOME_HOLD, Hold, isSolved, Move, relLabel, rotateHold, Rotation, simplify, solvedCubies, toFacelets,
} from './cube';

export type Step =
  | { kind: 'move'; move: Move; label: string } // move = cube-frame move, label = notation for the hands
  | { kind: 'rotate'; rot: Rotation; label: string };

export interface Stage {
  group: string; name: string; hint: string;
  alg?: string; algDoes?: string; // the algorithm used in this step and what it does
  steps: Step[];
}

const ALL_MOVES: Move[] = FACES.flatMap((face) => [1, 2, 3].map((turns) => ({ face, turns } as Move)));
const RING: Face[] = ['F', 'R', 'B', 'L'];
const color = (f: Face) => FACE_COLOR[f].name;
const same = (a: Face[], b: Face[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Cube-frame position of the corner / edge that sits at the given hand-relative spot. */
const cornerAt = (h: Hold, rel: Face[]) => CORNER_COLOR.findIndex((fs) => same(fs, rel.map((r) => h[r])));
const edgeAt = (h: Hold, rel: Face[]) => EDGE_COLOR.findIndex((fs) => same(fs, rel.map((r) => h[r])));

// ---------- Goal checks (cube frame: U = yellow, D = white) ----------
const cornerOk = (c: Cubies, i: number) => c.cp[i] === i && c.co[i] === 0;
const edgeOk = (c: Cubies, i: number) => c.ep[i] === i && c.eo[i] === 0;
const WHITE_EDGES = [4, 5, 6, 7];
const crossDone = (c: Cubies) => WHITE_EDGES.every((i) => edgeOk(c, i));
const firstLayerDone = (c: Cubies) => crossDone(c) && [4, 5, 6, 7].every((i) => cornerOk(c, i));
const secondLayerDone = (c: Cubies) => firstLayerDone(c) && [8, 9, 10, 11].every((i) => edgeOk(c, i));
const yellowCrossDone = (c: Cubies) => secondLayerDone(c) && [0, 1, 2, 3].every((i) => c.eo[i] === 0);
const yellowFaceDone = (c: Cubies) => yellowCrossDone(c) && [0, 1, 2, 3].every((i) => c.co[i] === 0);

// ---------- 1. Daisy (white edges around the yellow center), solved optimally ----------
let daisyTable: Int8Array | null = null;
let slotMove: number[][] | null = null; // [move][edge slot] → edge slot, slot = position*2 + orientation
const encode = (s: number[]) => ((s[0] * 24 + s[1]) * 24 + s[2]) * 24 + s[3];

function buildDaisyTable() {
  slotMove = ALL_MOVES.map((m) => {
    const M = applyMove(solvedCubies(), m);
    const t: number[] = [];
    for (let p = 0; p < 12; p++) {
      const q = M.ep.indexOf(p);
      for (let o = 0; o < 2; o++) t[p * 2 + o] = q * 2 + ((o + M.eo[q]) % 2);
    }
    return t;
  });
  const table = new Int8Array(24 ** 4).fill(-1);
  let frontier: number[][] = [];
  const perms = (a: number[]): number[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  for (const p of perms([0, 1, 2, 3])) { // goal: white edges anywhere in the top layer, white facing up
    const s = p.map((pos) => pos * 2);
    table[encode(s)] = 0;
    frontier.push(s);
  }
  for (let d = 0; frontier.length; d++) {
    const next: number[][] = [];
    for (const s of frontier) {
      for (const mt of slotMove) {
        const n = s.map((x) => mt[x]);
        const k = encode(n);
        if (table[k] < 0) { table[k] = d + 1; next.push(n); }
      }
    }
    frontier = next;
  }
  daisyTable = table;
}

function solveDaisy(c: Cubies): Move[] {
  if (!daisyTable) buildDaisyTable();
  let s = WHITE_EDGES.map((p) => { const q = c.ep.indexOf(p); return q * 2 + c.eo[q]; });
  const out: Move[] = [];
  while (daisyTable![encode(s)] > 0) {
    const d = daisyTable![encode(s)];
    const i = slotMove!.findIndex((mt) => daisyTable![encode(s.map((x) => mt[x]))] === d - 1);
    out.push(ALL_MOVES[i]);
    s = s.map((x) => slotMove![i][x]);
  }
  return out;
}

// ---------- Building stages ----------

/** Collects one stage's moves and whole-cube turns while tracking the cube and the hand position. */
class Builder {
  items: (Move | Rotation)[] = [];
  constructor(public c: Cubies, public hold: Hold) {}
  /** Cube-frame moves. */
  abs(ms: Move[]) { for (const m of ms) { this.items.push(m); this.c = applyMove(this.c, m); } }
  /** Moves written relative to the hands, e.g. "R' D' R D". */
  rel(notation: string) { this.abs(fromRel(this.hold, notation)); }
  /** Turn the whole cube. */
  rot(r: Rotation) { this.items.push(r); this.hold = rotateHold(this.hold, r); }
  /** Turn the whole cube (around the vertical axis) the least amount so `ok(hold)` holds. */
  rotUntil(ok: (h: Hold) => boolean) {
    const opts: (Rotation | null)[] = [null, 'y', "y'", 'y2'];
    const r = opts.find((o) => ok(o ? rotateHold(this.hold, o) : this.hold));
    if (r === undefined) throw new Error('Beginner solver: no hand position fits');
    if (r) this.rot(r);
  }
  /** Turn a layer (hand-relative face) the least amount so `ok(cube)` holds. */
  turnUntil(face: Face, ok: (c: Cubies) => boolean) {
    for (let k = 0; k < 4; k++) {
      const ms = k ? fromRel(this.hold, face + (k === 2 ? '2' : k === 3 ? "'" : '')) : [];
      if (ok(applyMoves(this.c, ms))) return this.abs(ms);
    }
    throw new Error('Beginner solver: no turn fits');
  }
}

function finalizeSteps(items: (Move | Rotation)[], hold: Hold): Step[] {
  const steps: Step[] = [];
  let run: Move[] = [];
  const flush = () => {
    for (const m of simplify(run)) steps.push({ kind: 'move', move: m, label: relLabel(hold, m) });
    run = [];
  };
  for (const it of items) {
    if (typeof it === 'string') { flush(); steps.push({ kind: 'rotate', rot: it, label: it }); hold = rotateHold(hold, it); }
    else run.push(it);
  }
  flush();
  return steps;
}

// ---------- Algorithms ----------
const ALG = {
  cornerDrop: { alg: "R' D' R D", does: 'Lifts the corner from the bottom-front-right into the top-front-right spot. Repeat it until white faces up (2, 4 or 6 times).' },
  right: { alg: "U R U' R' U' F' U F", does: 'Moves the top-front edge down into the front-right slot without breaking the white layer.' },
  left: { alg: "U' L' U L U F U' F'", does: 'Moves the top-front edge down into the front-left slot without breaking the white layer.' },
  cross: { alg: "F R U R' U' F'", does: 'Flips top edges so more yellow shows: dot → L → line → cross.' },
  sune: { alg: "R U R' U R U2 R'", does: "Twists the top corners (it's called the Sune). Repeat with the patterns until the top is all yellow." },
  corners: { alg: "R' F R' B2 R F' R' B2 R2", does: 'Moves three top corners around while the two at the back (headlights) stay put.' },
  edges: { alg: "F2 U L R' F2 L' R U F2", does: 'Moves three top edges around while the back side stays solved.' },
};

// ---------- Solver ----------
export function solveBeginner(start: Cubies): Stage[] {
  let c = clone(start);
  let hold: Hold = { ...HOME_HOLD };
  const stages: Stage[] = [];
  const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`Beginner solver: ${what} failed`); };

  const stage = (meta: Omit<Stage, 'steps'>, build: (b: Builder) => void) => {
    const b = new Builder(c, hold);
    build(b);
    const steps = finalizeSteps(b.items, hold);
    c = b.c;
    hold = b.hold;
    if (steps.length) stages.push({ ...meta, steps });
  };

  // 1-2. Daisy, then each petal down → white cross on the bottom. (Hold: yellow up, green front.)
  if (!crossDone(c)) {
    stage({ group: 'Daisy', name: '', hint: 'Bring the 4 white edges up around the yellow center, white facing up — like flower petals.',
      alg: '(no fixed algorithm)', algDoes: 'Just get each white edge to the top with white facing up. Follow the moves.' },
    (b) => b.abs(solveDaisy(b.c)));

    for (const piece of [5, 4, 7, 6]) { // DF, DR, DB, DL
      const side = EDGE_COLOR[piece][1]; // the petal's non-white color = the face it belongs to
      const above = EDGE_COLOR.findIndex((fs) => same(fs, ['U', side]));
      stage({ group: 'White cross', name: `${color(side)} petal`,
        hint: `Turn the top until the white-${color(side)} petal is above the ${color(side)} center, then turn the ${color(side)} face twice.`,
        alg: `U (until it matches), then ${side}2`, algDoes: 'Turning that face twice brings the petal down so white ends up on the bottom.' },
      (b) => {
        b.turnUntil('U', (s) => s.ep[above] === piece);
        b.rel(`${side}2`);
      });
    }
    check(crossDone(c), 'white cross');
  }

  // 3. White corners with white on top: turn over, then R' D' R D at the front-right.
  if (!firstLayerDone(c)) {
    stage({ group: 'White corners', name: 'Turn over', hint: 'Turn the cube upside down so the white cross is on top.',
      alg: 'z2', algDoes: 'Turns the whole cube over, keeping the same side facing you.' },
    (b) => b.rot('z2'));

    for (const target of [4, 7, 6, 5]) { // white corners: DFR, DRB, DBL, DLF (cube frame)
      if (cornerOk(c, target)) continue;
      const [, a, d] = CORNER_COLOR[target];
      const name = `White-${color(a)}-${color(d)} corner`;
      const where = c.cp.indexOf(target);
      if (where >= 4) { // in the white layer but in the wrong spot or twisted: drop it to the bottom first
        stage({ group: 'White corners', name: `${name}: take it out`,
          hint: 'This corner is on top but in the wrong spot (or twisted). Hold it at the top-front-right and do R\' D\' R D once to drop it to the bottom.',
          alg: ALG.cornerDrop.alg, algDoes: 'Done once, it pulls the top-front-right corner down to the bottom layer.' },
        (b) => {
          b.rotUntil((h) => cornerAt(h, ['U', 'F', 'R']) === where);
          b.rel("R' D' R D");
        });
      }
      stage({ group: 'White corners', name,
        hint: `Turn the whole cube so this corner's spot (between ${color(a)} and ${color(d)}) is at the top-front-right. Turn the bottom until the corner is right under it, then repeat R' D' R D until it's in.`,
        alg: ALG.cornerDrop.alg, algDoes: ALG.cornerDrop.does },
      (b) => {
        b.rotUntil((h) => cornerAt(h, ['U', 'F', 'R']) === target);
        const below = cornerAt(b.hold, ['D', 'F', 'R']);
        b.turnUntil('D', (s) => s.cp[below] === target);
        for (let reps = 0; !cornerOk(b.c, target); reps++) {
          check(reps < 6, 'white corner');
          b.rel("R' D' R D");
        }
      });
    }
    check(firstLayerDone(c), 'first layer');
  }

  // 4. Middle layer, with yellow back on top.
  if (hold.U !== 'U') {
    stage({ group: 'Middle layer', name: 'Turn over', hint: 'The white layer is done! Turn the cube upside down so white is on the bottom and yellow is on top.',
      alg: 'z2', algDoes: 'Turns the whole cube over, keeping the same side facing you.' },
    (b) => b.rot('z2'));
  }
  for (let it = 0; !secondLayerDone(c); it++) {
    check(it < 12, 'middle layer');
    const onTop = [8, 9, 10, 11].filter((p) => c.ep.indexOf(p) < 4);
    if (onTop.length) {
      const piece = onTop[0];
      const q = c.ep.indexOf(piece);
      const upColor = EDGE_COLOR[piece][c.eo[q]];
      const side = EDGE_COLOR[piece][1 - c.eo[q]];
      const above = EDGE_COLOR.findIndex((fs) => same(fs, ['U', side]));
      const right = (h: Hold) => upColor === h.R;
      stage({ group: 'Middle layer', name: `${color(side)}-${color(upColor)} edge`,
        hint: `Turn the top until the edge's ${color(side)} side is above the ${color(side)} center. Turn the whole cube so ${color(side)} faces you, then send the edge to the ${'{dir}'}.`,
        alg: '', algDoes: '' },
      (b) => {
        b.turnUntil('U', (s) => s.ep[above] === piece);
        b.rotUntil((h) => h.F === side);
        b.rel(right(b.hold) ? ALG.right.alg : ALG.left.alg);
      });
      // Fill in which way it went (known only after the hand position is chosen).
      const st = stages[stages.length - 1];
      const dir = right(hold) ? 'right' : 'left';
      st.hint = st.hint.replace('{dir}', dir);
      st.alg = ALG[dir].alg;
      st.algDoes = ALG[dir].does;
    } else {
      const piece = [8, 9, 10, 11].find((p) => !edgeOk(c, p))!;
      const slot = c.ep.indexOf(piece);
      stage({ group: 'Middle layer', name: 'Take an edge out',
        hint: 'An edge is stuck in the wrong middle slot. Hold that slot at the front-right and do the right-hand algorithm once to pop it out.',
        alg: ALG.right.alg, algDoes: 'Done here, it swaps the stuck edge out to the top so it can be put back properly.' },
      (b) => {
        b.rotUntil((h) => edgeAt(h, ['F', 'R']) === slot);
        b.rel(ALG.right.alg);
      });
    }
  }

  // 5. Yellow cross by pattern: dot → L → line → cross.
  const upEdge = (s: Cubies, h: Hold, rel: Face) => s.eo[edgeAt(h, ['U', rel])] === 0;
  for (let it = 0; !yellowCrossDone(c); it++) {
    check(it < 4, 'yellow cross');
    const n = [0, 1, 2, 3].filter((i) => c.eo[i] === 0).length;
    const line = (c.eo[0] === 0 && c.eo[2] === 0) || (c.eo[1] === 0 && c.eo[3] === 0);
    const [name, hint, ok] = n === 0
      ? ['Yellow dot', "Only the yellow center is up. Do F R U R' U' F' to get an L or a line.", () => true]
      : line
        ? ['Line', "A yellow line: turn the top so it runs left-right, then do F R U R' U' F'.", (s: Cubies) => upEdge(s, hold, 'L') && upEdge(s, hold, 'R')]
        : ['L shape', "A yellow L: turn the top so it points to the back and left, then do F R U R' U' F'.", (s: Cubies) => upEdge(s, hold, 'L') && upEdge(s, hold, 'B')];
    stage({ group: 'Yellow cross', name: name as string, hint: hint as string, alg: ALG.cross.alg, algDoes: ALG.cross.does }, (b) => {
      b.turnUntil('U', ok as (s: Cubies) => boolean);
      b.rel(ALG.cross.alg);
    });
  }

  // 6. Yellow face by pattern, with the Sune. The front-left corner decides where to hold it.
  const frontLeftYellow = (s: Cubies, h: Hold, facing: Face) => {
    const pos = cornerAt(h, ['U', 'F', 'L']);
    const sticker = CORNER_FACELET[pos][CORNER_COLOR[pos].indexOf(h[facing])];
    return toFacelets(s)[sticker] === 'U';
  };
  for (let it = 0; !yellowFaceDone(c); it++) {
    check(it < 6, 'yellow face');
    const n = [0, 1, 2, 3].filter((i) => c.co[i] === 0).length;
    const [name, hint, facing]: [string, string, Face] = n === 1
      ? ['Fish', "One yellow corner up (a fish): turn the top so that corner is at the front-left, then R U R' U R U2 R'.", 'U']
      : n === 0
        ? ['No corners up', "No yellow corners up: turn the top so the front-left corner's yellow faces left, then R U R' U R U2 R'.", 'L']
        : ['Two corners up', "Two yellow corners up: turn the top so the front-left corner's yellow faces you, then R U R' U R U2 R'.", 'F'];
    stage({ group: 'Yellow face', name, hint, alg: ALG.sune.alg, algDoes: ALG.sune.does }, (b) => {
      b.turnUntil('U', (s) => frontLeftYellow(s, b.hold, facing));
      b.rel(ALG.sune.alg);
    });
  }

  // 7. Yellow corners: headlights to the back.
  const sideRow = (s: Cubies, abs: Face) => { const f = toFacelets(s), k = FACES.indexOf(abs) * 9; return [f[k], f[k + 1], f[k + 2], f[k + 4]]; };
  const headlightsAt = (s: Cubies, abs: Face) => { const r = sideRow(s, abs); return r[0] === r[2]; };
  const cornersRelative = (s: Cubies) => RING.every((side) => headlightsAt(s, side));
  for (let it = 0; !cornersRelative(c); it++) {
    check(it < 5, 'yellow corners');
    if (!RING.some((side) => headlightsAt(c, side))) {
      stage({ group: 'Yellow corners', name: 'No headlights', hint: "No side has two matching corners yet. Do the algorithm once to make some.",
        alg: ALG.corners.alg, algDoes: ALG.corners.does }, (b) => b.rel(ALG.corners.alg));
    } else {
      stage({ group: 'Yellow corners', name: 'Headlights', hint: "Two corners on one side match (headlights). Turn the top so they're at the back, then do the algorithm.",
        alg: ALG.corners.alg, algDoes: ALG.corners.does }, (b) => {
        b.turnUntil('U', (s) => headlightsAt(s, b.hold.B));
        b.rel(ALG.corners.alg);
      });
    }
  }

  // 8. Yellow edges: line the corners up with their centers, then solved side to the back.
  stage({ group: 'Yellow edges', name: 'Line up corners', hint: 'Turn the top so every corner matches the centers below it.' }, (b) => {
    b.turnUntil('U', (s) => [0, 1, 2, 3].every((i) => s.cp[i] === i));
  });
  const sideDone = (s: Cubies, abs: Face) => { const r = sideRow(s, abs); return r.every((x) => x === r[3]); };
  for (let it = 0; !isSolved(c); it++) {
    check(it < 5, 'yellow edges');
    const solvedSide = RING.find((side) => sideDone(c, side));
    if (solvedSide) {
      stage({ group: 'Yellow edges', name: 'One side done',
        hint: "One side of the top is complete. Turn the whole cube so that side is at the back, then do the algorithm (repeat if needed).",
        alg: ALG.edges.alg, algDoes: ALG.edges.does }, (b) => {
        b.rotUntil((h) => h.B === solvedSide);
        b.rel(ALG.edges.alg);
      });
    } else {
      stage({ group: 'Yellow edges', name: 'No side done', hint: 'No side of the top is complete yet. Do the algorithm once from any side.',
        alg: ALG.edges.alg, algDoes: ALG.edges.does }, (b) => b.rel(ALG.edges.alg));
    }
  }

  check(isSolved(c), 'final');
  return stages;
}
