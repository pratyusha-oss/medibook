# MediBook

Doctor appointment management system built with MongoDB, Express, React, and Node.js.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- MongoDB locally or a MongoDB Atlas connection string

## Local setup

1. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI` and a private `JWT_SECRET`.
2. Install dependencies from the repository root with `npm install`.
3. Start the Vite client and API with `npm run dev`.
4. Open the client URL printed by Vite. The API health endpoint is `http://localhost:5000/api/health`.

The client and server are separate npm workspaces. The client is a Vite React single-page application; the server exposes JSON REST endpoints and connects to MongoDB through Mongoose.

## Seed a development doctor

The development-only seed creates or updates the `demo.doctor@medibook.test` doctor account and linked profile. It never creates an admin account, and it refuses to run when `NODE_ENV=production`. Re-running it reuses the same user/profile, restores the demo details and active state, and updates the password hash from the supplied environment variable.

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

The password must contain 8–72 UTF-8 bytes. Keep the variable set only for this local command; do not add it to `.env`, source control, or client-side `VITE_` variables. The demo doctor is available Monday through Saturday, 09:00–17:00 in `Asia/Kolkata`.

## Environment variables

See [`server/.env.example`](server/.env.example). Never commit `.env` files or place secrets in frontend variables; browser code is public.

## Project layout

```text
client/   React frontend
server/   Express API, Mongoose connection and models
docs/     Architecture, schema, API and handover material
```

## Status

Patient authentication, public doctor discovery, and patient appointment booking/history are implemented. Doctor/admin management dashboards and deployment remain planned milestones.
