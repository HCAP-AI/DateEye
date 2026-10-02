# prod. mobile — first development milestone

React Native / Expo SDK 55 app for iPhone and Android. Native UI; the existing Cloudflare Worker and Supabase database remain the service backend. No Supabase secret or Twilio credential belongs in this app.

## Included

- Coral/teal branding using the existing prod. logo.
- Isolated sample plan for reviewing calendar and majority-date screens.
- Email code sign-in for existing users; session tokens in Expo SecureStore, automatic refresh and sign-out.
- Adult profile completion / current Terms acceptance for verified accounts.
- List, create, archive and restore organiser plans.
- Member email editing, organiser's own availability and group majority-date results.
- Native share menu with invitation and privacy links.
- Account deletion from Account, with explicit confirmation and the existing server deletion endpoint.
- Additive Worker session endpoints, regression tests and GitHub build checks.

## Run locally

Node 24 is used for CI and logic tests. In `mobile/`:

```sh
npm install
cp .env.example .env
npm run typecheck
npm test
npm start
```

Use a compatible Expo Go version, or install a development build. For an EAS development build, first sign in to your own Expo account and configure this project, then run `npx eas-cli build --profile development --platform ios` (or `android`). Do not commit credentials. The EAS project ID and store accounts are deliberately not invented in this repository.

Point `EXPO_PUBLIC_API_URL` at an HTTPS Worker origin that includes the mobile session endpoints. Those endpoints do not exist on production until the matching Worker is deployed. The sample plan works without the backend. Real sign-in and plan operations need deployment of this branch's Worker to a staging environment first. The app does not access privileged Supabase RPCs directly.

The native SDK dependency versions follow Expo's official SDK 55 template and bundled module list. They are version-ranged and need a generated lockfile when installation is available; CI currently uses `npm install` for the new mobile project. The existing website keeps its own lockfile and `npm ci`.

## Scope and remaining work

This is a development foundation, not a store-ready release. New users currently register/confirm their email on the existing website before entering their code in the app. The website's confirmation flow can send a further sign-in code. Finish a native registration and confirmation flow before store submission.

Verified invitee login (email and Twilio SMS), automated invitation/reminder delivery, contact picking, push notifications, native date pickers and invitation deep links are not implemented here. The app does not silently reuse the unverified invitee-email pilot as a native login. Share invitation sends only what the user chooses through the operating system share sheet, and opens the existing website response flow for recipients.

The sample event is explicitly labelled, remains in memory, sends nothing and disappears when exiting. It is a design preview, not a claim that production authentication has been tested.

Before release:

1. Deploy a staging Worker; verify sign-in, session rotation, plan ownership and deletion against staging Supabase.
2. Complete verified invitee entry with the agreed Twilio project and decide the consent/rate-limit/reminder rules. Never bundle Twilio secrets.
3. Add contact picking only after a user action, invitations that open the app, optional notifications, and polished date entry.
4. Finalise native account creation, moderation/reporting requirements, app icon, privacy disclosures and the mobile secure-storage/privacy-policy wording.
5. Confirm `com.houndcapital.prod` identifiers in Hound Capital's Apple/Google accounts; configure Expo/EAS, signing, store metadata and domain association files.
6. Test on real iPhone and Android devices, including keyboard, accessibility, poor connectivity, expired sessions and deletion; then use TestFlight / Google Play internal testing.

## Verification

Backend security and dependency-free mobile domain/session tests can run from the repository root:

```sh
node --experimental-strip-types --test tests/worker.test.mjs tests/mobile-worker.test.mjs mobile/tests/*.test.mjs
```

GitHub Actions additionally installs dependencies, runs the full existing website suite/build, typechecks the native app and exports iOS/Android bundles. Bundling is not a signed native build or on-device testing.
