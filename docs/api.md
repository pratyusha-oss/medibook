# API outline

The API uses JSON under `/api`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Area | Planned endpoints | Access |
| --- | --- | --- |
| Health | `GET /api/health` | Public; implemented |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Implemented; public for register/login; authenticated for me |
| Doctors | `GET /api/doctors`, `GET /api/doctors/:id` | Public reads; implemented |
| Doctor slots | `GET /api/doctors/:doctorId/slots` | Public; implemented |
| Patient appointments | `POST /api/appointments`, `GET /api/appointments/me`, `PATCH /api/appointments/:id/cancel` | Patient role; implemented |
| Doctor profile and availability | `PATCH /api/doctors/me`, `PUT /api/doctors/me/availability` | Doctor role; planned |
| Doctor appointment management | Doctor appointment list/status routes | Planned |
| Admin | Dashboard statistics, appointment review, doctor and account management routes | Planned; admin routes are not implemented |

### Authentication details

- `POST /api/auth/register` accepts `{ "name", "email", "password" }`, creates a patient account, and returns `201` with `{ "user", "token" }`. A duplicate email returns `409`.
- `POST /api/auth/login` accepts `{ "email", "password" }` and returns `{ "user", "token" }`. Invalid credentials return a generic `401` response.
- `GET /api/auth/me` requires `Authorization: Bearer <token>` and returns the current active account. Invalid or inactive accounts receive `401`.

Passwords must be at least eight characters and fit bcrypt's 72-byte input limit. Registration ignores any submitted role and always creates a patient, preventing public privilege escalation. Protected routes derive identity from a verified JWT and current database account; they never trust a client-supplied user or role field.

### Doctor directory details

- `GET /api/doctors` supports `q` (name, specialty, or biography), `specialty`, and `feeMax` filters, plus `page` and `limit` pagination. Results are ordered by consultation fee, then stable ID.
- `GET /api/doctors/:id` returns a public profile without account email or other private user fields. Inactive doctor accounts are hidden.
- Invalid filters, page values, or limits return `400`; missing or malformed profile IDs return `404`.

### Appointment details

Doctor weekly availability is interpreted in the Doctor profile's IANA `timezone` (default `Asia/Kolkata`). Slots are a fixed 30 minutes. API `from`, `to`, and `startsAt` values must be ISO datetimes with an explicit timezone; responses and stored appointment instants are UTC.

- `GET /api/doctors/:doctorId/slots?from=2026-10-11T00:00:00.000Z&to=2026-10-13T00:00:00.000Z` returns `{ "doctorId", "timezone", "slotDurationMinutes": 30, "slots": [{ "startsAt", "endsAt" }] }`. The range is limited to 31 days; past slots and active bookings are excluded.
- `POST /api/appointments` requires a patient Bearer token and accepts `{ "doctorId", "startsAt", "reason"? }`. The server computes `endsAt`; client-supplied patient IDs and end times are ignored. Success returns `201` with `{ "appointment": { "id", "doctorId", "startsAt", "endsAt", "status", "reason", "createdAt", "updatedAt" } }`.
- `GET /api/appointments/me` requires a patient Bearer token and returns only that user's appointments, with optional `status`, `page`, and `limit` filters.
- `PATCH /api/appointments/:id/cancel` requires the owning patient's Bearer token. It returns `{ "appointment" }`; only future requested or accepted appointments can be cancelled. Cancellation atomically removes `activeSlotKey` so the slot can be booked again.
- Invalid input returns `400`, a missing doctor/appointment returns `404`, an unavailable or concurrently booked slot returns `409`, and missing/invalid authentication returns `401`.

An active booking reserves `${doctorId}:${startsAt.toISOString()}` in the unique sparse `activeSlotKey` index. Only `requested` and `accepted` appointments block slots. A duplicate-key race is returned as `409 BOOKING_CONFLICT`.
