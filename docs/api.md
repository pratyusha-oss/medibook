# API outline

The API uses JSON under `/api`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Area | Endpoints | Access |
| --- | --- | --- |
| Health | `GET /api/health` | Public; implemented |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Implemented; public for register/login; authenticated for me |
| Doctors | `GET /api/doctors`, `GET /api/doctors/:id` | Public reads; implemented |
| Doctor slots | `GET /api/doctors/:doctorId/slots` | Public; implemented |
| Patient appointments | `POST /api/appointments`, `GET /api/appointments/me`, `PATCH /api/appointments/:id/cancel` | Patient role; implemented |
| Doctor profile and availability | `GET /api/doctor/me`, `PUT /api/doctor/me/availability` | Doctor role; implemented |
| Doctor appointment management | `GET /api/doctor/appointments`, `PATCH /api/doctor/appointments/:id/status` | Doctor role; implemented |
| Admin management | `GET /api/admin/stats`, `GET /api/admin/appointments`, `GET /api/admin/users`, `PATCH /api/admin/users/:userId/status`, doctor list/create/edit/status endpoints | Admin role; implemented |

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

### Doctor dashboard and availability

All `/api/doctor/*` endpoints require a Bearer token for an active doctor account. The server resolves the Doctor profile through the authenticated user's `User` ID; clients never submit a doctor ID for dashboard authorization.

- `GET /api/doctor/me` returns `{ "doctor": { "id", "name", "specialty", "consultationFee", "bio", "timezone", "availability" } }`.
- `GET /api/doctor/appointments?page=1&limit=50&status=requested` returns only appointments linked to that doctor's profile, with patient name, reason, status, and UTC start/end instants; the response includes the doctor's timezone for display. `status` is optional and supports the existing appointment statuses.
- `PATCH /api/doctor/appointments/:id/status` accepts `{ "status": "accepted" }` or `{ "status": "rejected" }`. Only `requested` appointments can transition. Other doctors' appointment IDs return `404`; already changed appointments return `409 INVALID_STATUS_TRANSITION`. Rejection atomically clears `activeSlotKey` so the slot can become available again.
- `PUT /api/doctor/me/availability` accepts `{ "timezone": "Asia/Kolkata", "availability": [{ "weekday": 1, "startTime": "09:00", "endTime": "12:00" }] }`. Weekdays use `0` for Sunday through `6` for Saturday; times use local 24-hour `HH:mm`. Multiple non-overlapping windows per day are supported.
- Invalid timezone, weekday, clock values, ordering, or overlapping windows return `400 INVALID_AVAILABILITY`. If a change would exclude a future requested or accepted appointment, the API returns `409 AVAILABILITY_CONFLICT` with the affected appointment IDs, UTC start times, patient names, and statuses. No changes are saved. Cancelled and rejected appointments do not constrain the schedule.

Saved weekly availability is used immediately by the public doctor slots endpoint. Appointment instants remain stored in UTC; weekly hours remain local to the doctor's configured timezone.

### Admin doctor management

All `/api/admin/*` routes require an active account Bearer token and the `admin` role. Public registration remains patient-only. Bootstrap the first administrator with the one-time `npm run bootstrap:admin --workspace server` script described in the root README; production requires explicit opt-in environment settings. The bootstrap script does not return a token or password.

- `GET /api/admin/doctors?page=1&limit=20&status=all&q=cardiology` returns `{ "doctors", "pagination" }`. `status` is `all`, `active`, or `inactive`; optional `q` searches doctor names, emails, specialties, and biographies.
- `POST /api/admin/doctors` accepts `{ "name", "email", "password", "specialty", "consultationFee", "bio?", "timezone?", "availability?" }`. The password is a one-time temporary credential supplied over the authenticated admin workflow. The server hashes it, always assigns the `doctor` role, creates the linked User and Doctor records, and returns `201` with `{ "doctor" }`; credentials and password hashes are never returned. Email conflicts return `409 EMAIL_IN_USE`. Availability uses weekday numbers `0`–`6`, local `HH:mm`, and an IANA timezone; timezone defaults to `Asia/Kolkata` and availability defaults to an empty array.
- `PATCH /api/admin/doctors/:doctorId/status` accepts `{ "isActive": true|false }` and returns `{ "doctor" }`. Deactivation hides the profile from public discovery and blocks login. It returns `409 DOCTOR_HAS_UPCOMING_APPOINTMENTS` if future requested or accepted appointments remain; the admin must resolve those appointments first.
- Patients and doctors receive `403 FORBIDDEN` from admin routes. Missing or invalid tokens receive `401`.

### Admin overview, appointments, and users

All routes in this section require an active admin Bearer token. Lists use `page` (default 1) and `limit` (default 20, maximum 50) and return pagination metadata with database totals.

- `GET /api/admin/stats` returns counts computed from MongoDB: `{ "statistics": { "totalPatients", "activeDoctors", "totalAppointments", "appointmentsByStatus": { "requested", "accepted", "rejected", "cancelled", "completed" } } }`. Missing statuses and empty collections count as zero.
- `GET /api/admin/appointments` supports optional `status`, `doctorId`, `patientId`, and paired `from`/`to` timezone-qualified ISO datetimes. The date range must be ordered and no longer than 366 days. It returns paginated appointments with UTC instants and only the patient name and doctor name, specialty, and fee for display; it omits emails and credentials.
- `GET /api/admin/users` supports optional `role=patient|doctor|admin`, `status=all|active|inactive`, and `q` (name or email search). It returns account ID, name, email, role, active state, creation date, and pagination metadata. Password hashes are not selected.
- `PATCH /api/admin/users/:userId/status` accepts `{ "isActive": true|false }`; roles cannot be changed. The admin cannot deactivate their own account or the last active admin. Deactivation is rejected with `409 USER_HAS_UPCOMING_APPOINTMENTS` if the patient or linked doctor has future requested or accepted appointments.

### Admin doctor profile editing

- `PATCH /api/admin/doctors/:doctorId` accepts any supported subset of `{ "specialty", "bio", "consultationFee", "timezone", "availability" }`. Unknown fields (including role/account fields) are rejected. Schedule or timezone changes validate weekly windows and return `409 AVAILABILITY_CONFLICT` if they would exclude an existing future requested or accepted appointment. No profile update is saved on conflict.
- Existing `PATCH /api/admin/doctors/:doctorId/status` remains supported for doctor activation. It applies the same appointment-preservation check before deactivation.
