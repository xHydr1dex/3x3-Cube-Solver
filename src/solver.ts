// Both solvers behind one small API.
import { Cubies, Move, moveToString, parseMoves } from './cube';
import { solveBeginner, Stage, Step } from './beginner';

export type { Stage, Step };

const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
let nextId = 0;
const pending = new Map<number, { resolve: (m: Move[]) => void; reject: (e: Error) => void }>();
let readyResolve: () => void;
export const solverReady = new Promise<void>((r) => (readyResolve = r));

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ready') return readyResolve();
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.type === 'solution') p.resolve(parseMoves(msg.solution));
  else p.reject(new Error(msg.message));
};

export async function solveShortest(facelets: string): Promise<Stage[]> {
  await solverReady;
  const id = nextId++;
  const moves = await new Promise<Move[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, facelets });
  });
  if (!moves.length) return [];
  const steps = moves.map((move) => ({ kind: 'move' as const, move, label: moveToString(move) }));
  return [{ group: 'Shortest solution', name: '', hint: 'The fewest moves — usually 18 to 22. Keep the same hold the whole time.', steps }];
}

export function solveBeginnerStages(c: Cubies): Stage[] {
  return solveBeginner(c);
}
