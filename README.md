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

## Environment variables

See [`server/.env.example`](server/.env.example). Never commit `.env` files or place secrets in frontend variables; browser code is public.

## Project layout

```text
client/   React frontend
server/   Express API, Mongoose connection and models
docs/     Architecture, schema, API and handover material
```

## Status

The initial scaffold and patient authentication endpoints are implemented. Doctor discovery and management, appointment workflows, dashboards, and deployment remain planned milestones.
