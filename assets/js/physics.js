/*
 * Physics behind the site's animations: the accretion disk at the top of the page and the binary below it.
 *
 * Everything here is pure (no DOM), so the page and the tests in tests/physics.test.mjs
 * run exactly the same code. Units: G = c = 1.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Physics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };

  /** The shadow of a Schwarzschild hole: light aimed inside impact parameter b_c = (3√3/2) r_s is captured. */
  const criticalImpact = rs => 1.5 * Math.sqrt(3) * rs;

  /* ---------- The accretion disk: Paczyński–Wiita potential, in units of r_s ----------
   * Φ = −GM/(r − 1). This pseudo-Newtonian potential reproduces the Schwarzschild innermost
   * stable orbit (r = 3) and marginally bound orbit (r = 2) exactly. With r_s = 1, GM = 1/2. */

  const PW_GM = 0.5;
  const pwPotential = (r, GM) => -GM / (r - 1);
  const pwCircularSpeed = (r, GM) => Math.sqrt(GM * r) / (r - 1);
  const pwAngularMomentum = (r, GM) => r * pwCircularSpeed(r, GM);
  /**
   * Advance particle i of d = {x, y, z, vx, vy, vz} (arrays) by dts in leapfrog substeps.
   * opt = {GM, rcap, visc, circ, zDamp, zDampFar}. visc (a viscous torque that removes angular momentum)
   * and circ (radial damping) act where gas has joined the disk; the z terms settle it into the plane.
   * Set them all to 0 for pure orbits. Returns false if the particle falls inside rcap.
   */
  const DS = { ax: 0, ay: 0, az: 0 };
  function diskAccel(x, y, z, vx, vy, vz, opt) {
    const GM = opt.GM, r = Math.sqrt(x * x + y * y + z * z), g = -GM / ((r - 1) * (r - 1) * r);
    let ax = g * x, ay = g * y, az = g * z;
    if (opt.visc || opt.circ || opt.zDamp || opt.zDampFar) {
      const R = Math.sqrt(x * x + y * y) + 1e-6, cx = x / R, sy = y / R;
      const vR = vx * cx + vy * sy, vP = vy * cx - vx * sy, rc = ((R * vP) * (R * vP)) / GM;
      if (r < 1.6 * Math.max(rc, 1.5)) {   // where infalling streams meet the disk
        const aR = -opt.circ * vR, aP = -opt.visc * Math.exp(-Math.abs(z) / 2) * vP;
        ax += aR * cx - aP * sy; ay += aR * sy + aP * cx; az -= opt.zDamp * vz;
      } else az -= opt.zDampFar * vz;
    }
    DS.ax = ax; DS.ay = ay; DS.az = az;
  }
  function diskStep(d, i, dts, opt) {
    const rcap = opt.rcap;
    let x = d.x[i], y = d.y[i], z = d.z[i], vx = d.vx[i], vy = d.vy[i], vz = d.vz[i];
    const r0 = Math.sqrt(x * x + y * y + z * z);
    if (r0 < rcap) return false;
    const tdyn = (Math.sqrt((r0 * r0 * r0) / opt.GM) * (r0 - 1)) / r0;
    const n = Math.min(30, Math.max(1, Math.ceil(dts / (0.03 * tdyn))));
    const h = dts / n, hh = 0.5 * h;
    diskAccel(x, y, z, vx, vy, vz, opt);
    for (let k = 0; k < n; k++) {
      // kick–drift–kick; each step's closing force is reused to open the next (gravity depends on position only)
      vx += hh * DS.ax; vy += hh * DS.ay; vz += hh * DS.az;
      x += vx * h; y += vy * h; z += vz * h;
      if (x * x + y * y + z * z < rcap * rcap) return false;
      diskAccel(x, y, z, vx, vy, vz, opt);
      vx += hh * DS.ax; vy += hh * DS.ay; vz += hh * DS.az;
    }
    d.x[i] = x; d.y[i] = y; d.z[i] = z; d.vx[i] = vx; d.vy[i] = vy; d.vz[i] = vz;
    return true;
  }

  /* ---------- Gravitational lensing by a point mass ----------
   * For a distant observer, a source a distance d behind the lens at projected offset b appears at
   * θ± = (b ± √(b² + 4R_E²))/2, the roots of the lens equation b = θ − R_E²/θ, with R_E² = 2 r_s d. */
  function lensImages(b, d, rs) {
    const q = Math.sqrt(b * b + 8 * rs * d);
    return [0.5 * (b + q), 0.5 * (b - q)];
  }

  /* ---------- The intro's growing black hole ----------
   * Radius normalised to run from 0 to 1 as p goes from 0 to 1, growing at a rate proportional to its
   * size (plus a small seed term): almost nothing at first, then a rush at the end. */
  const growth = (p, a) => (Math.exp(a * clamp(p, 0, 1)) - 1) / (Math.exp(a) - 1);

  /* ---------- A binary black hole (G = c = 1) ----------
   * Two masses on a circular orbit of separation a, to leading (Newtonian and quadrupole) order.
   * Kepler: Ω² = M / a³ with M = m1 + m2. The waves come out at twice the orbital frequency with strain
   * h₀ = 4 μ M / (a r) = 4 𝓜^(5/3) Ω^(2/3) / r at distance r, where μ = m1 m2 / M and 𝓜 is the chirp mass. */
  const binaryOmega = (m1, m2, a) => Math.sqrt((m1 + m2) / (a * a * a));
  const chirpMass = (m1, m2) => Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);
  function strainAmplitude(m1, m2, a, r) { const M = m1 + m2; return 4 * (m1 * m2 / M) * M / (a * r); }
  // Strain seen by an observer at inclination ι to the orbit's axis, when the orbital phase (at the retarded
  // time) is Φ. Polarisation axes: p in the plane containing the axis and the line of sight, q perpendicular to it.
  function quadrupoleStrain(m1, m2, a, r, iota, phase, out) {
    const h0 = strainAmplitude(m1, m2, a, r), c = Math.cos(iota), o = out || [0, 0];
    o[0] = -h0 * 0.5 * (1 + c * c) * Math.cos(2 * phase);
    o[1] = -h0 * c * Math.sin(2 * phase);
    return o;
  }
  // In the orbital plane, at azimuth φ: only the plus polarisation, h₊ = −(h₀/2) cos 2(Φ − φ)
  const planeStrain = (h0, phase, phi) => -0.5 * h0 * Math.cos(2 * (phase - phi));
  // Peters (1964): radiated power, and the time for the orbit to shrink to nothing
  function gwPower(m1, m2, a) { const M = m1 + m2, mu = m1 * m2 / M; return 6.4 * mu * mu * M * M * M / Math.pow(a, 5); }
  const shrinkRate = (m1, m2, a) => -12.8 * m1 * m2 * (m1 + m2) / (a * a * a);   // da/dt
  const mergerTime = (m1, m2, a) => (5 / 256) * Math.pow(a, 4) / (m1 * m2 * (m1 + m2));
  // The pair's Newtonian potential at (x, y), which also sets the depth of the sheet
  function binaryPotential(x, y, x1, y1, m1, x2, y2, m2) {
    return -m1 / Math.hypot(x - x1, y - y1) - m2 / Math.hypot(x - x2, y - y2);
  }

  /* ---------- Inspiral, merger and ringdown ----------
   * The orbit shrinks by radiation reaction (Peters) until the wave frequency reaches the value numerical
   * relativity finds at peak amplitude for equal masses, M ω₂₂ ≈ 0.36. The holes then merge; the frequency
   * rises to the remnant's fundamental ringdown mode and the amplitude decays at its damping time. */
  const PEAK_MW = 0.36;
  const peakSeparation = (m1, m2) => (m1 + m2) * Math.pow(2 / PEAK_MW, 2 / 3);   // where 2MΩ = 0.36
  // Remnant of two non-spinning holes: fits to numerical relativity (Tichy & Marronetti 2008; Buonanno, Kidder & Lehner 2008)
  function remnant(m1, m2) {
    const M = m1 + m2, eta = m1 * m2 / (M * M);
    return {
      Mf: M * (1 + (Math.sqrt(8 / 9) - 1) * eta - 0.4333 * eta * eta - 0.4392 * eta * eta * eta),
      chi: 2 * Math.sqrt(3) * eta - 3.871 * eta * eta + 4.028 * eta * eta * eta
    };
  }
  // The l = m = 2 fundamental ringdown mode of a Kerr hole (fits of Berti, Cardoso & Will 2006)
  function ringdown(Mf, chi) {
    const omega = (1.5251 - 1.1568 * Math.pow(1 - chi, 0.1292)) / Mf, Q = 0.7 + 1.4187 * Math.pow(1 - chi, -0.4990);
    return { omega, tau: 2 * Q / omega };
  }
  const kerrHorizon = (M, chi) => M * (1 + Math.sqrt(1 - chi * chi));

  // A run from separation a0. The shrinking is sped up by K0 at the start, easing to the true rate for the
  // last orbits (K = 1 at the end), so a long inspiral can be shown in a few orbits without changing how it ends.
  function makeBinary(m1, m2, a0, K0) {
    const M = m1 + m2, am = peakSeparation(m1, m2), rem = remnant(m1, m2), rd = ringdown(rem.Mf, rem.chi);
    return { m1, m2, M, mu: m1 * m2 / M, a0, am, K0, Mf: rem.Mf, chi: rem.chi, wr: rd.omega, tau: rd.tau,
      rp: kerrHorizon(rem.Mf, rem.chi), wm: binaryOmega(m1, m2, am), tf: 4 * M, dur: 12 * M };
  }
  const paceK = (B, a) => 1 + (B.K0 - 1) * Math.pow(clamp((a - B.am) / (B.a0 - B.am), 0, 1), 2);
  const inspiralRate = (B, a) => paceK(B, a) * shrinkRate(B.m1, B.m2, a);
  // Orbits from a0 to the merger: ∫ Ω / |da/dt| da / 2π (Simpson's rule)
  function inspiralOrbits(B) {
    const n = 400, h = (B.a0 - B.am) / n, f = a => binaryOmega(B.m1, B.m2, a) / -inspiralRate(B, a);
    let sum = f(B.am) + f(B.a0);
    for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(B.am + i * h);
    return sum * h / 3 / (2 * Math.PI);
  }
  // The pace that shows the true number of orbits when it lies in [nmin, nmax], and the nearest end otherwise
  function pacedBinary(m1, m2, a0, nmin, nmax) {
    const B = makeBinary(m1, m2, a0, 1), n = inspiralOrbits(B), want = clamp(n, nmin, nmax);
    if (want === n) return B;
    let lo = 0.01, hi = 1000;
    for (let i = 0; i < 50; i++) { B.K0 = Math.sqrt(lo * hi); if (inspiralOrbits(B) > want) lo = B.K0; else hi = B.K0; }
    return B;
  }
  // One RK4 step of the inspiral, s = {a, phase}
  function inspiralStep(B, s, h) {
    const f = a => inspiralRate(B, a), g = a => binaryOmega(B.m1, B.m2, Math.max(a, 1e-9)), a = s.a;
    const k1 = f(a), k2 = f(a + 0.5 * h * k1), k3 = f(a + 0.5 * h * k2), k4 = f(a + h * k3);
    s.phase += h * (g(a) + 2 * g(a + 0.5 * h * k1) + 2 * g(a + 0.5 * h * k2) + g(a + h * k3)) / 6;
    s.a = a + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
  }
  // After the merger (s time units on): orbital-phase rate (half the wave frequency), phase gained,
  // strain amplitude (μM/a, so h = 4·amp/r face-on), and how far the two horizons have merged (0 → 1)
  function afterMerger(B, s, o) {
    const dw = B.wr / 2 - B.wm, e = Math.exp(-s / B.tf);
    o.omega = B.wm + dw * (1 - e);
    o.dphase = B.wm * s + dw * (s - B.tf * (1 - e));
    o.amp = B.mu * B.M / B.am * Math.exp(-s / B.tau);
    o.blend = sstep(s / B.dur);
    return o;
  }

  /* ---------- Retarded time ----------
   * Each wave carries the orbit as it was when it left. The history keeps the orbital phase, its rate, the wave
   * amplitude and the radius it was emitted from, on a fixed time grid. A wave emitted at t′ from radius r_e(t′)
   * is now at r_e(t′) + c (t − t′), so the field at any distance uses the orbit as it was then, and a change to
   * the orbit spreads outward at the wave speed instead of appearing everywhere at once. */
  function makeHistory(n, dt) {
    return { n, dt, ph: new Float64Array(n), om: new Float64Array(n), amp: new Float64Array(n), rs: new Float64Array(n),
      head: 0, t: 0, tLast: 0, phase: 0, omega: 0, a: 0, r: 0 };
  }
  function historyReset(H, phase, omega, amp, rs = 0) {
    H.t = 0; H.tLast = 0; H.phase = phase; H.omega = omega; H.a = amp; H.r = rs; H.head = 0;
    for (let k = 0; k < H.n; k++) { H.ph[k] = phase - omega * k * H.dt; H.om[k] = omega; H.amp[k] = amp; H.rs[k] = rs; }
  }
  // Move on by dt to a state with this phase, rate, amplitude and emission radius (interpolated in between)
  function historyAdvance(H, dt, phase, omega, amp, rs = 0) {
    const t0 = H.t, p0 = H.phase, w0 = H.omega, a0 = H.a, r0 = H.r;
    H.t += dt; H.phase = phase; H.omega = omega; H.a = amp; H.r = rs;
    while (H.tLast + H.dt <= H.t) {
      H.tLast += H.dt; H.head = (H.head + H.n - 1) % H.n;      // newest sample sits at head
      const f = (H.tLast - t0) / dt;
      H.ph[H.head] = p0 + (phase - p0) * f; H.om[H.head] = w0 + (omega - w0) * f;
      H.amp[H.head] = a0 + (amp - a0) * f; H.rs[H.head] = r0 + (rs - r0) * f;
    }
  }
  function sample(H, k, fr, o) {   // between grid samples k and k + 1 (older)
    const i0 = (H.head + k) % H.n, i1 = (H.head + k + 1) % H.n;
    o[0] = H.ph[i0] + (H.ph[i1] - H.ph[i0]) * fr; o[1] = H.amp[i0] + (H.amp[i1] - H.amp[i0]) * fr;
    o[2] = H.om[i0] + (H.om[i1] - H.om[i0]) * fr; o[3] = H.rs[i0] + (H.rs[i1] - H.rs[i0]) * fr;
    return o;
  }
  function oldest(H, extra, o) {   // beyond the record: the orbit as it was then, held steady
    const j = (H.head + H.n - 1) % H.n;
    o[0] = H.ph[j] - H.om[j] * extra; o[1] = H.amp[j]; o[2] = H.om[j]; o[3] = H.rs[j]; return o;
  }
  // [phase, amplitude, rate, emission radius] as they were `lag` time units ago
  function historyAt(H, lag, out) {
    const o = out || [0, 0, 0, 0], tq = H.t - lag;
    if (tq >= H.tLast) {
      const f = H.t > H.tLast ? (H.t - tq) / (H.t - H.tLast) : 0, j = H.head;
      o[0] = H.phase + (H.ph[j] - H.phase) * f; o[1] = H.a + (H.amp[j] - H.a) * f;
      o[2] = H.omega + (H.om[j] - H.omega) * f; o[3] = H.r + (H.rs[j] - H.r) * f;
      return o;
    }
    const back = (H.tLast - tq) / H.dt, k = Math.floor(back);
    if (k >= H.n - 1) return oldest(H, (back - (H.n - 1)) * H.dt, o);
    return sample(H, k, back - k, o);
  }
  // The same, for the wave that has now reached distance r travelling at speed c
  function historyFront(H, r, c, out) {
    const o = out || [0, 0, 0, 0], age0 = H.t - H.tLast;
    const front = k => H.rs[(H.head + k) % H.n] + c * (age0 + k * H.dt);
    if (r <= H.r) { o[0] = H.phase; o[1] = H.a; o[2] = H.omega; o[3] = H.r; return o; }
    const f0 = front(0);
    if (r < f0) {   // emitted since the newest grid sample
      const f = (r - H.r) / (f0 - H.r), j = H.head;
      o[0] = H.phase + (H.ph[j] - H.phase) * f; o[1] = H.a + (H.amp[j] - H.a) * f;
      o[2] = H.omega + (H.om[j] - H.omega) * f; o[3] = H.r + (H.rs[j] - H.r) * f;
      return o;
    }
    const fl = front(H.n - 1);
    if (r >= fl) return oldest(H, (r - fl) / c, o);
    let lo = 0, hi = H.n - 1;                  // fronts grow with age: find the pair that brackets r
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (front(mid) <= r) lo = mid; else hi = mid; }
    const flo = front(lo);
    return sample(H, lo, (r - flo) / (front(hi) - flo), o);
  }

  return {
    criticalImpact,
    PW_GM, pwPotential, pwCircularSpeed, pwAngularMomentum, diskStep,
    lensImages, growth,
    binaryOmega, chirpMass, strainAmplitude, quadrupoleStrain, planeStrain,
    gwPower, shrinkRate, mergerTime, binaryPotential,
    PEAK_MW, peakSeparation, remnant, ringdown, kerrHorizon,
    makeBinary, pacedBinary, inspiralOrbits, inspiralRate, inspiralStep, afterMerger,
    makeHistory, historyReset, historyAdvance, historyAt, historyFront
  };
});
