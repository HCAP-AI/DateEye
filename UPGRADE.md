# DateEye: multiple plans upgrade

Prepared code only: nothing in this package has been applied to your live database or deployed.

## What is included
- My plans dashboard, with Create plan, Active plans and Archived plans.
- Separate names, dates, invitees and responses for every plan.
- A distinct WhatsApp sharing link for each plan (`/?plan=...`).
- The same email can participate in several plans independently.
- Archive/restore controls. Archived plans are read-only for the owner and closed to invitees; restoring preserves their answers.
- Small footer on every page: **© Hound Capital Ltd 2026**, plus **Help!** linking to `mailto:office@hound-capital.com`.
- Existing original plan IDs, members and answers are retained. The original root sharing link continues to address that original plan.

## Apply to your existing DateEye installation — in this order

1. Save a database backup/export before the upgrade. Keep the previous code version in GitHub history.
2. In Supabase SQL Editor, run **only `supabase/03_multi_plan.sql`** from this package. You have already run scripts 01 and 02; do not rerun them for this upgrade. Script 01 defines the old API and would undo the multi-plan function if run afterwards.
3. The migration assigns the original plan to the existing administrator. If there is more than one administrator and ownership is ambiguous, it stops and rolls back rather than guessing. It can safely be rerun once applied.
4. Update GitHub with the files below, preserving their exact paths. Do not upload the ZIP itself or flatten its folders. Since the repository is connected to Cloudflare, a change to main may deploy automatically: finish step 2 first.

| File | Action |
|---|---|
| `src/App.tsx` | Replace |
| `src/styles.css` | Replace |
| `worker/index.ts` | Replace |
| `wrangler.jsonc` | Replace |
| `supabase/03_multi_plan.sql` | Add |
| `tests/worker.test.mjs` | Replace |
| `tests/multiplan.test.mjs` | Add |
| `README.md`, `START_HERE.md`, `UPGRADE.md`, `INITIAL_SETUP.md` | Add/replace documentation |

All other files are included for completeness and need no changes. No new dependencies or keys are required. `keep_vars: true` preserves dashboard runtime variables across deployments; existing secrets remain in Cloudflare. The password is not included.

5. Wait for Cloudflare to finish the deployment, then refresh the website and sign in as administrator. You should land on **My plans** and see the original plan.
6. Create a second plan. Add emails in Event settings, then use **Copy group link** from inside that plan. Each plan has its own link; use that link when inviting friends.
7. Test with the same email in both plans and confirm its availability is separate. Check the original plan still has its existing responses. Archive and restore the second plan to confirm its responses survive.

## Verification and scope

Production TypeScript/Vite build and Worker packaging are checked. Automated tests execute the PostgreSQL migration with existing records, repeat the migration, and verify original-link compatibility, independent same-email memberships, cross-plan write rejection, owner isolation, archive/restore, and browser-role denial. Worker tests cover plan URL forwarding, authentication and request protections.

Live deployment, live Supabase account testing and visual mobile/desktop QA remain to be completed in your environment. Each plan still supports 2–50 members and up to one year of dates. Results update on loading/saving rather than live-pushing between browsers. Invitee emails remain deliberately unverified. The existing single administrator email policy stays in force; this is multiple plans per administrator, not public organiser registration.

## New installations only

Follow INITIAL_SETUP.md for the original account/key steps, but run SQL **01, then create/confirm the Auth user and run 02, then run 03** before deploying this version. After sign-in, use My plans → Create plan. With no legacy plan, the bare root link is an entry point; invitees must use a plan-specific link.

## Recovery

Migration 03 is transactional: a SQL error rolls it back. If a code deployment fails after the migration, keep the upgraded database and repair/redeploy the code; do not rerun script 01 or remove plan records. The migration preserves the original root-link API for the old UI while you complete deployment. After multiple plans exist, rolling back to the old app would hide newer plans from its UI, so retain this version or restore a matching tested database/code backup together.
