# Hieu Nguyen · The Physics of Learning

Source for Hieu Nguyen's personal site. It is a static site with no build framework: one HTML page,
one stylesheet and two scripts. GitHub Actions tests it and publishes it to GitHub Pages.

```
index.html              all four pages (Home, Research, Notes, About), switched with #research etc.
404.html                shown for addresses that don't exist
assets/css/site.css     styles, colour tokens, self-hosted fonts
assets/js/physics.js    the physics behind both animations (no page code, so it can be tested)
assets/js/site.js       page behaviour: intro, black hole, observatory, theme, pause control, routing
assets/fonts/           Instrument Serif, Manrope, IBM Plex Mono (SIL Open Font License)
assets/img/             favicon, home-screen icon, social preview image
tests/                  physics tests and browser tests
scripts/                local server and the build step that copies the site into _site/
.github/                the test-and-deploy workflow and monthly dependency updates
```

## Editing content

Everything you read on the site is in `index.html`, one `<section data-page="…">` per page.

- **A research thread:** copy one `<article class="thread">` block in the Research section and edit it.
- **A note or book:** copy one `<li class="entry" data-subject="Physics">` in the Notes section. The subject
  must be one of the filter buttons (Physics, Statistics, Mathematics, Teaching), or add a new button.
- **Links on the About page:** replace the dashed placeholders (arXiv, Google Scholar, GitHub, CV, contact)
  with real links, e.g. `<a href="https://arxiv.org/a/...">arXiv</a>`. To host a CV, put the PDF in
  `assets/` and link to `assets/cv.pdf`.
- **Page titles** shown in the browser tab are set in `site.js` (the `PAGES` list near the end).

Then preview it, run the tests, and push:

```bash
npm install          # once
npm start            # preview at http://127.0.0.1:8080
npm test             # physics + browser tests (needs: npx playwright install chromium)
git commit -am "Add new note" && git push
```

A push to `main` runs the tests; if they pass, the site is live a minute or two later.

## What the tests check

`tests/physics.test.mjs` runs the same code the page runs:
light is captured inside the critical impact parameter (3√3/2) r_s and escapes outside it; weak-field
deflection matches 2r_s/b; the Shapiro delay; conservation of energy and angular momentum along light rays and
orbits; circular orbits stay circular; orbits are stable outside 6M and plunge inside it; perihelion
precession matches an independent integration of the GR orbit equation; the Langevin bath satisfies
fluctuation–dissipation; the Paczyński–Wiita potential's innermost stable orbit (3 r_s) and marginally bound
orbit (2 r_s); gas in the disk circles several times before plunging inside 3 r_s; lens images solve the
lens equation.

`tests/site.test.mjs` opens the site in Chromium on ten screen sizes from an iPhone SE to an ultrawide
monitor and checks: the intro and its skip button; nothing wider than the screen; touch (tapping, the sheet,
dragging sliders); keyboard use (skip link, tab order, visible focus, focus moving to each new page);
reduced-motion settings; the pause control; animation stopping when off screen; accessibility (axe-core,
both themes); page weight and no third-party requests; the page without JavaScript; the 404 page; and
automatic quality reduction on slow devices.

## Publishing (one-time setup)

1. In the GitHub repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Pages → Custom domain:** enter the domain and save. This creates nothing in the repo;
   the workflow publishes it.
3. At the domain registrar, add these DNS records (and delete any default "parking" records):

   | Type | Name | Value |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA | @ | 2606:50c0:8000::153 |
   | AAAA | @ | 2606:50c0:8001::153 |
   | AAAA | @ | 2606:50c0:8002::153 |
   | AAAA | @ | 2606:50c0:8003::153 |
   | CNAME | www | *your-github-username*.github.io |

   Don't add wildcard (`*`) records.
4. Back in **Settings → Pages**, once the DNS check passes, tick **Enforce HTTPS**. GitHub issues and
   renews the certificate itself; the option can take up to a day to become available.
5. Recommended: verify the domain under your GitHub account's **Settings → Pages → Verified domains**,
   so nobody else can publish to it if the site is ever switched off.

## Upkeep

- **Content:** edit `index.html` as above.
- **Dependencies:** the site itself has none at run time. Dependabot opens a pull request once a month when
  the test tools (Playwright, axe-core) or the workflow's GitHub Actions have updates; the tests run on it,
  and you merge it if they pass.
- **Domain:** turn on auto-renew at the registrar and keep the payment method current. If the domain
  lapses, the site goes offline at that address (it stays reachable at *username*.github.io).
- **HTTPS:** renews automatically while the DNS records point at GitHub Pages.

## Notes on the physics

- **Observatory (exact):** light follows null geodesics of the Schwarzschild metric in the equatorial plane,
  timed in Schwarzschild coordinate time; matter follows timelike geodesics in proper time, plus friction and
  noise from a Langevin bath. The sheet is Flamm's paraboloid, drawn with its height exaggerated by half.
- **Hero disk (a model):** test particles in the Paczyński–Wiita potential, which reproduces the
  Schwarzschild innermost stable and marginally bound orbits. Viscosity is far stronger than in a real
  disk so that inflow is visible, but gas still circles several times before it reaches the inner edge.
  Lensing uses the weak-field point-mass lens (the primary image only); brightness uses a T ∝ r^(-3/4)
  profile, Doppler beaming and a redshift fade near the horizon. It is a picture, not a ray trace.
