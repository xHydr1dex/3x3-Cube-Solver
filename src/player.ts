// 3D cube view with animated layer turns.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Face, FACE_COLOR, FACES, Hold, Move } from './cube';

// x = right (R), y = up (U), z = front (F).
const AXIS: Record<Face, { axis: 'x' | 'y' | 'z'; layer: number; sign: number }> = {
  R: { axis: 'x', layer: 1, sign: -1 }, L: { axis: 'x', layer: -1, sign: 1 },
  U: { axis: 'y', layer: 1, sign: -1 }, D: { axis: 'y', layer: -1, sign: 1 },
  F: { axis: 'z', layer: 1, sign: -1 }, B: { axis: 'z', layer: -1, sign: 1 },
};

/** 3D position + outward normal for facelet `i` of face `f` (Kociemba reading order). */
function faceletPlacement(f: Face, i: number): { pos: THREE.Vector3; normal: THREE.Vector3 } {
  const r = Math.floor(i / 3), c = i % 3;
  switch (f) {
    case 'U': return { pos: new THREE.Vector3(c - 1, 1, r - 1), normal: new THREE.Vector3(0, 1, 0) };
    case 'D': return { pos: new THREE.Vector3(c - 1, -1, 1 - r), normal: new THREE.Vector3(0, -1, 0) };
    case 'F': return { pos: new THREE.Vector3(c - 1, 1 - r, 1), normal: new THREE.Vector3(0, 0, 1) };
    case 'B': return { pos: new THREE.Vector3(1 - c, 1 - r, -1), normal: new THREE.Vector3(0, 0, -1) };
    case 'R': return { pos: new THREE.Vector3(1, 1 - r, 1 - c), normal: new THREE.Vector3(1, 0, 0) };
    case 'L': return { pos: new THREE.Vector3(-1, 1 - r, c - 1), normal: new THREE.Vector3(-1, 0, 0) };
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Player {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private controls: OrbitControls;
  private cube = new THREE.Group();
  private cubies: THREE.Group[] = [];
  private stickers: THREE.Mesh[] = []; // indexed by facelet, valid right after setState()
  private materials = Object.fromEntries(
    FACES.map((f) => [f, new THREE.MeshStandardMaterial({ color: FACE_COLOR[f].hex, roughness: 0.45 })]),
  ) as unknown as Record<Face, THREE.Material>;
  private anim: { start: number; duration: number; update: (e: number) => void; finish: () => void; done: () => void } | null = null;
  private dirty = true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.camera.position.set(5.2, 4.6, 7.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);
    this.scene.add(this.cube);
    this.build();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  private build() {
    const body = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });
    const stickerGeo = new RoundedBoxGeometry(0.8, 0.8, 0.04, 2, 0.06);
    const byPos = new Map<string, THREE.Group>();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.add(new THREE.Mesh(body, bodyMat));
      this.cube.add(g);
      this.cubies.push(g);
      byPos.set(`${x},${y},${z}`, g);
    }
    FACES.forEach((f, k) => {
      for (let i = 0; i < 9; i++) {
        const { pos, normal } = faceletPlacement(f, i);
        const g = byPos.get(`${pos.x},${pos.y},${pos.z}`)!;
        const m = new THREE.Mesh(stickerGeo, this.materials[f]);
        m.position.copy(normal).multiplyScalar(0.49);
        m.lookAt(normal.clone().multiplyScalar(2));
        g.add(m);
        this.stickers[k * 9 + i] = m;
      }
    });
    // Remember each cubie's home so we can snap back before recoloring.
    this.cubies.forEach((g) => (g.userData.home = g.position.clone()));
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole cube in view on narrow screens.
    this.camera.zoom = Math.min(1, w / h);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Instantly show a cube state held a certain way (cancels any running animation). */
  setState(facelets: string, hold: Hold) {
    this.finishNow();
    for (const g of this.cubies) {
      g.position.copy(g.userData.home);
      g.quaternion.identity();
    }
    this.stickers.forEach((m, i) => (m.material = this.materials[facelets[i] as Face]));
    this.cube.quaternion.copy(holdQuaternion(hold));
    this.dirty = true;
  }

  get busy() { return this.anim !== null; }

  private run(duration: number, update: (e: number) => void, finish: () => void): Promise<void> {
    return new Promise((done) => {
      this.anim = { start: performance.now(), duration, update, finish, done };
    });
  }

  /** Animate one layer turn; resolves when it has finished. */
  turn(move: Move, duration: number): Promise<void> {
    this.finishNow();
    const { axis, layer, sign } = AXIS[move.face];
    const pivot = new THREE.Group();
    this.cube.add(pivot);
    for (const g of this.cubies) if (Math.round(g.position[axis]) === layer) pivot.attach(g);
    const quarter = move.turns === 2 ? 2 : move.turns === 1 ? 1 : -1;
    const angle = sign * quarter * (Math.PI / 2);
    return this.run(duration * (move.turns === 2 ? 1.5 : 1), (e) => (pivot.rotation[axis] = angle * e), () => {
      pivot.rotation[axis] = angle;
      pivot.updateMatrixWorld();
      for (const g of [...pivot.children]) {
        this.cube.attach(g);
        g.position.set(Math.round(g.position.x), Math.round(g.position.y), Math.round(g.position.z));
        // Snap rotation to exact right angles so errors never accumulate.
        const m = new THREE.Matrix4().makeRotationFromQuaternion(g.quaternion);
        m.elements.forEach((v, i) => (m.elements[i] = Math.round(v)));
        g.quaternion.setFromRotationMatrix(m);
      }
      this.cube.remove(pivot);
    });
  }

  /** Animate turning the whole cube in your hands to a new hold. */
  rotateTo(hold: Hold, duration: number): Promise<void> {
    this.finishNow();
    const from = this.cube.quaternion.clone();
    const to = holdQuaternion(hold);
    return this.run(duration, (e) => this.cube.quaternion.slerpQuaternions(from, to, e), () => this.cube.quaternion.copy(to));
  }

  /** Jump the current animation to its end. */
  finishNow() {
    if (!this.anim) return;
    const a = this.anim;
    this.anim = null;
    a.finish();
    this.dirty = true;
    a.done();
  }

  private tick(now: number) {
    this.controls.update();
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.start) / (this.anim.duration * 1000));
      this.anim.update(ease(t));
      this.dirty = true;
      if (t >= 1) this.finishNow();
    }
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  }

  resetView() {
    this.controls.reset();
    this.dirty = true;
  }
}

const NORMAL: Record<Face, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0), D: new THREE.Vector3(0, -1, 0), R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0), F: new THREE.Vector3(0, 0, 1), B: new THREE.Vector3(0, 0, -1),
};

/** Orientation that puts face hold.U on top, hold.F in front and hold.R on the right. */
function holdQuaternion(hold: Hold): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(NORMAL[hold.R], NORMAL[hold.U], NORMAL[hold.F]).transpose();
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
