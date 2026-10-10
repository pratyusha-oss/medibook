# API outline

The API uses JSON under `/api`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Area | Planned endpoints | Access |
| --- | --- | --- |
| Health | `GET /api/health` | Public; implemented |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Implemented; public for register/login; authenticated for me |
| Doctors | `GET /api/doctors`, `GET /api/doctors/:id` | Public reads; implemented |
| Doctor profile | `PATCH /api/doctors/me` | Doctor role; planned |
| Availability | `GET /api/doctors/:id/slots`, `PUT /api/doctors/me/availability` | Public slots; doctor role for updates |
| Patient appointments | `POST /api/appointments`, `GET /api/appointments/me`, `PATCH /api/appointments/:id/cancel` | Patient role |
| Doctor appointments | `GET /api/doctor/appointments`, `PATCH /api/appointments/:id/status` | Doctor role; ownership checked |
| Admin | `GET /api/admin/stats`, `GET /api/admin/appointments`, doctor and account management routes | Admin role |

### Authentication details

- `POST /api/auth/register` accepts `{ "name", "email", "password" }`, creates a patient account, and returns `201` with `{ "user", "token" }`. A duplicate email returns `409`.
- `POST /api/auth/login` accepts `{ "email", "password" }` and returns `{ "user", "token" }`. Invalid credentials return a generic `401` response.
- `GET /api/auth/me` requires `Authorization: Bearer <token>` and returns the current active account. Invalid or inactive accounts receive `401`.

Passwords must be at least eight characters and fit bcrypt's 72-byte input limit. Registration ignores any submitted role and always creates a patient, preventing public privilege escalation. Protected routes derive identity from a verified JWT and current database account; they never trust a client-supplied user or role field.

### Doctor directory details

- `GET /api/doctors` supports `q` (name, specialty, or biography), `specialty`, and `feeMax` filters, plus `page` and `limit` pagination. Results are ordered by consultation fee, then stable ID.
- `GET /api/doctors/:id` returns a public profile without account email or other private user fields. Inactive doctor accounts are hidden.
- Invalid filters, page values, or limits return `400`; missing or malformed profile IDs return `404`.
