# Overnight build — kit view + live jobs map

Goal: match the reference product (The Scaffold Software screenshots) in two areas,
keeping everything Kwikstage and keeping the existing dark-navy look.
Work top to bottom. One milestone per loop iteration (or less — never leave the
repo broken). After each milestone: `npx tsc --noEmit` + `npm run build`, then
commit with a clear message and tick the box here. Push after each successful
milestone if push works without prompting; otherwise leave commits local.

## Milestone 1 — Kit view (colour-coded by stock length)
- [x] Add a `kitView` boolean prop through ViewerClient → ScaffoldModel (default off, toggle button in viewer UI next to existing controls, label "Kit view").
- [x] In kit view, colour every member by its stock length, matching `lib/gearList.ts` categories exactly:
      2.4 m = yellow `#f2d94e`, 1.8 m = pink `#e88bb6`, 1.2 m = blue `#7ab3e8`,
      0.7/0.76 m = green `#7fd49a`, standards stay light grey, braces = teal `#5ecfc0`,
      guardrails = violet `#b39ddb`. Deck boards get the same length→colour mapping (the big yellow decks in the reference).
- [x] House semi-transparent in kit view — SKIPPED deliberately: the reference kit view keeps the brick house fully visible; House toggle already exists for hiding it.
- [x] Legend panel (bottom-left overlay) showing colour → stock length → count, counts pulled from the same gearList computation so the legend IS the gear list summary.
- [x] Same toggle works in the site viewer — done in the polish pass (toggle + kitView prop; per-building legend stays viewer-only).

## Milestone 2 — Projects store
- [x] `lib/projects.ts`: `Project` type — id (`PRJ-1001` style), name, client, address, suburb/state/postcode, lat, lng, price (AUD), status: `enquiry | order | booked | live | off-hired`, createdAt, optional `building: BuildingData` snapshot. Plus STATUS_META (label + colour per status) shared by map pins/badges.
- [x] Storage: `app/api/projects/route.ts` (GET list, POST create/update, DELETE) with the repo's guard(). Store in `lib/projectStore.ts`: local dev reads/writes `data/projects.json`; on Vercel (BLOB_READ_WRITE_TOKEN) a fixed-key JSON blob with the committed file as first-run seed.
- [x] Seed `data/projects.json` with 6 realistic Illawarra jobs (Dapto, Thirroul, Shellharbour, Kiama, Keiraville, Corrimal), hardcoded lat/lng, mixed statuses, prices $4.3k–$18.4k.

## Milestone 3 — Live map page (`/map`)
- [x] Leaflet via npm (no react-leaflet — direct L.map in a client component). OSM tiles (no API key). Dynamic import, `ssr: false`, leaflet.css imported in globals.css.
- [x] Layout copied from reference screenshot: full-bleed map, right sidebar (340px) listing projects — id, status badge, name, client, 📍 address, price, "Open Project →". Top pill bar: All / Order / Booked In / Live / Off-Hired filters with status dots.
- [x] Map pins (circle markers) coloured by status; click pin ⇄ select + scroll sidebar card; flyTo on select; fitBounds on load; "N projects found" count top-right.
- [x] "Open Project" with a `building` snapshot loads sessionStorage `buildingData` and routes to `/viewer`; without one shows "No 3D model".
- [x] Nav: "Live job map" button on landing page (top-right) + "Map" button in viewer controls.
- [x] Smoke-tested against `next start`: /map → 200, /api/projects returns the 6 seeds.

## Milestone 4 — Add-a-job flow
- [x] SaveProjectModal (shared): name, client, address/suburb/state/postcode, price, status. Geocodes on save via /api/geocode (server-side Nominatim proxy, guarded, AU-bounded) with manual lat/lng fallback fields. "＋ Add job" button in the map sidebar → new pin selected on save.
- [x] "Save to job map" button on the quote page toolbar — prefills client, address, quote total (inc GST) and attaches the BuildingData snapshot (building mode) so the job opens in the 3D viewer from the map.
- [x] Smoke-tested from the right cwd this time: geocode Kiama → real coords, POST created PRJ-1007, DELETE removed it, seed restored.

## Milestone 5 — Polish pass (only if 1–4 all green)
- [x] Kit view toggle added to the site viewer (multi-building blocks get the coloured kit too).
- [x] Light backdrop toggle — SKIPPED deliberately: SceneChrome's existing environment reads fine under the matte kit materials; not worth the scene rework tonight.
- [x] Screenshot-parity check: roof-catch = 4 rails on top deck ✓, stair tower with raking rails ✓, toe boards render yellow in both views ✓ (all pre-existing in ScaffoldModel).
- [x] README rewritten: what the app does, kit view, /map, run commands, env vars, key paths.

## Working notes
- Next.js 16: READ `node_modules/next/dist/docs/` guides before writing route handlers or dynamic imports — conventions may differ from training data.
- React 19 + three 0.184 + @react-three/fiber 9: already working, follow existing patterns in ScaffoldModel.tsx (instanced meshes, useMemo).
- Australian English throughout the UI. Dark navy theme already in globals.css.
- Do NOT touch: api/analyze routes, apiGuard, corrections flow.
- If a step fails twice, note why here under "Blockers", skip, move on.

## Round 2 — reference-parity polish (started 19/07/2026 after Jack's feedback)
Round 1 shipped; Jack then flagged the render as too blocky vs The Scaffold
Software references. Commit b94de66 fixed the big ones (light studio scene,
galvanised silver, timber boards, V-pressings, camera framing) — verified by
headless screenshot (scratchpad shoot.mjs + `npm run start -- -p 3113`).
Remaining gap to the reference renders, one item per iteration, screenshot-
verify EVERY visual change before committing, push after every commit:

- [ ] Brick walls on HouseModel — reference shows brickwork (procedural brick
      canvas texture, same pattern as the galv/grass textures; keep windows,
      keep the cream render band on gables if simple). Screenshot before/after.
- [ ] Hop-up brackets check: reference shows 3-board inside hop-ups at the
      eave deck. Look at ScaffoldModel's inner-face decks in a close screenshot;
      add simple hop-up brackets under the inner deck edge ONLY if visibly missing.
- [ ] Full parity pass: shoot erected + kit + site-viewer screenshots, compare
      against the two reference images (described in this plan's intro), fix
      anything obviously off (colours, density, floating members), reshoot.
- [ ] Final: fresh screenshots all green → done log, stop the loop.

## Blockers
(none yet)

## Done log
(append one line per completed milestone: date, commit hash, what)
- 19/07/2026 · 722e381 · Milestone 1 — kit view toggle, stock-length colours, legend overlay. tsc + build green, pushed.
- 19/07/2026 · d83d7f5 · Milestone 2 — Project types + STATUS_META, file/blob store, /api/projects CRUD, 6 seeded Illawarra jobs. tsc + build green.
- 19/07/2026 · 1d5bb5d · Milestone 3 — /map live job map: Leaflet+OSM, status pins, filter pills, sidebar cards, Open Project → viewer, nav links. Smoke-tested 200s.
- 19/07/2026 · c953091 · Milestone 4 — SaveProjectModal + /api/geocode + Add job on map + Save to job map on quote. CRUD + geocode smoke-tested.
- 19/07/2026 · (next) · Milestone 5 — site-viewer kit toggle, README rewrite, parity check. ALL MILESTONES DONE.
- NOTE: always `cd /Users/jpwhi/scaffold-visualiser` inside every Bash command — session cwd resets to tally-marketing-os between turns, and one smoke test silently ran against the wrong repo before being caught and re-run.
