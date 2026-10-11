# Architecture

MediBook uses one repository with two npm workspaces. `client/` is a React single-page application built with Vite. `server/` is an Express REST API, and Mongoose owns MongoDB connectivity and document schemas. The browser calls the API over HTTP; the API is the authority for validation, authentication, role checks, and appointment state changes.

## Data model

- **User** stores a person's name, normalized email, password hash, role, and active-account flag. Password hashes are excluded from normal query results.
- **Doctor** extends a doctor-role user with a specialty, consultation fee, biography, an IANA timezone, and weekly availability windows.
- **Appointment** links a patient user to a doctor profile, stores a time interval and lifecycle status, and reserves a slot using a unique sparse key while active.

Availability is stored as weekly local-time windows in the doctor's IANA timezone (default `Asia/Kolkata`). Slots are fixed at 30 minutes. API datetimes are timezone-qualified ISO values and appointment instants are stored in UTC. MongoDB's unique sparse index on `activeSlotKey` is the final guard against two simultaneous reservations of the same doctor and slot start; booking assigns the key, and cancellation atomically unsets it.

## Security boundaries

Public registration creates patient accounts only; doctor and admin roles cannot be selected in a signup request. Passwords are hashed with bcryptjs, and the database field is excluded from normal query results. Access tokens are signed with a server-only secret and expire after seven days. Protected requests verify the token and load the current active account from MongoDB, so role changes and account deactivation take effect without waiting for the token to expire. Role middleware checks permissions on the server; the frontend is not trusted to enforce access.

The first admin is created by a one-time server script, never by public signup. It requires a password through a short-lived process environment variable, hashes it with the same bcrypt mechanism, and atomically claims a persistent singleton bootstrap marker before checking that no admin exists. A production run additionally requires two deliberate opt-in values. Admin doctor routes create doctor-role users and linked doctor profiles; if profile creation fails after user creation, the service removes that just-created user to avoid an orphan login. Admin deactivation checks future requested and accepted appointments first and refuses the operation with a conflict response until they are resolved. The admin dashboard is hidden by role-aware navigation, while every operation remains protected by backend middleware.

Request bodies are validated before database writes, JSON input size is limited, and CORS uses the configured client origin. Secrets belong in server-side environment variables, never in the client bundle or Git.

## Doctor workspace

Doctor dashboard routes require an authenticated doctor role and resolve the Doctor profile from the token's current User ID. Appointment list and status queries include that linked profile ID, so a doctor cannot read or change another doctor's records. Status transitions are atomic and only accept or reject a `requested` appointment; rejection releases the active slot key.

Weekly availability edits validate IANA timezone names and local weekly windows, including overlap checks. Before saving, the API checks all future requested and accepted appointments against the proposed schedule. Conflicting updates return the affected appointments and leave the existing schedule untouched. Public slot generation continues to read the saved local availability and convert slot instants to UTC.
