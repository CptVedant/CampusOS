# CampusOS frontend

CampusOS uses React, TypeScript, Tailwind, and Vite. Use Node.js 24 with npm.

## Development with the real API

Follow the [repository quick start](../README.md#quick-start) for a seeded API, or start the [persistent backend](../backend/README.md#install-and-run) and run Vite with `VITE_USE_MOCKS=false`. For the seeded accounts and feature walkthrough, see the [demo guide](../docs/demo.md).

Vite forwards `/api` to `http://127.0.0.1:8080` by default. To use another backend, set `API_PROXY_TARGET` in `frontend/.env.local` and restart Vite. Production builds use same-origin `/api` URLs. Bearer tokens are stored in tab-scoped session storage and cleared on sign-out or expiration. Serve the frontend and same-origin API over HTTPS in production.

## Frontend-only demo

Set `VITE_USE_MOCKS=true` in `frontend/.env.local` and restart Vite. Update the setting in your shell as well if it already defines `VITE_USE_MOCKS`. The sign-in screen offers demo account buttons. Mock attendance is stored in the browser, so switch roles in the same profile to see those changes.

## Checks

See the [contribution guide](../CONTRIBUTING.md#run-the-checks). The integration suite uses the ignored `tests/.backend/` directory populated by `npm run test:prepare`. It contains a copy of the Fastify source and dependencies used by the tests.
