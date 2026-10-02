# prod. SMS upgrade — 2 October 2026

This is a patch for HCAP-AI/prod, prepared against main commit f3a00edf26b80e6b7fe7ccd1b9e643eef3b51bcf.
Your Twilio sender: **+44 7462 164132**.
Nothing has been deployed. No real SMS has been sent. Invitation sending defaults to disabled.

## What changes

- Invitees can use an invited UK mobile number, verify a text code and respond.
- Organisers still sign in by email. Existing email invitations, plans and responses remain.
- Event Settings accepts email, mobile number, or both. Choose Email or SMS as the response method.
- SMS contacts cannot bypass verification by entering their optional email.
- Verified invitees can opt in to event texts. Organisers cannot record consent on their behalf.
- Send SMS invitations queues one invitation per member/mobile number. Pressing again does not resend it.
- One reminder is due 24 hours after Twilio accepts the invitation, and normally sends within the next five minutes. Any saved availability, including unavailable, counts as a response.
- Pending messages are cancelled when someone responds, opts out, is removed, changes number/method, or the event is archived. Past events are excluded.
- STOP blocks further event texts. START unblocks the number, but website permission must also be enabled again.
- Contact selection is available where the device's browser supports it. iPhone users can enter contacts manually; a future native app can provide broader contact selection. Only selected names/numbers are submitted.

## 1. Back up, then update Supabase FIRST

Use your project's backup/export options to preserve current data before changing it.
Open **Supabase → SQL Editor → New query**. Paste the complete contents of
`supabase/06_sms.sql` and Run, including the final `commit;`.

Run only 06. Do not rerun 01–05. Keep your existing saved queries and tables.
The script is transactional and can be repeated; it does not remove existing event/member/availability records or send messages.
It adds columns, SMS tables and functions and replaces the existing state functions. Supabase may show a destructive-operation warning because functions are replaced.
If it errors, stop and send the full error rather than updating GitHub.

## 2. Check the Twilio Messaging Service

In **Twilio → Messaging → Services**, open the service you connected to Supabase.
Its SID starts `MG`, not `PN` (number resource) or `VA` (Verify service).
Check that **+447462164132** is in the **Sender Pool**. For this initial UK setup, keep it as the service's only sender.
Enable UK SMS delivery under **Messaging Geographic Permissions**, if it is restricted.

Under the service's incoming-message **Integration** settings, choose to send incoming messages to a webhook:

`https://prod-plan.com/api/sms/inbound`

Method: **POST**. If the interface delegates incoming handling to the number, set the same POST webhook on the number's Messaging configuration instead.
Enable **Advanced Opt-Out** on the Messaging Service so STOP/START are handled by Twilio and the application receives OptOutType. Retain English STOP and START keywords.

Outgoing messages set their delivery callback automatically:
`https://prod-plan.com/api/sms/status?job=<message-job-id>`.
Do not manually substitute an ID or send a dummy callback.

These endpoints become available after the code deployment in step 4. Set the webhook now and perform the end-to-end test after deployment.
Twilio must use the exact HTTPS URL above; redirects and alternate hostnames will fail signature verification.

## 3. Add Cloudflare RUNTIME secrets

Open **Cloudflare → Workers & Pages → prod → Settings → Variables and Secrets**.
Use the runtime section, not Builds. Add the following as Secrets:

| Exact name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio Account SID starting AC |
| `TWILIO_AUTH_TOKEN` | Twilio account Auth Token |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging Service SID starting MG |

Save/deploy the settings. Keep existing Supabase runtime settings.
Do not put secrets in GitHub, source files, the ZIP or a chat message.
The number is selected through the Messaging Service; no additional `TWILIO_FROM` setting is needed.

The included `wrangler.jsonc` sets these non-secret values:

| Name | Initial value |
|---|---|
| `SMS_PUBLIC_ORIGIN` | `https://prod-plan.com` |
| `SMS_ENABLED` | `false` |
| `SMS_DAILY_LIMIT` | `50` |

The daily limit caps invitation/reminder send attempts across the site in each UTC day. It is not a pound-denominated budget; multi-segment SMS can cost more. Verification texts have separate rate limits (one request/minute per number, five/hour per number/IP and twenty/day per IP). Configure Supabase Auth SMS limits and Twilio usage alerts as well; those providers also control verification traffic outside this Worker.

## 4. Upload the patch to the matching GitHub folders

Open **HCAP-AI/prod**, branch main. Upload each file into its exact folder:

| Folder | Files |
|---|---|
| `src/` | `App.tsx`, `PhoneEntry.tsx`, `Legal.tsx`, `styles.css` |
| `worker/` | `index.ts`, `sms.ts` |
| `supabase/` | `06_sms.sql` |
| `tests/` | `sms.test.mjs` |
| Repository root | `wrangler.jsonc`, `SMS_START_HERE.md` |

Avoid uploading App.tsx/index.ts to the root: the build uses src/ and worker/.
These files preserve the prod. logo, existing registration/setup flow and example names Oliver, Henry, Eric, Poppy.
Cloudflare's GitHub build should deploy. Wait for Success and refresh with Cmd+Shift+R on Mac.
At this point phone verification is available through Supabase, but invitation/reminder delivery remains disabled by `SMS_ENABLED=false`.

## 5. Test phone verification with your own number

Create a test plan with two members. In Event Settings save your own real mobile on one member and choose **SMS**. Keep the other member as Email or add their consenting test number.

Open that event's sharing link in a private browser. Choose **Mobile number**, declare 18+, accept Terms and select the optional event-text permission checkbox if you want to test invitations/reminders.
Request the text code and verify it. You should reach only your own response record and be unable to change event settings.

If you do not receive a code, check **Supabase → Authentication → Phone provider** and Twilio Messaging logs. Keep the Supabase provider set to ordinary Twilio, with the AC SID, Auth Token and MG Messaging Service SID already configured. Do not switch it to Twilio Verify for this patch.

Do not mark availability yet if you want to test the invitation and reminder.

## 6. Enable invitations, then test

Edit the root `wrangler.jsonc` in GitHub: change **`"SMS_ENABLED":"false"`** to **`"SMS_ENABLED":"true"`**. Commit and wait for Cloudflare deployment.
This setting is in the source configuration; changing only the dashboard value can be overwritten by the next source deployment.

As organiser, reopen Event Settings and choose **Send SMS invitations**. Only opted-in mobile numbers are queued. Texts go out on the five-minute schedule.
For people who have not opted in, share the event link through WhatsApp first; the first automated invitation is withheld until they verify and opt in.

Check these tests using consenting people only:

1. Invitation arrives from +447462164132, identifies prod./organiser/event and opens mobile entry.
2. Repeated Send SMS invitations does not duplicate it.
3. Without a saved availability response, one reminder arrives shortly after 24 hours; no second reminder follows.
4. Another invitee submits availability after their invitation: no reminder goes out.
5. Reply STOP before a reminder: no further event text, and website Enable event texts cannot override STOP. Reply START then enable website permission again for future invitations.
6. Remove a member or archive a test event before its reminder: no reminder is sent.
7. Same mobile on another event opens a separate response record. Email invitees still work as before.
8. Try the optional contact picker on a supported phone/browser; check each selected number. Manual entry remains available.

For an accelerated reminder test on a **test-only** event, use Supabase Table Editor → prod_sms_jobs. Locate its pending reminder, verify member/event IDs, and change due_at to a time in the past. The next Cron run should send it if no response exists. Do not change production reminder rows or rerun the invitation.

The scheduler checks eligibility immediately before claiming a message. A response or STOP arriving at the exact same time as a send may not recall a request already handed to Twilio.

## Troubleshooting and controls

- No invitation: check permission, SMS response method, SMS_ENABLED, secrets, past/archived event and pending job's due_at. Messages wait if the daily limit is reached.
- Status failed: inspect Twilio's error code and logs. Failed invitations cancel their reminder.
- Status unknown: a timeout or interrupted Worker may have sent the message. Check Twilio before any manual recovery. The system deliberately does not retry ambiguous sends.
- No resending control is included in this first version: one invitation/reminder per member/mobile number avoids accidental repeat messages and costs. Support can review failures individually.
- Check **Cloudflare → Settings → Triggers/Cron Triggers** for `*/5 * * * *` after deployment; configuration propagation may take a little time.
- To stop invitation/reminder sends, change SMS_ENABLED to false in wrangler.jsonc and redeploy. Phone verification remains a separate Supabase feature.
- Existing organiser deletion cascades SMS job records with its plans. Global permission/suppression and Supabase phone login records need separate support review for an erasure request; the privacy text explains this.

## Validation completed for this patch

Production build, local PostgreSQL-compatible migration/security tests, Worker verification/webhook tests, and Cloudflare deployment dry-run.
Live Twilio delivery, live Supabase authentication, real 24-hour timing, contact-picker/device testing and visual browser testing remain. No account configuration, database migration or live deployment was performed by this package.

## Reference documentation

- Supabase phone sign-in: https://supabase.com/docs/guides/auth/phone-login?showSmsProvider=Twilio
- Twilio Messaging Services: https://www.twilio.com/docs/messaging/services
- Twilio webhook security: https://www.twilio.com/docs/usage/security
