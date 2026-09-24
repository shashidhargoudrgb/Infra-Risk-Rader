INFRA RISK RADAR — SIH 26103

1. Install Node.js 18+.
2. Extract this folder and open it in VS Code.
3. Run setup.bat once.
4. Run start-all.bat.
5. Open http://localhost:3000/login

NO BUILT-IN LOGIN
Use Register to create an account for this local deployment. Production deployments should replace this local registration flow with the organization's identity provider.

FEATURES
- Role-ready login and registration
- Dashboard and India risk map
- Project register + project details
- Cost-overrun prediction
- Time/delay prediction
- Explainable risk scoring
- Early-warning alerts
- Performance analytics
- EVM (PV, EV, AC, CPI, SPI, EAC, VAC)
- Prescriptive decision support
- Drone/site imagery upload workflow
- Route conflict radar with road routing
- Corridor scanning and overlap markers
- Dependency graph
- Reports and CSV export
- AI assistant

REAL-WORLD DATA MODE
Backend and frontend default to DEMO_MODE=false. Route results exclude demo fixtures. The route engine uses actual road geometry from OSRM and exact project geometry from verified GIS sources. PAIMANA metadata can be synchronized from the official public dashboard; Telangana routes additionally query official TGRAC/R&B ongoing and proposed road GIS layers. OSM is supplementary mapped-construction evidence and is not treated as official government progress. Projects without verified geometry remain in the project register but are not placed on a route. Predictive analytics uses transparent calculations from current project data; ML metrics are withheld until validated historical data is connected. Imagery upload never fabricates progress percentages.

ROUTING FIX (14-Sep-2026)
- Fixed coordinate-order handling and added OSRM route sanity validation.
- The app now rejects implausible routes instead of drawing a world-scale/straight-line route.
- If the routing provider returns an invalid response, the UI shows a retry error rather than a false route.
- Restart both backend and frontend after replacing the project folder.
