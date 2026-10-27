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

/* ------------------------------------------------------- binary black holes */

// Two point masses under Newtonian gravity, integrated directly (independent of the formulas being tested)
function twoBody(m1, m2, a) {
  const M = m1 + m2, w = P.binaryOmega(m1, m2, a);
  return { m1, m2, x1: [m2 / M * a, 0], x2: [-m1 / M * a, 0], v1: [0, m2 / M * a * w], v2: [0, -m1 / M * a * w] };
}
function accel(s) {
  const dx = s.x2[0] - s.x1[0], dy = s.x2[1] - s.x1[1], d3 = Math.pow(dx * dx + dy * dy, 1.5);
  return [[s.m2 * dx / d3, s.m2 * dy / d3], [-s.m1 * dx / d3, -s.m1 * dy / d3]];
}
function leap(s, h) {
  let [a1, a2] = accel(s);
  for (let k = 0; k < 2; k++) { s.v1[k] += 0.5 * h * a1[k]; s.v2[k] += 0.5 * h * a2[k]; s.x1[k] += h * s.v1[k]; s.x2[k] += h * s.v2[k]; }
  [a1, a2] = accel(s);
  for (let k = 0; k < 2; k++) { s.v1[k] += 0.5 * h * a1[k]; s.v2[k] += 0.5 * h * a2[k]; }
}

test('binary: the pair keeps a circular orbit with the Kepler period', () => {
  for (const [m1, m2, a] of [[0.35, 0.35, 6.2], [0.5, 0.2, 9], [0.2, 0.2, 10.8]]) {
    const s = twoBody(m1, m2, a), T = 2 * Math.PI / P.binaryOmega(m1, m2, a), h = T / 20000;
    let ang = 0, prev = 0, t = 0, d = 0, dmax = 0;
    while (ang < 2 * Math.PI) {
      leap(s, h); t += h;
      const th = Math.atan2(s.x1[1] - s.x2[1], s.x1[0] - s.x2[0]);
      d = th - prev; if (d < -Math.PI) d += 2 * Math.PI; ang += d; prev = th;
      dmax = Math.max(dmax, Math.abs(Math.hypot(s.x1[0] - s.x2[0], s.x1[1] - s.x2[1]) - a));
    }
    t -= h * (ang - 2 * Math.PI) / d;   // back up to the moment the angle reached a full turn
    close(t, T, 1e-6, `period for m1=${m1}, m2=${m2}, a=${a}`);
    assert.ok(dmax < 1e-6 * a, `separation drifted by ${dmax}`);
  }
});

test('binary: the strain formula matches the quadrupole moment of the actual orbit', () => {
  // h_ij = (2/r) d²I_ij/dt², projected onto the polarisation axes p and q of an observer along n
  const r = 1000;
  for (const [m1, m2, a] of [[0.35, 0.35, 6.2], [0.5, 0.2, 9]]) {
    const s = twoBody(m1, m2, a), T = 2 * Math.PI / P.binaryOmega(m1, m2, a);
    for (let step = 0; step < 7; step++) {
      for (let k = 0; k < 900; k++) leap(s, T / 6000);   // move somewhere new along the orbit
      const [a1, a2] = accel(s), I2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const [m, x, v, ac] of [[s.m1, s.x1, s.v1, a1], [s.m2, s.x2, s.v2, a2]])
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) I2[i][j] += m * (2 * v[i] * v[j] + ac[i] * x[j] + x[i] * ac[j]);
      const quad = (u, w) => { let q = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) q += u[i] * I2[i][j] * w[j]; return q; };
      const phase = Math.atan2(s.x1[1] - s.x2[1], s.x1[0] - s.x2[0]);
      for (const iota of [0, 0.6, Math.PI / 2, 2.2]) {
        const p = [Math.cos(iota), 0, -Math.sin(iota)], q = [0, 1, 0];
        const hp = (quad(p, p) - quad(q, q)) / r, hx = 2 * quad(p, q) / r;
        const [fp, fx] = P.quadrupoleStrain(m1, m2, a, r, iota, phase);
        const h0 = P.strainAmplitude(m1, m2, a, r);
        assert.ok(Math.abs(fp - hp) < 1e-6 * h0 && Math.abs(fx - hx) < 1e-6 * h0, `ι=${iota}: formula (${fp}, ${fx}) vs orbit (${hp}, ${hx})`);
      }
      for (const phi of [0, 0.9, 2.5, 4]) {   // observers in the orbital plane, as drawn on the sheet
        const p = [0, 0, -1], q = [-Math.sin(phi), Math.cos(phi), 0];
        const hp = (quad(p, p) - quad(q, q)) / r;
        assert.ok(Math.abs(P.planeStrain(P.strainAmplitude(m1, m2, a, r), phase, phi) - hp) < 1e-6 * P.strainAmplitude(m1, m2, a, r), `in-plane strain at φ=${phi}`);
      }
    }
  }
});

test('binary: the waves have twice the orbital frequency and a quadrupole pattern', () => {
  const h0 = 1;
  for (const ph of [0.1, 1.3, 2.9]) {
    close(P.planeStrain(h0, ph + Math.PI, 0.4), P.planeStrain(h0, ph, 0.4), 1e-12, 'half an orbit repeats the wave');
    close(P.planeStrain(h0, ph, 0.4 + Math.PI), P.planeStrain(h0, ph, 0.4), 1e-12, 'opposite directions see the same strain');
    close(P.planeStrain(h0, ph, 0.4 + Math.PI / 2), -P.planeStrain(h0, ph, 0.4), 1e-12, 'directions 90° apart see opposite strain');
  }
  // the chirp-mass form, and the right size for LIGO's first detection (36 + 29 Msun at 410 Mpc, waves at 100 Hz)
  for (const [m1, m2, a] of [[0.35, 0.35, 6], [0.5, 0.2, 9]])
    close(P.strainAmplitude(m1, m2, a, 50), 4 * Math.pow(P.chirpMass(m1, m2), 5 / 3) * Math.pow(P.binaryOmega(m1, m2, a), 2 / 3) / 50, 1e-12, 'chirp-mass form');
  const MSUN = 1476.625, M = 65 * MSUN, w = Math.PI * 100 / 299792458;   // metres, and Ω in 1/m
  const a = Math.cbrt(M / (w * w)), h = P.strainAmplitude(36 * MSUN, 29 * MSUN, a, 410 * 3.0857e22);
  assert.ok(h > 5e-22 && h < 3e-21, `GW150914-like strain ${h}`);
  assert.ok(a > 3e5 && a < 6e5, `separation ${a} m`);
});

test('binary: radiated power matches the quadrupole formula, and the orbit shrinks to merge in the Peters time', () => {
  // P = (1/5) <d³Q_ij/dt³ d³Q_ij/dt³>, with Q the traceless quadrupole of the orbit, differentiated numerically
  for (const [m1, m2, a] of [[0.35, 0.35, 6.2], [0.5, 0.2, 9]]) {
    const M = m1 + m2, w = P.binaryOmega(m1, m2, a);
    const Q = t => {
      const c = Math.cos(w * t), s = Math.sin(w * t), I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const [m, R] of [[m1, m2 / M * a], [m2, -m1 / M * a]]) {
        const x = [R * c, R * s, 0];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += m * x[i] * x[j];
      }
      const tr = (I[0][0] + I[1][1] + I[2][2]) / 3; for (let i = 0; i < 3; i++) I[i][i] -= tr;
      return I;
    };
    const h = 0.005 / w, t = 0.37 / w, f = [Q(t + 2 * h), Q(t + h), Q(t - h), Q(t - 2 * h)];
    let sum = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const d3 = (f[0][i][j] - 2 * f[1][i][j] + 2 * f[2][i][j] - f[3][i][j]) / (2 * h * h * h); sum += d3 * d3; }
    close(sum / 5, P.gwPower(m1, m2, a), 1e-4, 'quadrupole power');
    // the orbit loses exactly that energy: E = −m1 m2 / 2a
    close(-(m1 * m2 / (2 * a * a)) * P.shrinkRate(m1, m2, a), P.gwPower(m1, m2, a), 1e-12, 'energy balance');
    // integrate da/dt down to a/1000 and compare with the merger time
    let A = a, T = 0; const dt = P.mergerTime(m1, m2, a) / 4e5;
    while (A > a / 1000) {
      const k1 = P.shrinkRate(m1, m2, A), k2 = P.shrinkRate(m1, m2, A + 0.5 * dt * k1), k3 = P.shrinkRate(m1, m2, A + 0.5 * dt * k2), k4 = P.shrinkRate(m1, m2, A + dt * k3);
      const dA = dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      if (A + dA < a / 1000) { T += dt * (A - a / 1000) / -dA; A = a / 1000; break; }
      A += dA; T += dt;
    }
    close(T, P.mergerTime(m1, m2, a) - P.mergerTime(m1, m2, a / 1000), 1e-3, 'merger time');
  }
});

test('binary: the waves carry the orbit as it was, and a change spreads outward at the wave speed', () => {
  const H = P.makeHistory(800, 0.5), w1 = 0.05, w2 = 0.02;
  P.historyReset(H, 0.3, w1, 1);
  for (let k = 0; k < 5000; k++) P.historyAdvance(H, 0.77, w1, 1);   // wraps the buffer many times
  const o = [0, 0];
  for (const lag of [0, 0.2, 13.1, 250, 399, 600]) {
    P.historyAt(H, lag, o);
    close(o[0], H.phase - w1 * lag, 1e-9, `steady phase at lag ${lag}`);
  }
  for (let k = 0; k < 50; k++) P.historyAdvance(H, 0.77, w2, 0.4);    // the orbit widens: slower, weaker
  const since = 50 * 0.77, freq = lag => { const a = P.historyAt(H, lag, [0, 0])[0], b = P.historyAt(H, lag + 1, [0, 0])[0]; return a - b; };
  close(freq(5), w2, 1e-6, 'recent waves have the new frequency');
  close(freq(since + 20), w1, 1e-6, 'older waves still have the old one');
  assert.equal(P.historyAt(H, 5, o)[1], 0.4); assert.equal(P.historyAt(H, since + 20, o)[1], 1);
  const before = P.historyAt(H, since - 0.01, [0, 0])[0], after = P.historyAt(H, since + 0.01, [0, 0])[0];
  assert.ok(Math.abs(before - after) < 0.01, 'the phase is continuous across the change');
});
