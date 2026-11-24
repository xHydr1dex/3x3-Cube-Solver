// Runs the Kociemba two-phase solver off the main thread.
// The solver's tables take a moment to build, so we do that as soon as the app opens.
import Cube from 'cubejs';

Cube.initSolver();
postMessage({ type: 'ready' });

onmessage = (e: MessageEvent<{ id: number; facelets: string }>) => {
  const { id, facelets } = e.data;
  try {
    const solution = Cube.fromString(facelets).solve();
    postMessage({ type: 'solution', id, solution });
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err) });
  }
};
