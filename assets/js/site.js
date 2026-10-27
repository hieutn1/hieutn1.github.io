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

/* ---------------- the observatory: two black holes spiral together and merge ---------------- */
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
  const CW = 0.05;       // wave speed on the sheet (light is 1), slowed so that several wavelengths fit
  const SIM = 46;        // time units per second of film...
  const WREF = 0.06;     // ...run faster while the orbit is slower than this, so wide orbits don't drag
  const WAVE = 0.85;     // ripple height near the orbit for the strongest starting setting
  const NMIN = 5, NMAX = 7;                    // orbits shown from start to merger
  const HMAX = 0.25 / (2 * 450 / KM);         // μM/a at the strongest start (50 Msun each, 450 km apart from the centre)
  const TRACE_S = 4, TN = 480;                 // the trace: the last four seconds of film
  const H = Phys.makeHistory(1400, 0.5);       // 700 time units of waves: more than the sheet's edge needs
  const P = [0, 0, 0], P2 = [0, 0], O = [0, 0, 0, 0], post = {};
  const TR = new Float32Array(TN);             // strain samples, newest last
  let W = 1, Hh = 1, dpr = 1, f = 1, cx = 0, cy = 0, TW = 1, TH = 1, tok = null, coarse = false;
  let active = false, visible = false, paused = !Motion.on, raf = 0, last = 0, frame = 0;
  // the run
  let B = null, m = 0, a = 0, phase = 0, omega = 0, amp = 0, merged = false, aM = 0, sm = 0, smScreen = 0, still = false, traceClock = 0;
  // the sliders act on the running system: masses ease to their new value, and a moved orbit is held at the new radius
  let mT = 0, aT = 0, holding = false, dragging = false, startKm = 0;
  // where waves leave from: it follows the holes, but moves outward at no more than half the wave speed, so waves never bunch up
  let rsEmit = 0;
  // what is drawn this frame
  let sep = 0, rh = 0, mw = 0, h1x = 0, h1y = 0, h2x = 0, h2y = 0, potRim = 0, bar = 0;

  function readTok() {
    const cs = getComputedStyle(root), g = n => cs.getPropertyValue(n).trim() || '#888888';
    tok = { grid: g('--grid'), light: g('--light'), void: g('--void'), ink: g('--ink'), bg: g('--bg') };
    const [r, gg, b] = hexRgb(tok.bg);
    tok.dark = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255 < 0.45;
  }
  const fmtMs = v => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ms';
  function readouts() {
    if (merged) {   // ringing: the waves are at the remnant's ringdown frequency until it settles
      oT.textContent = oTau.textContent = '—';
      oF.textContent = sm < B.dur + 4 * B.tau ? Math.round(omega / Math.PI / MS * 1000) + ' Hz' : '—';
      return;
    }
    const tau = Math.max(0, Phys.mergerTime(B.m1, B.m2, a) - Phys.mergerTime(B.m1, B.m2, B.am)) * MS;
    oT.textContent = fmtMs(2 * Math.PI / omega * MS);
    oF.textContent = Math.round(omega / Math.PI / MS * 1000) + ' Hz';
    oTau.textContent = tau < 1000 ? fmtMs(tau) : (tau / 1000).toFixed(1) + ' s';
  }
  function syncRadius() {   // the radius slider follows the shrinking orbit
    if (dragging || holding) return;
    if (merged) { rOut.textContent = '—'; rIn.setAttribute('aria-valuetext', 'merged'); return; }
    const km = Math.round(0.5 * a * KM);
    rIn.value = km; rOut.textContent = rIn.value + ' km'; rIn.setAttribute('aria-valuetext', rIn.value + ' kilometres');
  }
  // Film speed: faster while the orbit is wide, and in slow motion around the merger so it can be seen
  function rate() {
    const g = merged ? 0.3 + 0.7 * sstep((sm - B.dur - 2 * B.tau) / (40 * B.M)) : 1 - 0.7 * sstep((1.8 * B.am - a) / (0.8 * B.am));
    return SIM * Math.max(1, WREF / omega) * g;
  }
  const strain = (ph, am) => Phys.quadrupoleStrain(0.5, 0.5, 1, 1, 0, ph, P2)[0] * am;   // face-on h₊, here −am·cos 2Φ
  function label() { runBtn.textContent = merged ? 'Restart' : paused ? 'Resume' : 'Pause'; }
  // pace the rest of the inspiral from where the orbit is now
  function repace() { B = a > Phys.peakSeparation(m, m) * 1.001 ? Phys.pacedBinary(m, m, a, NMIN, NMAX) : Phys.makeBinary(m, m, a, 1); }

  // A pair at the sliders' settings. Fresh: as if it had been orbiting there for a long time.
  // Otherwise (a new pair after a merger) the old waves carry on outward.
  function start(fresh) {
    startKm = +rIn.value; m = mT = +mIn.value / MSUN; a = aT = 2 * startKm / KM;
    holding = false; merged = false; still = false; sm = 0; smScreen = 0;
    repace();
    omega = Phys.binaryOmega(m, m, a); amp = B.mu * B.M / a;
    if (fresh) {
      phase = 0.6; rsEmit = a / 2;
      Phys.historyReset(H, phase, omega, amp / HMAX, rsEmit);
      const peak = B.mu * B.M / B.am, dph = omega * rate() * TRACE_S / TN;
      for (let i = 0; i < TN; i++) TR[i] = strain(phase - (TN - 1 - i) * dph, amp / peak);
      traceClock = 0;
    }
    mOut.textContent = mIn.value + ' M☉'; mIn.setAttribute('aria-valuetext', mIn.value + ' solar masses');
    syncRadius(); readouts(); label();
  }
  function merge() { merged = true; aM = a; sm = 0; smScreen = 0; holding = false; label(); readouts(); syncRadius(); }
  // Apply the sliders at once (when nothing is running, so a still picture shows the new state)
  function settle() {
    m = mT;
    if (!merged) { a = aT; holding = false; repace(); omega = Phys.binaryOmega(m, m, a); amp = B.mu * B.M / a; rsEmit = a / 2; Phys.historyReset(H, phase, omega, amp / HMAX, rsEmit); }
    else B = Phys.makeBinary(m, m, B.a0, B.K0);
    readouts();
    if (active) render();
  }

  // Advance the film by dt seconds
  function advance(dt) {
    const p0 = phase, amp0 = amp, peak = B.mu * B.M / B.am;
    if (mT !== m) {   // the masses ease toward the slider
      m += (mT - m) * (1 - Math.exp(-dt / 0.25));
      if (Math.abs(mT - m) < 1e-3) m = mT;
      B = Phys.makeBinary(m, m, B.a0, B.K0);
      if (m === mT && !merged && !holding) repace();
    }
    const film = rate() * dt;
    let T = film;
    if (!merged) {
      if (holding) {   // the orbit is moved to the new radius, then left to evolve from there
        a += (aT - a) * (1 - Math.exp(-dt / 0.15));
        phase += Phys.binaryOmega(m, m, a) * T; T = 0;
        if (!dragging && Math.abs(aT - a) < 1e-3 * aT) { a = aT; holding = false; if (a > B.am) repace(); }
        if (a <= B.am) merge();
      } else {
        while (T > 0) {
          const w = Phys.binaryOmega(m, m, a), da = Phys.inspiralRate(B, a);
          let h = Math.min(T, 0.02 * TAU / w);
          if (a + da * h <= B.am) h = Math.max(0, (a - B.am) / -da);   // stop at the merger
          const st = { a, phase }; Phys.inspiralStep(B, st, h); a = st.a; phase = st.phase; T -= h;
          if (a <= B.am * 1.0000001 || h < 1e-9) { a = Math.min(a, B.am); merge(); break; }
        }
      }
      if (!merged) { omega = Phys.binaryOmega(m, m, a); amp = B.mu * B.M / a; }
    }
    if (merged) {
      sm += T; smScreen += dt;
      Phys.afterMerger(B, sm, post);
      omega = post.omega; amp = post.amp; phase += omega * T;
      if (sm > B.dur + 6 * B.tau && sm * CW > RDOM + 4) still = true;   // rung down, and the last waves have left the sheet
    }
    const sepNow = merged ? aM * (1 - post.blend) : a;
    rsEmit = Math.min(sepNow / 2, rsEmit + 0.5 * CW * film);
    Phys.historyAdvance(H, film, phase, omega, amp / HMAX, rsEmit);
    // the trace, sampled evenly in film time; it stops once the ringing has died away
    if (!merged || smScreen < 2.5) {
      traceClock += dt;
      const step = TRACE_S / TN;
      for (let n = 0; traceClock >= step && n < TN; n++) {
        traceClock -= step;
        const fr = 1 - traceClock / dt;
        TR.copyWithin(0, 1); TR[TN - 1] = strain(p0 + (phase - p0) * fr, (amp0 + (amp - amp0) * fr) / peak);
      }
    }
  }

  function proj(X, Y, Z, o) {
    const yc = Z * CE + Y * SE, zc = DIST + Y * CE - Z * SE, s = f / zc;
    o[0] = cx + X * s; o[1] = cy - yc * s; o[2] = s; return o;
  }
  function place() {
    const bl = merged ? post.blend : 0;
    sep = merged ? aM * (1 - bl) : a;
    rh = 2 * m + (B.rp - 2 * m) * bl;                 // each horizon grows into the remnant's
    mw = B.M + (B.Mf - B.M) * bl; potRim = -mw / RDOM;
    // the newly formed hole is a spinning bar that rings down: its stretch, lined up with the old pair's axis
    bar = merged ? 0.35 * Math.exp(-sm / B.tau) * bl : 0;
    const c = Math.cos(phase), s = Math.sin(phase);
    h1x = 0.5 * sep * c; h1y = 0.5 * sep * s; h2x = -h1x; h2y = -h1y;
  }
  // depth of the sheet: the pair's potential, plus the near field of the ringing remnant, with the rim at zero
  function well(X, Y) {
    let v = Phys.binaryPotential(X, Y, h1x, h1y, 0.5 * mw, h2x, h2y, 0.5 * mw) - potRim;
    if (bar > 1e-4) {
      const d = Math.max(Math.hypot(X, Y), rh), q = bar * rh;
      v -= mw * q * q * Math.cos(2 * (Math.atan2(Y, X) - phase)) / (d * d * d);
    }
    return DEPTH * v;
  }
  // near the pair the field is not yet a wave; the ripple starts just outside the horizons
  const ramp = r => sstep((r - 0.5 * sep - 0.8 * rh) / 2);
  const fall = r => (0.5 * sep + 2) / Math.max(r, 0.5 * sep + 2);
  // display height for relative strain q at angular frequency w: grows with q, never so steep that the sheet folds
  const height = (q, w) => Math.min(WAVE * Math.sqrt(q), 0.16 * Math.PI * CW / w);
  // The ripple at (X, Y): the wave now at this distance, as it was emitted. The sign of h₊ depends on the choice
  // of polarisation axes; we take the one whose ridges point along the line through the holes.
  function ripple(X, Y, r) {
    const rp = ramp(r);
    if (rp <= 0) return 0;
    Phys.historyFront(H, r, CW, O);
    return height(O[1], O[2]) * rp * fall(r) * -Phys.planeStrain(2, O[0], Math.atan2(Y, X));
  }

  /* ----- drawing ----- */
  function gridLine(c, k, vertical, sp) {
    let pen = false, t = -RDOM;
    while (t <= RDOM) {
      const X = vertical ? k : t, Y = vertical ? t : k, r = Math.hypot(X, Y);
      let dn = Math.min(Math.hypot(X - h1x, Y - h1y), Math.hypot(X - h2x, Y - h2y));
      if (merged && sep < rh) dn = Math.min(dn, r - rh * stretch() * Math.cos(2 * (Math.atan2(Y, X) - phase)));
      let step;
      if (r > RDOM || dn < rh * 1.003) { pen = false; step = 0.1; }
      else {
        proj(X, Y, well(X, Y) + ripple(X, Y, r), P);
        if (pen) c.lineTo(P[0], P[1]); else { c.moveTo(P[0], P[1]); pen = true; }
        step = Math.min(sp, 0.012 + 0.06 * (dn - rh));
      }
      t += step;
    }
  }
  // The two ridges, where the wave peaks: φ = Φ(emitted) − nπ, starting at the holes. Brighter where it is stronger.
  const CMAX = 3000, CR = new Float32Array(2 * CMAX), CA = new Float32Array(CMAX);
  function drawCrests(c) {
    for (let arm = 0; arm < 2; arm++) {
      let n = 0, prev = NaN;
      for (let r = 0.5 * sep + 0.5 * rh; r <= RDOM && n < CMAX; n++) {
        Phys.historyFront(H, r, CW, O);
        const q = O[1], phi = O[0] - arm * Math.PI, X = r * Math.cos(phi), Y = r * Math.sin(phi), rp = ramp(r), fl = fall(r);
        const jump = Math.abs(Math.atan2(Math.sin(phi - prev), Math.cos(phi - prev))) > 0.5; prev = phi;
        proj(X, Y, well(X, Y) + height(q, O[2]) * rp * fl, P);
        CR[2 * n] = P[0]; CR[2 * n + 1] = P[1];
        CA[n] = jump ? -1 : (0.3 + 0.7 * Math.min(1, Math.sqrt(q) * rp * Math.sqrt(fl))) * sstep(q / 0.03) * sstep(rp * 3);
        r += clamp(0.2 * CW / Math.max(O[2], 1e-6), 0.012, 0.08);
      }
      for (const [lw, k] of [[3.2, 0.16], [1.1, 0.9]]) {     // a soft glow, then the line
        c.lineWidth = lw;
        for (let j = 1; j < n; j++) {
          if (CA[j] < 0) continue;   // a break in the wave train: don't join across it
          const al = (tok.dark ? 1 : 1.1) * k * 0.5 * (CA[j] + Math.max(0, CA[j - 1]));
          if (al < 0.01) continue;
          c.strokeStyle = rgba(tok.light, Math.min(1, al));
          c.beginPath(); c.moveTo(CR[2 * j - 2], CR[2 * j - 1]); c.lineTo(CR[2 * j], CR[2 * j + 1]); c.stroke();
        }
      }
    }
  }
  // each horizon is drawn level, at the depth of the sheet at its edge (its own well plus the other hole's)
  function horizonPath(c, hx, hy) {
    const z = DEPTH * (-0.5 * mw / rh - 0.5 * mw / Math.max(sep, rh) - potRim);
    c.beginPath();
    for (let i = 0; i <= 72; i++) {
      const an = i / 72 * TAU;
      proj(hx + rh * 1.004 * Math.cos(an), hy + rh * 1.004 * Math.sin(an), z, P); i ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]);
    }
    c.closePath();
  }
  // the common horizon: one shape, stretched along the pair's axis while it forms and rings, then round
  const stretch = () => Math.min(0.6, bar + 0.5 * sep / rh);
  function remnantPath(c) {
    const e = stretch(), z = DEPTH * (-mw / rh - potRim);
    c.beginPath();
    for (let i = 0; i <= 96; i++) {
      const an = i / 96 * TAU, rr = rh * 1.004 * (1 + e * Math.cos(2 * (an - phase)));
      proj(rr * Math.cos(an), rr * Math.sin(an), z, P); i ? c.lineTo(P[0], P[1]) : c.moveTo(P[0], P[1]);
    }
    c.closePath();
  }
  function drawHoles(c) {
    // outlines first, then the fills, so that overlapping horizons show a single outline
    const order = h1y < h2y ? [[h2x, h2y], [h1x, h1y]] : [[h1x, h1y], [h2x, h2y]];
    const common = merged && sep < rh, pair = !merged || post.blend < 1;
    c.lineWidth = 0.8; c.strokeStyle = rgba(tok.ink, 0.3); c.fillStyle = tok.void;
    if (pair) for (const [x, y] of order) { horizonPath(c, x, y); c.stroke(); }
    if (common) { remnantPath(c); c.stroke(); }
    if (pair) for (const [x, y] of order) { horizonPath(c, x, y); c.fill(); }
    if (common) { remnantPath(c); c.fill(); }
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
    drawHoles(c);
  }
  function drawTrace() {
    const c = xT; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, TW, TH);
    const L = 10, R = TW - 10, mid = TH / 2, half = TH / 2 - 12;
    c.lineWidth = 1; c.strokeStyle = rgba(tok.ink, 0.14);
    c.beginPath(); c.moveTo(L, mid); c.lineTo(R, mid); c.stroke();
    // h₊ for an observer on the orbit's axis, relative to this run's peak
    c.lineWidth = 1.2; c.strokeStyle = rgba(tok.light, tok.dark ? 0.9 : 1); c.beginPath();
    for (let i = 0; i < TN; i++) { const x = L + (R - L) * i / (TN - 1), y = mid - half * TR[i]; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  }
  function render() { if (!tok) readTok(); drawSheet(); drawTrace(); }

  /* ----- loop ----- */
  function tick(now) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60; last = now;
    if (!paused && !still) { advance(dt); if (++frame % 6 === 0) { readouts(); syncRadius(); } }
    render();
    schedule();
  }
  function schedule() {
    if (raf) return;
    if (!active || !visible || document.hidden || paused || still) { last = 0; return; }
    raf = requestAnimationFrame(tick);
  }
  function setPaused(p) { paused = p; label(); if (!p) schedule(); }
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
  const running = () => raf !== 0 || (active && visible && !paused && !still && !document.hidden);
  rIn.addEventListener('input', () => {
    rOut.textContent = rIn.value + ' km'; rIn.setAttribute('aria-valuetext', rIn.value + ' kilometres');
    startKm = +rIn.value;
    if (merged) start(false);                        // a new pair forms; the old waves carry on outward
    else { aT = 2 * startKm / KM; holding = true; }
    if (!running()) settle();
    schedule();
  });
  mIn.addEventListener('input', () => {
    mT = +mIn.value / MSUN;
    mOut.textContent = mIn.value + ' M☉'; mIn.setAttribute('aria-valuetext', mIn.value + ' solar masses');
    if (!running()) settle();
  });
  rIn.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointercancel', () => { dragging = false; });
  runBtn.addEventListener('click', () => {
    if (merged) { rIn.value = startKm; start(true); if (active) render(); schedule(); }
    else setPaused(!paused);
  });
  new ResizeObserver(() => { if (active) resize(); }).observe(field);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; schedule(); }).observe(field);
  document.addEventListener('visibilitychange', schedule);
  const retheme = () => { readTok(); if (active) render(); };
  new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', retheme);
  Motion.subscribe(on => setPaused(!on));

  start(true);
  setPaused(paused);

  return {
    setActive(on) {
      active = on;
      if (on) { resize(); schedule(); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    },
    get frames() { return frame; },
    get state() { return { merged, still, separation: merged ? sep : a, mass: m, orbits: B ? inspiralShown() : 0 }; }
  };
  function inspiralShown() { return Phys.inspiralOrbits(B); }
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
// read by the browser tests (tests/site.test.mjs)
window.__site = { get particles() { return Cosmos.active; }, get frames() { return Cosmos.frames; }, get hole() { return Cosmos.hole; }, get binFrames() { return Bin.frames; }, get bin() { return Bin.state; } };
})();
