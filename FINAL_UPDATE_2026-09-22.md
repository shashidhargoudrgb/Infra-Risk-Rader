# Infra Risk Radar — Final Update 2026-09-22

## Fixed
- Fixed `String(...).join is not a function` in route PAIMANA road-name matching.
- Route road-name input is normalized whether the API receives a string, array, null, or undefined.
- Existing `safeJoin` frontend handling retained.
- OSRM full road geometry and route-first rendering architecture retained.
- Route live-source lookups remain time-bounded so slow public GIS/OSM services do not block initial route rendering.

## Access control
- General User: view/search/analyze portal data and route analysis.
- Administrator: all General User capabilities plus project creation/edit/delete, verified GIS import, alert acknowledgement and administrative operations.
- Administrator mutation APIs are protected server-side.
- General Users no longer see the Add New Project quick action.

## Login
- Existing refreshed clean login theme retained.
- Administrator and General User role selection remains explicit.
- Administrator operations require backend authentication and administrator key.
- Google OAuth is not enabled until real Google OAuth credentials/redirect configuration are supplied.

## Data policy
- No synthetic route projects were added.
- PAIMANA April 2026 portfolio context remains 1,981 projects.
- Route matching distinguishes verified GIS geometry from PAIMANA locality/text candidates.
- No fabricated ML accuracy is displayed.

## Verification
- `node --check backend/server.js` passes.
- Backend health endpoint starts successfully and reports 1,981 project records.
- A live route request in this isolated environment could not reach external routing services (`fetch failed`); this is an environment/network limitation, not a route-code exception. The deployed application still uses OSRM/Nominatim/public GIS endpoints as configured.
