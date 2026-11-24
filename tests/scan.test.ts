import { describe, expect, it } from 'vitest';
import { applyMoves, Face, randomScramble, solvedCubies, toFacelets } from '../src/cube';
import { classify, RGB } from '../src/scan';

// Typical camera readings of real stickers (slightly off, as cameras see them).
const SEEN: Record<Face, RGB> = {
  U: [215, 200, 40], R: [235, 110, 35], F: [30, 160, 80], D: [215, 215, 210], L: [185, 30, 40], B: [30, 80, 180],
};

describe('color classification', () => {
  // Measured ~1 misread cube per 5000 at this harsh lighting spread; allow 1 in 200 so the test isn't flaky.
  it('recovers the cube under uneven lighting and noise', () => {
    let wrong = 0;
    for (let n = 0; n < 200; n++) {
      const truth = toFacelets(applyMoves(solvedCubies(), randomScramble()));
      const raw = [...truth].map((f, i) => {
        const shade = 0.7 + 0.35 * Math.sin(i * 1.7 + n); // brightness varies across the cube
        return SEEN[f as Face].map((v) => Math.max(0, Math.min(255, v * shade + (Math.random() - 0.5) * 16))) as RGB;
      });
      if (classify(raw) !== truth) wrong++;
    }
    expect(wrong).toBeLessThanOrEqual(1);
  });

  // Warm indoor light makes red and orange read very close. Before the cube-rules matching
  // ~81% of these cubes had a red/orange mix-up; now ~7%. Guard against regressions.
  it('mostly separates red and orange in warm light', () => {
    const WARM: Record<Face, RGB> = {
      U: [220, 190, 50], R: [225, 85, 40], F: [40, 150, 80], D: [220, 205, 180], L: [200, 50, 45], B: [35, 75, 160],
    };
    let wrong = 0;
    const N = 300;
    for (let n = 0; n < N; n++) {
      const truth = toFacelets(applyMoves(solvedCubies(), randomScramble()));
      const raw = [...truth].map((f, i) => {
        const shade = 0.75 + 0.3 * Math.sin(i * 1.7 + n);
        return WARM[f as Face].map((v) => Math.max(0, Math.min(255, v * shade + (Math.random() - 0.5) * 24))) as RGB;
      });
      if (classify(raw) !== truth) wrong++;
    }
    expect(wrong / N).toBeLessThan(0.15);
  });
});
