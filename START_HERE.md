# DateEye — independent hosting setup

This is a complete replacement source package for the DateEye pilot. Start here.

**Prepared for:** HCAP-AI/DateEye on GitHub, Cloudflare Workers, and Supabase project `qtxuehkexzbdzzxbkvaf`.
**Administrator email:** office@hound-capital.com.
**Status:** code prepared and locally tested; not deployed or connected to your live Supabase project. No account or database records have been created remotely.

## What stays the same

The existing mobile/desktop calendar, binary availability, unanswered status, majority/everyone results, event settings, member removal/restoration, and shared WhatsApp link are retained. Invitees enter a listed email without a password. The administrator signs in separately with a password and can sign out using a visible button.

This remains a **single-plan pilot with 2–50 members and a date range up to one year**. Moving to independent hosting does not make it a multi-group product. Emails entered by invitees are intentionally unverified, as agreed. The old site's live data is not included or automatically copied; create a new plan for this trial, or arrange a separate data transfer before replacing the old site.

## 1. Create the Supabase tables

1. Open your existing Supabase project.
2. Open **SQL Editor**, create a new query, and paste the entire contents of `supabase/01_schema.sql`.
3. Run it. A success message with no returned rows is normal.

The script creates four DateEye tables and a server-only database function. It can be rerun without erasing records. Do not run the old SQLite/Drizzle scripts from the original source package.

## 2. Create your administrator login

1. In Supabase, open **Authentication → Users** and use **Add user → Create new user** (wording may vary).
2. Enter **office@hound-capital.com** and set your chosen password directly there. The password is not in this ZIP and must not be placed in GitHub or Cloudflare configuration.
3. Mark the email as confirmed using the dashboard's confirmation option.
4. Keep the Email/password provider enabled. Disable public account sign-ups in Authentication settings: invitees do not need Supabase user accounts.

If Supabase rejects the password under its configured password policy, use one that meets that policy. To reset an administrator password later, use the Supabase dashboard; a self-service reset page is not part of this pilot.

## 3. Grant administrator permissions

Open another SQL Editor query, paste `supabase/02_grant_admin.sql`, and run it.

This links administrator authority to the newly created user's permanent Supabase ID. It fails with a clear message if the account has not been created and confirmed. An invitee entering the administrator email still receives only invitee permissions, and only if that email is on the event list.

## 4. Replace the GitHub source

This ZIP replaces the old project structure. Do **not** just add it inside the old `DateEye` folder or leave old package/hosting configuration in place.

Recommended with GitHub Desktop:
1. Clone `HCAP-AI/DateEye` and create a branch called `standalone-supabase`.
2. In the local repository folder, keep the `.git` directory. Remove the old project files and folders, then copy **all contents** of this ZIP's `DateEye` folder into that location, including `.gitignore` and `.dev.vars.example`.
3. Confirm `package.json`, `package-lock.json`, `wrangler.jsonc`, `src`, `worker`, and `supabase` are at the repository root.
4. Commit with “Prepare DateEye for Supabase and Cloudflare” and publish the branch.
5. Review and merge the branch into `main` when ready. The old source remains available in GitHub history.

The old `.openai`, Next/Vinext, D1/Drizzle and Sites scripts are intentionally absent. The UI is now a normal React/Vite build with a separate Cloudflare Worker API. This avoids carrying ChatGPT-specific deployment and authentication into the independent site.

## 5. Deploy to Cloudflare Workers

In Cloudflare, open **Workers & Pages**, create a **Worker**, and choose the option to import/connect a Git repository. Select `HCAP-AI/DateEye` and its updated `main` branch. Use Workers, not a static-only Pages deployment: the server API is required.

Use these settings where prompted:

| Setting | Value |
|---|---|
| Worker name | `dateeye` |
| Root directory | Repository root (`/`) |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | Node 22.13 or newer; use Node 24 if offered |

The `wrangler.jsonc` file already specifies the Worker entry point, `dist` asset folder, SPA routing, Supabase URL and administrator email. No D1 binding is needed.

An initial deployment can build before the keys are set, but the application cannot sign in or load data until the next step is complete.

## 6. Add the Supabase keys to Cloudflare

In Supabase, open **Settings → API Keys** and locate the project's **publishable key** and **secret key**. Use the new `sb_publishable_…` and `sb_secret_…` keys. The implementation expects these new keys, not legacy JWT keys.

In the DateEye Worker's **Settings → Variables and Secrets**, add these as runtime values (not merely build variables):

| Name | Value | Cloudflare type |
|---|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | Your project's publishable key | Secret |
| `SUPABASE_SECRET_KEY` | Your project's secret key | Secret |

Save/deploy the configuration changes. Copy keys directly between the two dashboards. The secret key belongs only in the Worker runtime; never put it in GitHub, browser code, a `VITE_` variable, or a chat message.

`SUPABASE_URL` and `ADMIN_EMAIL` are already in `wrangler.jsonc`; they are not secrets. No database password is needed by the application.

## 7. Test before inviting friends

1. Open the Cloudflare `workers.dev` address shown for your Worker.
2. Choose **Administrator sign-in**, use office@hound-capital.com and the password created in Supabase.
3. Create the plan and at least two members. Add each member's email in **Event settings**, including your own if you want to enter availability.
4. Use **Sign out**. Open the same address in a private/incognito window and enter an invited email.
5. Mark dates available/unavailable; refresh and re-enter the email to confirm responses persist.
6. Enter a second invited email in another window, mark the same dates and check the results. “Majority” means strictly more than half of active members.
7. Check an unlisted email is refused. Removing a member should block their entry and exclude them from results; restoring them restores their responses.
8. Use **Copy group link** for WhatsApp once satisfied.

Admin sessions last at most one hour (or the shorter Supabase access-token lifetime); sign in again when expired. There is no refresh-token storage. Invitees re-enter their email after a page refresh. Results refresh on opening or saving; this pilot does not push other users' changes live to already-open screens.

Keep the existing ChatGPT-hosted site available until this trial passes. Its responses are separate. A custom domain can be added to the Worker after testing the temporary address.

## Local developer commands

Install Node.js 22.13+ (Node 24 recommended), then from the project folder:

```sh
npm ci
npm test
npm run build
```

For full local preview, copy `.dev.vars.example` to `.dev.vars` and fill its two values locally. Then run `npm run preview` and open the address Wrangler prints. It uses the configured Supabase project, so any writes are real; use a separate test project for disposable data. For hot-reloading UI development, run `npm run dev` in a second terminal; Vite proxies `/api` to Wrangler on port 8787.

For terminal deployment as an alternative to Git-connected builds:

```sh
npx wrangler login
npm run deploy
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SECRET_KEY
```

Enter secret values only when prompted. Neither a password nor a key should appear in a committed file.

## Troubleshooting

- **Database connection is not configured yet:** add both keys as Worker runtime secrets and deploy the settings.
- **Database request failed:** confirm script 01 ran successfully in the project matching the configured URL, and the secret key is from that same project.
- **Administrator access has not been granted:** create and confirm the Auth user, then run script 02.
- **Email or password is incorrect:** check the Auth user, password, and confirmation in Supabase. Invitee membership does not create an administrator login.
- **Email not invited:** add that address to an active member in Event settings.
- **Missing module / old build command:** verify the new files are at repository root, the old project files were removed, and Cloudflare uses the commands above.

## Verification performed

- TypeScript and production browser build passed.
- Cloudflare Worker deployment dry-run passed (no live deployment).
- Automated Worker tests cover anonymous access, spoofed old identity headers, cross-origin writes, request size limits, invitee/admin separation, expired sessions, cookie settings and sign-out.
- A local PostgreSQL-compatible PGlite test executes the actual schema and administrator scripts, checks direct browser-role access is denied, and tests creation, ownership restrictions, duplicate emails, date limits, removal/restoration and response preservation.
- Browser visual/interaction QA was attempted but could not run because the Chromium download was unavailable. Mobile/desktop layout and the login journey still need the live trial above.
- Live Supabase Auth, production keys, account creation and Cloudflare deployment still require the setup and trial above.

## Reference documentation

- Supabase password authentication: https://supabase.com/docs/guides/auth/passwords
- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase database functions: https://supabase.com/docs/guides/database/functions
- Cloudflare static assets and Worker routing: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Git build configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
