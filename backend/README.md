# SMS Backend

Self-hosted Student Management System API: Fastify + SQLite (better-sqlite3), designed for
low-resource hosting (Termux on Android). **Status: Phase 1 of 8** (foundation + schema).

## Architecture
Routes (endpoints) -> Controllers (HTTP) -> Services (business logic) -> SQLite (parameterized SQL only).
Config and the DB handle are injected into `buildApp()`, which keeps tests isolated.

    src/config/      env parsing, SQLite pragmas
    src/database/    connection, migration runner, migrations/*.sql, seeds
    src/modules/     one folder per feature (health now; auth, courses, ... later)
    src/utils/       errors, response envelope, ids, validation patterns

## Install and run
    npm install
    cp .env.example .env        # edit values
    npm run db:migrate          # optional: server also migrates on startup
    npm run dev                 # development (auto-restart)
    npm start                   # production-style
    npm test

## Environment variables
| Name | Default | Notes |
|---|---|---|
| NODE_ENV | development | `production` hides internal error messages and enforces a strong JWT_SECRET |
| PORT / HOST | 8080 / 0.0.0.0 | |
| DATABASE_PATH | ./data/sms.sqlite | directory is created automatically |
| UPLOAD_DIR | ./uploads | used from Phase 5 |
| JWT_SECRET | CHANGE_ME | >= 32 random chars in production |
| JWT_EXPIRES_IN | 8h | used from Phase 2 |
| LOG_LEVEL | info (prod) / debug | |

## Database
Migrations live in `src/database/migrations/NNN_name.sql`, run in order, each in a transaction,
and are tracked in `schema_migrations`. Never edit an applied migration; add a new one.
Pragmas (WAL, synchronous=NORMAL, foreign_keys=ON, temp_store=MEMORY, busy_timeout=5000) are applied per connection.

## API (Phase 1)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/health | none | liveness + DB pragma status |

Response envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.

## Roadmap / later sections
Authentication, endpoint table, upload configuration, Termux + PM2 + Cloudflare Tunnel notes are added in their phases.
