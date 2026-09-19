# DateEye

A mobile-first shared availability calendar. React/Vite frontend, Cloudflare Worker API, Supabase PostgreSQL and Auth.

Read **[START_HERE.md](START_HERE.md)** for the complete setup sequence.

- `src/`: existing calendar UI adapted for independent administrator login.
- `worker/`: server API; verified administrator cookie sessions and unverified invitee email entry.
- `supabase/01_schema.sql`: tables, access restrictions and transactional calendar operations.
- `supabase/02_grant_admin.sql`: grants the confirmed administrator account access.
- `tests/`: Worker and database behaviour tests.
- `wrangler.jsonc`: deployment configuration, no secret values.

The backend alone can call the database function. Browser roles have no direct table or function access. Invitee identity remains the deliberately low-security pilot arrangement; knowing another invited email lets someone act as that invitee. Administrator identity always requires a verified Supabase access token and an explicit database administrator record.

No live records, password or API keys are included. Based on the exported DateEye version 6 source (e2dfe3333b2ae293050a8949a4b83374abc4d9f8); later GitHub changes, if any, are not incorporated because repository access was unavailable. This package has not been deployed.
