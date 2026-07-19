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
- [ ] Same toggle works in the site viewer if trivial; skip if it drags. (Deferred to polish pass.)

## Milestone 2 — Projects store
- [ ] `lib/projects.ts`: `Project` type — id (`PRJ-1001` style), name, client, address, suburb/state/postcode, lat, lng, price (AUD), status: `enquiry | order | booked | live | off-hired`, createdAt, optional `building: BuildingData` snapshot.
- [ ] Storage: `app/api/projects/route.ts` (GET list, POST create/update, DELETE). Local dev: JSON file at `data/projects.json` (gitignore the folder? No — commit seed data, it's demo). Production note: @vercel/blob is already a dep — use it only if straightforward, otherwise file-based is fine for now.
- [ ] Seed `data/projects.json` with 6 realistic Illawarra/Wollongong-area jobs (Wollongong, Thirroul, Shellharbour, Kiama, Dapto, Corrimal) with real-looking street addresses, hardcoded lat/lng (no geocoding call needed for seeds), mixed statuses, realistic scaffold prices ($4k–$55k).

## Milestone 3 — Live map page (`/map`)
- [ ] Leaflet via CDN-free npm install (`leaflet`, no react-leaflet needed if a small wrapper is simpler with React 19). OSM tiles (no API key). Dynamic import, `ssr: false`.
- [ ] Layout copied from reference screenshot: full-bleed map, right sidebar (~320px) listing projects — id, status badge, name, client, 📍 address, price, "Open Project →". Top pill bar: All / Order / Booked In / Live / Off-Hired filters with status dot colours: order = amber, booked = blue, live = green, off-hired = red.
- [ ] Map pins coloured by same status colours; click pin ⇄ highlight sidebar card; "N projects found" count top-right.
- [ ] Clicking "Open Project" with a `building` snapshot loads it into sessionStorage and routes to `/viewer`; without one, shows project details.
- [ ] Nav: add "Map" link to landing page header + viewer pages.

## Milestone 4 — Add-a-job flow
- [ ] Small form (modal or `/map/new`): name, client, address fields, price, status. Geocode on submit via Nominatim (`https://nominatim.openstreetmap.org/search?format=json&q=...`, User-Agent header, one call per submit) with manual lat/lng override fields as fallback. Server-side route to avoid CORS/rate issues.
- [ ] "Save as project" button on the quote page (`app/quote/page.tsx`) that captures the current BuildingData + gear list price into a new project → lands on map.

## Milestone 5 — Polish pass (only if 1–4 all green)
- [ ] Kit view: subtle white/light backdrop toggle like reference "kit" renders (light background reads better for the coloured kit).
- [ ] Screenshot-parity pass on viewer: check guardrail double-rail on top deck, stair tower visible, kickboards tinted yellow in kit view.
- [ ] README section: what the app does, /map, kit view, run commands.

## Working notes
- Next.js 16: READ `node_modules/next/dist/docs/` guides before writing route handlers or dynamic imports — conventions may differ from training data.
- React 19 + three 0.184 + @react-three/fiber 9: already working, follow existing patterns in ScaffoldModel.tsx (instanced meshes, useMemo).
- Australian English throughout the UI. Dark navy theme already in globals.css.
- Do NOT touch: api/analyze routes, apiGuard, corrections flow.
- If a step fails twice, note why here under "Blockers", skip, move on.

## Blockers
(none yet)

## Done log
(append one line per completed milestone: date, commit hash, what)
