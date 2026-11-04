# Database design

CampusConnect uses MySQL 8.0.19 or newer with InnoDB and `utf8mb4`.

## Tables

- `users` stores a unique email, display name, nullable password hash for local accounts, optional Google account subject, and application role.
- `user_sessions` stores opaque Express session IDs, expiration timestamps, and serialized session data for authentication sessions.
- `events` stores event descriptions, category, venue, registration deadline, capacity, tags, and artwork key.
- `registrations` links a user to an event. A user can only have one registration record per event; status changes can record cancellation or waitlisting without creating duplicate registrations.

Foreign keys cascade registration cleanup when a user or event is deleted. Listing capacity counts are derived from registrations with `registered` or `attended` status, not from demo fixture counters.

## Date and time convention

`starts_at`, `ends_at`, and `registration_deadline` use `DATETIME(3)` and store UTC. The API returns ISO 8601 timestamps with a `Z` suffix; browsers display those instants in the viewer's local timezone. The seed data converts the sample events' `+05:30` times to UTC.

## Setup and sample data

Create the configured database and a dedicated MySQL account with privileges scoped to that database. Copy `.env.example` to `.env`, set `EVENTS_DATA_SOURCE=mysql`, add the account credentials, and run `npm.cmd run db:setup`. `MYSQL_HOST` and `MYSQL_PORT` default to `localhost` and `3306`. The schema is safe to apply repeatedly. The seed refreshes the six demonstration event records so the discovery UI can run against MySQL without importing private data. Never commit `.env` or use a database administrator account as the application account.

Local login uses the `users.password_hash` column for salted scrypt hashes; Google sign-in uses `google_subject` for verified identities. Both use `user_sessions` for server-side sessions. `npm.cmd run db:setup` creates the session table and adds the nullable password-hash column to an existing users table. The MySQL application account therefore needs table creation and alteration privileges during setup, plus `SELECT`, `INSERT`, `UPDATE`, and `DELETE` for normal operation.

Sample event records should be replaced with real campus event data before using this application for live announcements. The seed does not create user accounts or registrations.
