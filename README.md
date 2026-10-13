# MediBook

MediBook is a doctor appointment management app built with MongoDB, Express, React, and Node.js. Patients find doctors and request appointments, doctors manage their appointments and availability, and admins manage accounts and doctor profiles.

## What is implemented

- Patient registration, login, logout, and a browser-tab session.
- Responsive doctor directory with name/profile search, explicit symptom-to-specialty search, specialty filtering, and a maximum-fee filter.
- Doctor profiles with specialty, biography, optional qualification and registration details, languages, clinic/OPD location, fee, and availability. Credentials are not independently verified by MediBook.
- Weekly availability in an IANA timezone, 30-minute slots, disabled booked slots, server-side date/availability checks, booking conflict protection, appointment history, and eligible patient cancellation.
- Doctor dashboard for appointment review, accept/reject/complete actions, profile editing, and availability management.
- Admin dashboard for database-backed statistics, appointment and user lists, safe account status management, and doctor account/profile management.
- Emergency alerts on the home page and booking view.

Symptom search uses a small explicit mapping (fever, migraine, back pain); it does not diagnose or replace medical advice. The app does not include payments, chat, video consultations, medical records, or notifications. See [the student guide](docs/student-guide.md) for a demo walkthrough, [the architecture guide](docs/architecture.md) for design details, and [the API guide](docs/api.md) for endpoint contracts.

## Requirements and local setup

- Node.js 20.19+ or 22.12+
- npm 10+
- A local MongoDB instance or a development MongoDB Atlas URI

From the repository root, install packages and make local environment files:

```powershell
npm ci
if (!(Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
if (!(Test-Path client/.env.local)) { Copy-Item client/.env.example client/.env.local }
```

Edit `server/.env` with the local values below. The provided MongoDB URI is a local example; never put a production URI or real secret in `.env.example`, source control, or the frontend environment. The client example points to the default local API and normally needs no edits.

| Server variable | Local value / purpose |
| --- | --- |
| `NODE_ENV` | `development` |
| `PORT` | `5000` (the server defaults to this locally) |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/medibook` |
| `JWT_SECRET` | A private random value at least 32 characters long |
| `CLIENT_URL` | `http://localhost:5173` |

`client/.env.example` contains `VITE_API_BASE_URL=http://localhost:5000/api`. Vite exposes `VITE_` variables to browser code, so use this variable for the API address only—never credentials or secrets. The server loads `server/.env` in local development.

Start both workspaces from the repository root:

```powershell
npm run dev
```

Or start one workspace at a time with `npm run dev:client` and `npm run dev:server`. Vite serves the frontend at `http://localhost:5173`; the API health check is `http://localhost:5000/api/health`. Stop the processes with `Ctrl+C`.

## Useful commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm test` | Run the backend Node test suite (55 tests passed in the documentation review) |
| `npm run build --workspace client` | Build the frontend for production |
| `npm run build` | Root shortcut for the frontend production build |
| `npm run start` | Start the production API |
| `npm run bootstrap:admin --workspace server` | One-time first-admin bootstrap; see below |

Tests are developer checks; the deployed website does not run them when a user visits it. The test files document important backend rules and should remain in the repository.

## Deployment: Vercel, Render, and MongoDB Atlas

Deployment settings below describe the current monorepo scripts and runtime configuration. No deployment or production database change is performed by these instructions.

### Vercel frontend

| Setting | Value |
| --- | --- |
| Root directory | `.` (repository root) |
| Framework preset | Other |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `client/dist` |

Set `VITE_API_BASE_URL` to the deployed Render API base URL ending in `/api`, for example `https://<render-service>.onrender.com/api`. This is public browser configuration. The current app changes views in React state and does not use pathname routes, so no Vercel SPA rewrite is needed.

### Render API

Create a Node Web Service with root directory `.`, build command `npm ci`, start command `npm start`, and health-check path `/api/health`. The root start script delegates to the server workspace. Render supplies `PORT`; do not hardcode a production port.

Set these variables in Render's server environment:

| Variable | Required configuration |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas application URI targeting the intended MediBook production database; keep it secret |
| `JWT_SECRET` | Server-only random secret of at least 32 characters |
| `CLIENT_URL` | Exact HTTPS Vercel origin, no path or trailing slash; comma-separated exact origins are supported |

Production startup requires a valid `CLIENT_URL` and rejects wildcard or non-HTTPS production origins. CORS allows only configured exact origins. Do not put server secrets in Vercel variables. Render provides `PORT`.

### MongoDB Atlas and deployment order

1. Create an Atlas database user with `readWrite` access to the MediBook database and configure Atlas Network Access for the Render service's outbound IP ranges or an approved private network path. Avoid `0.0.0.0/0`.
2. Set the production URI only in Render's `MONGODB_URI`; URL-encode special characters in URI credentials.
3. Configure Render and Vercel variables. Deploy the API, then confirm `/api/health` returns `{"status":"ok","service":"medibook-api"}`.
4. Deploy the frontend and confirm the deployed UI uses the Render API URL.
5. Provision the first admin only after verifying the production database target. Do not run bootstrap as part of build, deploy, or server startup.

### First admin bootstrap

Public signup always creates patients. The one-time bootstrap script refuses to run if an admin exists or its lock has already been claimed. It hashes the supplied password, creates no login token, and never prints credentials. For local development, run this from the repository root; the script loads the local `server/.env` database configuration:

```powershell
$securePassword = Read-Host "Initial admin password" -AsSecureString
$env:ADMIN_BOOTSTRAP_NAME = "MediBook Administrator"
$env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.test"
$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
try {
  npm run bootstrap:admin --workspace server
} finally {
  Remove-Item Env:ADMIN_BOOTSTRAP_NAME, Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Variable securePassword -ErrorAction SilentlyContinue
}
```

The password must meet normal password validation rules.

For production only, use a secured operator machine and a trusted secret source for `MONGODB_URI`. Set `NODE_ENV=production`, `ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=true`, and `ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION=CREATE_FIRST_ADMIN_IN_PRODUCTION` only for that single invocation. Never store bootstrap values in Git, Vercel, or Render's persistent environment. Do not delete an existing admin to rerun bootstrap.

## Project layout

```text
client/   React/Vite frontend
server/   Express API, Mongoose models, middleware, services, tests, and scripts
docs/     Student, architecture, and API guides
```
