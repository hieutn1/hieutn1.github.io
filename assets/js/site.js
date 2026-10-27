/*
 * Site behaviour: theme, the motion switch, the hero's black hole, the observatory, and page routing.
 * The physics lives in physics.js (window.Physics) so the tests can run the same code.
 */
(() => {
'use strict';

const TAU = Math.PI * 2;
const root = document.documentElement;
const Phys = window.Physics;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const store = {
  get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* storage blocked */ } }
};
let spare = null;
function gauss() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u = 0; while (u === 0) u = Math.random();
  const v = Math.random(), m = Math.sqrt(-2 * Math.log(u));
  spare = m * Math.sin(TAU * v); return m * Math.cos(TAU * v);
}
function hexRgb(hex) {
  hex = (hex || '#888888').trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* ---------------- theme ---------------- */
const themeBtn = document.getElementById('theme');
function isDark() {
  const t = root.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t === 'dark';
  return !matchMedia('(prefers-color-scheme: light)').matches;
}
function syncTheme() {
  const d = isDark();
  themeBtn.textContent = d ? 'Paper' : 'Night';
  themeBtn.setAttribute('aria-label', d ? 'Paper: switch to the light theme' : 'Night: switch to the dark theme');
}
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  store.set('hn-theme', next);
  syncTheme();
});
syncTheme();

/* ---------------- motion: one switch for every animation on the page ----------------
 * Defaults to off for visitors who ask their system for reduced motion. A choice made with the
 * button is remembered on this device. */
const Motion = (() => {
  const btn = document.getElementById('motion'), label = btn.querySelector('.motion-label');
  const subs = [];
  const saved = store.get('hn-motion');
  let on = saved ? saved === 'on' : !reduceMQ.matches;
  function render() {
    btn.dataset.state = on ? 'on' : 'off';
    label.textContent = on ? 'Pause animation' : 'Play animation';
  }
  function set(v, remember) {
    if (remember) store.set('hn-motion', v ? 'on' : 'off');
    if (v === on) return;
    on = v; render();
    for (const f of subs) f(on);
  }
  btn.addEventListener('click', () => set(!on, true));
  reduceMQ.addEventListener('change', () => { if (!store.get('hn-motion')) set(!reduceMQ.matches, false); });
  render();
  return { get on() { return on; }, subscribe(f) { subs.push(f); } };
})();

/* ---------------- the cosmos: collapse, a growing black hole, accretion; then the home background ---------------- */
const Cosmos = (() => {
  const cv = document.getElementById('cosmos'), c = cv.getContext('2d');
  const ui = document.getElementById('intro-ui'), sk = document.getElementById('skip');
  const scrim = document.getElementById('scrim'), hero = document.getElementById('hero');
  const heroPin = document.getElementById('hero-pin'), heroLede = document.getElementById('hero-lede');
  const heroText = document.getElementById('hero-text'), topBar = document.querySelector('.top');
  const BG = '11,14,21';
  const ELEV = 8 * Math.PI / 180, CE = Math.cos(ELEV), SE = Math.sin(ELEV);    // camera 8° above the disk plane
  const ROLL = 10 * Math.PI / 180, CR = Math.cos(ROLL), SR = Math.sin(ROLL);   // spin axis tilted 10° counter-clockwise
  // Units: r_s = 1. Paczyński–Wiita potential (physics.js): ISCO at 3 r_s, marginally bound orbit at 2 r_s.
  const GM = Phys.PW_GM, BC = Phys.criticalImpact(1);
  // Disk dissipation. visc sets the inflow: gas circles about three times between 8 r_s and the ISCO,
  // with radial speed under a tenth of the orbital speed (checked in tests/physics.test.mjs).
  const DISK = { GM, rcap: 1.15, visc: 0.001, circ: 0.02, zDamp: 0.012, zDampFar: 0.003 };
  // Timeline, in seconds.
  const T_GROW = 2.2, D_GROW = 3.2, T_REVEAL = 6.0, T_GLIDE = 6.2, D_GLIDE = 1.9;
  const GROW_A = 6;   // growth rate ∝ size: almost nothing at first, then a rush at the end
  const NB = 16, BINS = [];
  (function palette() {   // orange ramp: cool outer gas to the hot inner edge
    const stops = [[0, [110, 30, 10, .4]], [.35, [214, 80, 20, .68]], [.62, [255, 136, 38, .86]], [.84, [255, 184, 100, .93]], [1, [255, 234, 196, .98]]];
    for (let b = 0; b < NB; b++) {
      const v = b / (NB - 1); let k = 0;
      while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      const [a0, c0] = stops[k], [a1, c1] = stops[k + 1], u = (v - a0) / (a1 - a0);
      const m = j => c0[j] + (c1[j] - c0[j]) * u;
      BINS.push('rgba(' + (m(0) | 0) + ',' + (m(1) | 0) + ',' + (m(2) | 0) + ',' + (m(3) * 0.5).toFixed(3) + ')');
    }
  })();
  const N = innerWidth * innerHeight < 520000 ? 1600 : 4500;
  const COARSE = matchMedia('(pointer: coarse)').matches;   // phones and tablets: draw at 1.5×, which a moving particle field doesn't need more than
  let NA = N;   // particles in play; lowered automatically on slow devices
  const PX = new Float32Array(N), PY = new Float32Array(N), PZ = new Float32Array(N);
  const VX = new Float32Array(N), VY = new Float32Array(N), VZ = new Float32Array(N), AGE = new Float32Array(N);
  const D = { x: PX, y: PY, z: PZ, vx: VX, vy: VY, vz: VZ };
  const X1 = new Float32Array(N), Y1 = new Float32Array(N);
  const LAY = new Int8Array(N), VIS = new Uint8Array(N), BIN = new Uint8Array(N);
  const ORD = new Int32Array(N), CNT = new Int32Array(2 * NB + 1);   // particles sorted by layer and colour
  // two trail layers: the far side (drawn behind the shadow) and the near side (drawn in front of it)
  const LA = document.createElement('canvas'), la = LA.getContext('2d');
  const LB = document.createElement('canvas'), lb = LB.getContext('2d');
  let W = 1, H = 1, dpr = 1, lastW = 0, lastH = 0;
  let mode = 'rest', t = 0, last = 0, raf = 0, onHome = true, inView = true, revealed = true, glideStart = -1, guard = 0;
  let anchored = false;   // after the intro the canvas belongs to the page and scrolls with the hero
  let workAvg = 0, workFrames = 0, frameCount = 0;
  const shown = { x: 0, y: 0, r: 0 };   // where the shadow was last drawn (for the tests)
  const fr = { ix: 0, iy: 0, ik: 1, rx: 0, ry: 0, rk: 1 };   // intro framing and resting framing: centre and px per r_s

  const vcirc = r => Phys.pwCircularSpeed(r, GM);
  function frames() {
    fr.ix = W / 2; fr.iy = H * 0.47; fr.ik = Math.max(8, Math.min(W * 0.034, H * 0.048));
    if (W >= 700) {
      const pr = heroPin.getBoundingClientRect();
      const textR = pr.width > 0 ? pr.left + heroLede.offsetLeft + heroLede.offsetWidth : W * 0.45, free = Math.max(160, W - textR);
      fr.rx = textR + free * 0.34; fr.ry = H * 0.46; fr.rk = Math.max(8, Math.min(free * 0.95 / 13, H * 0.046));
    } else {
      // phones: the black hole sits in the space between the menu and the text below it (page coordinates,
      // which match the screen until the page scrolls; scrolling is locked during the intro)
      const menu = topBar.getBoundingClientRect().bottom + scrollY, text = heroText.getBoundingClientRect().top + scrollY;
      fr.rx = W * 0.5; fr.ry = text > menu + 80 ? menu + 0.55 * (text - menu) : H * 0.26;
      fr.rk = Math.max(8, Math.min(W * 0.034, H * 0.03));
    }
  }
  function setV(i, x, y, z, vphi, vr, vz) {
    const R = Math.hypot(x, y) || 1, cx = x / R, sy = y / R;
    PX[i] = x; PY[i] = y; PZ[i] = z;
    VX[i] = vr * cx - vphi * sy; VY[i] = vr * sy + vphi * cx; VZ[i] = vz;
  }
  function respawn(i) {     // fresh gas falls in from beyond the disk, close to its plane
    const r = 13.5 + 3.5 * Math.random(), ph = Math.random() * TAU;
    const z = (Math.random() < 0.5 ? -1 : 1) * r * (0.005 + 0.03 * Math.random());
    const R = Math.sqrt(Math.max(1, r * r - z * z));
    const rc = 8 + 5 * Math.random();
    setV(i, R * Math.cos(ph), R * Math.sin(ph), z, rc * vcirc(rc) / R, -0.02, -Math.sign(z) * 0.006);
    AGE[i] = 0;
  }
  function initCloud() {    // a slowly rotating, slightly flattened cloud, much larger than the disk
    for (let i = 0; i < N; i++) {
      const r0 = 6 + 14 * Math.cbrt(Math.random()), u = 2 * Math.random() - 1, ph = Math.random() * TAU, s = Math.sqrt(1 - u * u);
      const x = r0 * s * Math.cos(ph), y = r0 * s * Math.sin(ph), z = r0 * u * 0.7, R = Math.hypot(x, y) + 1e-6;
      let L;
      if (Math.random() < 0.25) L = 0.2 + 1.5 * Math.random();   // below the marginally bound value: falls straight in
      else { const rc = Math.min(3.6 + 9.4 * Math.pow(Math.random(), 0.8), 0.85 * Math.hypot(R, z)); L = rc * vcirc(rc); }
      setV(i, x, y, z, Math.min(L / R, 0.45) + 0.01 * gauss(), -0.02 + 0.012 * gauss(), 0.012 * gauss());
      AGE[i] = -0.45 * Math.random();
    }
  }
  function initSteady() {   // an established disk plus the inflowing feed
    for (let i = 0; i < N; i++) {
      if (i < N * 0.85) {
        const rc = 3.4 + 9.6 * Math.pow(Math.random(), 0.9), ph = Math.random() * TAU;
        setV(i, rc * Math.cos(ph), rc * Math.sin(ph), 0.012 * rc * gauss(), vcirc(rc) * (1 + 0.006 * gauss()), 0, 0);
      } else respawn(i);
      AGE[i] = 1;
    }
  }
  function step(dts, dtr) {
    for (let i = 0; i < NA; i++) {
      AGE[i] += dtr;
      const r = Math.sqrt(PX[i] * PX[i] + PY[i] * PY[i] + PZ[i] * PZ[i]);
      if (r > 40 || !Phys.diskStep(D, i, dts, DISK)) respawn(i);
    }
  }
  function project(sh, lvl) {    // sh: shadow radius as a fraction of its final size (tracks the growing mass)
    const bc = BC * sh;
    for (let i = 0; i < NA; i++) {
      const fa = clamp(AGE[i] / 0.9, 0, 1);
      if (fa < 0.04) { LAY[i] = 2; continue; }
      const x = PX[i], y = PY[i], z = PZ[i], r = Math.sqrt(x * x + y * y + z * z);
      const ux = x, uy = y * SE + z * CE, d = y * CE - z * SE;    // d > 0: behind the hole
      // emission: T ∝ r^(-3/4); Doppler beaming from the line-of-sight velocity; gravitational redshift near the hole
      const vlos = clamp(-VY[i] * CE + VZ[i] * SE, -0.8, 0.8);
      const Dp = 1 / (1 - vlos);
      const red = r < 3 ? 1 - sh + sh * clamp((r - 1.5) / 1.5, 0, 1) ** 2 : 1;
      const I = Math.pow(3 / Math.max(r, 3), 0.75) * clamp(Dp * Dp, 0.45, 1.8) * red * (1 - lvl + lvl * (0.15 + 0.85 * Math.exp(-Math.abs(z) / 0.8))) * fa;
      BIN[i] = clamp(Math.round(I / 1.3 * (NB - 1)), 0, NB - 1);
      let ax1, ay1;
      if (d <= 0 || sh < 0.02) {
        ax1 = ux; ay1 = uy;
        const b = Math.hypot(ux, uy);
        if (r < 3 && b < bc && b > 1e-3) { ax1 = ux / b * bc * 1.02; ay1 = uy / b * bc * 1.02; }   // deep emitters appear at the rim
        LAY[i] = 1;
      } else {
        // light from behind the hole: the brighter (primary) image of a point-mass lens
        const b = Math.hypot(ux, uy), tp = Phys.lensImages(b, d, sh)[0];
        const nx = b > 1e-3 ? ux / b : 0, ny = b > 1e-3 ? uy / b : 1;
        ax1 = nx * tp; ay1 = ny * tp;
        LAY[i] = 0; VIS[i] = tp > bc ? 1 : 0;    // images inside the shadow are hidden
      }
      X1[i] = ax1 * CR - ay1 * SR; Y1[i] = ax1 * SR + ay1 * CR;       // roll the whole picture
    }
  }
  function radial(x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  function sortParticles() {   // counting sort by (layer, colour bin)
    CNT.fill(0);
    for (let i = 0; i < NA; i++) if (LAY[i] < 2) CNT[LAY[i] * NB + BIN[i] + 1]++;
    for (let j = 1; j <= 2 * NB; j++) CNT[j] += CNT[j - 1];
    const pos = CNT.slice(0, 2 * NB);
    for (let i = 0; i < NA; i++) if (LAY[i] < 2) ORD[pos[LAY[i] * NB + BIN[i]]++] = i;
  }
  function draw() {
    const intro = mode === 'intro';
    const p = intro ? clamp((t - T_GROW) / D_GROW, 0, 1) : 1;
    const sh = Phys.growth(p, GROW_A);
    const knot = intro ? sstep((t - 0.5) / 1.2) * (1 - sstep((p - 0.55) / 0.45)) : 0;   // hot core, swallowed as the hole grows
    const lvl = intro ? sstep((t - 4.4) / 1.2) : 1;
    const gp = glideStart < 0 ? (intro ? 0 : 1) : sstep((t - glideStart) / D_GLIDE);
    const moving = glideStart < 0 ? 0 : Math.sin(Math.PI * gp);
    const ox = fr.ix + (fr.rx - fr.ix) * gp, oy = fr.iy + (fr.ry - fr.iy) * gp, k = fr.ik + (fr.rk - fr.ik) * gp;
    project(sh, lvl); sortParticles();
    shown.x = ox; shown.y = oy; shown.r = BC * sh * k;
    const fade = (0.1 + 0.32 * moving).toFixed(3);              // trails trace the orbits; shortened while the hole moves
    for (const L of [la, lb]) {
      L.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.globalCompositeOperation = 'destination-out'; L.fillStyle = 'rgba(0,0,0,' + fade + ')'; L.fillRect(0, 0, W, H);
      L.globalCompositeOperation = 'lighter';
    }
    const s = W < 600 ? 1.2 : 1.35, hs = s / 2;
    for (let b = 0; b < NB; b++) {                 // far side, lensed up over the hole
      const j0 = CNT[b], j1 = CNT[b + 1];
      la.fillStyle = BINS[b];
      for (let j = j0; j < j1; j++) { const i = ORD[j]; if (VIS[i]) la.fillRect(ox + X1[i] * k - hs, oy - Y1[i] * k - hs, s, s); }
    }
    for (let b = 0; b < NB; b++) {                 // near side of the disk
      const j0 = CNT[NB + b], j1 = CNT[NB + b + 1];
      lb.fillStyle = BINS[b];
      for (let j = j0; j < j1; j++) { const i = ORD[j]; lb.fillRect(ox + X1[i] * k - hs, oy - Y1[i] * k - hs, s, s); }
    }
    // compose: sky, glow, far side, shadow and photon ring, near side
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgb(' + BG + ')'; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalCompositeOperation = 'lighter';
    if (knot > 0.01) radial(ox, oy, 2.6 * k, '255,200,140', 0.3 * knot);
    if (lvl > 0.01) radial(ox, oy, 8 * k, '255,140,50', 0.06 * lvl);
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(LA, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sh > 0.002) {                              // shadow, radius (3√3/2) r_s, and photon ring
      c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000';
      c.beginPath(); c.arc(ox, oy, BC * sh * k, 0, TAU); c.fill();
      c.globalCompositeOperation = 'lighter';
      c.beginPath(); c.arc(ox, oy, BC * 1.02 * sh * k, 0, TAU);
      c.strokeStyle = 'rgba(255,150,60,' + (0.12 * sh) + ')'; c.lineWidth = 4; c.stroke();
      c.strokeStyle = 'rgba(255,190,120,' + (0.5 * sh * (0.4 + 0.6 * lvl)) + ')'; c.lineWidth = 0.9; c.stroke();
    }
    const tf = T_GROW + D_GROW;
    if (intro && t > tf && t < tf + 0.8) {         // the hole reaches full size
      const q = (t - tf) / 0.8;
      c.beginPath(); c.arc(ox, oy, BC * k * (1 + 1.6 * q), 0, TAU);
      c.strokeStyle = 'rgba(255,220,170,' + (0.3 * (1 - q)) + ')'; c.lineWidth = 1.2; c.stroke();
    }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.drawImage(LB, 0, 0);
  }
  function timeline() {
    if (t >= T_REVEAL && !revealed) reveal();
    if (t >= T_GLIDE && glideStart < 0) glideStart = t;
    if (glideStart >= 0 && t >= glideStart + D_GLIDE + 0.1) mode = 'rest';
  }
  function adapt(work) {   // drop particles if a frame's work keeps running long (slow phones, battery saver)
    workAvg = workFrames ? workAvg * 0.94 + work * 0.06 : work; workFrames++;
    if (NA > N * 0.3 && ((workFrames > 45 && workAvg > 10) || (workFrames > 8 && workAvg > 40))) { NA = Math.floor(NA * 0.8); workFrames = 0; }
  }
  function tick(now) {
    raf = 0;
    const dtr = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60; last = now;
    t += dtr;
    const rate = mode === 'intro' ? (t < 1.8 ? 70 : t < 3.4 ? 70 - 46 * (t - 1.8) / 1.6 : 24) : 24;   // r_s/c per second
    const w0 = performance.now();
    try { step(rate * dtr, dtr); draw(); }
    catch (err) { if (!revealed) { mode = 'rest'; reveal(); } return; }
    adapt(performance.now() - w0); frameCount++;
    if (mode === 'intro') timeline();
    schedule();
  }
  function running() { return mode === 'intro' || (Motion.on && onHome && inView && !document.hidden); }
  function schedule() {
    if (raf) return;
    if (!running()) { last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  function layoutHero() { if (onHome) { frames(); onScroll(); } }
  function onScroll() {   // animate only while some of the hero is on screen
    inView = !revealed || (onHome && hero.getBoundingClientRect().bottom > 0);
    schedule();
  }
  // During the intro the canvas is fixed to the window. When the page appears it becomes part of the page, at the
  // top, so the black hole glides into place within the hero and then scrolls up with it (natively, no scroll handler).
  function anchor(top) {
    anchored = true;
    for (const el of [cv, scrim]) { el.style.position = 'absolute'; el.style.top = Math.max(0, top) + 'px'; el.style.height = H + 'px'; }
    onScroll();
  }
  function unanchor() {
    anchored = false;
    for (const el of [cv, scrim]) { el.style.position = ''; el.style.top = ''; el.style.height = ''; }
  }
  function reveal() {
    revealed = true; root.classList.remove('intro-on');   // scrolling was locked during the intro, so this is the top
    store.set('hn-intro-seen', '1', true);
    clearTimeout(guard); anchor(scrollY);
  }
  function clearCanvas() {
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgb(' + BG + ')'; c.fillRect(0, 0, cv.width, cv.height);
    for (const L of [la, lb]) { L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, LA.width, LA.height); }
  }
  function size(force) {
    const w = innerWidth, h = innerHeight;
    if (!force && w === lastW && Math.abs(h - lastH) < 120) return;   // ignore mobile toolbar jitter
    lastW = w; lastH = h; W = w; H = h;
    dpr = Math.min(COARSE ? 1.5 : 2, window.devicePixelRatio || 1, Math.sqrt(6e6 / (W * H)));   // cap the backing store on huge screens
    cv.width = LA.width = LB.width = Math.round(W * dpr); cv.height = LA.height = LB.height = Math.round(H * dpr);
    if (anchored) for (const el of [cv, scrim]) el.style.height = H + 'px';
    layoutHero(); clearCanvas();
    if (mode === 'rest' && !Motion.on) still();
  }
  function still() { for (let j = 0; j < 40; j++) { step(0.3, 0.05); draw(); } }   // a settled frame, with short trails
  function skip() {
    if (mode !== 'intro' || revealed) return;
    if (t < 4.0) { initSteady(); clearCanvas(); }
    t = Math.max(t, T_REVEAL); reveal(); glideStart = t + 0.1;
  }
  function playIntro() {
    root.classList.add('intro-on');
    unanchor();
    mode = 'intro'; revealed = false; t = 0; glideStart = -1;
    initCloud(); size(true);
    cancelAnimationFrame(raf); raf = 0; schedule();
    clearTimeout(guard);
    guard = setTimeout(() => { if (!revealed) { initSteady(); mode = 'rest'; glideStart = -1; reveal(); } }, 11000);
  }
  function rest() {
    mode = 'rest'; glideStart = -1; revealed = true;
    initSteady(); size(true); anchor(0);
    if (!Motion.on) { still(); return; }
    // let the page finish loading and paint its text before the disk starts
    const go = () => setTimeout(schedule, 120);
    if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
  }
  function setPage(home) {
    onHome = home;
    if (home) requestAnimationFrame(layoutHero); else onScroll();
    if (!home && mode !== 'intro' && raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
  }
  Motion.subscribe(on => {
    if (on) { schedule(); return; }
    if (mode === 'intro' && revealed) { glideStart = t - D_GLIDE; mode = 'rest'; }   // finish the glide at once
    if (mode !== 'intro' && raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    if (mode !== 'intro') draw();
  });
  sk.addEventListener('click', e => { e.stopPropagation(); skip(); });
  ui.addEventListener('click', skip);
  const SCROLL_KEYS = [' ', 'Spacebar', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'End', 'Home'];
  document.addEventListener('keydown', e => {
    if (mode !== 'intro' || revealed) return;
    if (SCROLL_KEYS.includes(e.key)) e.preventDefault();   // the key skips the intro; it shouldn't also scroll the page
    skip();
  });
  addEventListener('resize', () => size(false));
  addEventListener('scroll', onScroll, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutHero);
  document.addEventListener('visibilitychange', schedule);
  return { playIntro, rest, setPage, get active() { return NA; }, get frames() { return frameCount; }, get hole() { return { ...shown }; } };
})();

/* ---------------- the observatory ---------------- */
const Obs = (() => {
  const field = document.getElementById('field');
  const cS = document.getElementById('sheet'), cD = document.getElementById('flow'), cP = document.getElementById('phase');
  const xS = cS.getContext('2d'), xD = cD.getContext('2d'), xP = cP.getContext('2d');
  const rsIn = document.getElementById('rs'), sgIn = document.getElementById('sigma');
  const rsOut = document.getElementById('rs-out'), sgOut = document.getElementById('sigma-out');
  const oCap = document.getElementById('o-cap'), oPh = document.getElementById('o-ph'), oBc = document.getElementById('o-bc');
  const runBtn = document.getElementById('run'), emitBtn = document.getElementById('emit');

  // camera and model constants (world units; r_s is set by the lens slider)
  const ELEV = 33 * Math.PI / 180, CE = Math.cos(ELEV), SE = Math.sin(ELEV), DIST = 27;
  const KAPPA = 0.5, RREF = 16, RDOM = 15.5;      // embedding exaggeration, reference radius, sheet radius
  const GAMMA = 0.012, SIM = 12, CVIS = 6.5;       // bath friction, proper time per second, light speed on screen
  const st = { rs: +rsIn.value, sigma: +sgIn.value };
  let W = 1, H = 1, dpr = 1, f = 1, cx = 0, cy = 0, s0 = 1, zRef = 0, tok = null, PW = 1, PH = 1;
  let active = false, visible = false, paused = !Motion.on, raf = 0, last = 0, frame = 0, captured = 0, firstPending = false, staticRaf = 0;
  const NP = matchMedia('(max-width: 640px)').matches ? 200 : 340;
  const E = { x: new Float64Array(NP), y: new Float64Array(NP), u: new Float64Array(NP), v: new Float64Array(NP) };
  const pulses = [];
  const P = [0, 0, 0];
  const S = { x: 0, y: 0, u: 0, v: 0 };

  function readTok() {
    const cs = getComputedStyle(root), g = n => cs.getPropertyValue(n).trim() || '#888888';
    tok = { grid: g('--grid'), light: g('--light'), matter: g('--matter'), void: g('--void'), ink: g('--ink'), bg: g('--bg'), panel: g('--panel') };
    const [r, gg, b] = hexRgb(tok.bg);
    tok.dark = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255 < 0.45;
  }
  function setZ() { zRef = Phys.flamm(RREF, st.rs); }
  // Flamm's paraboloid, shifted so the rim sits at zero and exaggerated by KAPPA
  function hgt(r) { return KAPPA * ((r <= st.rs ? 0 : Phys.flamm(r, st.rs)) - zRef); }
  function proj(X, Y, Hh, o) {
    const yc = Hh * CE + Y * SE, zc = DIST + Y * CE - Hh * SE, s = f / zc;
    o[0] = cx + X * s; o[1] = cy - yc * s; o[2] = s; return o;
  }
  function projR(X, Y, o) { return proj(X, Y, hgt(Math.hypot(X, Y)), o); }
  function toPlane(sx, sy) {
    const a = (sx - cx) / f, b = (cy - sy) / f;
    if (SE - b * CE < 0.03) return null;
    let Hh = 0, X = 0, Y = 0;
    for (let i = 0; i < 6; i++) {
      Y = (b * (DIST - Hh * SE) - Hh * CE) / (SE - b * CE);
      X = a * (DIST + Y * CE - Hh * SE);
      Hh = hgt(Math.max(Math.hypot(X, Y), st.rs));
    }
    return Math.hypot(X, Y) > RDOM ? null : [X, Y];
  }
  function trace(x, y, u, v) {
    const rs = st.rs, k = Phys.nullK(rs, x * v - y * u);
    S.x = x; S.y = y; S.u = u; S.v = v;
    const pts = [x, y];
    for (let n = 0; n < 9000; n++) {
      const r = Math.hypot(S.x, S.y);
      if (r < rs * 1.01) break;
      if (r > 18 && S.x * S.u + S.y * S.v > 0) break;
      Phys.nullStep(S, k, Phys.nullStepSize(r, rs, Math.hypot(S.u, S.v), 0.002, 0.15)); pts.push(S.x, S.y);
    }
    return pts;
  }

  /* ----- static layer: sheet, horizon, rings, one geodesic ----- */
  function gridLine(c, k, vertical) {
    let pen = false, t = -RDOM;
    while (t <= RDOM) {
      const X = vertical ? k : t, Y = vertical ? t : k, r = Math.hypot(X, Y);
      let step;
      if (r > RDOM || r < st.rs * 1.003) { pen = false; step = 0.1; }
      else {
        proj(X, Y, hgt(r), P);
        if (pen) c.lineTo(P[0], P[1]); else { c.moveTo(P[0], P[1]); pen = true; }
        step = Math.min(0.14, 0.01 + 0.05 * (r - st.rs));
      }
      t += step;
    }
  }
  function ringPath(c, r) {
    c.beginPath();
    for (let i = 0; i <= 180; i++) { const a = i / 180 * TAU; proj(r * Math.cos(a), r * Math.sin(a), hgt(r), P); i ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]); }
    c.closePath();
  }
  function drawSheet() {
    if (!tok) readTok();
    setZ();
    const c = xS, rs = st.rs;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.lineWidth = 0.8; c.strokeStyle = rgba(tok.grid, tok.dark ? 0.28 : 0.34);
    c.beginPath();
    for (let i = -20; i <= 20; i++) { const k = i * 0.8; gridLine(c, k, true); gridLine(c, k, false); }
    c.stroke();
    ringPath(c, rs * 1.004); c.fillStyle = tok.void; c.fill(); c.lineWidth = 0.8; c.strokeStyle = rgba(tok.ink, 0.3); c.stroke();
    c.setLineDash([1.5, 4]); ringPath(c, Phys.isco(rs)); c.strokeStyle = rgba(tok.ink, 0.5); c.stroke();
    c.setLineDash([3, 3]); ringPath(c, Phys.photonSphere(rs)); c.strokeStyle = rgba(tok.light, 0.8); c.stroke();
    c.setLineDash([]);
    // a single geodesic, passing just outside the critical impact parameter
    const pts = trace(-17, -Phys.criticalImpact(rs) * 1.06, 1, 0);
    c.lineWidth = 1; c.strokeStyle = rgba(tok.light, tok.dark ? 0.75 : 0.95);
    c.beginPath();
    for (let j = 0; j < pts.length; j += 2) { projR(pts[j], pts[j + 1], P); j ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]); }
    c.stroke();
  }
  function requestStatic() {
    if (staticRaf) return;
    staticRaf = requestAnimationFrame(() => { staticRaf = 0; drawSheet(); if (!raf) render(); });
  }

  /* ----- matter: timelike geodesics in a Langevin bath ----- */
  const temp = () => 0.02 * st.sigma * st.sigma;
  function spawn(i) {
    const rs = st.rs, M = 0.5 * rs;
    const rmin = Math.max(3.3 * rs, 2.4), rmax = 10.5;
    const r = rmin + (rmax - rmin) * Math.pow(Math.random(), 0.9), th = Math.random() * TAU;
    const vc = Phys.circularSpeed(r, M), vt = Math.sqrt(temp());
    E.x[i] = r * Math.cos(th); E.y[i] = r * Math.sin(th);
    E.u[i] = -vc * Math.sin(th) + vt * gauss(); E.v[i] = vc * Math.cos(th) + vt * gauss();
  }
  function stepEnsemble(dts) {
    const rs = st.rs, M = 0.5 * rs, T = temp(), cap = rs * 1.04;
    for (let i = 0; i < NP; i++) {
      if (!Phys.timelikeStep(E, i, dts, M, GAMMA, T, cap, gauss)) { captured++; spawn(i); continue; }
      const x = E.x[i], y = E.y[i], r = Math.hypot(x, y);
      if (r > 12.5) {   // a reflecting wall keeps the ensemble on the sheet
        const vr = (x * E.u[i] + y * E.v[i]) / r;
        if (vr > 0) { E.u[i] -= 2 * vr * x / r; E.v[i] -= 2 * vr * y / r; }
      }
    }
  }

  /* ----- light pulses, advanced in Schwarzschild coordinate time ----- */
  function mk(x, y, u, v) { return { x, y, u, v, L: x * v - y * u, t: 0, alive: true, tr: [] }; }
  function addPulse(p) { pulses.push(p); if (pulses.length > 6) pulses.shift(); if (paused) setPaused(false); else schedule(); }
  function launchPlane() {
    const n = W < 520 ? 72 : 112, ph = [];
    for (let i = 0; i < n; i++) ph.push(mk(-16.5, -9 + 18 * i / (n - 1), 1, 0));
    addPulse({ ph, closed: false, gap: 1.3, T: 0 });
  }
  function launchPoint(X, Y) {
    if (Math.hypot(X, Y) < st.rs * 1.25) return;
    const n = 144, ph = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; ph.push(mk(X, Y, Math.cos(a), Math.sin(a))); }
    addPulse({ ph, closed: true, gap: 1.6, T: 0 });
  }
  function photonStep(ph, rs) {
    const r = Math.hypot(ph.x, ph.y);
    if (r < rs * 1.03 || (r > 19 && ph.x * ph.u + ph.y * ph.v > 0)) { ph.alive = false; return false; }
    const x0 = ph.x, y0 = ph.y;
    S.x = ph.x; S.y = ph.y; S.u = ph.u; S.v = ph.v;
    Phys.nullStep(S, Phys.nullK(rs, ph.L), Phys.nullStepSize(r, rs, Math.hypot(ph.u, ph.v), 0.0015, 0.12));
    const dt = Phys.nullDt(x0, y0, S.x, S.y, rs);
    if (dt < 0) { ph.alive = false; return false; }
    ph.t += dt;
    ph.x = S.x; ph.y = S.y; ph.u = S.u; ph.v = S.v;
    return true;
  }
  function stepPulses(dt) {
    const rs = st.rs;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pl = pulses[i]; pl.T += CVIS * dt; let alive = 0;
      for (const ph of pl.ph) {
        if (!ph.alive) continue;
        let guard = 0;
        while (ph.t < pl.T && guard++ < 400) { if (!photonStep(ph, rs)) break; }
        if (ph.alive) { ph.tr.push(ph.x, ph.y); if (ph.tr.length > 24) ph.tr.splice(0, 2); alive++; }
        else ph.tr.length = 0;
      }
      if (alive === 0 || pl.T > 90) pulses.splice(i, 1);
    }
  }

  /* ----- drawing ----- */
  function drawPulse(c, pl) {
    const col = tok.light, n = pl.ph.length;
    c.strokeStyle = rgba(col, tok.dark ? 0.5 : 0.7); c.lineWidth = 1.1; c.beginPath();
    let prev = null;
    for (let j = 0; j <= n; j++) {
      if (j === n && !pl.closed) break;
      const ph = pl.ph[j % n];
      if (!ph.alive) { prev = null; continue; }
      projR(ph.x, ph.y, P);
      if (prev && Math.hypot(ph.x - prev.x, ph.y - prev.y) < pl.gap) c.lineTo(P[0], P[1]); else c.moveTo(P[0], P[1]);
      prev = ph;
    }
    c.stroke();
    c.strokeStyle = rgba(col, tok.dark ? 0.26 : 0.4); c.lineWidth = 0.9; c.beginPath();
    for (const ph of pl.ph) {
      const tr = ph.tr; if (tr.length < 4) continue;
      for (let k = 0; k < tr.length; k += 2) { projR(tr[k], tr[k + 1], P); k ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]); }
    }
    c.stroke();
    c.fillStyle = rgba(col, 0.95); c.beginPath();
    for (const ph of pl.ph) {
      if (!ph.alive) continue;
      projR(ph.x, ph.y, P); const rad = clamp(1.4 * P[2] / s0, 0.8, 2.6);
      c.moveTo(P[0] + rad, P[1]); c.arc(P[0], P[1], rad, 0, TAU);
    }
    c.fill();
  }
  function drawPhase() {
    const c = xP; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, PW, PH);
    const L = 10, R = PW - 10, T = 10, B = PH - 22, rs = st.rs;
    const lx = q => L + Math.log(q) / Math.log(30) * (R - L);
    const ly = p => T + (0.5 - p / 0.8) * (B - T);
    c.lineWidth = 1;
    c.strokeStyle = rgba(tok.ink, 0.14); c.beginPath(); c.moveTo(L, ly(0)); c.lineTo(R, ly(0)); c.stroke();
    c.setLineDash([3, 3]); c.strokeStyle = rgba(tok.light, 0.7); c.beginPath(); c.moveTo(lx(1.5), T); c.lineTo(lx(1.5), B); c.stroke();
    c.setLineDash([1.5, 3]); c.strokeStyle = rgba(tok.ink, 0.4); c.beginPath(); c.moveTo(lx(3), T); c.lineTo(lx(3), B); c.stroke();
    c.setLineDash([]);
    c.fillStyle = rgba(tok.ink, 0.6); c.font = '9.5px "IBM Plex Mono", ui-monospace, monospace'; c.textBaseline = 'top';
    for (const q of [1, 3, 10, 30]) { c.textAlign = q === 1 ? 'left' : q === 30 ? 'right' : 'center'; c.fillText(String(q), lx(q), B + 6); }
    c.fillStyle = rgba(tok.matter, 0.85);
    for (let i = 0; i < NP; i++) {
      const r = Math.hypot(E.x[i], E.y[i]), q = r / rs; if (q < 1 || q > 30) continue;
      const pr = (E.x[i] * E.u[i] + E.y[i] * E.v[i]) / r;
      c.fillRect(lx(q) - 1, ly(clamp(pr, -0.4, 0.4)) - 1, 2, 2);
    }
  }
  function render() {
    if (!tok) readTok();
    const c = xD; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = rgba(tok.matter, tok.dark ? 0.85 : 0.82); c.beginPath();
    for (let i = 0; i < NP; i++) {
      projR(E.x[i], E.y[i], P); const rad = clamp(1.25 * P[2] / s0, 0.7, 2.4);
      c.moveTo(P[0] + rad, P[1]); c.arc(P[0], P[1], rad, 0, TAU);
    }
    c.fill();
    if (tok.dark) c.globalCompositeOperation = 'lighter';
    for (const pl of pulses) drawPulse(c, pl);
    c.globalCompositeOperation = 'source-over';
    drawPhase();
  }
  function readouts() {
    oCap.textContent = captured;
    let n = 0; for (const pl of pulses) for (const ph of pl.ph) if (ph.alive) n++;
    oPh.textContent = n;
  }

  /* ----- loop ----- */
  function tick(now) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60; last = now;
    if (!paused) { stepEnsemble(dt * SIM); stepPulses(dt); }
    render();
    if (++frame % 8 === 0) readouts();
    schedule();
  }
  function schedule() {
    if (raf) return;
    if (!active || !visible || document.hidden || paused) { last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  function setPaused(p) {
    paused = p; runBtn.textContent = p ? 'Resume' : 'Pause';
    if (!p) schedule(); else readouts();
  }
  function resize() {
    const r = field.getBoundingClientRect();
    if (r.width < 2) return;
    W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cS, cD]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    f = Math.min(W / 20, H / 13) * DIST; cx = W / 2; cy = H * 0.42; s0 = f / DIST;
    const pr = cP.getBoundingClientRect(); PW = Math.max(1, pr.width); PH = Math.max(1, pr.height);
    cP.width = Math.round(PW * dpr); cP.height = Math.round(PH * dpr);
    drawSheet(); render();
  }
  function tryFirst() { if (firstPending && active && visible) { firstPending = false; setTimeout(() => { if (active && !paused) launchPlane(); }, 380); } }

  rsIn.addEventListener('input', () => {
    st.rs = +rsIn.value; rsOut.textContent = st.rs.toFixed(2);
    oBc.textContent = Phys.criticalImpact(st.rs).toFixed(2); setZ(); requestStatic();
  });
  sgIn.addEventListener('input', () => { st.sigma = +sgIn.value; sgOut.textContent = st.sigma.toFixed(2); });
  emitBtn.addEventListener('click', launchPlane);
  runBtn.addEventListener('click', () => setPaused(!paused));
  field.addEventListener('click', e => {
    const r = field.getBoundingClientRect(), pt = toPlane(e.clientX - r.left, e.clientY - r.top);
    if (pt) launchPoint(pt[0], pt[1]);
  });
  new ResizeObserver(() => { if (active) resize(); }).observe(field);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) tryFirst(); schedule(); }).observe(field);
  document.addEventListener('visibilitychange', schedule);
  const retheme = () => { readTok(); if (active) { drawSheet(); render(); } };
  new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', retheme);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (active) { drawSheet(); render(); } });
  Motion.subscribe(on => setPaused(!on));

  setZ();
  for (let i = 0; i < NP; i++) spawn(i);
  oBc.textContent = Phys.criticalImpact(st.rs).toFixed(2);
  setPaused(paused);

  return {
    setActive(on) {
      active = on;
      if (on) { resize(); schedule(); tryFirst(); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    },
    firstLight() { if (!Motion.on) return; firstPending = true; tryFirst(); },
    get frames() { return frame; }
  };
})();

/* ---------------- the binary: two black holes and their gravitational waves ---------------- */
const Bin = (() => {
  const field = document.getElementById('bin-field');
  if (!field) return { setActive() {}, get frames() { return 0; } };
  const cS = document.getElementById('bin-sheet'), cT = document.getElementById('bin-trace');
  const xS = cS.getContext('2d'), xT = cT.getContext('2d');
  const rIn = document.getElementById('bin-r'), mIn = document.getElementById('bin-m');
  const rOut = document.getElementById('bin-r-out'), mOut = document.getElementById('bin-m-out');
  const oT = document.getElementById('b-T'), oF = document.getElementById('b-f'), oTau = document.getElementById('b-tau');
  const runBtn = document.getElementById('bin-run');

  // Units: G = c = 1 with masses in units of 100 Msun, so a length unit is 147.66 km and a time unit 0.49255 ms
  const KM = 147.6625, MS = 0.4925491, MSUN = 100;
  const ELEV = 33 * Math.PI / 180, CE = Math.cos(ELEV), SE = Math.sin(ELEV), DIST = 27, RDOM = 15.5;
  const DEPTH = 6.5;     // sheet depth per unit of potential
  const CW = 0.045;      // ripple speed on the sheet (light is 1), slowed so that several wavelengths fit
  const SIM = 46;        // time units per second on screen
  const WAVE = 0.85;     // ripple height near the orbit at the strongest setting
  const WIN = 4 * SIM;   // the trace shows the last four seconds
  const HMAX = 0.5 * 0.5 / (2 * 450 / KM);   // μM/a at the strongest setting (50 Msun each, 450 km)
  const H = Phys.makeHistory(900, 0.5);       // 450 time units: enough for the sheet's edge and the trace
  const st = { R: 0, m: 0, om: 0, q: 0 };
  let W = 1, Hh = 1, dpr = 1, f = 1, cx = 0, cy = 0, TW = 1, TH = 1, tok = null, coarse = false;
  let active = false, visible = false, paused = !Motion.on, raf = 0, last = 0, frame = 0;
  const P = [0, 0, 0], O = [0, 0];
  let h1x = 0, h1y = 0, h2x = 0, h2y = 0, rh = 0, potRim = 0;

  function readTok() {
    const cs = getComputedStyle(root), g = n => cs.getPropertyValue(n).trim() || '#888888';
    tok = { grid: g('--grid'), light: g('--light'), void: g('--void'), ink: g('--ink'), bg: g('--bg') };
    const [r, gg, b] = hexRgb(tok.bg);
    tok.dark = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255 < 0.45;
  }
  function setParams() {
    st.R = +rIn.value / KM; st.m = +mIn.value / MSUN;
    const a = 2 * st.R;
    st.om = Phys.binaryOmega(st.m, st.m, a);
    st.q = (st.m * st.m / a) / HMAX;          // strain relative to the strongest setting (μM = m² for equal masses)
    rh = 2 * st.m; potRim = -2 * st.m / RDOM;
    rOut.textContent = rIn.value + ' km'; rIn.setAttribute('aria-valuetext', rIn.value + ' kilometres');
    mOut.textContent = mIn.value + ' M☉'; mIn.setAttribute('aria-valuetext', mIn.value + ' solar masses');
    const T = TAU / st.om * MS, fq = st.om / Math.PI / MS * 1000, tau = Phys.mergerTime(st.m, st.m, a) * MS;
    oT.textContent = Math.round(T) + ' ms';
    oF.textContent = Math.round(fq) + ' Hz';
    oTau.textContent = tau < 1000 ? Math.round(tau) + ' ms' : (tau / 1000).toFixed(1) + ' s';
  }
  function place() {
    const ph = H.phase, c = Math.cos(ph), s = Math.sin(ph);
    h1x = st.R * c; h1y = st.R * s; h2x = -h1x; h2y = -h1y;
  }
  function proj(X, Y, Z, o) {
    const yc = Z * CE + Y * SE, zc = DIST + Y * CE - Z * SE, s = f / zc;
    o[0] = cx + X * s; o[1] = cy - yc * s; o[2] = s; return o;
  }
  // depth of the sheet: the pair's potential, with the rim at zero
  const well = (X, Y) => DEPTH * (Phys.binaryPotential(X, Y, h1x, h1y, st.m, h2x, h2y, st.m) - potRim);
  // the ripple at (X, Y): the in-plane strain of the orbit as it was r/c ago, scaled for display
  const ramp = r => sstep((r - st.R - 0.6) / 2.2);
  const fall = r => (st.R + 2) / Math.max(r, st.R + 2);
  function ripple(X, Y, r) {
    const rp = ramp(r);
    if (rp <= 0) return 0;
    Phys.historyAt(H, r / CW, O);
    return height(O[1]) * rp * fall(r) * Phys.planeStrain(2, O[0], Math.atan2(Y, X));   // −cos 2(Φ − φ)
  }
  // Display height: grows with the strain, but never so steep (for the wavelength) that the sheet folds over
  const height = q => Math.min(WAVE * Math.sqrt(q), 0.16 * Math.PI * CW / st.om);
  // The two crest lines, where h₊ peaks: φ = Φ(t − r/c) − π/2 − nπ. Brighter where the wave is stronger.
  const CR = new Float32Array(2 * 400), CA = new Float32Array(400);
  function drawCrests(c) {
    const r0 = st.R + 0.6, dr = coarse ? 0.12 : 0.08;
    for (let arm = 0; arm < 2; arm++) {
      let n = 0;
      for (let r = r0; r <= RDOM && n < 400; r += dr, n++) {
        Phys.historyAt(H, r / CW, O);
        const s = Math.sqrt(O[1]) * ramp(r), phi = O[0] - Math.PI / 2 - arm * Math.PI;
        const X = r * Math.cos(phi), Y = r * Math.sin(phi);
        proj(X, Y, well(X, Y) + height(O[1]) * ramp(r) * fall(r), P);
        CR[2 * n] = P[0]; CR[2 * n + 1] = P[1]; CA[n] = s * Math.sqrt(fall(r));
      }
      for (const [lw, k] of [[3.2, 0.16], [1.1, 0.9]]) {     // a soft glow, then the line
        c.lineWidth = lw;
        for (let j = 1; j < n; j++) {
          c.strokeStyle = rgba(tok.light, (tok.dark ? 1 : 1.1) * k * (0.3 + 0.7 * 0.5 * (CA[j] + CA[j - 1])));
          c.beginPath(); c.moveTo(CR[2 * j - 2], CR[2 * j - 1]); c.lineTo(CR[2 * j], CR[2 * j + 1]); c.stroke();
        }
      }
    }
  }

  /* ----- drawing ----- */
  function gridLine(c, k, vertical, sp) {
    let pen = false, t = -RDOM;
    while (t <= RDOM) {
      const X = vertical ? k : t, Y = vertical ? t : k, r = Math.hypot(X, Y);
      const dn = Math.min(Math.hypot(X - h1x, Y - h1y), Math.hypot(X - h2x, Y - h2y));
      let step;
      if (r > RDOM || dn < rh * 1.003) { pen = false; step = 0.1; }
      else {
        const w = ripple(X, Y, r);
        proj(X, Y, well(X, Y) + w, P);
        if (pen) c.lineTo(P[0], P[1]); else { c.moveTo(P[0], P[1]); pen = true; }
        step = Math.min(sp, 0.012 + 0.06 * (dn - rh));
      }
      t += step;
    }
  }
  function horizon(c, hx, hy) {
    c.beginPath();
    for (let i = 0; i <= 72; i++) {
      const an = i / 72 * TAU, X = hx + rh * 1.004 * Math.cos(an), Y = hy + rh * 1.004 * Math.sin(an);
      proj(X, Y, well(X, Y), P); i ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]);
    }
    c.closePath();
    c.fillStyle = tok.void; c.fill(); c.lineWidth = 0.8; c.strokeStyle = rgba(tok.ink, 0.3); c.stroke();
  }
  function drawSheet() {
    const c = xS;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, Hh);
    place();
    const gap = coarse ? 1 : 0.8, sp = coarse ? 0.2 : 0.14, n = Math.floor(16 / gap);
    c.lineWidth = 0.8; c.strokeStyle = rgba(tok.grid, tok.dark ? 0.28 : 0.34);
    c.beginPath();
    for (let i = -n; i <= n; i++) { gridLine(c, i * gap, true, sp); gridLine(c, i * gap, false, sp); }
    c.stroke();
    drawCrests(c);
    // the nearer hole is drawn last
    if (h1y < h2y) { horizon(c, h2x, h2y); horizon(c, h1x, h1y); } else { horizon(c, h1x, h1y); horizon(c, h2x, h2y); }
  }
  function drawTrace() {
    const c = xT; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, TW, TH);
    const L = 10, R = TW - 10, mid = TH / 2, half = TH / 2 - 14;
    c.lineWidth = 1; c.strokeStyle = rgba(tok.ink, 0.14);
    c.beginPath(); c.moveTo(L, mid); c.lineTo(R, mid); c.stroke();
    // h₊ for an observer on the orbit's axis, relative to the strongest setting
    c.lineWidth = 1.2; c.strokeStyle = rgba(tok.light, tok.dark ? 0.9 : 1); c.beginPath();
    const N = Math.max(60, Math.round((R - L) / 1.5));
    for (let i = 0; i <= N; i++) {
      Phys.historyAt(H, (1 - i / N) * WIN, O);
      const y = mid - half * Phys.quadrupoleStrain(0.5, 0.5, 1, 1, 0, O[0], P)[0] * O[1];   // h₀ = 1 here
      const x = L + (R - L) * i / N;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }
  function render() { if (!tok) readTok(); drawSheet(); drawTrace(); }

  /* ----- loop ----- */
  function tick(now) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60; last = now;
    if (!paused) Phys.historyAdvance(H, dt * SIM, st.om, st.q);
    render(); frame++;
    schedule();
  }
  function schedule() {
    if (raf) return;
    if (!active || !visible || document.hidden || paused) { last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  function setPaused(p) { paused = p; runBtn.textContent = p ? 'Resume' : 'Pause'; if (!p) schedule(); }
  function resize() {
    const r = field.getBoundingClientRect();
    if (r.width < 2) return;
    W = r.width; Hh = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    cS.width = Math.round(W * dpr); cS.height = Math.round(Hh * dpr);
    f = Math.min(W / 20, Hh / 13) * DIST; cx = W / 2; cy = Hh * 0.42;
    coarse = W < 520;
    const tr = cT.getBoundingClientRect(); TW = Math.max(1, tr.width); TH = Math.max(1, tr.height);
    cT.width = Math.round(TW * dpr); cT.height = Math.round(TH * dpr);
    render();
  }
  function onInput() {
    setParams();
    // while running, the change spreads outward with the waves; when still, show the new steady pattern at once
    if (paused || !raf) Phys.historyReset(H, H.phase, st.om, st.q);
    if (active && !raf) render();
  }

  rIn.addEventListener('input', onInput);
  mIn.addEventListener('input', onInput);
  runBtn.addEventListener('click', () => setPaused(!paused));
  new ResizeObserver(() => { if (active) resize(); }).observe(field);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; schedule(); }).observe(field);
  document.addEventListener('visibilitychange', schedule);
  const retheme = () => { readTok(); if (active) render(); };
  new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', retheme);
  Motion.subscribe(on => setPaused(!on));

  setParams();
  Phys.historyReset(H, 0.6, st.om, st.q);
  setPaused(paused);

  return {
    setActive(on) {
      active = on;
      if (on) { resize(); schedule(); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    },
    get frames() { return frame; }
  };
})();

/* ---------------- research figure: three regimes (schematic) ---------------- */
(function regimes() {
  const svg = document.getElementById('regimes'); if (!svg) return;
  const L = 46, R = 540, T = 40, B = 194;
  const x = e => L + e * (R - L), y = v => B - v / 0.9 * (B - T);
  const risk = e => 0.17 + 0.62 * Math.exp(-7 * e) + 0.9 * Math.max(0, e - 0.5) ** 2;
  let d = '', best = 0, bv = 9;
  for (let i = 0; i <= 160; i++) { const e = i / 160, v = risk(e); if (v < bv) { bv = v; best = e; } d += (i ? 'L' : 'M') + x(e).toFixed(1) + ' ' + y(v).toFixed(1); }
  const bands = [[0, 0.2, 'BRITTLE', false], [0.2, 0.64, 'ROBUST', true], [0.64, 1, 'OVER-SMOOTHED', false]];
  let s = '';
  for (const [a, b, t, hi] of bands) {
    if (hi) s += `<rect class="band" x="${x(a)}" y="${T - 6}" width="${x(b) - x(a)}" height="${B - T + 6}"/>`;
    s += `<text x="${(x(a) + x(b)) / 2}" y="${T - 16}" text-anchor="middle">${t}</text>`;
  }
  for (const e of [0.2, 0.64]) s += `<line class="tick" x1="${x(e)}" y1="${T - 6}" x2="${x(e)}" y2="${B}"/>`;
  s += `<path class="axis" d="M${L} ${T - 6} L${L} ${B} L${R} ${B}"/>`;
  s += `<path class="curve" d="${d}"/>`;
  s += `<circle class="dot" cx="${x(best)}" cy="${y(bv)}" r="3.5"/>`;
  s += `<text class="sym" x="${x(best)}" y="${y(bv) - 12}" text-anchor="middle">ε*</text>`;
  s += `<text x="${R}" y="${B + 22}" text-anchor="end">TRAINING NOISE ε →</text>`;
  s += `<text x="${L - 14}" y="${(T + B) / 2}" text-anchor="middle" transform="rotate(-90 ${L - 14} ${(T + B) / 2})">TEST RISK</text>`;
  svg.innerHTML = s;
})();

/* ---------------- notes filter ---------------- */
(function notes() {
  const items = [...document.querySelectorAll('#catalog .entry')];
  const chips = [...document.querySelectorAll('.chip')];
  for (const ch of chips) {
    const v = ch.dataset.filter;
    ch.querySelector('span').textContent = v === 'All' ? items.length : items.filter(li => li.dataset.subject === v).length;
    ch.addEventListener('click', () => {
      for (const c of chips) c.setAttribute('aria-pressed', String(c === ch));
      for (const li of items) li.hidden = v !== 'All' && li.dataset.subject !== v;
    });
  }
})();

/* ---------------- pages ---------------- */
const PAGES = {
  home: 'Hieu Nguyen · The Physics of Learning',
  research: 'Research · Hieu Nguyen',
  notes: 'Notes · Hieu Nguyen',
  about: 'About · Hieu Nguyen'
};
const links = [...document.querySelectorAll('[data-nav]')];
function route(fromUser) {
  let id = location.hash.slice(1);
  if (!(id in PAGES)) {
    if (id && document.getElementById(id)) return;   // an in-page anchor, not a page
    id = 'home';
  }
  root.dataset.page = id;
  document.title = PAGES[id];
  for (const a of links) { if (a.dataset.nav === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  Obs.setActive(id === 'home');
  Bin.setActive(id === 'home');
  Cosmos.setPage(id === 'home');
  if (fromUser) {
    window.scrollTo(0, 0);
    const h = document.getElementById('h-' + id);
    if (h) h.focus({ preventScroll: true });   // keyboard and screen-reader users land on the new page's heading
  }
}
addEventListener('hashchange', () => route(true));
route(false);

document.querySelector('.skip-link').addEventListener('click', e => {
  e.preventDefault();
  const main = document.getElementById('main');
  main.focus({ preventScroll: true }); main.scrollIntoView();
});
document.getElementById('replay').addEventListener('click', () => { window.scrollTo(0, 0); Cosmos.playIntro(); });

if (root.classList.contains('intro-on')) Cosmos.playIntro(); else Cosmos.rest();
Obs.firstLight();
// read by the browser tests (tests/site.test.mjs)
window.__site = { get particles() { return Cosmos.active; }, get frames() { return Cosmos.frames; }, get hole() { return Cosmos.hole; }, get obsFrames() { return Obs.frames; }, get binFrames() { return Bin.frames; } };
})();
