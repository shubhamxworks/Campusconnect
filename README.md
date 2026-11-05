# CampusConnect

CampusConnect is a campus event discovery and management platform. The starter includes a responsive landing page, a searchable and filterable event directory, event detail pages, and an Express API that can read from sample data or Supabase PostgreSQL.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

In PowerShell:

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). Browse events at [http://localhost:3000/events.html](http://localhost:3000/events.html), or open the [event calendar](http://localhost:3000/calendar.html). The API health check is available at [http://localhost:3000/api/health](http://localhost:3000/api/health).

Use `npm.cmd start` for a normal server start. Set `PORT` in `.env` to change the port.

## Deploy on Render

The root `render.yaml` defines a Render web service that runs the Express app and serves the frontend. CampusConnect uses Supabase PostgreSQL for accounts, registrations, organizer tools, and other database-backed features.

Create a Supabase project first. In Render, create a Blueprint from the GitHub repository and provide the Supabase PostgreSQL connection string for `DATABASE_URL` when prompted. Use the Supabase session pooler URL for a persistent Node.js server. If Render reports a certificate-chain verification error, download the database CA certificate from Supabase and set its PEM contents as the private `DATABASE_CA_CERT` environment variable in Render. Certificate verification remains enabled. Keep database credentials and certificates private.

After the Render service is deployed, run `npm run db:setup` from a local checkout with `DATABASE_URL` set to the Supabase connection string and `EVENTS_DATA_SOURCE=postgres`. This creates the tables and sample events. Then confirm `/api/health` reports `"dataSource":"postgres"`. Do not commit `.env` or put credentials in `render.yaml`.

## Installable app and offline behavior

Open the home page in a supported browser to install CampusConnect. The service worker caches the public home shell and static assets; when offline, the home page or a small offline page is shown. API requests and authenticated pages are never cached. Browser push can be enabled from the notifications page when VAPID keys are configured as described above.

## Project layout

- `client/` — static frontend, styles, scripts, and role-specific page directories.
- `server/` — Express entry point and directories for routes, services, repositories, middleware, and configuration.
- `server/data/events.js` — sample event listings used by the initial discovery API.
- `database/` — schema, migrations, and procedures.
- `tests/` — unit, integration, and end-to-end test locations.
- `docs/` — project documentation.
- `scripts/` — development and database utility scripts.

## Supabase setup

The app defaults to clearly identified sample events. To enable database-backed features:

1. Create a Supabase project and open **Project Settings → Database → Connection string**.
2. Select the **Session pooler** connection string and copy its URI. Do not expose the database password.
3. In a local `.env`, set `EVENTS_DATA_SOURCE=postgres`, `DATABASE_URL` to that URI, and a private `SESSION_SECRET` of at least 32 characters.
4. Run `npm.cmd run db:setup` to create the PostgreSQL tables and insert demonstration event listings.
5. Add the same `DATABASE_URL` in the Render service environment, keep `EVENTS_DATA_SOURCE=postgres`, and redeploy. Verify `/api/health` reports `"status":"ok"` and `"dataSource":"postgres"`.

The schema defines users, sessions, events, registrations, notifications, student teams, team project submissions, event judge assignments, evaluations, and administrator audit logs. Row-level security is enabled without public policies; the Render server connects with its private PostgreSQL connection string and must never expose that string to browser code. Event timestamps are stored as timezone-aware UTC timestamps. Seeded events are demonstration data, not live campus announcements.

## Local login

The login page supports student account creation and email/password sign-in. Configure `EVENTS_DATA_SOURCE=postgres` and `DATABASE_URL` in `.env`, then set a private `SESSION_SECRET` of at least 32 characters. Generate one locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run `npm.cmd run db:setup` to create the user and session tables. Restart the app and open [http://localhost:3000/login.html](http://localhost:3000/login.html). Choose **Create account** to register; new accounts receive the student role.

Passwords must be between 12 and 128 characters and are stored as salted scrypt hashes. Login and registration requests are rate limited and checked for same-origin requests. Password reset and email verification are not implemented yet.

## Event registration

Sign in with a student account to register from an event's detail page. Registrations require Supabase PostgreSQL and are checked against the event's registration deadline and capacity. Once capacity is reached, new registrations are placed on the waitlist. Students can cancel their registration from the same page.

The API provides authenticated `GET`, `POST`, and `DELETE /api/events/:eventId/registration` endpoints. Mutating requests must be same-origin. When a registered student cancels, the earliest waitlisted student is promoted automatically in the same transaction. Leaving the waitlist does not affect the other waitlisted students.

## Notifications

Open [http://localhost:3000/notifications.html](http://localhost:3000/notifications.html) to review registration confirmations, waitlist additions, cancellations, waitlist promotions, and published event results. Signed-in users see an unread count beside the Notifications link. Notifications are written in the same database transaction as the registration or publication change. Result announcements link directly to the public leaderboard. The page supports marking individual or all notifications as read, and only returns notifications belonging to the signed-in user. Run `npm.cmd run db:setup` to create the notifications table and update its type enum in an existing database.

The notifications page can optionally enable browser push. Generate a VAPID key pair with `node -e "console.log(require('web-push').generateVAPIDKeys())"` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` together in `.env` (for example, a `mailto:` contact you control). Restart the server and run database setup to create the subscription table. Push delivery is sent for registration, cancellation, waitlist promotion, and published results; it supplements in-app notifications. Browsers must support push and grant notification permission.

## Student dashboard

Open [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html) to review upcoming registrations, waitlisted events, and events marked attended. The page requires sign-in and PostgreSQL-backed registration data. Its authenticated `GET /api/my-events` endpoint only returns the signed-in student's non-cancelled registrations.

## Personalized schedule

Open [http://localhost:3000/schedule.html](http://localhost:3000/schedule.html) to view upcoming registered and waitlisted events in date order. Download the schedule as an iCalendar `.ics` file for calendar apps; confirmed registrations are exported as confirmed events and waitlisted registrations as tentative. The schedule uses your authenticated `GET /api/my-events` data and does not require additional database setup.

## Student profile

Open [http://localhost:3000/profile.html](http://localhost:3000/profile.html) to view your account email and role or update your display name. Changes require an authenticated, same-origin request.

## Admin workspace

The admin workspace at [http://localhost:3000/admin/dashboard.html](http://localhost:3000/admin/dashboard.html) provides platform totals, account role management, event and registration views, reports, audit history, and read-only settings. Admin access is provisioned out of band by a database administrator, for example:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.edu';
```

After signing in, use the Admin dashboard link on the sign-in page. Role changes are recorded in the audit log; an administrator cannot change their own role or demote the last admin. Admin lists are capped to the most recent 200 users, 500 events or registrations, and 200 audit entries.

## Organizer event management

Organizers can create and edit events and review registrations at [http://localhost:3000/organizer/dashboard.html](http://localhost:3000/organizer/dashboard.html). Open an event's **Registrations** list to filter registered, waitlisted, attended, or cancelled students, and mark registered students as attended. Event ownership is attached to the signed-in organizer account; only the owner can view or update that event's registrations. New accounts are students by default; a database administrator must grant organizer access, for example:

```sql
UPDATE users SET role = 'organizer' WHERE email = 'organizer@example.edu';
```

Run `npm.cmd run db:setup` after updating to add the organizer ownership column to an existing database.

## Team management

Open [http://localhost:3000/team.html](http://localhost:3000/team.html) to create a team for an event or join one with its 32-character invitation code. Students can belong to one team per event; team membership is available after running `npm.cmd run db:setup`.

## Team project submissions

Open [http://localhost:3000/submissions.html](http://localhost:3000/submissions.html) from an event detail or team page to submit one project per team. Team members can update the project name, description, repository URL, and demo URL.

## Event judging

Organizers can open an event's **Judges** page to assign an existing judge account by email. A database administrator can grant judge access to an existing account with:

```sql
UPDATE users SET role = 'judge' WHERE email = 'judge@example.edu';
```

Judges can open [http://localhost:3000/judge/dashboard.html](http://localhost:3000/judge/dashboard.html) to review team submissions for assigned events, score each submission from 0 to 100, and save feedback. Each judge has one editable evaluation per submission. Organizers can remove a judge assignment; the judge's previous evaluation remains stored but is not accessible to them unless they are assigned again.

Organizers can review aggregate scores from an event's **Results** page. Each submission must have at least one judge score before results can be published. Once published, the event appears on [http://localhost:3000/leaderboard.html](http://localhost:3000/leaderboard.html); organizers can unpublish results at any time. Public leaderboards show average scores and the number of judge evaluations, not private written feedback. Run `npm.cmd run db:setup` to create the judge/evaluation tables and add the publication timestamp column on an existing database.

## Event calendar

Open [http://localhost:3000/calendar.html](http://localhost:3000/calendar.html) to browse events by month and select a day for event details. Event times are displayed in your browser's local time zone.

## Optional Google sign-in

Google sign-in can be added later. It uses the same PostgreSQL user and session tables. In Google Cloud Console, configure an OAuth consent screen, create a **Web application** client, add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/google/callback` as an authorized redirect URI, then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in the private `.env` file. Google OAuth state validation and PKCE are enabled. Keep credentials private. Production deployments must use HTTPS.
