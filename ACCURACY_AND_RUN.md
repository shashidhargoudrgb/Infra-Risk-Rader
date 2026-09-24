# Infra Risk Radar — Map & Conflict accuracy fix

## What this build changes
- Route search uses a **5 km corridor on each side of the actual driving route**.
- The full OSRM driving geometry is rendered first; live project-source checks run separately.
- Up to 8 route projects are shown, prioritising source-backed GIS/government work records, then mapped construction, then PAIMANA monitoring candidates.
- **No project is fabricated** to avoid a zero count.
- PAIMANA records without authoritative project GIS geometry remain cards/monitoring candidates and are **not placed at guessed map coordinates**.
- Malformed project geometry is filtered before Leaflet GeoJSON rendering.
- Leaflet calls `invalidateSize()` after the map container is mounted/resized to prevent blank-map rendering after layout changes.
- A React map error boundary prevents one bad marker/geometry from blanking the complete Map & Conflict page.
- External project-source calls have individual time limits so one unavailable service cannot block the route.

## Accuracy rule
A map marker/line is an exact route project only when its source supplies usable Point/LineString/MultiLineString geometry. OpenStreetMap construction features are labelled supplementary/unverified. PAIMANA portfolio records are official monitoring records, but a place-name match alone is not an exact project footprint.

## Run
1. Open the `frontend` and `backend` folders in VS Code.
2. Backend: `npm install --no-audit --no-fund` then `npm start`.
3. Frontend: `npm install --no-audit --no-fund` then `npm run dev`.
4. Open the Vite URL shown by the frontend terminal.

## Important
This build improves the matching and stability logic; it does not create a national live project database. For genuinely exact all-India project detection, authoritative project GIS/geometry feeds must be imported into `backend/data/verified-projects.geojson` or `government-work-records.geojson` with source provenance.
