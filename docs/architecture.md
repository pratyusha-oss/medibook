# Architecture

MediBook uses one repository with two npm workspaces. `client/` is a React single-page application built with Vite. `server/` is an Express REST API, and Mongoose owns MongoDB connectivity and document schemas. The browser calls the API over HTTP; the API is the authority for validation, authentication, role checks, and appointment state changes.

## Data model

- **User** stores a person's name, normalized email, password hash, role, and active-account flag. Password hashes are excluded from normal query results.
- **Doctor** extends a doctor-role user with a specialty, consultation fee, biography, an IANA timezone, and weekly availability windows.
- **Appointment** links a patient user to a doctor profile, stores a time interval and lifecycle status, and reserves a slot using a unique sparse key while active.

Availability is stored as weekly local-time windows in the doctor's IANA timezone (default `Asia/Kolkata`). Slots are fixed at 30 minutes. API datetimes are timezone-qualified ISO values and appointment instants are stored in UTC. MongoDB's unique sparse index on `activeSlotKey` is the final guard against two simultaneous reservations of the same doctor and slot start; booking assigns the key, and cancellation atomically unsets it.

## Security boundaries

Public registration creates patient accounts only; doctor and admin roles cannot be selected in a signup request. Passwords are hashed with bcryptjs, and the database field is excluded from normal query results. Access tokens are signed with a server-only secret and expire after seven days. Protected requests verify the token and load the current active account from MongoDB, so role changes and account deactivation take effect without waiting for the token to expire. Role middleware checks permissions on the server; the frontend is not trusted to enforce access.

Request bodies are validated before database writes, JSON input size is limited, and CORS uses the configured client origin. Secrets belong in server-side environment variables, never in the client bundle or Git.
