import { describe, expect, it } from 'vitest';
import Cube from 'cubejs';
import {
  applyMoves, fromRel, HOME_HOLD, isSolved, Move, movesToString, parseMoves, randomScramble, rotateHold, Rotation, simplify, solvedCubies, SOLVED, toFacelets, validate,
} from '../src/cube';
import { solveBeginner, Stage } from '../src/beginner';

const movesOf = (stages: Stage[]): Move[] => stages.flatMap((s) => s.steps.flatMap((st) => (st.kind === 'move' ? [st.move] : [])));

describe('cube model', () => {
  it('matches cubejs facelets for random move sequences', () => {
    for (let i = 0; i < 200; i++) {
      const scr = randomScramble(20);
      const mine = toFacelets(applyMoves(solvedCubies(), scr));
      const ref = new Cube().move(movesToString(scr)).asString();
      expect(mine).toBe(ref);
    }
  });

  it('round-trips facelets through validate', () => {
    for (let i = 0; i < 100; i++) {
      const f = toFacelets(applyMoves(solvedCubies(), randomScramble()));
      const v = validate(f);
      expect(v.ok).toBe(true);
      expect(toFacelets(v.cubies!)).toBe(f);
    }
  });

  it('rejects bad cubes with a reason', () => {
    expect(validate(SOLVED.replace('UUUU', 'UUU?')).message).toMatch(/blank/);
    expect(validate('R' + SOLVED.slice(1)).message).toMatch(/exactly 9/);
    // twist one corner: URF facelets 8,9,20 rotated
    const f = SOLVED.split('');
    [f[8], f[9], f[20]] = [f[20], f[8], f[9]];
    expect(validate(f.join('')).message).toMatch(/twisted/);
    // flip one edge: UF facelets 7,19
    const g = SOLVED.split('');
    [g[7], g[19]] = [g[19], g[7]];
    expect(validate(g.join('')).message).toMatch(/flipped/);
    // swap two edges UR <-> UF (same orientation) -> parity
    const h = SOLVED.split('');
    [h[10], h[19]] = [h[19], h[10]];
    expect(validate(h.join('')).message).toMatch(/swapped/);
  });

  it('simplifies redundant moves', () => {
    expect(movesToString(simplify(parseMoves("U U R R' F F F")))).toBe("U2 F'");
  });
});

describe('beginner solver', () => {
  it('solves 500 random scrambles', () => {
    const t0 = performance.now();
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const start = applyMoves(solvedCubies(), randomScramble());
      const stages = solveBeginner(start);
      const all = movesOf(stages);
      total += all.length;
      expect(isSolved(applyMoves(start, all))).toBe(true);
    }
    const ms = (performance.now() - t0) / 500;
    console.log(`beginner: avg ${(total / 500).toFixed(0)} moves, ${ms.toFixed(1)} ms/solve`);
  });

  it('follows the taught order: daisy → cross → corners → middle → yellow patterns', () => {
    const ORDER = ['Daisy', 'White cross', 'White corners', 'Middle layer', 'Yellow cross', 'Yellow face', 'Yellow corners', 'Yellow edges'];
    for (let i = 0; i < 200; i++) {
      const stages = solveBeginner(applyMoves(solvedCubies(), randomScramble()));
      const idx = stages.map((s) => ORDER.indexOf(s.group));
      expect(idx.every((v) => v >= 0)).toBe(true);
      expect(idx).toEqual([...idx].sort((a, b) => a - b)); // never goes backwards
      expect(stages.every((s) => s.hint.length > 0 && s.steps.length > 0)).toBe(true);
    }
  });

  it('returns no stages for a solved cube', () => {
    expect(solveBeginner(solvedCubies())).toEqual([]);
  });

  it('notation shown to the hands replays to exactly the solving moves', () => {
    for (let i = 0; i < 200; i++) {
      const stages = solveBeginner(applyMoves(solvedCubies(), randomScramble()));
      let hold = HOME_HOLD;
      const replay: Move[] = [];
      for (const st of stages.flatMap((s) => s.steps)) {
        if (st.kind === 'rotate') hold = rotateHold(hold, st.rot);
        else replay.push(...fromRel(hold, st.label));
      }
      expect(replay).toEqual(movesOf(stages));
    }
  });

  it('white is on top for the white corners, yellow on top from the middle layer on', () => {
    for (let i = 0; i < 100; i++) {
      const stages = solveBeginner(applyMoves(solvedCubies(), randomScramble()));
      let hold = HOME_HOLD;
      for (const s of stages) {
        for (const st of s.steps) {
          if (st.kind === 'rotate') { hold = rotateHold(hold, st.rot); continue; }
          const expectTop = s.group === 'White corners' ? 'D' : 'U';
          expect(hold.U).toBe(expectTop);
        }
      }
    }
  });
});

describe('hand position', () => {
  it('whole-cube rotations match cubejs (which face ends up where)', () => {
    const rots: Rotation[] = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
    for (let n = 0; n < 50; n++) {
      const seq = Array.from({ length: 4 }, () => rots[Math.floor(Math.random() * rots.length)]);
      const ref = new Cube().move(seq.join(' ')).asString();
      const hold = seq.reduce(rotateHold, HOME_HOLD);
      // The center sticker at each position tells which original face is there now.
      (['U', 'R', 'F', 'D', 'L', 'B'] as const).forEach((pos, k) => expect(hold[pos]).toBe(ref[k * 9 + 4]));
    }
  });
});

describe('shortest solver (cubejs)', () => {
  it('solutions verify on our model', () => {
    Cube.initSolver();
    for (let i = 0; i < 20; i++) {
      const start = applyMoves(solvedCubies(), randomScramble());
      const sol = parseMoves(Cube.fromString(toFacelets(start)).solve());
      expect(isSolved(applyMoves(start, sol))).toBe(true);
    }
  }, 60000);
});
