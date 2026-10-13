# MediBook

Doctor appointment management system built with MongoDB, Express, React, and Node.js.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- MongoDB locally or a MongoDB Atlas connection string

## Local setup

1. Create `server/.env` with local-only values for `NODE_ENV=development`, `PORT=5000`, `MONGODB_URI=mongodb://127.0.0.1:27017/medibook`, `JWT_SECRET` (at least 32 characters), and `CLIENT_URL=http://localhost:5173`.
2. Install dependencies from the repository root with `npm install`.
3. Start the Vite client and API with `npm run dev`.
4. Open the client URL printed by Vite. The API health endpoint is `http://localhost:5000/api/health`.

The client uses `VITE_API_BASE_URL` at build time and defaults to the local API above. For a local override, set it in `client/.env.local`; this variable is public browser configuration and must never contain credentials or other secrets.

The client and server are separate npm workspaces. The client is a Vite React single-page application; the server exposes JSON REST endpoints and connects to MongoDB through Mongoose.

## Student walkthrough

Start with [the student guide](docs/student-guide.md) for a plain-language explanation of the app, a suggested presentation flow, and a code-reading order. Use [the architecture guide](docs/architecture.md) for the system design and [the API guide](docs/api.md) for exact request and response formats.

For a quick demo, register or sign in as a patient, find a doctor, open the doctor's profile, choose a future slot, and book it. Then sign in as that doctor to review and accept or reject the request. Sign in as a patient again to see the updated appointment. The admin dashboard can show system counts and manage doctor accounts. Use only the project's approved demo accounts and keep their passwords outside the repository.

Automated tests are optional developer checks. The website does not run tests when a patient opens it, and the test files are not included in the frontend bundle. Keep them in the repository: they document important rules and help catch regressions if the code changes.

## Seed a development doctor

The development-only seed creates or updates the `demo.doctor@medibook.test` account and linked profile. It is explicitly marked **Fictional demonstration profile** in the application; its biography states that it does not represent a real doctor, and it contains no qualification, registration number, or verification claim. It never creates an admin account, and it refuses to run when `NODE_ENV=production`. Re-running it reuses the same user/profile, restores the demo details and active state, and updates the password hash from the supplied environment variable.

In PowerShell, enter a development-only password at the secure prompt and run the seed from the repository root:

```powershell
$securePassword = Read-Host "Demo doctor password" -AsSecureString
$env:SEED_DOCTOR_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
try {
  npm run seed:doctor --workspace server
} finally {
  Remove-Item Env:SEED_DOCTOR_PASSWORD -ErrorAction SilentlyContinue
  Remove-Variable securePassword -ErrorAction SilentlyContinue
}
```

The password must contain 8–72 UTF-8 bytes. Keep the variable set only for this local command; do not add it to `.env`, source control, or client-side `VITE_` variables. The fictional demo doctor is available Monday through Saturday, 09:00–17:00 in `Asia/Kolkata`. This script is for local development only; it was not run as part of the profile/search UI work.

Doctor profile credentials such as qualification and medical council registration number are blank unless supplied by the profile owner or an administrator. MediBook does not independently verify those details. Do not enter real professional credentials without project-owner approval and a reliable source.

## Environment variables

Never commit `.env` files or place secrets in frontend variables; browser code is public. The server reads the variables listed in the deployment section below. The optional local example [`client/.env.example`](client/.env.example) contains only the non-secret local API URL.

## One-time read-only production doctor inventory

`server/scripts/auditDoctorsReadOnly.js` inventories doctor profiles, their linked user accounts, appointment counts by status, and conflicts with `doctor1@gmail.com` through `doctor4@gmail.com`. It makes no writes, does not load `server/.env`, does not import app models, and disables Mongoose auto-creation and auto-indexing. It prints the resolved database name and pauses for an exact-name confirmation before issuing any collection query. The script never selects password hashes or prints the MongoDB URI.

The API's normal database connection calls `mongoose.connect(MONGODB_URI)` without a separate `dbName` option, then initializes model indexes. In that connection pattern the URI's database path selects the database; when no database path or `dbName` option is present, the driver default is `test`. Do not use the local `server/.env` target as evidence of the Render production database. Verify the intended database name in the Render service's `MONGODB_URI` configuration and Atlas before continuing.

Run this once from a secured PowerShell session. Retrieve the production URI from Render or a secret manager without displaying or saving it in source control. The hidden prompt below keeps the URI out of the command text and PowerShell history; the script reads only the temporary process environment variable and ignores `.env` files.

```powershell
$secureUri = Read-Host "Production MongoDB URI" -AsSecureString
$uriPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUri)
try {
  $env:MONGODB_URI = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($uriPointer)
  npm run audit:doctors:readonly --workspace server
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($uriPointer)
  Remove-Item Env:MONGODB_URI -ErrorAction SilentlyContinue
  Remove-Variable secureUri, uriPointer -ErrorAction SilentlyContinue
}
```

At the prompt, compare the displayed database name with the intended production database in Render and Atlas, then type that exact name to proceed. Any mismatch or non-interactive run stops before collection queries. For strongest protection, supply a temporary Atlas database user with read-only access to this database instead of the application's `readWrite` credential. The report contains doctor names and emails, so keep its output in a secured location and do not paste it into public logs or source control. This is an inventory only; it does not replace or deactivate any account.

## Deployment (Vercel, Render, MongoDB Atlas)

Deploy the frontend as a Vercel project and the API as a Render **Web Service**. No deployment configuration file is required for the current URL behavior.

### Vercel frontend settings

Connect the repository and set:

| Setting | Value |
| --- | --- |
| Root Directory | `.` (repository root; keep the root npm workspace lockfile in scope) |
| Framework Preset | `Other` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `client/dist` |
| Node.js | `22.x` or another version satisfying the project minimum |

Set `VITE_API_BASE_URL` in Vercel's **Production**, **Preview**, and **Development** environments as needed. Production should be the full Render API base URL, for example `https://<render-service>.onrender.com/api`. This value is compiled into the public JavaScript bundle; it is an API address, never a secret. Do not add `MONGODB_URI`, `JWT_SECRET`, bootstrap passwords, or any server secret to Vercel.

The current React app changes views in component state and does not use pathname-based client routes. Therefore it does not need a Vercel SPA rewrite today. If direct links to client-side paths are added later, add a Vercel rewrite to `/index.html` and verify that it does not shadow static assets.

### Render API settings

Create a Node **Web Service** with:

| Setting | Value |
| --- | --- |
| Root Directory | `.` (repository root; the API is an npm workspace) |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Node.js | `22.x` or another version satisfying the project minimum |

The root `start` script delegates to `npm run start --workspace server`. The server listens on Render's injected `PORT`; do not set a fixed production port. Add these variables in the Render service's **Environment** settings:

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas application connection string for the production database; store as a Render secret |
| `JWT_SECRET` | A high-entropy server-only secret of at least 32 characters; store as a Render secret |
| `CLIENT_URL` | Exact HTTPS Vercel production origin, with no path or trailing slash; comma-separated additional exact HTTPS origins are supported if needed |

`PORT` is supplied by Render. `CLIENT_URL` is required in production; startup now fails safely if it is missing or malformed. The server does not allow wildcard origins. Do not put bootstrap variables in the persistent Render environment.

### MongoDB Atlas setup

1. Use a production Atlas project/cluster and a database name dedicated to MediBook. Set the database name in the Atlas connection URI.
2. Create a separate database user for the API with only `readWrite` access to the MediBook database. This is distinct from an Atlas console user. URL-encode special characters in the username/password portion of the URI.
3. In Atlas **Network Access**, allow the Render service's outbound IP CIDR ranges for its region (shown in Render's service **Connect → Outbound** panel). Avoid `0.0.0.0/0`; use private networking or dedicated outbound IPs if you need a narrower allowlist.
4. Save the connection string only as Render's `MONGODB_URI`. Keep the URI out of Git, Vercel variables, screenshots, and logs.

Atlas requires both an IP access-list entry and a database user for the application connection. See the official [Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) and [Render outbound IP guide](https://render.com/docs/outbound-ip-addresses).

### Deployment order and first admin

1. Create the Atlas database user and network access entry.
2. Create the Render service and Vercel project so their production origins are known. Configure the Render server variables and Vercel `VITE_API_BASE_URL` above.
3. Deploy Render first, then verify `https://<render-service>.onrender.com/api/health` returns `{"status":"ok","service":"medibook-api"}`.
4. Deploy Vercel. Verify the deployed UI can load the public doctor directory and that login/API requests use the Render URL.
5. Only after confirming the Render `MONGODB_URI` targets the intended production database, provision the first admin once from a secured operator machine. Follow the single bootstrap procedure below. Do not add bootstrap variables to Render or run the script as a build, pre-deploy, or start command.

## Project layout

```text
client/   React frontend
server/   Express API, Mongoose connection and models
docs/     Student guide, architecture, API and handover material
```

## Status

Patient, doctor, and admin workflows are implemented. Deployment settings are documented above; use the actual configured service URLs in the project presentation and handover.

## Bootstrap the first admin

Public registration always creates a patient. Create the first admin from a trusted machine with database access; this one-time script hashes the password, refuses a second bootstrap, and never prints credentials. It writes a persistent singleton marker in `admin_bootstrap_locks` so concurrent runs cannot provision separate first admins.

This script is for the **first admin only**. It refuses to run if an admin already exists or if its one-time lock has already been claimed. Never delete an existing admin just to rerun bootstrap. In PowerShell from the repository root, supply a private password at the secure prompt. `MONGODB_URI` is read from `server/.env` for local use, or from the process environment when supplied by a trusted production secret manager:

```powershell
# Production only: set these after confirming the target database and using a secured operator machine.
# $env:NODE_ENV = 'production'
# $env:ADMIN_BOOTSTRAP_ALLOW_PRODUCTION = 'true'
# $env:ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION = 'CREATE_FIRST_ADMIN_IN_PRODUCTION'

$securePassword = Read-Host "Initial admin password" -AsSecureString
$env:ADMIN_BOOTSTRAP_NAME = "MediBook Administrator"
$env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.test"
$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
try {
  npm run bootstrap:admin --workspace server
} finally {
  Remove-Item Env:NODE_ENV, Env:MONGODB_URI, Env:ADMIN_BOOTSTRAP_NAME, Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD, Env:ADMIN_BOOTSTRAP_ALLOW_PRODUCTION, Env:ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION -ErrorAction SilentlyContinue
  Remove-Variable securePassword -ErrorAction SilentlyContinue
}
```

For a deliberate production bootstrap only, set `NODE_ENV=production`, `ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=true`, and `ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION=CREATE_FIRST_ADMIN_IN_PRODUCTION` for that single command on a secured operator machine. Supply the production `MONGODB_URI` from a secret manager. Remove all temporary variables immediately afterward. Never put the admin password or production opt-in values in source control, `.env`, Render's persistent environment, or Vercel. Later administrator accounts require a separately authorized operational process.
