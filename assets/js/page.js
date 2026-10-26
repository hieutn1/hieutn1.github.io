/* Behaviour for the notes pages: the light/dark theme switch. (The home page uses site.js.) */
(() => {
  'use strict';
  const root = document.documentElement, btn = document.getElementById('theme');
  if (!btn) return;
  const isDark = () => {
    const t = root.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t === 'dark';
    return !matchMedia('(prefers-color-scheme: light)').matches;
  };
  const sync = () => {
    const d = isDark();
    btn.textContent = d ? 'Paper' : 'Night';
    btn.setAttribute('aria-label', d ? 'Paper: switch to the light theme' : 'Night: switch to the dark theme');
  };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('hn-theme', next); } catch (e) { /* storage blocked */ }
    sync();
  });
  sync();
})();
