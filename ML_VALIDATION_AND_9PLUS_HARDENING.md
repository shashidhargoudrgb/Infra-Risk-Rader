# SIH 26103 — 9+ hardening changes

- Removed unvalidated ML/demo accuracy wording from the backend model-metrics endpoint.
- Risk calculations are evidence-based and no longer use a fabricated +12% planned-progress offset.
- EVM PV/SPI are shown only when a project record contains a real `plannedProgress` baseline.
- Added `backend/data/historical-outcome-training-template.csv` for outcome-labelled historical training data.
- Added `backend/data/ml-validation-results.json` as an explicit not-validated gate; do not add invented metrics.
- Added `/api/analytics-readiness` for transparent validation status.
- Fixed the CUF availability counter to use `usedInBaseline`.
- Kept the existing map geometry, route matching, source labels, and UI structure.

## Validation rule
A prediction accuracy number may be displayed only after an actual historical train/test evaluation produces a documented result file with `validated: true`.
