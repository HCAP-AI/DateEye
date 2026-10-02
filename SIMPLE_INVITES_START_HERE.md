# Simplified invitations — install this update

This replaces the earlier SMS verification flow. Existing event links still work. Your plans and responses are preserved.

## What changes

- **Send invites** saves the event and contact edits, then queues an invitation for each saved email address and mobile number. Both details means both messages.
- No Email/SMS response-method choice and no invitee verification code. Invitees enter either invited detail, confirm the existing age/Terms fields, and open the calendar.
- Organiser sign-in continues to require authentication. Invitees can update only the matching member's availability; they cannot edit settings.
- Anyone who knows an invited contact detail and the event link can respond as that person. Contact-only entry does not prove ownership of the email or phone.
- Previous text opt-outs/STOP are respected. Invitations do not require an earlier visit or an opt-in verification code. Existing opted-in reminders remain available; no new reminder permission is assumed.
- Pressing Send invites again does not resend invitations already recorded. Messages with failed or uncertain delivery are not automatically retried.

## 1. Apply the database update

In your existing Supabase project, open SQL Editor. Run the complete contents of **supabase/07_simple_invites.sql**. This requires the earlier migrations through **06_sms.sql**, which you have already been setting up. Do not rerun 06 after applying 07: it would restore the old entry restrictions.

The migration can safely be rerun and does not itself send messages. It changes invitation eligibility for pending SMS jobs; the existing five-minute sender will process eligible pending jobs when enabled.

## 2. Upload the files to GitHub

Replace/add the files from this ZIP in **HCAP-AI/prod**, retaining their folders:

- src/App.tsx
- src/PhoneEntry.tsx
- src/Legal.tsx
- worker/index.ts
- worker/invites.ts (new)
- supabase/07_simple_invites.sql (new)
- tests/invites.test.mjs (new)
- wrangler.jsonc
- SIMPLE_INVITES_START_HERE.md

Do not put the files inside an extra enclosing folder. Let Cloudflare finish deploying the new commit. Existing worker/sms.ts and the earlier SMS migration remain in place.

The supplied wrangler.jsonc enables SMS and email processing, with separate limits of 50 attempts per day. It retains the existing five-minute cron trigger and public URL. Provider credentials are never included in GitHub.

## 3. Configure invitation sending in Cloudflare

Open the **prod** Worker → Settings → Variables and Secrets. Keep the existing Supabase and Twilio settings. The SMS sender uses:

- TWILIO_ACCOUNT_SID (existing)
- TWILIO_AUTH_TOKEN (existing secret)
- TWILIO_MESSAGING_SERVICE_SID (existing)
- SMS_PUBLIC_ORIGIN = https://prod-plan.com

Automatic invitation email is new; Supabase authentication emails do not provide an API for arbitrary invitation messages. This update uses **SendGrid**:

1. Set up SendGrid and authenticate your sending domain. Use a verified sender address on that domain.
2. Create a SendGrid API key with Mail Send permission.
3. Add **SENDGRID_API_KEY** as an encrypted Cloudflare secret.
4. Add **EMAIL_FROM** as the exact verified sender email address, for example an address on prod-plan.com that you have verified. Do not enter a display name here.
5. Deploy the saved Worker settings.

The API implementation uses SendGrid's global endpoint. An EU regional SendGrid subuser would require changing the endpoint in worker/invites.ts to api.eu.sendgrid.com.

Official setup/API references:
- https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sender-identity
- https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send

If a channel isn't configured, Send invites reports how many messages could not be queued. It still queues the configured channel. After configuring the missing channel, press Send invites again to queue it without duplicating the other channel.

## 4. Try your own invitation

Open Birthday Weekend's event settings, check your saved email and mobile number, and press **Send invites** once. The screen reports messages **queued**, not guaranteed delivered.

The cron sends up to ten texts and ten emails every five minutes, subject to daily limits. Larger groups may take several runs. Open the link from either message and enter your saved email or mobile number. UK phone formats such as 07700 900123, +447700900123 and 00447700900123 are accepted. There is no code to request or enter.

If a previously stopped number is skipped, reply START from that phone and contact support if its saved website opt-out also needs changing. Do not delete suppression records to force delivery.

## Delivery troubleshooting

- No messages queued: check the counts shown, provider settings, event dates, and active invitee details.
- Pending messages: check Cloudflare's five-minute cron and daily limits.
- Text delivery: check Twilio Messaging logs and public.prod_sms_jobs in Supabase.
- Email delivery: check SendGrid Email Activity and public.prod_email_jobs. `accepted` means accepted by SendGrid, not confirmed inbox delivery.
- `unknown` means a request may have reached the provider. Check provider logs before attempting any manual resend.
- If entry reports a database upgrade error, confirm migration 07 ran successfully in the same Supabase project used by the Worker.

## Validation completed

Production build and existing automated tests passed. Added database/API tests cover contact entry, both channels, duplicate prevention, text suppression, existing responses, cross-event isolation, own-response editing, archives, daily limits and email-provider timeout handling. A simulated React UI check confirms first-submit calendar entry by phone/email and saving unsaved contact edits before queueing invitations. Live provider delivery must be checked after your deployment and credential setup.
