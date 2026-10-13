# Architecture

MediBook uses one repository with two npm workspaces. `client/` is a React single-page application built with Vite. `server/` is an Express REST API, and Mongoose owns MongoDB connectivity and document schemas. The browser calls the API over HTTP; the API is the authority for validation, authentication, role checks, and appointment state changes.

For a beginner-friendly explanation and a presentation walkthrough, see [the student guide](student-guide.md). This document describes the same design in more technical detail; [the API guide](api.md) lists the exact HTTP contracts.

## Data model

- **User** stores a person's name, normalized email, password hash, role, and active-account flag. Password hashes are excluded from normal query results.
- **Doctor** extends a doctor-role user with a specialty, consultation fee, biography, an IANA timezone, and weekly availability windows.
- **Appointment** links a patient user to a doctor profile, stores a time interval and lifecycle status, and reserves a slot using a unique sparse key while active.

Availability is stored as weekly local-time windows in the doctor's IANA timezone (default `Asia/Kolkata`). Slots are fixed at 30 minutes. API datetimes are timezone-qualified ISO values and appointment instants are stored in UTC. MongoDB's unique sparse index on `activeSlotKey` is the final guard against two simultaneous reservations of the same doctor and slot start; booking assigns the key, and cancellation atomically unsets it.

## Security boundaries

Public registration creates patient accounts only; doctor and admin roles cannot be selected in a signup request. Passwords are hashed with bcryptjs, and the database field is excluded from normal query results. Access tokens are signed with a server-only secret and expire after seven days. Protected requests verify the token and load the current active account from MongoDB, so role changes and account deactivation take effect without waiting for the token to expire. Role middleware checks permissions on the server; the frontend is not trusted to enforce access.

The first admin is created by a one-time server script, never by public signup. It requires a password through a short-lived process environment variable, hashes it with the same bcrypt mechanism, and atomically claims a persistent singleton bootstrap marker before checking that no admin exists. A production run additionally requires two deliberate opt-in values. Admin doctor routes create doctor-role users and linked doctor profiles; if profile creation fails after user creation, the service removes that just-created user to avoid an orphan login. Admin deactivation checks future requested and accepted appointments first and refuses the operation with a conflict response until they are resolved. The admin dashboard is hidden by role-aware navigation, while every operation remains protected by backend middleware.

The admin service also provides database-backed counts by appointment status and paginated appointment and user lists. These responses are mapped to explicit display DTOs so password hashes and unrelated private fields are not returned. User status updates preserve future appointments, block self-deactivation, and reject deactivation of the last active admin. Doctor profile edits validate the supported profile fields; changing weekly availability or timezone reuses the same future-appointment conflict rule as doctor self-service edits.

Request bodies are validated before database writes, JSON input size is limited, and CORS uses an exact allowlist from `CLIENT_URL`. Local development defaults to `http://localhost:5173`; production requires explicit HTTPS origins and rejects wildcard, path, and credential-bearing origin values. Startup and request failures log only the error class, not raw database errors or credentials. Secrets belong in server-side environment variables, never in the client bundle or Git.

## Deployment boundary

The Vite client is built from the repository root workspace and emits `client/dist`. `VITE_API_BASE_URL` is public build-time configuration and points to the `/api` base URL. Render runs the Express workspace from the root lockfile and supplies the listening `PORT`. The API waits for MongoDB and model indexes before opening its HTTP port; the health endpoint is consequently available only after database startup succeeds. Atlas credentials and the JWT signing key are Render-only secrets. Atlas access is restricted to the Render service's outbound IP ranges or a private network path. The first-admin bootstrap is a separately invoked, one-time operator action, not part of the service lifecycle.

## Doctor workspace

Doctor dashboard routes require an authenticated doctor role and resolve the Doctor profile from the token's current User ID. Appointment list and status queries include that linked profile ID, so a doctor cannot read or change another doctor's records. Appointment pagination totals and dashboard summary counts come from database count queries, not the current page. Status transitions are atomic: a doctor may accept or reject a `requested` appointment, or complete an `accepted` appointment. Rejection and completion release the active slot key.

Doctors can edit only their linked profile's specialty, biography, and consultation fee through self-service; account roles, linked users, availability, and appointment records are outside that profile update. Weekly availability edits validate IANA timezone names and local weekly windows, including overlap checks. Before saving, the API checks all future requested and accepted appointments against the proposed schedule. Conflicting updates return the affected appointments and leave the existing schedule untouched. Public slot generation continues to read the saved local availability and convert slot instants to UTC.
