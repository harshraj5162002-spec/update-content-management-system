# Signal CMS

Signal CMS is an existing React and Express content-management application with reader, author, and administrator workspaces. It includes article discovery, editorial workflows, moderation, analytics, and local AI-assisted tools.

## Features

- Public discovery with full-text search, categories, tags, authors, trending stories, and related articles
- Reader accounts, bookmarks, reading history and progress, comments, notifications, and recommendation feedback
- Author drafts, article submission, moderation status, freshness checks, and engagement analytics
- Optional multiple-choice quizzes embedded in articles, with reader scoring
- Admin moderation queue, reports and appeals, user roles and restrictions, taxonomy, audit events, and settings
- JWT authentication, role-based authorization, rate limiting, and MongoDB persistence when configured
- Deterministic local summaries, writing suggestions, content checks, and moderation that work without AI credentials
- Responsive React interface with an in-memory demo mode when MongoDB is unavailable

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 8 requirement)
- npm 9+
- MongoDB is optional for local/demo use

## Install and configure

From the project root in PowerShell:

```powershell
npm install
if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
if (-not (Test-Path .\frontend\.env)) { Copy-Item .\frontend\.env.example .\frontend\.env }
```

The guarded copy commands only create missing `.env` files; they do not overwrite existing environment settings or credentials. Set a unique `JWT_SECRET` and `MONGODB_URI` in `backend/.env` if MongoDB persistence is desired. Set `VITE_API_BASE_URL` in `frontend/.env` if the API is not at `http://localhost:5000/api`.

## Run

From the project root:

```powershell
npm run dev
```

Or run the API and frontend separately:

```powershell
Set-Location backend
npm run dev
```

```powershell
Set-Location frontend
npm run dev
```

Vite prints the local frontend URL (typically `http://localhost:5173`). The API defaults to port `5000`.

## Demo accounts

The demo seed includes:

- Admin: `admin@signalcms.dev` / `AdminPass123!`
- Author: `author@signalcms.dev` / `AuthorPass123!`
- Reader: `reader@signalcms.dev` / `ReaderPass123!`

Change or remove demo credentials before deploying the application to a shared or production environment.

## Environment variables

Backend (`backend/.env`):

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `5000`) |
| `JWT_SECRET` | Signing key for authentication tokens |
| `MONGODB_URI` | Optional MongoDB connection string |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins |
| `AI_PROVIDER` | AI provider: `local` (default) or `gemini` |
| `GEMINI_API_KEY` | Gemini API key; required when `AI_PROVIDER=gemini` |
| `GEMINI_MODEL` | Gemini model name (default `gemini-2.5-flash`) |

To enable Gemini, set `AI_PROVIDER=gemini` and add your key to `backend/.env`, then restart the backend. Keep the key server-side; do not add it to frontend environment variables. Set `AI_PROVIDER=local` to use the built-in deterministic tools instead. Related-article recommendations remain local.

Frontend (`frontend/.env`):

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API base URL (default `http://localhost:5000/api`) |

## API overview

All endpoints are under `/api`.

- Health and dashboard: `GET /health`, `GET /dashboard`
- Authentication: `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
- Articles: `GET /articles`, `GET /articles/home`, `GET /articles/:id`, `POST /articles`, `PUT /articles/:id`, `POST /articles/:id/submit`, `POST /articles/:id/engagement`, `POST /articles/:id/quiz/attempt`
- Discovery: `GET /search`, `GET /trending`, `GET /recommendations`, `POST /recommendations/feedback`, plus categories, tags, and author profiles
- Reader account: profile, bookmarks, history/progress, reading insights, notifications, comments, reports, and appeals
- Author analytics and freshness: `GET /me/analytics`, `GET /me/freshness`, `POST /freshness/check`
- AI tools: `POST /ai/tools/:tool` (for example `summary`, `writing`, `moderation`, `quality`, or `related`; uses the configured provider)
- Admin: moderation dashboard and queue, article decisions, reports, appeals, users, audit log, taxonomy, and settings

## Validation

```powershell
npm run build --workspace frontend
npm run lint --workspace frontend
node --test backend/test/*.test.js
```

## Current limitations

- Gemini-backed tools require a valid API key and may be subject to Google API quotas; local deterministic tools remain available with `AI_PROVIDER=local`.
- Password reset and email verification need a configured mail-delivery provider and are not implemented.
- External-link freshness checks are manual and run on demand; there is no scheduler.
- Without MongoDB, demo data and changes exist only in process memory and are lost on restart.
- Demo accounts and seed content are for local development; review credentials, secrets, CORS, and database configuration before deployment.
