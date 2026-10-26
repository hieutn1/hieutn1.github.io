// Checks that the animations obey the physics they claim to show.
// Run with: npm run test:physics
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../assets/js/physics.js');

const close = (got, want, rel, what) =>
  assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what}: got ${got}, expected ${want} within ${rel * 100}%`);

// Seeded Gaussian generator, so the stochastic tests are reproducible.
function gaussian(seed) {
  let a = seed >>> 0, spare = null;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = uni();
    const m = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * uni();
    spare = m * Math.sin(th); return m * Math.cos(th);
  };
}

// Trace a light ray exactly as the observatory draws one (same step sizes and stopping rules).
function traceLikePage(x, y, u, v, rs) {
  const s = { x, y, u, v }, L = x * v - y * u, k = P.nullK(rs, L);
  for (let n = 0; n < 20000; n++) {
    const r = Math.hypot(s.x, s.y);
    if (r < rs * 1.01) return { fate: 'captured', s };
    if (r > 18 && s.x * s.u + s.y * s.v > 0) return { fate: 'escaped', s };
    P.nullStep(s, k, P.nullStepSize(r, rs, Math.hypot(s.u, s.v), 0.002, 0.15));
  }
  return { fate: 'orbiting', s };
}

/* ------------------------------------------------------------------ light */

test('light aimed inside the critical impact parameter is captured; outside, it escapes', () => {
  for (const rs of [0.15, 0.6, 1.2]) {
    const bc = P.criticalImpact(rs);
    assert.equal(traceLikePage(-17, 0.98 * bc, 1, 0, rs).fate, 'captured', `rs=${rs}, b=0.98 b_c`);
    assert.equal(traceLikePage(-17, 1.02 * bc, 1, 0, rs).fate, 'escaped', `rs=${rs}, b=1.02 b_c`);
  }
});

test('the drawn geodesic (b = 1.06 b_c) escapes after swinging around the hole', () => {
  const rs = 0.6, { fate, s } = traceLikePage(-17, -1.06 * P.criticalImpact(rs), 1, 0, rs);
  assert.equal(fate, 'escaped');
  const deflection = Math.abs(Math.atan2(s.v, s.u));
  assert.ok(deflection > Math.PI / 2, `deflection ${deflection.toFixed(2)} rad should exceed 90°`);
});

test('energy and angular momentum are conserved along a null geodesic', () => {
  const rs = 0.6, s = { x: -17, y: 4 * rs, u: 1, v: 0 };
  const L0 = s.x * s.v - s.y * s.u, E0 = P.nullEnergy2(s, rs), k = P.nullK(rs, L0);
  for (let n = 0; n < 4000; n++) {
    const r = Math.hypot(s.x, s.y);
    if (r > 18 && s.x * s.u + s.y * s.v > 0) break;
    P.nullStep(s, k, P.nullStepSize(r, rs, Math.hypot(s.u, s.v), 0.002, 0.15));
  }
  close(s.x * s.v - s.y * s.u, L0, 1e-9, 'L');
  close(P.nullEnergy2(s, rs), E0, 1e-6, 'E²');
});

test('weak-field deflection matches 2r_s/b + (15π/16)(r_s/b)²', () => {
  const rs = 1;
  for (const b of [100, 300, 1000]) {
    const X = 2000 * b, s = { x: -X, y: b, u: 1, v: 0 }, k = P.nullK(rs, -b);
    while (s.x < X) P.nullStep(s, k, 0.01 * Math.hypot(s.x, s.y));
    const alpha = -Math.atan2(s.v, s.u);
    close(alpha, (2 * rs) / b + ((15 * Math.PI) / 16) * (rs / b) ** 2, 2e-3, `deflection at b=${b} r_s`);
  }
});

test('light is delayed near the hole: radial travel time includes the Shapiro term', () => {
  const rs = 1, r1 = 20, r2 = 2, s = { x: r1, y: 0, u: -1, v: 0 };
  let t = 0;
  while (s.x > r2) {
    const x0 = s.x, y0 = s.y, h = Math.min(P.nullStepSize(s.x, rs, 1, 0.0015, 0.12), s.x - r2);
    P.nullStep(s, 0, h);
    t += P.nullDt(x0, y0, s.x, s.y, rs);
  }
  close(t, r1 - r2 + rs * Math.log((r1 - rs) / (r2 - rs)), 2e-3, 'coordinate travel time');
});

test('the photon sphere sits at 1.5 r_s and its impact parameter is the shadow radius', () => {
  const rs = 1, V = r => (1 - rs / r) / (r * r);   // effective potential for light
  let best = 0, rBest = 0;
  for (let r = 1.01; r < 5; r += 1e-4) if (V(r) > best) { best = V(r); rBest = r; }
  close(rBest, P.photonSphere(rs), 1e-3, 'peak of the light potential');
  close(1 / Math.sqrt(best), P.criticalImpact(rs), 1e-6, 'b_c = 1/√V_max');
});

test("Flamm's paraboloid has the radial geometry of the Schwarzschild slice", () => {
  const rs = 0.6;
  for (const r of [0.7, 1, 2, 5, 12]) {
    const e = 1e-6, dz = (P.flamm(r + e, rs) - P.flamm(r - e, rs)) / (2 * e);
    close(1 + dz * dz, 1 / (1 - rs / r), 1e-5, `g_rr at r=${r}`);
  }
});

/* ----------------------------------------------------------------- matter */

const orbit = (r, speedFactor, radialKick = 0) => {
  const M = 0.3, v = P.circularSpeed(r, M) * speedFactor;
  return { M, e: { x: [r], y: [0], u: [radialKick], v: [v] } };
};

test('circular orbits stay circular', () => {
  const { M, e } = orbit(3, 1);
  let rmin = Infinity, rmax = 0;
  for (let n = 0; n < 2500; n++) {   // about 10 orbits at the page's step (0.2 proper time per frame)
    assert.ok(P.timelikeStep(e, 0, 0.2, M, 0, 0, 2 * M * 1.04, Math.random));
    const r = Math.hypot(e.x[0], e.y[0]); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
  }
  assert.ok(rmax / rmin < 1.002, `radius varied by ${((rmax / rmin - 1) * 100).toFixed(2)}%`);
});

test('energy and angular momentum are conserved on an eccentric timelike orbit', () => {
  const { M, e } = orbit(4, 1.1);
  const E0 = P.timelikeEnergy2(e.x[0], e.y[0], e.u[0], e.v[0], M), L0 = e.x[0] * e.v[0] - e.y[0] * e.u[0];
  for (let n = 0; n < 4000; n++) assert.ok(P.timelikeStep(e, 0, 0.2, M, 0, 0, 0.62, Math.random));
  close(e.x[0] * e.v[0] - e.y[0] * e.u[0], L0, 1e-9, 'L');
  close(P.timelikeEnergy2(e.x[0], e.y[0], e.u[0], e.v[0], M), E0, 2e-3, 'E²');
});

test('orbits are stable outside 6M and unstable inside it', () => {
  const run = (rOverM, kick) => {
    const M = 0.3, { e } = orbit(rOverM * M, 1, -kick * P.circularSpeed(rOverM * M, M));
    for (let n = 0; n < 6000; n++) if (!P.timelikeStep(e, 0, 0.2, M, 0, 0, 2 * M * 1.04, Math.random)) return 'captured';
    return Math.hypot(e.x[0], e.y[0]) / (rOverM * M);
  };
  assert.equal(run(5.4, 0.005), 'captured', 'r = 5.4M');
  const ratio = run(6.8, 0.005);
  assert.ok(typeof ratio === 'number' && ratio > 0.9 && ratio < 1.1, `r = 6.8M drifted to ${ratio}`);
});

test('perihelion precession matches an independent integration of the GR orbit equation', () => {
  const M = 0.3, rp = 12 * M, v = 1.08 * P.circularSpeed(rp, M), L = rp * v;
  // Reference: u'' + u = M/L² + 3Mu² integrated in φ with small RK4 steps, periapsis to periapsis.
  let u = 1 / rp, w = 0, phi = 0;
  const f = (u) => M / (L * L) - u + 3 * M * u * u, dphi = 1e-4;
  let started = false;
  for (;;) {
    const k1u = w, k1w = f(u), k2u = w + 0.5 * dphi * k1w, k2w = f(u + 0.5 * dphi * k1u);
    const k3u = w + 0.5 * dphi * k2w, k3w = f(u + 0.5 * dphi * k2u), k4u = w + dphi * k3w, k4w = f(u + dphi * k3u);
    const wPrev = w;
    u += (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u); w += (dphi / 6) * (k1w + 2 * k2w + 2 * k3w + k4w); phi += dphi;
    if (wPrev < 0) started = true;
    if (started && wPrev > 0 && w <= 0) break;   // u is at a maximum again: periapsis
  }
  const expected = phi - 2 * Math.PI;
  // The page's integrator, periapsis to periapsis in proper time.
  const e = { x: [rp], y: [0], u: [0], v: [v] };
  let prev = rp, wentOut = false, falling = false, measured = null, turns = 0, lastAng = 0, prevAng = 0;
  for (let n = 0; n < 200000 && measured === null; n++) {
    P.timelikeStep(e, 0, 0.05, M, 0, 0, 0.62, Math.random);
    const ang = Math.atan2(e.y[0], e.x[0]);
    if (ang < lastAng - Math.PI) turns++;
    lastAng = ang;
    const r = Math.hypot(e.x[0], e.y[0]), unwrapped = ang + 2 * Math.PI * turns;
    if (r > 1.2 * rp) wentOut = true;
    if (wentOut && r < prev) falling = true;
    else if (falling && r > prev) measured = prevAng - 2 * Math.PI;   // the previous sample was the periapsis
    prev = r; prevAng = unwrapped;
  }
  close(measured, expected, 0.02, 'precession per orbit (rad)');   // sampling the periapsis to one step costs <1%
  assert.ok(expected > 0.3, `precession ${expected} rad should be large this close to the hole`);
});

test('the Langevin bath holds the velocity variance at T (fluctuation–dissipation)', () => {
  const N = 3000, gamma = 0.012, sigma = 0.6, T = 0.02 * sigma * sigma;   // the page's γ and T(σ)
  const e = { x: new Float64Array(N).fill(5), y: new Float64Array(N), u: new Float64Array(N), v: new Float64Array(N) };
  const g = gaussian(7);
  for (let n = 0; n < 2500; n++) for (let i = 0; i < N; i++) P.timelikeStep(e, i, 0.2, 0, gamma, T, 0, g);   // 6 relaxation times
  let s = 0; for (let i = 0; i < N; i++) s += e.u[i] * e.u[i] + e.v[i] * e.v[i];
  close(s / (2 * N), T, 0.05, '⟨v²⟩ per component');
});

/* ------------------------------------------------------------------- disk */

const DISK = { GM: P.PW_GM, rcap: 1.15, visc: 0.001, circ: 0.02, zDamp: 0.012, zDampFar: 0.003 };   // the page's values (site.js)
const PURE = { ...DISK, visc: 0, circ: 0, zDamp: 0, zDampFar: 0 };
const diskParticle = (r, factor = 1, radialKick = 0) => {
  const v = P.pwCircularSpeed(r, P.PW_GM) * factor;
  return { x: [r], y: [0], z: [0], vx: [radialKick * v], vy: [v], vz: [0] };
};

test('Paczyński–Wiita: innermost stable orbit at 3 r_s and marginally bound orbit at 2 r_s', () => {
  let best = Infinity, rBest = 0;
  for (let r = 1.5; r < 10; r += 1e-4) { const L = P.pwAngularMomentum(r, P.PW_GM); if (L < best) { best = L; rBest = r; } }
  close(rBest, 3, 1e-3, 'minimum of L(r)');
  const r = 2, E = 0.5 * P.pwCircularSpeed(r, P.PW_GM) ** 2 + P.pwPotential(r, P.PW_GM);
  assert.ok(Math.abs(E) < 1e-12, `energy of the circular orbit at 2 r_s is ${E}`);
});

test('disk orbits conserve angular momentum and energy when dissipation is off', () => {
  const d = diskParticle(6, 1.1);
  const Lz = () => d.x[0] * d.vy[0] - d.y[0] * d.vx[0];
  const E = () => 0.5 * (d.vx[0] ** 2 + d.vy[0] ** 2 + d.vz[0] ** 2) + P.pwPotential(Math.hypot(d.x[0], d.y[0], d.z[0]), P.PW_GM);
  const L0 = Lz(), E0 = E();
  for (let n = 0; n < 3000; n++) assert.ok(P.diskStep(d, 0, 0.4, PURE));
  close(Lz(), L0, 1e-9, 'L_z');
  close(E(), E0, 1e-3, 'E');
});

test('disk orbits are stable outside 3 r_s and plunge inside it', () => {
  const run = (r) => {
    const d = diskParticle(r, 1, -0.005);
    for (let n = 0; n < 3000; n++) if (!P.diskStep(d, 0, 0.4, PURE)) return 'captured';
    return Math.hypot(d.x[0], d.y[0]) / r;
  };
  assert.equal(run(2.7), 'captured', 'r = 2.7 r_s');
  const ratio = run(3.4);
  assert.ok(typeof ratio === 'number' && ratio > 0.9 && ratio < 1.1, `r = 3.4 r_s drifted to ${ratio}`);
});

test('with the disk viscosity on, gas circles several times as it drifts in, then plunges inside 3 r_s', () => {
  const d = diskParticle(8);
  let t = 0, crossed = false, revDisk = 0, revPlunge = 0, last = 0, maxRatio = 0, captured = false;
  while (t < 40000 && !captured) {
    captured = !P.diskStep(d, 0, 0.4, DISK); t += 0.4;
    const r = Math.hypot(d.x[0], d.y[0]), a = Math.atan2(d.y[0], d.x[0]);
    let da = a - last; if (da < -Math.PI) da += 2 * Math.PI; if (da > Math.PI) da -= 2 * Math.PI; last = a;
    if (!crossed && r < 2.95) crossed = true;
    if (crossed) revPlunge += da / (2 * Math.PI); else revDisk += da / (2 * Math.PI);
    if (!crossed && r > 3.3 && t > 20) {
      const vR = (d.x[0] * d.vx[0] + d.y[0] * d.vy[0]) / r, vP = (d.x[0] * d.vy[0] - d.y[0] * d.vx[0]) / r;
      maxRatio = Math.max(maxRatio, Math.abs(vR / vP));
    }
  }
  assert.ok(captured, 'the particle should be accreted');
  assert.ok(revDisk >= 2, `only ${revDisk.toFixed(2)} revolutions while drifting from 8 r_s to the inner edge`);
  assert.ok(maxRatio < 0.12, `radial speed reached ${(maxRatio * 100).toFixed(0)}% of the orbital speed inside the disk`);
  assert.ok(revPlunge < 1, `the plunge took ${revPlunge.toFixed(2)} revolutions`);
});

/* ------------------------------------------------------- lensing, growth */

test('lens images solve the point-mass lens equation', () => {
  for (const [b, d, rs] of [[0.5, 3, 1], [2, 10, 1], [7, 1, 0.3]]) {
    const RE2 = 2 * rs * d;
    for (const th of P.lensImages(b, d, rs)) close(th - RE2 / th, b, 1e-9, `image at θ=${th}`);
  }
  const [tp, tm] = P.lensImages(0, 4, 1);
  close(tp, Math.sqrt(8), 1e-12, 'Einstein ring radius');
  close(-tm, Math.sqrt(8), 1e-12, 'Einstein ring radius (second image)');
});

test('the intro black hole grows slowly at first, then fast', () => {
  const a = 6, g = p => P.growth(p, a);
  assert.equal(g(0), 0); close(g(1), 1, 1e-12, 'final size');
  assert.ok(g(0.5) < 0.06, `half-way size ${g(0.5)}`);
  let prevSlope = 0;
  for (let p = 0.05; p <= 1; p += 0.05) {
    const slope = (g(p) - g(p - 0.05)) / 0.05;
    assert.ok(slope > prevSlope, 'growth should speed up monotonically');
    prevSlope = slope;
  }
});
