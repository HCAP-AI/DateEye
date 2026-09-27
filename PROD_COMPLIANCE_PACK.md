# prod. compliance pack — draft for launch review
27 September 2026 · operator: Hound Capital Ltd (company details supplied by owner) · version 0.1

**Status:** Draft for legal and operational review. The live architecture was inspected in GitHub; contracts, provider settings, actual cookies, data residency, backup retention, company registration details, and the production database were not independently verified. Complete the launch checklist before publication. The app currently permits invitees to respond with an unverified email address, which is a material access and privacy issue.

## A. Terms of Service — proposed public text

**Operator and contact.** prod. is provided by Hound Capital Ltd (company number 14932445), Mondays House, Farm Road, Bracklesham Bay, West Sussex, PO20 8JT, England and Wales. Contact office@hound-capital.com.

**Eligibility.** You must be 18 or older to create an account or use prod. Do not register or respond if you are under 18. We may suspend accounts where we reasonably believe this condition is not met.

**The service.** Organisers can create plans, invite participants and see their availability. Participants can submit their own responses. The organiser is responsible for entering accurate invitation details and only inviting people where it is reasonable to do so. Do not enter health, religious, political or similarly sensitive details in plan names or responses. Do not impersonate someone, scrape the service, or access another person's plan without authority.

**Accounts and plans.** Keep your sign-in email secure. A person with access to an invited email and plan link may gain access to that plan under the current invitation design; do not share links widely. We may remove abusive content or suspend access to protect users and the service. The organiser may archive a plan or delete their account. Account deletion removes their plans and participants' responses from the live service, subject to legal obligations and backup handling described in the Privacy Policy. Participants may ask us to remove their details from a plan.

**Availability and changes.** We aim to provide a reliable service but do not promise uninterrupted availability or that any proposed date will be suitable. We may amend the service and these Terms. Material changes will be notified before they take effect where reasonably practicable. Continuing to use the service after the effective date constitutes acceptance only where that mechanism is lawful; changes requiring fresh agreement will be presented for acceptance.

**Data.** Personal data is handled under the Privacy Policy. These Terms do not authorise sale of identifiable personal data. We may produce aggregate statistics only where individuals cannot reasonably be identified, including by combining the statistics with other information. If we propose a new identifiable-data sharing purpose, we will assess it and provide appropriate notice and choices before it begins.

**Liability and law.** Nothing excludes liability for fraud, death or personal injury caused by negligence, or any liability or consumer right that law does not allow us to exclude. Subject to that, we are responsible for foreseeable loss caused by our breach or failure to use reasonable care and skill. English law governs these Terms; consumers retain any mandatory protections applicable to them. [Review charging, refunds and cancellation terms before introducing paid plans.]

## B. Privacy Policy — proposed public text

**Who we are.** Hound Capital Ltd (company number 14932445), Mondays House, Farm Road, Bracklesham Bay, West Sussex, PO20 8JT is the controller of personal information used for prod. Contact office@hound-capital.com for privacy enquiries. You may complain to the Information Commissioner's Office (ico.org.uk).

**What we collect.** Organisers provide a name, email, sex selection (including “Prefer not to say”), age range, and acceptance of Terms. We record the Terms version and acceptance time. They create plan titles, dates, participant names and optional participant emails. Participants provide availability responses, and may provide an email to open an invitation. Authentication providers process verification codes and account identifiers. We may hold IP addresses, technical logs and support correspondence. Please avoid entering sensitive information in free-text fields.

**Where details come from.** Organisers give us invitees' names and optional emails. Participants provide their own responses. If your details were added by an organiser, the relevant plan and this notice explain their source; contact us if you want your entry removed. [Before public launch, provide an effective way to deliver Article 14 information to invitees whose email is collected, normally by a timely invitation or notice. The current app does not send invitations itself.]

| Purpose | Data | Lawful basis (to validate before launch) |
|---|---|---|
| Register organisers, verify email, run plans and show results | Account, plan and availability details | Contract with registered organiser |
| Add invitees and coordinate a plan | Names, emails, responses | Legitimate interests of organiser and participants, subject to a documented balancing assessment; participant interactions may also involve contract |
| Protect accounts, detect abuse and answer requests | Security logs, support records | Legitimate interests and, where applicable, legal obligation |
| Record terms acceptance and meet legal duties | Version, time, necessary correspondence | Legitimate interests or legal obligation as applicable |

We do not currently send marketing emails or sell identifiable personal information. We share data with contracted providers for hosting, storage, authentication and email delivery, currently including Cloudflare and Supabase; [identify any separate mail provider after audit]. Other participants in the same plan can see names and availability; organisers may see participant emails. We may disclose information when law requires it or in a business sale subject to applicable privacy rules and appropriate notice. We will specify locations, transfer safeguards and recipients once provider contracts and configuration are verified; do not publish a claim that all data stays in the UK without verification.

**Retention.** While an account or plan is active, its details remain in the live service. Account deletion removes the organiser's plans, associated participant records and responses, and the organiser's account from live systems. An invitee may request removal of their entry. [Specify and implement actual inactivity periods, support-record retention, security-log periods and backup lifecycle before publication; a 30-day deletion promise is not verified.] Where an erasure exception applies, explain it to the requester. Deleted material in backups must be isolated from routine use, have a defined expiry, and be re-erased if a backup is restored.

**Your rights.** Depending on the basis and circumstances you may request access, rectification, erasure, restriction, portability or object to processing based on legitimate interests. Email office@hound-capital.com. We will verify requests proportionately and answer within the applicable statutory period. We do not make solely automated decisions with legal or similarly significant effects. Children are not intended users; the age range is self-declared and we do not collect date of birth or identity documents.

## C. Cookie notice — proposed public text

prod. uses a first-party `dateeye_admin` HTTP-only cookie, with Secure on HTTPS and SameSite=Strict, to maintain an authenticated organiser session. The Worker sets its lifetime to the shorter of the token lifetime or one hour. It is necessary to supply the requested sign-in service and does not require optional-cookie consent. [Audit Cloudflare challenge/security cookies, Supabase redirects, local/session storage and any analytics in the deployed browser; list each technology, provider, purpose and expiry before publication.] Do not load optional analytics or advertising technologies until the applicable consent mechanism has been implemented. Contact office@hound-capital.com about this notice.

## D. Internal retention schedule — proposed, pending implementation

| Record | Proposed trigger and period | Action / owner |
|---|---|---|
| Active account and plans | While needed for service | Delete on verified account request; product owner |
| Inactive plans | Consider review after 12 months inactivity, delete after a notified period | Requires scheduled job and user notice; product owner |
| Invitee email and responses | Until plan deletion or valid erasure request | Build invitee-specific erasure workflow; product owner |
| Auth and security logs | Provider-defined period to document | Obtain provider schedules; security owner |
| Support requests | Define period justified by dispute needs | Review and delete; privacy owner |
| Backups | Actual provider rotation to document | Restrict, expire and re-erase on restore; operations owner |
| Terms acceptance | While account exists and a proportionate dispute period thereafter if necessary | Version and time; privacy owner |

Do not state proposed periods as operational facts until configured and tested. Keep a deletion request log with minimal identifying information and disposition.

## E. Processing register and supplier checks

| Flow | Data | Access and open verification |
|---|---|---|
| Browser ↔ Cloudflare Worker | session cookie, email, plan details | HTTPS, access logs, DPA, subprocessors, region and transfers |
| Worker ↔ Supabase Auth | email, verification, token, registration metadata | DPA, authentication settings, email template/provider, region, deletion behaviour |
| Worker ↔ Supabase database | profiles, plans, names, emails, dates, responses | service-role RPC privileges, RLS, backup lifecycle, retention |
| Organiser ↔ invitee | plan link, names, availability | Current invitee email is not verified; fix authorisation before launch |

Controller: Hound Capital Ltd. Confirm the supplied address is the registered office, then obtain supplier agreements, transfer mechanism, privacy contact, legitimate-interest assessment for invitations, provider breach contacts and ICO fee self-assessment. Check whether the sex field has a justified purpose; otherwise remove it and migrate old records. Complete a children's access risk assessment: an 18+ statement and self-declared age alone do not establish that children are unlikely to use a friends-planning service.

## F. Personal-data breach procedure

1. Staff or provider immediately reports suspected loss, disclosure or unauthorised access to the privacy owner, recording when prod. became aware.
2. Contain access; preserve logs; rotate affected keys/tokens; identify records, users, processors, cause and recovery actions.
3. Assess likely risk to individuals and record the decision. If risk is likely, notify ICO without undue delay and where feasible within 72 hours of awareness. If high risk, notify affected people without undue delay, unless an exception applies.
4. Coordinate with Cloudflare, Supabase and relevant recipients; document notifications, remediation and any reasons for delay.
5. Review the incident, correct causes, and keep a restricted breach register including non-reportable events.

## G. Implementation and launch decision register

- **Prepared code:** registration requires an 18+ age-range choice and explicit Terms checkbox, with server and database checks; public `terms.` footer; `/terms` and `/account` pages; authenticated deletion endpoint; migration `supabase/05_compliance.sql`.
- **Deletion scope:** all plans owned by the organiser and their participant data are deleted in one database transaction; Auth user is then deleted using Supabase admin API. If the second step fails, support must complete it. No claim of immediate backup erasure.
- **Current production risk:** an invited participant's access depends on the plan link and an unverified email entered in the browser. Secure invitee verification or scoped invitation tokens before offering the service publicly. Review existing accounts without new acceptance records and provide acceptance gate.
- **Age:** the blocker applies to organiser registration, not invitee email-only access. A child can misstate age or respond as an invitee. Decide an age assurance approach after risk assessment.
- **Data sale:** no blanket clause or pre-ticked consent. Selling identifiable emails, sex/age information, plan details or availability would need a specific purpose, recipient categories, valid lawful basis, fairness assessment, updated notice and relevant rights. Marketing use requires separate PECR analysis. Truly anonymous aggregate insights may be commercialised only after a documented re-identification assessment. Pseudonymised data remains personal data.
- **Before publishing:** verify company details, DPA/transfers, cookie audit, exact retention/backup periods, Article 14 invitee notice, existing-user acceptance, invitee authentication, and legal review. Apply SQL before deploying code, then test registration, underage rejection, deletion and legacy plan behaviour on staging.
