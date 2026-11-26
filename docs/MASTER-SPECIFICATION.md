<!--
  Authoritative EP00 master specification, supplied by the project owner (PDA BLISS COMPANY LIMITED).
  Stored verbatim. Other docs reference this file instead of repeating it.
  Imported: 2026-11-26.
-->

> **Owner amendment (2026-11-26, before EP02 implementation):** the database is **MariaDB**
> (InnoDB, utf8mb4) with Prisma, replacing PostgreSQL. Wherever the verbatim text below says
> PostgreSQL, read MariaDB. The EP00 and EP01 reports are historical and keep their original
> wording. Details: [EP02-DATABASE.md](EP02-DATABASE.md).

# PDA BLISS FLOW

## EP00 — Signature Product Identity, Design System & Engineering Foundation

### FINAL CONSOLIDATED MASTER SPECIFICATION

Version: 1.0
Project Owner: PDA BLISS COMPANY LIMITED
Development Strategy: One-Day Signature Product Sprint
Environment: Local Windows Development
Current Episode: EP00
Official Mascot: Sally

---

# 0. EXECUTION AUTHORITY AND ROLE

You are acting as a combined:

- Principal Full-Stack Engineer.
- Senior Software Architect.
- Senior Product Designer.
- UX/UI Director.
- Brand Experience Designer.
- LINE Platform Integration Engineer.
- Database Architect.
- Security Engineer.
- QA Automation Engineer.
- DevOps Engineer.

Your assignment is to establish a new standalone software product named PDA BLISS FLOW.

This is a signature product of PDA BLISS COMPANY LIMITED.

The owner expects exceptional visual quality, original product identity, intuitive usability, reliable architecture, strong privacy protection, and professional engineering standards.

The product must not look like an ordinary LINE chatbot, generic calendar application, default SaaS dashboard, or hastily generated AI prototype.

It should demonstrate that PDA BLISS can transform an everyday messaging platform into a polished, intelligent, useful, and memorable digital product.

Read this entire specification before beginning implementation.

This is the single authoritative specification for EP00.

Execute EP00 only.

Do not automatically proceed to EP01 or any subsequent episode.

---

# 1. OFFICIAL PROJECT CONFIGURATION

## 1.1 Product Identity

Product name:

PDA BLISS FLOW

Short product name:

FLOW

Official mascot:

Sally

Thai mascot name:

น้องแซลลี่

Product category:

Shared Calendar & LINE Personal Assistant

Brand statement:

THE INTELLIGENCE OF EVERYDAY LIFE

Primary Thai tagline:

ทุกนัดหมาย ถูกเวลา ถูกคน ถูกกลุ่ม

Secondary tagline:

เรื่องเวลาปล่อยให้ Sally ดูแลนะคะ

Creator signature:

Designed & Engineered by PDA BLISS

## 1.2 Official Local Development Directory

The exact project directory is:

D:\One Drive\OneDrive\Desktop\project\pdabliss_flow

This is the owner's LOCAL Windows development workstation.

It is NOT the production server.

Perform all project-related implementation within this exact project directory.

Never create another nested pdabliss_flow directory.

Never relocate the project without explicit owner approval.

The directory contains spaces.

Always quote paths correctly.

Use PowerShell LiteralPath where appropriate.

Verify the actual working directory before modifying files.

If files already exist, inspect them before proceeding.

Never overwrite unrelated existing work.

## 1.3 Repository

Repository name:

pdabliss_flow

Initialize Git only if the directory is not already a valid Git repository.

The future remote repository is expected to be private.

Do not assume that a GitHub remote already exists.

Do not create a remote repository or push code during EP00.

A local Git commit is permitted after the applicable quality gates pass.

## 1.4 Proposed Network Configuration

Frontend development port:

6767

Backend development port:

6768

Future production domain:

flow.pdabliss.com

Future production PM2 process names:

- pdabliss-flow-frontend
- pdabliss-flow-backend
- pdabliss-flow-worker

All ports and process names are proposed configurations.

Check actual availability before binding ports.

Never terminate unrelated processes to reclaim a port.

If a port conflict exists, report it and use a clearly documented temporary local alternative if necessary.

Do not configure production DNS, Cloudflare Tunnel, or PM2 processes during EP00.

## 1.5 Database Isolation

Proposed databases:

Development:

pdabliss_flow_dev

Automated testing:

pdabliss_flow_test

Production:

pdabliss_flow

Development, testing, and production must be strictly separated.

Never connect automated tests to production databases.

Never reuse production credentials locally.

EP00 does not require creation of a real production database.

Prepare the database architecture and development integration plan.

Do not make PostgreSQL availability an unnecessary blocker for the EP00 visual prototype or basic application health checks.

## 1.6 Localization

Primary language:

Thai

Secondary language:

English where appropriate for branding and technical terminology.

Default timezone:

Asia/Bangkok

Store actual appointment instants in UTC.

Retain the relevant IANA timezone and local recurrence semantics when needed.

All-day events must preserve local calendar dates.

Do not incorrectly convert all-day events into UTC-based calendar dates.

Use Thai-friendly date and time formatting.

Handle Buddhist Era display correctly where applicable.

---

# 2. PRODUCT VISION

PDA BLISS FLOW is a LINE-first scheduling assistant designed for personal life, family coordination, company appointments, and authorized group communication.

Users should be able to manage appointments without installing a separate mobile application.

The product should feel like a premium application embedded inside LINE.

The primary experience consists of:

- LINE Official Account.
- LINE Rich Menu.
- LINE Flex Messages.
- LIFF Web Application.
- LINE authentication.
- Reliable scheduled notifications.
- Multi-group calendar management.

The system should connect people to the right appointments at the right time without exposing unrelated information.

The system is not intended to replace Google Calendar, enterprise ERP, payroll, HR attendance, or full-scale project management software.

It should remain focused, polished, lightweight, and useful in everyday life.

---

# 3. BUSINESS AND USER REQUIREMENTS

## 3.1 Primary Users

Initial users include:

- The project owner.
- The owner's spouse.
- The owner's mother.
- Company executives.
- Employees.
- Authorized participants in registered LINE groups.

The initial release is a controlled private system.

Public self-service registration is not required for the first release.

General users may experience the product through authorized invitations or a separate demonstration environment.

## 3.2 Primary Use Cases

The owner must eventually be able to:

- Open LINE.
- Open Sally's Official Account.
- Select Create Appointment.
- Enter an appointment title.
- Select a date and time.
- Select appointment category.
- Select who can view the appointment.
- Select the LINE notification destination.
- Select one or more reminder times.
- Preview the actual notification design.
- Review estimated LINE message consumption.
- Confirm and save the appointment.
- Close the LIFF application.
- Receive automatic notifications at the scheduled time.

The scheduling engine must operate independently of whether the user keeps LINE or LIFF open.

## 3.3 Example Scenarios

Scenario A — Family appointment:

Appointment: นัดหาหมอ

Authorized audience:

- Owner.
- Spouse.
- Mother.

Destination:

Registered family LINE group.

Employees must not see or receive this appointment.

Scenario B — Company meeting:

Appointment: ประชุมพนักงาน

Authorized audience:

- Owner.
- Authorized executives.
- Authorized employees.

Destination:

Registered company LINE group.

Unauthorized family members must not receive this appointment.

Scenario C — Personal appointment:

Appointment: เรียน Network

Authorized audience:

- Owner only.

Destination:

Private LINE conversation with Sally.

Scenario D — Shared appointment:

Appointment: กิจกรรมร่วมกันระหว่างครอบครัวและบริษัท

Authorized audience:

Explicitly approved participants.

Destination:

One or more specifically selected authorized groups or individual recipients.

Scenario E — Confidential subset:

An appointment should be visible to only two members of a larger LINE group.

The system must use authorized private notifications instead of posting confidential information to the entire group.

Never assume that a LINE group message can be hidden from selected group members.

---

# 4. NON-NEGOTIABLE PRODUCT PRINCIPLES

The following principles are mandatory:

1. LINE First.
2. Experience First.
3. Mobile First.
4. Original visual identity.
5. Exceptional Thai readability.
6. Premium but friendly interaction.
7. Privacy by Design.
8. Deny-by-default authorization.
9. Multi-group architecture from the beginning.
10. Zero additional monthly subscription cost as the target.
11. No automatic paid subscription upgrades.
12. Persistent and reliable scheduling.
13. Explicit notification destination validation.
14. No silent notification failures.
15. No fake functional success indicators.
16. No misleading mock data.
17. No unauthorized production changes.
18. No interference with existing systems.
19. Maintainable engineering.
20. Evidence-based quality assurance.
21. Tasteful creator attribution.
22. Simple operation for nontechnical users.

Do not sacrifice security, accessibility, reliability, or usability to achieve visual effects or a one-day timeline.

---

# 5. OFFICIAL MASCOT — SALLY

## 5.1 Character Identity

The official product mascot is Sally.

Thai name:

น้องแซลลี่

Sally is inspired by the elegant, intelligent, warm, and friendly personality of Sally Carrera from Pixar's Cars.

The visual inspiration includes a sophisticated soft automotive blue and metallic silver aesthetic.

Create an original character specifically for PDA BLISS FLOW.

Do not reproduce official Pixar character artwork, the existing Sally Carrera vehicle design, copyrighted promotional images, or Disney/Pixar logos.

Do not imply an official collaboration, endorsement, or licensing relationship.

The mascot must have its own original silhouette, expressions, identity, and design language.

## 5.2 Personality

Sally is:

- Feminine.
- Intelligent.
- Elegant.
- Warm.
- Professional.
- Thoughtful.
- Dependable.
- Calm.
- Friendly.
- Approachable.

Sally should feel like a capable personal secretary rather than a childish cartoon character or conventional technical chatbot.

## 5.3 Visual Direction

Design an original luxury technology assistant mascot.

Suggested visual characteristics:

- Soft automotive-inspired blue.
- Metallic silver accents.
- Ice blue highlights.
- Premium ivory details.
- Expressive but restrained facial features.
- Clean and recognizable silhouette.
- Subtle clock, calendar, or time-inspired elements.
- Modern intelligent assistant appearance.

Create an original lightweight SVG mascot concept.

The mascot should remain recognizable when displayed at small LINE profile and notification sizes.

Avoid unnecessary visual complexity.

Create initial expression concepts where practical:

- Default / welcoming.
- Happy confirmation.
- Reminder.
- Thoughtful.
- No appointments.
- Error or unavailable.

Do not spend excessive time producing a complete illustration library during EP00.

The mascot name is final.

The artwork is a provisional original design pending owner review.

## 5.4 Communication Style

Sally communicates primarily in natural Thai.

Use polite feminine Thai expressions.

Avoid excessive emojis, repetitive greetings, childish wording, or long unnecessary explanations.

Example messages:

Welcome:

สวัสดีค่ะ Sally มารายงานตัวแล้ว วันนี้มีอะไรให้ช่วยดูแลไหมคะ

Appointment saved:

Sally บันทึกนัดหมายให้เรียบร้อยแล้วค่ะ

Upcoming reminder:

อีก 30 นาทีจะถึงเวลานัดหมายแล้วนะคะ

Family reminder:

อย่าลืมนัดสำคัญของครอบครัววันนี้นะคะ

Company reminder:

อีก 15 นาทีจะเริ่มประชุมค่ะ กรุณาเตรียมตัวให้พร้อมนะคะ

Empty schedule:

วันนี้ยังไม่มีนัดหมายค่ะ ใช้เวลากับสิ่งที่สำคัญได้เต็มที่เลยนะคะ

Error:

ขออภัยค่ะ Sally ยังไม่สามารถดำเนินการรายการนี้ได้ กรุณาลองใหม่อีกครั้งนะคะ

Never claim that an appointment has been saved or a LINE message has been sent unless the operation actually succeeded.

All EP00 simulated messages must be visibly marked as prototype examples.

---

# 6. BRAND AND SIGNATURE VISUAL EXPERIENCE

## 6.1 Creative Direction

Official design direction:

Luxury Tech × Friendly Assistant × Editorial Minimalism

The design must feel premium, modern, original, elegant, intelligent, and accessible.

The product should have a strong visual identity without becoming visually complicated.

The owner wants family members, employees, executives, and other users to immediately recognize that this is a carefully designed and engineered PDA BLISS product.

Do not optimize only for first impressions.

Optimize for repeated everyday use.

## 6.2 Design Pillars

Beautiful by Default:

Every screen and notification must have an intentional visual hierarchy.

Clear at a Glance:

Users should quickly understand the appointment title, date, time, audience, and required action.

Right Information, Right People:

The selected audience and notification destination must always be clear.

Premium but Friendly:

The interface should feel professional without being intimidating.

Signature Experience:

The visual language must be recognizable as FLOW rather than a generic calendar template.

Engineering Excellence:

The visual experience must be supported by reliable and maintainable implementation.

## 6.3 Core Brand Palette

Suggested starting tokens:

- Deep Forest: #0B211C
- Emerald: #16836B
- Soft Mint: #A5EFCB
- Ivory: #F8F7F2
- Graphite: #202923

Sally complementary palette:

- Sally Blue: #A8D2E8
- Ice Blue: #EAF5FC
- Metallic Silver: #C8D9E6
- Deep Blue: #34566E
- Muted Blue: #517F9F

These are starting design tokens.

Refine them when necessary to achieve accessibility and coherent visual contrast.

Document any changes.

Do not use LINE green as the entire product identity.

FLOW must have its own recognizable brand.

## 6.4 Appointment Category Themes

Create distinct visual themes for:

Family:

Warm rose, soft ivory, and calm welcoming details.

Business:

Deep forest, sophisticated navy, and professional editorial hierarchy.

Personal:

Muted violet, graphite, and understated visual accents.

Health:

Calm teal, clean neutral surfaces, and exceptionally clear timing.

Special occasions:

Champagne gold, warm ivory, and celebratory details.

Urgent:

Accessible amber or red accents with restrained emphasis.

Do not rely on color alone to communicate event category, urgency, or status.

Use readable labels and appropriate iconography.

## 6.5 Typography

Choose a highly legible Thai-compatible font system.

Verify font licensing.

Prefer self-hosted open-license fonts where appropriate.

Use clear text hierarchy.

Ensure:

- Thai vowels and tone marks are not clipped.
- Appointment titles remain readable.
- Date and time are visually prominent.
- Body text is comfortable to read.
- Older adults can use the interface.
- Long Thai text wraps naturally.
- English branding does not reduce Thai usability.

Avoid extremely small text.

Use tabular numerals for time displays where supported.

## 6.6 Motion and Interaction

Use purposeful micro-interactions.

Examples:

- Smooth screen transitions.
- Appointment category selection.
- Group selection confirmation.
- Calendar date selection.
- Live notification preview updates.
- Save confirmation.
- Loading state transitions.

Avoid:

- Excessive animations.
- Heavy particle effects.
- Continuous distracting backgrounds.
- Slow transitions.
- Large unnecessary animation dependencies.

Respect prefers-reduced-motion.

The application must remain responsive on ordinary mobile devices.

---

# 7. SIGNATURE LINE EXPERIENCE

## 7.1 LINE Rich Menu

Design an original premium six-action Rich Menu.

Menu actions:

1. วันนี้ — Today.
2. ปฏิทิน — Calendar.
3. เพิ่มนัดหมาย — Create Appointment.
4. กลุ่มของฉัน — My Groups.
5. ประวัติ — History.
6. ตั้งค่า — Settings.

The Create Appointment action should be visually prominent.

Include Sally and FLOW branding tastefully.

The design must remain readable on actual mobile LINE screens.

Do not rely only on icons.

Use readable Thai action labels.

Prepare:

- Original Rich Menu design asset.
- Conceptual action regions.
- Route mapping.
- Export specification for future LINE upload.
- Clearly labeled local preview.

Verify actual LINE Rich Menu image and action-area requirements against official documentation.

Do not upload or register the Rich Menu in EP00.

## 7.2 Welcome Experience

Design a premium welcome concept for users opening Sally's LINE account.

The welcome experience should communicate:

- Who Sally is.
- What FLOW does.
- How to create an appointment.
- How to view the calendar.
- How group privacy works.
- How to get help.

Keep the introduction brief and approachable.

Do not present excessive onboarding steps.

## 7.3 LINE Flex Message Direction

LINE Flex Messages are the primary notification presentation format.

Do not rely on ordinary plain-text notifications when a suitable Flex Message can provide a better experience.

Design each category with a recognizable visual identity while preserving consistent information hierarchy.

Create representative visual prototypes for the following ten templates:

1. Family appointment.
2. Business meeting.
3. Personal appointment.
4. Health appointment.
5. Special occasion.
6. Urgent reminder.
7. Appointment changed.
8. Appointment cancelled.
9. Daily schedule summary.
10. Appointment saved confirmation.

Each template should define:

- Template identifier.
- Appointment category.
- Header treatment.
- Main title.
- Date and time.
- Timing context.
- Location when available.
- Relevant audience or destination.
- Optional concise description.
- Primary action.
- Optional secondary action.
- Accessible plain-text fallback.
- Subtle FLOW branding.

The visual hierarchy must prioritize what, when, and what to do next.

Keep important appointment information visible even if decorative images fail to load.

Design with actual LINE Flex Message capabilities in mind.

Do not assume arbitrary HTML, CSS, JavaScript, SVG rendering, dynamic countdowns, or complex animations are supported inside LINE Flex Messages.

Decorative artwork may be represented as separate compatible image assets in future implementation.

Do not create deceptive interactive controls that cannot actually work in LINE.

In EP00, visual templates may be represented using a reusable local design preview system.

Actual LINE API sending and provider validation belong to future episodes.

---

# 8. SIGNATURE APPOINTMENT CREATION EXPERIENCE

The appointment creation form is a central product experience.

The form must be visually distinctive, simple, and understandable to ordinary users.

It must eventually support the following sections.

## 8.1 Appointment Information

- Appointment title.
- Appointment category.
- Optional description.
- Optional location.
- Optional preparation checklist.
- Optional priority.

## 8.2 Date and Time

- Appointment date.
- Start time.
- Optional end time.
- All-day appointment.
- Timezone.
- Optional recurrence.

## 8.3 Audience and Notification Destination

Support:

- Only myself.
- One registered LINE group.
- Multiple registered LINE groups.
- Authorized individual recipients.

Use an intuitive dropdown or searchable group selector.

Display:

- Group name.
- Group category.
- Estimated member count where available.
- Permission context.
- Notification destination type.
- Audience summary.

Do not expose raw LINE group IDs in normal user interfaces.

Do not automatically select a sensitive or broad group.

The default selection should be private or require explicit destination selection.

The user must be able to clearly understand who can view the appointment and where notifications will be sent.

## 8.4 Reminder Configuration

Eventually support:

- At appointment time.
- 5 minutes before.
- 10 minutes before.
- 15 minutes before.
- 30 minutes before.
- 1 hour before.
- 2 hours before.
- 1 day before.
- Custom reminder time.
- Multiple reminders.

Show the actual calculated reminder date and time before confirmation.

Prevent invalid, duplicated, or past reminders according to documented rules.

## 8.5 Signature Live Preview

Include a live notification preview.

When a user changes form values, the preview should update immediately.

Preview inputs include:

- Appointment title.
- Category.
- Date.
- Time.
- Location.
- Notification destination.
- Reminder settings.

The preview should visually resemble the intended LINE notification.

Clearly label it as a preview.

Do not send real LINE messages during EP00.

For appointments targeting multiple groups, plan separate destination-specific previews.

Never include unrelated group information in a preview.

## 8.6 Confirmation Experience

Before actual saving in future episodes, display:

- Appointment information.
- Authorized audience.
- Notification destinations.
- Scheduled reminder times.
- Estimated message quota consumption.
- Important privacy warnings when applicable.

The user must be able to go back and make corrections.

Do not blur the distinction between saving an appointment and sending an immediate notification.

EP00 implements only the representative interactive prototype of this experience.

No real database persistence is required for the form prototype.

---

# 9. MULTI-GROUP ARCHITECTURE

## 9.1 Core Architecture

One FLOW LINE Official Account should serve multiple authorized LINE groups, subject to verified LINE platform constraints.

Example logical workspaces:

- Personal.
- Family.
- S2 Accounting.
- PDA BLISS.
- Executives.
- Additional registered groups.

Users may belong to multiple workspaces.

The owner and the owner's mother may have access to both family and company workspaces.

Employees should only have access to authorized company workspaces.

The owner's spouse should only have access to authorized family or shared appointments unless explicitly granted additional access.

Use a single maintainable application architecture.

Do not create separate application deployments or databases for every LINE group.

Use properly scoped logical isolation.

## 9.2 Separate Domain Concepts

The following must remain separate:

- User identity.
- Workspace.
- Workspace membership.
- Registered LINE destination.
- Appointment.
- Appointment visibility.
- Appointment participants.
- Notification destination.
- Reminder schedule.
- Notification delivery record.

A LINE group is a communication destination.

It is not automatically a trusted application authorization boundary.

A user's presence in a LINE group must not automatically grant access to every historical or future appointment stored by FLOW.

Appointment visibility and notification destination must be independently authorized.

Do not simplify them into a single unvalidated groupId field.

## 9.3 Group Registration

Design the future registration flow:

1. Sally is invited to an eligible LINE group.
2. LINE sends an appropriate webhook event.
3. FLOW validates the webhook signature.
4. FLOW records the destination as pending registration.
5. An authorized FLOW administrator verifies the destination.
6. The administrator associates it with an authorized workspace.
7. The destination is activated.
8. The destination appears in authorized users' group selectors.

A registration command by itself must not grant administrative privileges.

Use an owner-approved or short-lived verified registration mechanism.

Do not allow unauthorized users to register arbitrary groups.

## 9.4 Group Lifecycle

Design for:

- Pending registration.
- Active.
- Disabled.
- Bot removed.
- Membership changed.
- Verification required.
- Archived.

If Sally is removed from a group, scheduled messages for that destination must be blocked or marked as failed appropriately.

Never silently redirect a group notification to another group.

For sensitive appointments, revalidate destination eligibility before sending.

Where current recipient authorization cannot be established, block the sensitive group notification or require an approved private delivery route.

## 9.5 Role Model

Proposed application roles:

- System Owner.
- Workspace Admin.
- Member.
- Viewer.

Roles should be scoped appropriately.

System administration privileges must not silently expose private user appointments.

An administrator's management capabilities and content visibility permissions must be treated separately.

Support least privilege and explicit membership checks.

Do not implement unrestricted global data access simply because a user is an administrator.

## 9.6 Privacy Requirements

Mandatory future behavior:

- Family appointments must not leak to employees.
- Company appointments must not leak to unauthorized family members.
- Personal appointments must remain private.
- Unauthorized deep links must not reveal appointment details.
- Search results must respect appointment visibility.
- Calendar counts must not leak unauthorized information.
- Notification previews must respect destination permissions.
- Webhook responses must not expose unrelated appointments.
- Group summaries must contain only information authorized for that group.
- Audit logs must not unnecessarily contain sensitive appointment descriptions.

For medical and family appointments, design an optional minimal-disclosure notification mode.

For example, a notification may say:

คุณมีนัดหมายสำคัญเวลา 09:00 น.

Detailed appointment information should remain accessible only to authorized users.

A group notification is visible to all current members of that LINE group.

The system must warn users about this boundary.

Do not promise that already delivered LINE messages can be revoked or hidden from recipients.

---

# 10. FUTURE CALENDAR EXPERIENCE

The application must eventually provide:

## 10.1 Today Dashboard

Show:

- Today's date.
- Greeting from Sally.
- Next appointment.
- Today's authorized appointments.
- Upcoming important appointments.
- Group filters.
- Quick appointment creation.

The dashboard must not become a dense analytics interface.

## 10.2 Monthly Calendar

Show:

- Month navigation.
- Current date.
- Appointment indicators.
- Category labels or colors.
- Authorized group filters.
- Selected day agenda.
- Quick appointment creation.

Ensure the month view remains readable on narrow mobile screens.

## 10.3 Agenda Timeline

Provide a chronological view of appointments.

Group appointments by date.

Use prominent times and readable appointment cards.

Support upcoming and historical appointments.

## 10.4 Appointment Details

Eventually display:

- Appointment title.
- Category.
- Date and time.
- Location.
- Description.
- Authorized audience.
- Reminder schedule.
- Appointment status.
- Acknowledgement status where applicable.
- Edit or cancel actions when authorized.

## 10.5 Recurrence

Plan support for:

- Daily.
- Weekly.
- Monthly.
- Yearly.
- Custom recurrence where practical.

Document recurrence exceptions, timezone semantics, and individual occurrence changes.

Do not implement an unnecessarily complex recurrence engine during EP00.

---

# 11. FUTURE NOTIFICATION ENGINE

## 11.1 Architecture

Use a persistent database-backed scheduling architecture.

The worker must operate independently of the frontend.

Do not rely solely on in-memory timers or a browser remaining open.

Plan for:

- Persistent reminder records.
- Scheduled execution.
- Safe job claiming.
- Concurrent worker protection.
- Idempotency.
- Retry policy.
- Backoff.
- Delivery attempt history.
- Provider response tracking.
- Missed reminder recovery.
- Cancellation handling.
- Rescheduling.
- Dead-letter or terminal failure handling.
- Quota-aware execution.

Avoid introducing Redis or another infrastructure service unless later justified by real technical requirements.

## 11.2 Notification Lifecycle

Suggested states:

- Scheduled.
- Processing.
- Provider accepted.
- Retry scheduled.
- Failed.
- Blocked by quota.
- Blocked by authorization.
- Cancelled.
- Expired.

Acknowledgement must be tracked independently.

A provider success response does not prove that a human has received, read, understood, or acknowledged the message.

Do not label API acceptance as confirmed human delivery.

## 11.3 Reliability

Design for application restart, server restart, network interruption, and provider failure.

A restart must not silently erase pending reminders.

Editing an appointment must prevent obsolete reminder jobs from being sent.

Cancelling an appointment must prevent future pending reminders from being dispatched.

Document the policy for overdue reminders following recovery.

Do not deliver old reminders indiscriminately after a long outage.

Use documented expiration and missed-reminder behavior.

## 11.4 Acknowledgement

Plan for LINE postback actions such as:

- รับทราบแล้ว
- เข้าร่วม
- ไม่สามารถเข้าร่วมได้
- ดูรายละเอียด
- เลื่อนแจ้งเตือน

Authenticate and authorize the acting user.

Do not trust arbitrary postback parameters.

Prevent duplicate acknowledgements.

Personal snooze must not automatically send repeated reminders to an entire group.

These are future implementation requirements.

EP00 must not run an active scheduler or send notifications.

---

# 12. ZERO ADDITIONAL MONTHLY COST

## 12.1 Cost Objective

The target is zero additional monthly subscription cost.

Use existing approved infrastructure when the application reaches production.

Avoid:

- Paid AI APIs.
- Paid calendar libraries.
- Commercial UI component subscriptions.
- Additional hosting subscriptions.
- Automatic LINE subscription upgrades.
- Unnecessary third-party SaaS services.

The objective is zero additional subscription cost, not a claim that existing electricity, internet, hardware, domain, or maintenance costs are zero.

## 12.2 LINE Message Quota

The initial planning assumption is that the Thai LINE OA free plan provides 300 counted messages per month.

This must be verified against official current documentation and the actual account quota.

Do not hardcode 300 as an immutable platform rule.

Treat quota limits as provider-derived configuration.

Design for LINE quota and consumption APIs.

Distinguish:

- Push messages.
- Reply messages.
- Group recipients.
- Individual recipients.
- Provider-counted consumption.
- Local estimated consumption.
- Scheduled future consumption.

Group notifications may consume quota according to the number of recipients.

Connecting multiple groups does not itself consume notification quota.

Do not confuse a LINE access token with message quota.

## 12.3 Quota Management

Plan the following capabilities:

- Actual account quota.
- Actual provider-reported consumption.
- Local estimated usage.
- Estimated cost of each reminder.
- Group-level budget allocation.
- Upcoming reminder forecast.
- Configurable safety reserve.
- Remaining quota indicator.
- Safe handling of unknown group member counts.
- Hard quota guard.
- Blocked reminder history.
- Owner-facing quota status.

The quota guard must protect against concurrent sends overspending the available budget.

Use atomic reservation or equivalent safe coordination.

Reconcile estimates with provider-reported consumption.

Before a notification is dispatched, check that:

- The destination is authorized.
- The job remains valid.
- The reminder has not expired.
- The estimated consumption fits the safe remaining quota.

Do not silently bypass quota protection.

Never purchase additional messages or upgrade a paid subscription automatically.

## 12.4 Initial Channel Strategy

Initial release:

LINE only.

Telegram, Discord, Email SMTP, Web Push, and other notification channels are deferred.

Do not implement unnecessary fallback integrations during the one-day MVP.

If LINE quota is exhausted, preserve the appointment and expose a clear blocked-notification status.

Do not silently discard the reminder.

---

# 13. TECHNICAL STACK

Use stable, compatible versions.

Verify the actual local toolchain before selecting dependency versions.

Do not blindly install the newest package versions if compatibility is uncertain.

## 13.1 Frontend

- React.
- Vite.
- TypeScript.
- Tailwind CSS.
- React Router.
- TanStack Query where needed.
- React Hook Form.
- Zod.
- Lucide icons.
- Framer Motion where justified.

Evaluate an appropriate open-license calendar solution during the calendar implementation episode.

Do not add commercial calendar plugins.

## 13.2 Backend

- Node.js.
- Fastify.
- TypeScript.
- Prisma ORM.
- PostgreSQL.

Use a maintainable Fastify application factory.

Use appropriate request and response schemas.

Avoid excessive framework abstraction.

## 13.3 Worker

- Node.js.
- TypeScript.
- Shared domain contracts.
- PostgreSQL-backed scheduling architecture.

EP00 worker implementation is scaffold only.

It must not claim or execute real notification jobs.

## 13.4 Future LINE Integration

- LINE Official Account.
- LINE Messaging API.
- LINE Login.
- LIFF SDK.
- Rich Menu.
- Flex Messages.
- Webhook events.
- Postback actions.

Verify official platform requirements.

Where required for consistent user identity, plan LINE Login and Messaging API configuration under the appropriate shared LINE Developers Provider.

Do not assume that user identifiers from unrelated Providers are interchangeable.

## 13.5 Package Management

Use npm workspaces unless a verified existing project configuration requires another approach.

Commit an appropriate lockfile.

Avoid unnecessary dependencies.

Review dependency licenses and major security concerns.

Do not use unreviewed remote scripts or install unknown packages solely to generate visual effects.

---

# 14. REPOSITORY STRUCTURE

Create a pragmatic monorepo structure.

Suggested layout:

pdabliss_flow/
  apps/
    web/
    api/
    worker/
  packages/
    shared/
    design-system/
  assets/
    brand/
    mascot/
    rich-menu/
    flex-messages/
  docs/
  scripts/
  tests/
  package.json
  package-lock.json
  tsconfig.base.json
  .gitignore
  .env.example
  README.md

Adjust the structure only when technically justified.

Avoid empty packages with no useful purpose.

Create:

- Root workspace scripts.
- Shared TypeScript configuration.
- Appropriate lint configuration.
- Formatting configuration.
- Development scripts.
- Build scripts.
- Test scripts.
- Environment template.
- Local development instructions.

Provide convenient root commands such as:

- npm run dev
- npm run build
- npm run lint
- npm run typecheck
- npm run test

Use actual working scripts rather than placeholders reporting artificial success.

If a command is not implemented, do not claim that it is available.

---

# 15. ONEDRIVE DEVELOPMENT SAFETY

The official development directory is located inside a OneDrive-managed folder.

Account for:

- Synchronization delays.
- File locking.
- File watcher behavior.
- Long filesystem paths.
- Large generated dependency directories.
- Git metadata synchronization.
- Build artifacts.
- Temporary files.

Exclude inappropriate files from Git:

- node_modules.
- dist.
- coverage.
- Build caches.
- Browser test artifacts.
- Local environment files.
- Runtime logs.
- Temporary files.
- Database dumps.
- Secrets.
- Generated credentials.

Do not assume Git ignore rules prevent OneDrive synchronization.

Never store real LINE credentials, production secrets, or sensitive appointment data inside the synchronized project folder.

EP00 environment templates must contain placeholders only.

For future episodes, document a secure local secret-loading strategy outside the synchronized directory or using an appropriate operating system secret mechanism.

Do not modify global OneDrive configuration.

Do not disable synchronization globally.

Do not relocate the owner's project.

If synchronization causes actual problems, diagnose them and report evidence.

Do not apply unnecessary system-level workarounds.

---

# 16. EXISTING PDA BLISS INFRASTRUCTURE

The organization operates an existing Windows-based production environment.

Known production server specifications include:

- Intel Core i7-10700.
- 64 GB RAM.
- SSD 1 TB.
- M.2 SSD 256 GB.
- HDD 2 TB.
- NVIDIA Quadro P400 2 GB.
- Windows 11 Pro.

Existing infrastructure includes:

- Node.js.
- PostgreSQL.
- MariaDB.
- PM2.
- Cloudflare Tunnel.
- Git.

Existing systems include:

- PDA ONE.
- PDA BLISS CORE.
- PDA BLISS Property.
- S2 Accounting Website.
- PDA BLISS Website.
- Payroll.
- HR LINE Bot.

These are production context references only.

The current workstation is not assumed to have the same configuration.

Treat existing production workloads as protected.

Do not connect to, alter, restart, migrate, delete, or reconfigure existing production systems.

The HR LINE Bot may be inspected only as a read-only architecture reference when safely available locally.

Do not copy its production credentials.

Do not modify its code.

Do not assume that its implementation must be reused.

FLOW must remain a standalone product.

---

# 17. OFFICIAL LINE PLATFORM VERIFICATION

When internet access is available, consult official LINE documentation for:

- Thai LINE OA free-plan message quota.
- Message-counting rules.
- Push versus reply message accounting.
- Group notification accounting.
- LINE OA group participation.
- Restrictions on multiple LINE OAs joining one group.
- Group member count APIs.
- Group membership and identity limitations.
- Group join and leave webhooks.
- LIFF application behavior.
- Server-side LINE identity verification.
- LINE Provider identity scope.
- LINE webhook signature verification.
- Webhook redelivery behavior.
- Messaging API retry mechanisms.
- Flex Message specifications.
- Rich Menu specifications.
- Account quota endpoints.

Prefer official documentation over third-party tutorials.

Record relevant source URLs and verification dates.

Distinguish verified platform facts from planning assumptions.

If internet access is unavailable, document the unverified requirements.

Do not invent platform capabilities.

If a LINE group already contains another Official Account, document the compatibility issue and possible future owner-approved alternatives.

Do not remove or modify the existing HR LINE Bot.

---

# 18. EP00 IMPLEMENTATION SCOPE

EP00 is the product foundation episode.

It is not the full product implementation.

Complete the following work.

## 18.1 Read-Only Local Discovery

Inspect:

- Current working directory.
- Exact project directory.
- Existing files.
- Git repository status.
- Node.js version.
- npm version.
- Git version.
- PostgreSQL client or local availability.
- Proposed frontend port.
- Proposed backend port.
- Local toolchain compatibility.
- Existing relevant local processes where safely necessary.

Report actual results.

Do not print secrets or environment variable contents containing credentials.

Do not scan unrelated personal files.

Do not inspect production systems.

## 18.2 Repository Foundation

Create or prepare:

- npm workspace structure.
- Frontend application shell.
- Backend application shell.
- Worker scaffold.
- Shared contracts where needed.
- Design-system foundation.
- Documentation directories.
- Original design asset directories.
- Test infrastructure.

Verify that the project builds.

## 18.3 Original Brand Assets

Create:

- Original FLOW wordmark concept.
- Original FLOW logo symbol concept.
- Original Sally mascot concept.
- Initial category theme system.
- Rich Menu visual concept.
- Notification template visual concepts.

Prefer lightweight original assets.

Keep editable source files where practical.

Do not use copyrighted character artwork.

Do not rely on unlicensed stock images.

## 18.4 Design System

Implement reusable foundations for:

- Color tokens.
- Typography.
- Spacing.
- Border radius.
- Shadows.
- Icon usage.
- Buttons.
- Cards.
- Form inputs.
- Select controls.
- Group chips.
- Category indicators.
- Date and time displays.
- Navigation.
- Confirmation states.
- Empty states.
- Error states.
- Loading states.
- Focus indicators.
- Accessible interaction patterns.

Create intentional styles.

Do not leave default browser styles as the primary product experience.

## 18.5 Local Design Showcase

Create a development-only showcase route.

Suggested route:

/dev/design-showcase

The route should include:

A. Product identity and brand presentation.

B. Sally mascot concept.

C. Color and typography system.

D. Reusable UI component examples.

E. Premium LINE Rich Menu preview.

F. Signature notification templates.

G. Today dashboard prototype.

H. Appointment creation prototype.

I. Group selection prototype.

J. Live notification preview.

K. Empty, loading, error, and confirmation states.

Use one coherent showcase experience rather than duplicating many complete pages.

The showcase must be explicitly development-only.

It must not be exposed in a production build unless explicitly authorized.

Use mock fixtures only.

Mock appointments must not contain real family, medical, or confidential employee information.

Use generic demonstration data.

## 18.6 Interactive Appointment Prototype

Implement enough local interaction to demonstrate:

- Appointment title editing.
- Category selection.
- Date selection.
- Time selection.
- Private destination.
- Family group selection.
- Company group selection.
- Multiple destination selection concept.
- Reminder selection.
- Live preview updates.
- Estimated message quota calculation using mock counts.
- Confirmation review.

Clearly label the data as simulated.

Do not claim that a mock appointment was saved to a real database.

Do not send a LINE message.

Do not implement full appointment CRUD persistence during EP00.

## 18.7 Backend Foundation

Implement:

- Fastify application factory.
- Environment validation.
- Structured logging.
- Sensitive-data redaction.
- Basic health endpoint.
- Consistent error format.
- Initial security headers where appropriate.
- Restricted development CORS configuration.
- Graceful shutdown.
- Basic automated tests.

Suggested health endpoint:

GET /health

The health response must not expose secrets, internal credentials, or unnecessary system information.

A basic application health endpoint should not depend on unavailable future integrations.

Do not implement fake production authentication.

Do not create dummy endpoints that claim to send notifications.

Bind local development endpoints to loopback by default.

## 18.8 Worker Scaffold

Create a minimal maintainable worker foundation.

Document future interfaces for:

- Job claiming.
- Reminder processing.
- Idempotency.
- Provider delivery.
- Retry.
- Quota reservation.
- Shutdown.

Do not implement or start an active notification scheduler.

The worker must not connect to production services.

## 18.9 Domain Model Planning

Document the proposed relationships for:

- User.
- Workspace.
- WorkspaceMembership.
- LineIdentity.
- LineDestination.
- DestinationRegistration.
- Appointment.
- AppointmentAudience.
- AppointmentParticipant.
- AppointmentDestination.
- ReminderRule.
- NotificationJob.
- NotificationAttempt.
- Acknowledgement.
- QuotaReservation.
- AuditEvent.

These are proposed domain concepts, not a requirement to create all tables in EP00.

Avoid unnecessary database migrations.

Finalize actual persistence requirements in later implementation episodes.

---

# 19. REQUIRED FUTURE INFORMATION ARCHITECTURE

Document a proposed route map for:

- Welcome.
- Onboarding.
- Today.
- Monthly calendar.
- Agenda.
- Create appointment.
- Appointment details.
- Edit appointment.
- Notification preview.
- Appointment history.
- My groups.
- Group details.
- Group registration.
- Group members.
- Permissions.
- Reminder settings.
- Notification history.
- Quota dashboard.
- Profile.
- Settings.
- Help.
- About FLOW.
- Behind the Product.
- Access denied.
- Connection error.
- Not found.

The above screens are future product requirements.

They are not all required to be fully implemented during EP00.

Document:

- Purpose.
- Primary user.
- Entry point.
- Primary action.
- Required permissions.
- Main components.
- Important empty or error states.

Keep the route specification concise and actionable.

---

# 20. CREATOR SIGNATURE

FLOW should be recognizable as a PDA BLISS product.

Include tasteful creator attribution.

Preferred text:

Designed & Engineered by PDA BLISS

Potential future placement:

- LIFF application splash.
- About FLOW.
- Welcome experience.
- Selected notification footers.
- Rich Menu branding.
- Behind the Product.
- Release information.

Do not overwhelm users with branding.

Do not insert repetitive promotional messages into every interaction.

Create a future Behind the Product specification explaining:

- Why FLOW was created.
- What problems it solves.
- Its design philosophy.
- Its engineering philosophy.
- Its actual creator and contributor credits.

Do not invent developer names or contributions.

Do not publish the owner's personal information without explicit authorization.

---

# 21. SECURITY AND PRIVACY ARCHITECTURE

Document a deny-by-default security model.

Future implementation must cover:

## Authentication

- Server-side LINE identity verification.
- Token validation.
- Provider identity scope.
- Session handling.
- Expiration.
- Revocation where appropriate.
- Secure secret storage.

## Authorization

- Workspace-scoped membership.
- Per-event visibility.
- Separate participant authorization.
- Destination authorization.
- Role enforcement.
- Revocation handling.
- Deep-link access control.

## Webhooks

- Raw request body signature verification.
- Timing-safe signature comparison.
- Invalid-signature rejection.
- Duplicate event protection.
- Webhook redelivery handling.
- Safe postback processing.
- Untrusted input validation.

## Scheduling

- Atomic job claiming.
- Duplicate prevention.
- Cancellation and rescheduling safety.
- Safe retry behavior.
- Quota protection.
- Destination revalidation.

## Data Protection

- Sensitive-data redaction.
- Minimal collection of personal information.
- Secure configuration.
- Restricted logging.
- Data retention planning.
- Backup and recovery planning.
- Private appointment handling.

## Application Security

- Input validation.
- Rate limiting strategy.
- Appropriate security headers.
- Restricted CORS.
- CSRF protection where applicable.
- Safe URL handling.
- Protection against cross-group object reference attacks.
- Prevention of unauthorized data enumeration.

Do not claim that future documented controls are already implemented.

Separate implemented security controls from planned controls.

---

# 22. DOCUMENTATION DELIVERABLES

Create concise, actionable documentation.

Required files or clearly equivalent documents:

1. README.md

2. docs/MASTER-SPECIFICATION.md

3. docs/PRODUCT-ROADMAP.md

4. docs/DESIGN-SYSTEM.md

5. docs/UX-INFORMATION-ARCHITECTURE.md

6. docs/SYSTEM-ARCHITECTURE.md

7. docs/SECURITY-AND-PRIVACY.md

8. docs/LINE-INTEGRATION-PLAN.md

9. docs/NOTIFICATION-ENGINE-PLAN.md

10. docs/DEPLOYMENT-PLAN.md

11. docs/EP00-REPORT.md

Documentation must reflect:

- Sally as the official mascot.
- The exact local project directory.
- The local-only EP00 environment.
- The future production environment.
- The approved product scope.
- Verified LINE limitations.
- Unverified external assumptions.
- Multi-group authorization.
- Quota protection.
- OneDrive safety.
- Future deployment isolation.

Avoid repeating the entire master prompt in every documentation file.

Maintain a single authoritative source for shared requirements.

Use links or references between documents where appropriate.

---

# 23. OFFICIAL ONE-DAY SPRINT ROADMAP

The roadmap consists of eight episodes.

## EP00 — Signature Identity & Foundation

Scope:

- Project initialization.
- Sally identity.
- Brand concept.
- Design system.
- Local application shells.
- Design showcase.
- Architecture documentation.
- Local quality gates.

## EP01 — LINE Integration & Authentication

Scope:

- LINE Developers configuration guide.
- Approved development integration.
- LINE identity verification.
- Webhook validation.
- LIFF initialization.
- Private application access.
- Authentication tests.

Any required public HTTPS development callback must be explicitly authorized before exposure.

Do not assume that real LINE mobile integration can be fully tested against localhost.

## EP02 — Flagship LIFF Experience

Scope:

- Today dashboard.
- Calendar.
- Agenda.
- Create appointment UI.
- Appointment details.
- Editing experience.
- Live notification preview.
- Responsive mobile polish.

## EP03 — Multi-Group & Privacy

Scope:

- Local database schema.
- Development and test database isolation.
- Workspace membership.
- Registered destinations.
- Group authorization.
- Appointment persistence.
- Visibility rules.
- Multi-destination selection.
- Cross-group isolation tests.

## EP04 — Smart Notification Engine

Scope:

- Persistent scheduling.
- Worker implementation.
- Reminder jobs.
- Flex Message builders.
- Quota management.
- Retry.
- Idempotency.
- Cancellation and rescheduling.
- Provider integration tests.

## EP05 — Signature Experience & Polish

Scope:

- Sally brand refinement.
- Final Rich Menu assets.
- Premium notification templates.
- Acknowledgement.
- Micro-interactions.
- Empty and error states.
- Creator signature.
- Accessibility refinement.

## EP06 — Senior QA & Security Audit

Scope:

- Functional tests.
- Integration tests.
- Authorization tests.
- Cross-group leakage tests.
- Destination tampering tests.
- Duplicate notification tests.
- Quota protection tests.
- Restart recovery.
- Database safety.
- Mobile browser QA.
- Performance review.
- Security review.
- Regression fixes.

## EP07 — Production Deployment

Scope, subject to explicit deployment authorization and passed gates:

- Production infrastructure discovery.
- Deployment directory verification.
- Isolated production database.
- Secure production credentials.
- Application build.
- Dedicated PM2 processes.
- Cloudflare Tunnel configuration.
- HTTPS verification.
- LINE production configuration.
- Controlled smoke tests.
- Safe rollback plan.
- Production health verification.
- Owner-approved pilot rollout.

Only EP00 is authorized now.

Subsequent episodes require their own implementation instructions.

---

# 24. SPRINT DISCIPLINE

The owner targets an initial working private release within one day.

Treat this as a planning objective, not a guarantee.

Do not expand EP00 into the entire product.

Prioritize:

- Useful implementation.
- Original visual quality.
- Maintainable architecture.
- Essential documentation.
- Reliable tests.
- Efficient development.

Avoid:

- Excessive boilerplate.
- Redundant files.
- Unnecessary frameworks.
- Large unrelated refactors.
- Repetitive implementation.
- Premature optimization.
- Implementing all future screens immediately.
- Creating an overly complex enterprise architecture for a small private product.

Use reusable representative prototypes.

Document future work clearly.

Do not skip critical security checks or claim success to meet a time target.

If the full one-day target becomes unrealistic, prioritize a secure working vertical slice and report unfinished items accurately.

---

# 25. EP00 QUALITY GATES

Execute all applicable checks before declaring completion.

## G01 — Environment Discovery

Verify:

- Correct absolute project path.
- Local environment.
- Toolchain versions.
- Git status.
- Proposed port availability.
- No unintended production access.

## G02 — Dependency Integrity

Verify:

- Dependency installation.
- Lockfile.
- Compatibility.
- No unnecessary commercial dependencies.
- Review relevant dependency security findings.
- Review licensing where applicable.

Do not automatically force major dependency upgrades.

## G03 — Type Safety

Run TypeScript checks for applicable workspaces.

No unresolved required type errors.

## G04 — Lint

Run the configured lint checks.

Fix applicable errors.

Do not suppress meaningful errors solely to obtain a passing result.

## G05 — Automated Tests

Include meaningful tests for implemented EP00 behavior.

Suggested coverage:

- Environment validation.
- Health endpoint.
- Error handling.
- Shared input validation.
- Appointment prototype calculations.
- Reminder-time calculation where implemented.
- Group selection logic.
- Mock quota estimation.
- Live preview state.

Do not count trivial placeholder tests as meaningful functional coverage.

## G06 — Build

Run:

- Frontend production build.
- Backend build.
- Worker scaffold build or typecheck.
- Shared package checks where applicable.

Report actual command exit codes.

## G07 — Visual QA

Use available browser automation tooling where practical.

Test viewport widths:

- 320 px.
- 375 px.
- 390 px.
- 430 px.
- 768 px.
- 1440 px.

Check:

- No horizontal overflow.
- No clipped Thai vowels or tone marks.
- Clear typography.
- Readable appointment cards.
- Accessible contrast.
- Appropriate touch target sizes.
- Consistent spacing.
- Correct group selector behavior.
- Live preview updates.
- Working prototype interactions.
- Loading and error states.
- Reduced-motion behavior.
- No misleading success indicators.
- No broken navigation.
- No severe console errors.

Capture screenshots if supported.

Screenshots must be actual browser output, not fabricated images.

Provide exact screenshot paths.

If visual QA cannot be performed, explicitly report NOT TESTED.

Do not claim LINE mobile rendering has passed based only on a browser preview.

## G08 — Privacy and Security Review

Verify:

- No real secrets in tracked files.
- No production credentials.
- No production service connections.
- No real sensitive appointment fixtures.
- No public exposure of the development showcase.
- No unsafe default bindings.
- No misleading authentication.
- Appropriate error handling.
- Documented future authorization boundaries.

## G09 — Repository Review

Review:

- Git diff.
- Tracked files.
- Ignored files.
- Generated artifacts.
- Secret exposure.
- Documentation accuracy.
- Project scope.
- Working tree status.

A local commit may be created only after applicable required checks pass.

Do not push remotely.

---

# 26. EP00 PASS / PARTIAL / FAIL CRITERIA

PASS:

All mandatory EP00 deliverables are implemented.

Applicable required automated gates pass.

Required visual verification has been performed successfully.

No unresolved release-blocking security or correctness findings exist.

All mock and planned features are clearly identified.

PARTIAL:

Useful implementation exists, but one or more required deliverables or verification activities remain incomplete.

Examples:

- Browser QA unavailable.
- Required documentation incomplete.
- Design showcase partially implemented.
- Local environment limitations affecting verification.

Clearly explain the missing work.

FAIL:

A mandatory safety, correctness, or implementation gate fails and prevents the foundation from being accepted.

Examples:

- Build failure.
- Incorrect project directory.
- Secret exposure.
- Unauthorized production connection.
- Broken mandatory functionality.
- Critical uncorrected security problem.

Do not report PASS if a mandatory gate fails.

Do not hide unresolved findings.

---

# 27. EXPLICIT PROHIBITIONS

During EP00, do not:

- Create a production LINE Official Account.
- Configure real production LINE credentials.
- Send real LINE messages.
- Register production webhooks.
- Upload a live LINE Rich Menu.
- Expose the local application publicly.
- Modify Cloudflare DNS.
- Modify Cloudflare Tunnel.
- Connect to the production database.
- Create or migrate a production database.
- Restart existing production PM2 processes.
- Modify Windows scheduled tasks.
- Change firewall rules.
- Modify existing PDA BLISS or S2 applications.
- Remove the existing HR LINE Bot from any group.
- Reuse existing production credentials.
- Store secrets inside the OneDrive project.
- Push to a remote Git repository.
- Install unrelated system software without authorization.
- Terminate unrelated processes.
- Create paid subscriptions.
- Purchase LINE messages.
- Use paid AI APIs.
- Automatically proceed to EP01.

Local development, local testing, and approved project-file creation are allowed.

---

# 28. FINAL EP00 COMPLETION REPORT

Provide a structured completion report.

The executive summary must be written in Thai.

Technical evidence may use English where appropriate.

Include:

## A. Executive Summary

- What was implemented.
- What the owner can review now.
- Overall visual and engineering outcomes.

## B. Final Verdict

PASS / PARTIAL / FAIL

Explain the verdict using actual gate results.

## C. Verified Local Environment

- Exact project path.
- Git status.
- Node.js version.
- npm version.
- Relevant toolchain versions.
- PostgreSQL availability.
- Port availability.

## D. Implementation Summary

- Created applications.
- Created packages.
- Important files.
- Implemented components.
- Backend endpoints.
- Worker scaffold.
- Shared contracts.

## E. Brand and Design

- FLOW identity.
- Sally mascot.
- Color palette.
- Typography.
- Signature design decisions.
- Rich Menu concept.
- Notification template concepts.
- Live preview behavior.

## F. Local Preview

Provide:

- Actual local frontend URL.
- Actual design showcase URL.
- Backend health URL.
- Exact command to start local development.

Only report URLs that correspond to the actual configuration.

Distinguish a configured URL from a currently running service.

## G. Visual QA

- Tested viewports.
- Actual results.
- Browser findings.
- Screenshot paths.
- Remaining visual limitations.

## H. Automated Quality Gates

For every gate, report:

- Gate identifier.
- Command.
- Actual exit code.
- Exact pass/fail counts where available.
- Result.
- Relevant findings.

Never fabricate test counts.

## I. Security and Privacy

- Implemented controls.
- Planned controls.
- Verified safety.
- Remaining security work.

## J. Scope and Infrastructure Impact

Explicitly state:

- Whether any production service was accessed.
- Whether any production system was changed.
- Whether real LINE messages were sent.
- Whether real LINE credentials were used.
- Whether any external paid service was activated.

## K. Git Information

- Branch.
- Local commit hash, if committed.
- Git working tree status.
- Remote push status.

## L. Decisions and Limitations

List:

- Decisions made without explicit owner guidance.
- Unverified assumptions.
- Current blockers.
- Unfinished items.
- Deferred features.
- Any differences from the requested specification.

## M. EP01 Preparation

Provide a concise checklist of what will be needed for LINE integration.

Include configuration categories and steps without exposing or requesting secrets in the completion report.

Identify any owner actions required later.

## N. Final Confirmation

Finish with an explicit statement confirming whether:

- EP00 is complete.
- Production remained unchanged.
- The system is ready for owner review.
- EP01 can safely begin after approval.

Do not automatically start EP01.

---

# 29. FINAL EXECUTION INSTRUCTION

Begin EP00 in:

D:\One Drive\OneDrive\Desktop\project\pdabliss_flow

Build an original, premium, mobile-first product foundation for PDA BLISS FLOW.

Sally is the official mascot.

The product must ultimately deliver beautifully designed LINE notifications and an exceptional LIFF scheduling experience.

Prioritize the owner's real use cases:

- Family appointments.
- Personal appointments.
- Company appointments.
- Multiple authorized LINE groups.
- Correct recipient selection.
- Strong privacy.
- Zero additional monthly subscription cost target.

Create a foundation that demonstrates professional product design and careful software engineering.

Keep the implementation focused on EP00.

Work autonomously within the authorized scope.

Do not ask for routine decisions when safe defaults are available.

Do not claim completion without evidence.

Do not modify production.

Do not proceed to the next episode.

Begin implementation now.