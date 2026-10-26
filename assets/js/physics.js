/*
 * Physics behind the site's two animations.
 *
 * Everything here is pure (no DOM), so the page and the tests in tests/physics.test.mjs
 * run exactly the same code. Units: G = c = 1, so a black hole of mass M has
 * Schwarzschild radius r_s = 2M.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Physics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- Schwarzschild landmarks ---------- */

  /** Critical impact parameter b_c = (3√3/2) r_s. Light aimed inside it is captured; it is also the shadow's radius. */
  const criticalImpact = rs => 1.5 * SQRT3 * rs;
  /** Unstable circular orbit of light. */
  const photonSphere = rs => 1.5 * rs;
  /** Innermost stable circular orbit of matter. */
  const isco = rs => 3 * rs;
  /** Flamm's paraboloid z(r) = 2√(r_s (r − r_s)): an embedding of the equatorial slice at constant time. */
  const flamm = (r, rs) => (r <= rs ? 0 : 2 * Math.sqrt(rs * (r - rs)));

  /* ---------- Light: null geodesics in the equatorial plane ----------
   * The orbit equation u'' + u = (3/2) r_s u², with u = 1/r, is reproduced exactly by a planar
   * particle with acceleration a = −k x / r⁵, where k = (3/2) r_s L² and L = x v_y − y v_x.
   * Its "time" is the affine parameter λ. */

  const nullK = (rs, L) => 1.5 * rs * L * L;
  const A = { ax: 0, ay: 0 };
  function nullAccel(x, y, k) {
    const r2 = x * x + y * y, r = Math.sqrt(r2), c = -k / (r2 * r2 * r);
    A.ax = c * x; A.ay = c * y;
  }
  /** One classical RK4 step of size h. s = {x, y, u, v} is updated in place. */
  function nullStep(s, k, h) {
    const x = s.x, y = s.y, u = s.u, v = s.v;
    nullAccel(x, y, k); const a1x = A.ax, a1y = A.ay;
    const x2 = x + 0.5 * h * u, y2 = y + 0.5 * h * v, u2 = u + 0.5 * h * a1x, v2 = v + 0.5 * h * a1y;
    nullAccel(x2, y2, k); const a2x = A.ax, a2y = A.ay;
    const x3 = x + 0.5 * h * u2, y3 = y + 0.5 * h * v2, u3 = u + 0.5 * h * a2x, v3 = v + 0.5 * h * a2y;
    nullAccel(x3, y3, k); const a3x = A.ax, a3y = A.ay;
    const x4 = x + h * u3, y4 = y + h * v3, u4 = u + h * a3x, v4 = v + h * a3y;
    nullAccel(x4, y4, k);
    s.x = x + (h / 6) * (u + 2 * u2 + 2 * u3 + u4);
    s.y = y + (h / 6) * (v + 2 * v2 + 2 * v3 + v4);
    s.u = u + (h / 6) * (a1x + 2 * a2x + 2 * a3x + A.ax);
    s.v = v + (h / 6) * (a1y + 2 * a2y + 2 * a3y + A.ay);
  }
  /** Step size: fine near the horizon, capped far from it. */
  const nullStepSize = (r, rs, speed, lo, hi) => clamp(0.05 * (r - rs), lo, hi) / speed;
  /**
   * Schwarzschild coordinate time for a short null segment, by the midpoint rule:
   * ds² = 0 ⇒ dt² = dr²/f² + r² dφ²/f with f = 1 − r_s/r. Returns −1 at the horizon.
   */
  function nullDt(x0, y0, x1, y1, rs) {
    const mx = 0.5 * (x0 + x1), my = 0.5 * (y0 + y1), rm = Math.hypot(mx, my), f = 1 - rs / rm;
    if (f <= 0.01) return -1;
    const dx = x1 - x0, dy = y1 - y0, dr = (dx * mx + dy * my) / rm, dq = (dy * mx - dx * my) / rm;
    return Math.sqrt((dr * dr) / (f * f) + (dq * dq) / f);
  }
  /** Conserved along a null geodesic: E² = (dr/dλ)² + (1 − r_s/r) L²/r². */
  function nullEnergy2(s, rs) {
    const r = Math.hypot(s.x, s.y), vr = (s.x * s.u + s.y * s.v) / r, L = s.x * s.v - s.y * s.u;
    return vr * vr + (1 - rs / r) * (L * L) / (r * r);
  }

  /* ---------- Matter: timelike geodesics, optionally in a Langevin bath ----------
   * u'' + u = M/L² + 3Mu² is reproduced by a = −(M/r³)(1 + 3L²/r²) x, with proper time τ as "time"
   * and L = r² dφ/dτ. Radial motion then matches d²r/dτ² = −M/r² + L²/r³ − 3ML²/r⁴ exactly. */

  /** Orbital speed r dφ/dτ of a circular orbit at radius r > 3M. */
  const circularSpeed = (r, M) => Math.sqrt(M / (r - 3 * M));
  /** Conserved along a timelike geodesic: E² = (dr/dτ)² + (1 − 2M/r)(1 + L²/r²). */
  function timelikeEnergy2(x, y, u, v, M) {
    const r = Math.hypot(x, y), vr = (x * u + y * v) / r, L = x * v - y * u;
    return vr * vr + (1 - (2 * M) / r) * (1 + (L * L) / (r * r));
  }
  /**
   * Advance particle i of e = {x, y, u, v} (arrays) by proper time dts, in leapfrog (kick–drift–kick)
   * substeps: second order and symplectic, so orbits neither spiral in nor out numerically.
   * The bath adds friction γ and Gaussian kicks of size √(2γT h) per component, which by the
   * fluctuation–dissipation relation hold the velocity variance at T. Returns false if r drops below cap.
   */
  function timelikeStep(e, i, dts, M, gamma, T, cap, gauss) {
    let x = e.x[i], y = e.y[i], u = e.u[i], v = e.v[i];
    const r0 = Math.sqrt(x * x + y * y);
    const tdyn = M > 0 ? Math.sqrt((r0 * r0 * r0) / M) : Infinity;
    const n = Math.min(40, Math.max(1, Math.ceil(dts / (0.02 * tdyn))));
    const h = dts / n, hh = 0.5 * h, sq = gamma > 0 && T > 0 ? Math.sqrt(2 * gamma * T * h) : 0;
    for (let k = 0; k < n; k++) {
      let r2 = x * x + y * y, r = Math.sqrt(r2);
      if (r < cap) return false;
      let L = x * v - y * u;   // conserved by gravity: kicks are radial and drifts keep it fixed
      let a = M > 0 ? (-M / (r2 * r)) * (1 + (3 * L * L) / r2) : 0;
      u += hh * (a * x - gamma * u); v += hh * (a * y - gamma * v);
      x += u * h; y += v * h;
      r2 = x * x + y * y; r = Math.sqrt(r2);
      if (r < cap) return false;
      L = x * v - y * u;
      a = M > 0 ? (-M / (r2 * r)) * (1 + (3 * L * L) / r2) : 0;
      u += hh * (a * x - gamma * u); v += hh * (a * y - gamma * v);
      if (sq) { u += sq * gauss(); v += sq * gauss(); }
    }
    e.x[i] = x; e.y[i] = y; e.u[i] = u; e.v[i] = v;
    return true;
  }

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

  return {
    criticalImpact, photonSphere, isco, flamm,
    nullK, nullStep, nullStepSize, nullDt, nullEnergy2,
    circularSpeed, timelikeEnergy2, timelikeStep,
    PW_GM, pwPotential, pwCircularSpeed, pwAngularMomentum, diskStep,
    lensImages, growth
  };
});
