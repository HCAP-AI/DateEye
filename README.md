# DateEye

Multiple shared availability plans with a React/Vite frontend, Cloudflare Worker API, and Supabase PostgreSQL/Auth backend.

See [UPGRADE.md](UPGRADE.md) to upgrade the existing installation safely.

Administrators create and manage their own plans and can archive/restore them. Invitees enter their listed email on a plan-specific link. The same email can join multiple plans independently. Existing responses and the original sharing link survive migration. Footer: © Hound Capital Ltd 2026 and Help! email link.

`npm ci`, `npm test`, `npm run build`; Worker deployment uses `npx wrangler deploy`. SQL migration must be applied separately first. No API secrets, passwords or live user data are included.
