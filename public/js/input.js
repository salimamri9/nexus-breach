// Top-down controls: WASD moves (screen-relative), the mouse aims your body and flashlight,
// right-click pings, the wheel zooms.
export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.keys = new Set();
    this.h = handlers;
    this.enabled = true;
    this.mouseX = innerWidth / 2;
    this.mouseY = innerHeight / 2;
    this.zoomDelta = 0;

    addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') { document.activeElement.blur(); this.h.escape?.(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'tab') { e.preventDefault(); this.h.scores?.(true); return; }
      this.keys.add(k);
      if (e.repeat) return;
      if (!this.enabled) { if (k === 'escape') this.h.escape?.(); return; }
      if (k === 'e') this.h.interact?.();
      else if (k === 'f') this.h.light?.();
      else if (k === 'c') this.h.crouch?.();   // not Ctrl: Ctrl+W (crouch + walk) would close the tab, and keyd-style Caps→Esc/Ctrl sends it on every Esc
      else if (k === ' ' || k === 'q') { e.preventDefault(); this.h.ability?.(); }
      else if (k === 'm') this.h.map?.();
      else if (k === 'i') this.h.intel?.();
      else if (k === 'h') this.h.help?.();
      else if (k === 'enter' || k === 't') { e.preventDefault(); this.h.chat?.('team'); }
      else if (k === 'y') { e.preventDefault(); this.h.chat?.('all'); }
      else if (k === 'g') this.h.ping?.();
      else if (k === 'escape') this.h.escape?.();
      else if (k === '=' || k === '+') this.zoomDelta += 1;
      else if (k === '-') this.zoomDelta -= 1;
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.h.scores?.(false);
      if (k === 'e') this.h.interactUp?.();
    });
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) this.h.ping?.();
      else if (e.button === 0) this.h.throw?.();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomDelta -= Math.sign(e.deltaY); }, { passive: false });
  }

  get locked() { return false; }
  get lookTouch() { return null; }
  unlock() {}

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.keys.clear();
  }

  // movement relative to where you aim: forward (W / ↑) walks toward the mouse, back (S / ↓) away
  // from it, sideways (A D / ← →) sidesteps. x = right, y = forward; magnitude 0..1.
  move() {
    if (!this.enabled) return { x: 0, y: 0, mag: 0 };
    const k = this.keys;
    let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let y = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const m = Math.hypot(x, y);
    if (m > 0) { x /= m; y /= m; }
    return { x, y, mag: m ? 1 : 0 };
  }

  sprinting() { return this.enabled && this.keys.has('shift'); }

  consumeZoom() { const z = this.zoomDelta; this.zoomDelta = 0; return z; }
}
