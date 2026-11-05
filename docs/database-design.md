# Database design

CampusConnect uses the PostgreSQL database included with Supabase. The Express server connects directly to PostgreSQL using a private connection URL; browser code must never receive this URL or a database password.

## Tables

- `users` stores a unique email, display name, nullable password hash for local accounts, optional Google account subject, and application role.
- `user_sessions` stores opaque Express session IDs, expiration timestamps, and serialized session data for authentication sessions.
- `events` stores event descriptions, category, venue, registration deadline, capacity, tags, and artwork key.
- `registrations` links a user to an event. A user can only have one registration record per event; status changes can record cancellation or waitlisting without creating duplicate registrations.
- `notifications`, `web_push_subscriptions`, and `admin_audit_logs` store user notifications, browser push endpoints, and administrative actions.
- `teams`, `team_members`, `submissions`, `event_judges`, and `evaluations` support event collaboration and judging.

Foreign keys cascade registration cleanup when a user or event is deleted. Listing capacity counts are derived from registrations with `registered` or `attended` status, not from demo fixture counters. Row-level security is enabled without public policies because application queries run only from the trusted Express server.

## Date and time convention

Event timestamps use PostgreSQL `TIMESTAMPTZ` and are stored as instants. The API returns ISO 8601 timestamps; browsers display those instants in the viewer's local timezone. The seed data converts the sample events' `+05:30` times to UTC.

## Setup and sample data

Create a Supabase project and copy its PostgreSQL session-pooler URI from **Project Settings → Database → Connection string**. Set `EVENTS_DATA_SOURCE=postgres` and `DATABASE_URL` in a private `.env`, then run `npm.cmd run db:setup`. The schema is safe to apply repeatedly. The seed refreshes the six demonstration event records so the discovery UI can run without importing private data. Never commit `.env` or use the database URL in browser code.

Local login uses the `users.password_hash` column for salted scrypt hashes; Google sign-in uses `google_subject` for verified identities. Both use `user_sessions` for server-side sessions.

Sample event records should be replaced with real campus event data before using this application for live announcements. The seed does not create user accounts or registrations.
