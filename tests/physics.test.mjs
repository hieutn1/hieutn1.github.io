// Checks that the animations obey the physics they claim to show.
// Run with: npm run test:physics
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../assets/js/physics.js');

const close = (got, want, rel, what) =>
  assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what}: got ${got}, expected ${want} within ${rel * 100}%`);

/* ------------------------------------------------------------------ shadow */

test("the hero's shadow: light is captured inside b_c = (3√3/2) r_s", () => {
  // a photon with impact parameter b turns around where b² = r³/(r − r_s); the smallest such b is the edge of the shadow
  for (const rs of [0.5, 1, 2]) {
    let best = Infinity;
    for (let r = 1.01 * rs; r < 10 * rs; r += 1e-5 * rs) best = Math.min(best, Math.sqrt(r ** 3 / (r - rs)));
    close(P.criticalImpact(rs), best, 1e-6, `b_c for r_s = ${rs}`);
  }
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
  const H = P.makeHistory(800, 0.5), w1 = 0.05, w2 = 0.02, step = (w, amp, rs) => P.historyAdvance(H, 0.77, H.phase + w * 0.77, w, amp, rs);
  P.historyReset(H, 0.3, w1, 1, 2);
  for (let k = 0; k < 5000; k++) step(w1, 1, 2);   // wraps the buffer many times
  const o = [0, 0, 0, 0], c = 0.05;
  for (const lag of [0, 0.2, 13.1, 250, 399, 600]) {
    P.historyAt(H, lag, o);
    close(o[0], H.phase - w1 * lag, 1e-9, `steady phase at lag ${lag}`);
    // a wave emitted lag ago from radius 2 is now at 2 + c·lag
    P.historyFront(H, 2 + c * lag, c, o);
    close(o[0], H.phase - w1 * lag, 1e-9, `steady phase of the front ${c * lag} beyond the orbit`);
  }
  for (let k = 0; k < 50; k++) step(w2, 0.4, 2);    // the orbit widens: slower, weaker
  const since = 50 * 0.77, freq = lag => P.historyAt(H, lag, [0, 0, 0, 0])[0] - P.historyAt(H, lag + 1, [0, 0, 0, 0])[0];
  close(freq(5), w2, 1e-6, 'recent waves have the new frequency');
  close(freq(since + 20), w1, 1e-6, 'older waves still have the old one');
  assert.equal(P.historyAt(H, 5, o)[1], 0.4); assert.equal(P.historyAt(H, since + 20, o)[1], 1);
  assert.equal(P.historyFront(H, 2 + c * 5, c, o)[1], 0.4, 'near the source: the new amplitude');
  assert.equal(P.historyFront(H, 2 + c * (since + 20), c, o)[1], 1, 'further out: the old one');
  const before = P.historyAt(H, since - 0.01, [0, 0, 0, 0])[0], after = P.historyAt(H, since + 0.01, [0, 0, 0, 0])[0];
  assert.ok(Math.abs(before - after) < 0.01, 'the phase is continuous across the change');
});

test('binary: waves leave from where the holes were, and keep moving outward as the orbit shrinks', () => {
  // emission radius shrinking fast, as in the plunge: fronts must still be ordered and found where they are
  const H = P.makeHistory(900, 0.5), c = 0.05, dt = 0.31;
  P.historyReset(H, 0, 0.1, 1, 3);
  const emitted = [];
  for (let k = 0; k < 400; k++) {
    const t = H.t + dt, rs = Math.max(0, 3 - 0.012 * t), w = 0.1 + 0.001 * t;
    P.historyAdvance(H, dt, H.phase + w * dt, w, 1, rs);
    if (k % 37 === 0) emitted.push({ t: H.t, phase: H.phase, rs });
  }
  for (const e of emitted) {
    const r = e.rs + c * (H.t - e.t), o = P.historyFront(H, r, c, [0, 0, 0, 0]);
    close(o[0], e.phase, 2e-3, `the wave emitted at t=${e.t.toFixed(1)} from r=${e.rs.toFixed(2)}, now at r=${r.toFixed(2)}`);
  }
});

/* ------------------------------------------------------- inspiral, merger, ringdown */

test('inspiral: the orbit shrinks as Peters says, and the run reaches the merger in the predicted number of orbits', () => {
  // with the true rate, a⁴ falls linearly, a(t)⁴ = a0⁴ − (256/5) m1 m2 M t, and Φ(t) has a closed form
  for (const [m, km] of [[0.35, 560], [0.5, 450], [0.2, 800]]) {
    const a0 = 2 * km / 147.6625, B = P.makeBinary(m, m, a0, 1), M = 2 * m, A = 51.2 * m * m * M, T = a0 ** 4 / A;
    const s = { a: a0, phase: 0 }; let t = 0;
    while (true) {
      const h = 0.02 * 2 * Math.PI / P.binaryOmega(m, m, s.a);
      if ((s.a ** 4 - A * h) ** 0.25 < B.am) break;
      P.inspiralStep(B, s, h); t += h;
    }
    close(s.a, Math.pow(a0 ** 4 - A * t, 0.25), 1e-6, `a(t) for m=${m}, ${km} km`);
    const phase = (8 / 5) * Math.sqrt(M) * Math.pow(A, -3 / 8) * (Math.pow(T, 5 / 8) - Math.pow(T - t, 5 / 8));
    close(s.phase, phase, 1e-6, 'orbital phase');
    close(s.phase / (2 * Math.PI), P.inspiralOrbits(B), 0.02, 'orbits to the merger (to within the last step)');
  }
  // the inspiral ends where numerical relativity puts the peak: M ω₂₂ = 2MΩ = 0.36
  for (const m of [0.2, 0.35, 0.5]) close(2 * 2 * m * P.binaryOmega(m, m, P.peakSeparation(m, m)), 0.36, 1e-12, 'peak frequency');
});

test('inspiral: speeding up the early orbits shows the chosen number of orbits and leaves the ending unchanged', () => {
  for (const [m, km] of [[0.2, 800], [0.35, 560], [0.5, 450]]) {
    const a0 = 2 * km / 147.6625, B = P.pacedBinary(m, m, a0, 5, 7), n = P.inspiralOrbits(B);
    const truth = P.inspiralOrbits(P.makeBinary(m, m, a0, 1));
    if (truth >= 5 && truth <= 7) close(n, truth, 1e-9, 'unchanged when already in range');
    else close(n, truth > 7 ? 7 : 5, 1e-3, `orbits shown for m=${m}, ${km} km`);
    // integrating the paced run gives the same count
    const s = { a: a0, phase: 0 };
    while (s.a > B.am) P.inspiralStep(B, s, Math.min(0.01 * 2 * Math.PI / P.binaryOmega(m, m, s.a), 0.25 * (s.a - B.am) / -P.inspiralRate(B, s.a) + 1e-6));
    close(s.phase / (2 * Math.PI), n, 0.01, 'integrated orbits');
    close(P.inspiralRate(B, B.am), P.shrinkRate(m, m, B.am), 1e-12, 'the last orbits shrink at the true rate');
  }
});

test('merger: frequency rises smoothly into the ringdown, and the signal peaks at the merger', () => {
  const m = 0.35, B = P.makeBinary(m, m, 7.6, 1), o = {};
  let prevW = 0, prevPh = 0;
  close(P.afterMerger(B, 0, o).omega, P.binaryOmega(m, m, B.am), 1e-12, 'continuous frequency at the merger');
  assert.equal(o.dphase, 0); close(o.amp, B.mu * B.M / B.am, 1e-12, 'continuous amplitude');
  for (let s = 0.5; s < 300; s += 0.5) {
    P.afterMerger(B, s, o);
    assert.ok(o.omega >= prevW, 'frequency never falls');
    assert.ok(o.dphase > prevPh, 'phase keeps advancing');
    const num = (o.dphase - P.afterMerger(B, s - 1e-4, {}).dphase) / 1e-4;
    close(num, o.omega, 1e-4, 'phase rate matches the frequency');
    prevW = o.omega; prevPh = o.dphase;
  }
  close(prevW, B.wr / 2, 1e-6, 'ends ringing at the remnant’s mode');
  assert.ok(o.amp < 1e-9, 'and dies away'); assert.equal(o.blend, 1, 'with one horizon');
  // the inspiral's amplitude grows up to the merger: μM/a rises as a falls
  assert.ok(B.mu * B.M / B.am > B.mu * B.M / B.a0);
});

test('remnant: the numerical-relativity values for equal masses, and the known ringdown of a Schwarzschild hole', () => {
  const r = P.remnant(1, 1);
  close(r.Mf / 2, 0.9516, 3e-3, 'final mass (Scheel et al. 2009: 0.9516 M)');
  close(r.chi, 0.6865, 5e-3, 'final spin (0.6865)');
  const t = P.remnant(1, 1e-6); close(t.Mf, 1 + 1e-6, 1e-5, 'a test mass changes nothing'); assert.ok(t.chi < 1e-5);
  // Schwarzschild l = 2: M ω = 0.37367 − 0.08896 i
  const s = P.ringdown(1, 0);
  close(s.omega, 0.37367, 0.02, 'Schwarzschild ringdown frequency'); close(1 / s.tau, 0.08896, 0.03, 'and damping rate');
  // GW150914: remnant of about 68 Msun (as observed) and spin 0.67 rang at about 250 Hz with τ ≈ 4 ms
  const MSUN_S = 4.925491e-6, g = P.ringdown(67.8 * MSUN_S, 0.67);
  close(g.omega / (2 * Math.PI), 250, 0.05, 'GW150914 ringdown frequency (Hz)');
  close(g.tau, 4e-3, 0.1, 'GW150914 damping time (s)');
  // the merged horizon is bigger in area than the two it came from (Hawking's area theorem)
  const area = (M, chi) => 8 * Math.PI * M * M * (1 + Math.sqrt(1 - chi * chi));
  assert.ok(area(r.Mf, r.chi) > 2 * area(1, 0), 'area theorem');
});
