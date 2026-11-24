// Flat, unfolded view of the cube that you can tap to fix colors.
import { Face, FACE_COLOR, FACES } from './cube';

// Where each face sits on a 12x9 sticker grid (classic cross layout).
const FACE_ORIGIN: Record<Face, [number, number]> = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] };

export class Net {
  private cells: HTMLButtonElement[] = [];
  private paint: Face = 'U';
  facelets: string[];

  constructor(root: HTMLElement, palette: HTMLElement, facelets: string, private onChange: () => void) {
    this.facelets = facelets.split('');
    root.innerHTML = '';
    FACES.forEach((face, k) => {
      const [ox, oy] = FACE_ORIGIN[face];
      for (let i = 0; i < 9; i++) {
        const idx = k * 9 + i;
        const b = document.createElement('button');
        b.className = 'sticker' + (i === 4 ? ' center' : '');
        b.style.gridColumn = String(ox + (i % 3) + 1);
        b.style.gridRow = String(oy + Math.floor(i / 3) + 1);
        b.setAttribute('aria-label', `${face} sticker ${i + 1}`);
        if (i !== 4) b.onclick = () => this.set(idx, this.paint);
        root.appendChild(b);
        this.cells[idx] = b;
      }
    });

    palette.innerHTML = '';
    for (const f of FACES) {
      const p = document.createElement('button');
      p.className = 'swatch' + (f === this.paint ? ' active' : '');
      p.style.background = FACE_COLOR[f].hex;
      p.setAttribute('aria-label', FACE_COLOR[f].name);
      p.onclick = () => {
        this.paint = f;
        palette.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === p));
      };
      palette.appendChild(p);
    }
    this.render();
  }

  private set(idx: number, f: Face) {
    this.facelets[idx] = f;
    this.render();
    this.onChange();
  }

  highlight(bad: number[] = []) {
    this.cells.forEach((c, i) => c.classList.toggle('bad', bad.includes(i)));
  }

  render() {
    this.cells.forEach((c, i) => {
      const f = this.facelets[i] as Face;
      c.style.background = FACE_COLOR[f]?.hex ?? '#3a3f4b';
      c.classList.toggle('blank', !FACE_COLOR[f]);
    });
  }

  get value() { return this.facelets.join(''); }
}
