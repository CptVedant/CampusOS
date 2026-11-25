# CampusOS frontend changelog

## 2026-11-25 — Student search backend, milestone 2

- Added four Fastify and SQLite integration tests covering partial name and email lookup, the roster update after enrollment, per-course enrollment status, role and ownership restrictions, query validation, literal matching, and the 20-result cap. All four passed.
- Full backend suite on Node 24: 149 passed, 1 skipped, 0 failed. The initial sandbox run lacked a usable temporary directory. The rerun used a dedicated temporary directory for the fixtures.

## 2026-11-25 — Student search backend, milestone 1

- Added the course-scoped student search endpoint and documented the API contract in the backend README. It uses the existing management permissions and reports enrollment status for each result.
- Module syntax, Git whitespace checks, and an in-memory SQLite service smoke check passed. The HTTP integration suite and roster picker remain follow-ups.

## 2026-11-24 — Frontend demo

- M0–M2 delivered the React scaffold, typed API and mock adapters, role navigation, login, and light and dark styles. Login tokens use localStorage as agreed. Lite mode is deferred.
- M3–M4 added student attendance and history, course and roster management, and teacher session controls with four-second roster polling. Percentages come from the backend and display with two decimals. A raw 74.996% is returned as 75.00% by the backend, so the frontend classifies it as Satisfactory.
- M5–M6 added labeled sample materials, marks, and user screens. Enrollment by UUID remains available while student search is pending.
- M7–M8 added route splitting, keyboard-operable check-in, and a disposable real Fastify/SQLite integration fixture under `frontend/tests/`. Production hosting remains with the backend owner.
- Prepared as one frontend demo commit for review. The original `backend/` checkout is untouched.

- Verification passed: TypeScript, ESLint, the production build, seven attendance unit cases, and two integration cases against the real API. The React integration test covers starting a session, pasting a student code, seeing the updated percentage and teacher roster, and ending the session. Local HTTP verification also passed for the Vite page and the proxied health endpoint. The in-app browser timed out, so browser layout was not visually verified.
- The real-API build starts with approximately 68 kB of gzip-compressed JavaScript. Loading the signed-out screen and its shared chunks brings the total to approximately 93 kB. Main CSS is approximately 4 kB gzip.
- Manual demo check passed: signed in as the disposable Test Teacher and opened Live Attendance with CS101 and the Start session control available. Stopped the frontend and test API afterward.
- Review status: awaiting project-owner feedback. Record each requested revision in this changelog with the date, affected files, checks run, and any unresolved items.
