# CampusOS frontend

CampusOS uses React, TypeScript, Tailwind, and Vite. Use Node.js 22.12 or later in the 22.x series, or Node.js 24, with npm.

## Run the DBMS demo with the real API

From `frontend/`, install dependencies and prepare a disposable copy of the backend for testing.

```powershell
npm ci
npm run test:prepare
npm run test:server
```

In another terminal, run the frontend and open the URL Vite prints.

```powershell
$env:VITE_USE_MOCKS = 'false'
npm run dev
```

The test API listens on `127.0.0.1:8080`. Vite forwards `/api` to it. The fixture creates an in-memory SQLite database and seeds CS101 with two students. Restarting the fixture resets it. Backend files in the main checkout are read only for this workflow.

| Role | Email |
|---|---|
| Teacher | `teacher@integration.test` |
| Student | `student@integration.test` |
| Second student | `second@integration.test` |
| Admin | `admin@integration.test` |

All four disposable accounts use `CampusOS-Local-Test-Only`.

1. Sign in as the teacher and open **Attendance**. Select CS101 and start a session.
2. Open the site in a second browser profile or private window for the student. Enter the teacher’s code on **Overview**.
3. Show the student’s attendance percentage and history, then return to the teacher’s live roster. End the session.
4. Open **Materials** as a teacher or admin to upload, edit, or delete documents. Students can list and download documents from courses they are enrolled in.
5. Open **Marks** to view sample data. In the admin workspace, **Users** lists real accounts and can create teachers and students.

Separate browser profiles keep sign-ins independent. If demonstrating both student accounts, give them separate profiles because the API allows one check-in per browser fingerprint per session.

Live enrollment accepts the student UUID through the existing enrollments endpoint. Name and email search requires the Phase 6 student-search endpoint on the deployed backend. Bearer tokens are kept in tab-scoped session storage and cleared on sign-out or expiration. Serve the frontend and same-origin API over HTTPS in production.

To use another backend, set `API_PROXY_TARGET` in `frontend/.env.local` and restart Vite. Production builds use same-origin `/api` URLs.

## Use persistent accounts

Configure the backend environment as described in the [backend setup](../backend/README.md#create-the-first-admin). In the backend directory, run `npm run db:seed` once and then `npm run dev`. Start the frontend in live mode with `VITE_USE_MOCKS=false`.

1. Sign in as the admin and create a teacher and a student in **Users**.
2. In **Courses**, create a course and select the teacher by name.
3. Sign in as the teacher, find and enroll the student in the course roster, then start an attendance session.
4. Sign in as the student in a separate browser profile and submit the session code. Return to the teacher workspace to see the attendance record.

## Frontend-only demo

Set `VITE_USE_MOCKS=true` in `frontend/.env.local` and restart Vite. The sign-in screen offers demo account buttons. If the current shell already sets `VITE_USE_MOCKS`, clear it or update it as well. Mock attendance is stored in the browser, so switch roles in the same profile to see those changes.

## Checks

```powershell
npm run lint
npm test
npm run test:integration
npm run build
```

The integration suite uses `tests/.backend/` from `npm run test:prepare`. This folder is ignored by Git. It includes the Fastify source and dependencies used by the tests.
