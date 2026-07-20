# Scaffold Visualiser

Upload a building plan, get a true-to-erection **Kwikstage** scaffold model, a
counted gear list, a client-ready quote — and every job pinned on a live map.

Built for [Skelscaff](mailto:jack@skelscaff.com.au) on Next.js + React Three Fiber.

## What it does

- **Plan → 3D** — upload a floor plan/elevations (PDF or image); AI traces the
  footprint and heights, editable on the review page. Or enter dimensions manually.
- **Kwikstage scaffold, modelled like it's erected** — 0.7/1.2/1.8/2.4 m bays on
  real ledger sizes, 2 m lifts, star rosettes every 500 mm, boarded lifts with
  toe boards, bracing, wall ties, a zig-zag stair tower (or ladder), roof-catch
  or edge protection on top.
- **Kit view** — one toggle recolours every tube and board by stock length
  (2.4 m yellow · 1.8 m pink · 1.2 m blue · 0.76 m green · braces teal · rails
  violet), with a legend counted from the same gear-list maths. What's on
  screen is what goes on the truck.
- **Gear list & quote** — full Kwikstage count (standards, ledgers, transoms,
  boards, rails, jacks) and an editable, printable quote with GST. Creating a
  quote snapshots the 3D model (erected + kit view) straight into the document,
  and **Download PDF** produces a branded, client-ready PDF with the renders
  embedded.
- **Shareable 3D link** — every job saved with a model gets an unguessable
  `/share/…` URL (Share button on its map card). The client gets the full
  spin-able model, gear list and dimensions — read-only, no pricing, no way
  into the app.
- **Live job map** (`/map`) — every job pinned at its address on OpenStreetMap,
  coloured by status (Order / Booked In / Live / Off-Hired), with a project
  sidebar, filters, add-a-job (auto-geocoded), and "Open Project" straight into
  the saved 3D model. Quotes can be saved to the map with one click.
- **Site mode** — trace a whole block (multiple buildings, driveway, trees) and
  scaffold any subset of the buildings.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build: `npm run build && npm start`.

Environment (all optional in local dev):

- `ANTHROPIC_API_KEY` — plan analysis
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage for corrections + saved projects
  (local dev stores projects in `data/projects.json`)
- `AUTH_SECRET` / login gate vars — production login

## Key paths

- `components/ScaffoldModel.tsx` — parametric Kwikstage generator (+ kit view)
- `lib/gearList.ts` — stock-length gear counting
- `app/map/` + `components/MapClient.tsx` — live job map
- `app/api/projects` + `lib/projectStore.ts` — job storage (file dev / blob prod)
- `app/api/geocode` — server-side Nominatim proxy
- `app/share/[token]` + `app/api/share/[token]` — public read-only 3D link
  (token-authenticated, rate-limited, returns no pricing)
- `lib/captureRenders.ts` + `lib/quotePdf.ts` — canvas snapshots on Create
  Quote, jsPDF quote generation
