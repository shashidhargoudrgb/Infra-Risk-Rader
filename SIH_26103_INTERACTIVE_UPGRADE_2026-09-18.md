# SIH 26103 Interactive Decision-Support Upgrade

This build strengthens Infra Risk Radar around the SIH 26103 problem rather than adding unrelated dashboard decoration.

## Added
- Interactive **Route Intelligence Center** below Map & Conflict.
- **Overview**: selected project, source evidence, related-work signal count and scenario control.
- **Dependencies**: source-backed project relationship signals using route proximity + shared state/sector. These are explicitly labelled as derived signals, not asserted causal dependencies.
- **What-if simulation**: adjustable 0–365 day hypothetical delay with transparent illustrative propagation.
- **Action Center**: operational follow-up suggestions and source-transparency notes.
- Interactive dashboard **SIH Command Center** linking route intelligence, dependency graph and reports.
- Responsive styling for the new controls.

## Accuracy rules retained
- 5 km corridor around the selected driving route.
- Real/source-backed records only; no fabricated projects.
- PAIMANA text/location candidates are not presented as exact GIS footprints.
- OSM construction is supplementary and not treated as official government progress.
- Missing source fields remain `Not available` / `Source not reported`.
- Route rendering is independent of slow live project-source requests.
- Map rendering has an error boundary and `invalidateSize()` protection.

## Recommended SIH demo
1. Dashboard → **Open Route Intelligence**.
2. Select two Indian locations from the location suggestions.
3. Show the actual driving route first.
4. Wait for source-backed project results to update.
5. Open a project card and show evidence/progress/risk.
6. Open **Dependencies** and inspect related records.
7. Open **What-if**, move the delay slider, and explain that this is a scenario, not a factual prediction.
8. Open **Actions** and then generate a report.

## Important
The build should be connected to authoritative project/GIS feeds before claiming live national coverage. Public OSM/Nominatim/OSRM services are useful for prototyping but are not a substitute for a production government data pipeline.
