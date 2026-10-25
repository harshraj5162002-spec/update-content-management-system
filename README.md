# Signal CMS

Signal CMS is an existing React and Express content-management application with reader, author, and administrator workspaces. It includes article discovery, editorial workflows, moderation, analytics, and local AI-assisted tools.

## Features

- Public discovery with full-text search, categories, tags, authors, trending stories, and related articles
- Reader accounts, bookmarks, reading history and progress, comments, notifications, and recommendation feedback
- Author drafts, mandatory administrator review before publishing, reviewer feedback and resubmission, freshness checks, and engagement analytics
- Optional multiple-choice quizzes embedded in articles, with reader scoring
- Admin moderation queue, reports and appeals, user roles and restrictions, taxonomy, audit events, and settings
- JWT authentication, role-based authorization, rate limiting, and MongoDB persistence when configured
- Optional Google and GitHub OAuth with one-time state, PKCE, and verified-email checks
- Role-specific author, reader, and administrator analytics backed by recorded application data
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

## Run a presentation demo on another laptop

For a local presentation, share the GitHub repository URL rather than your personal `.env` file. On the presentation laptop, install Node.js 20.19+ or 22.12+ and Git, then open PowerShell and run:

```powershell
git clone https://github.com/harshraj5162002-spec/update-content-management-system.git
Set-Location update-content-management-system
npm install
npm run dev
```

Open the frontend URL printed by Vite (normally `http://localhost:5173`) on that same laptop. MongoDB, Gemini, and SMTP credentials are not required for the seeded local demo; demo changes are held in memory and reset when the backend restarts. The Forgot Password screen is available, but sending reset emails requires the presenter to configure their own SMTP settings in the ignored `backend/.env` file. Never distribute that file or put real credentials in GitHub.

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
| `FRONTEND_URL` | Public frontend origin used to build password reset links |
| `BACKEND_URL` | Public API origin used to construct OAuth callback URLs (default `http://localhost:5000`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google OAuth application credentials |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional GitHub OAuth application credentials |
| `SMTP_HOST` | SMTP server hostname used to send password reset email |
| `SMTP_PORT` | SMTP server port (default `587`) |
| `SMTP_SECURE` | Set `true` for implicit TLS, otherwise `false` (typically STARTTLS on port 587) |
| `SMTP_USER` / `SMTP_PASSWORD` | Optional SMTP authentication credentials, if required by the provider |
| `SMTP_FROM` | Verified sender address shown on password reset emails |

To enable Gemini, set `AI_PROVIDER=gemini` and add your key to `backend/.env`, then restart the backend. Keep the key server-side; do not add it to frontend environment variables. Set `AI_PROVIDER=local` to use the built-in deterministic tools instead. Related-article recommendations remain local.

Password recovery is available from the login page. Configure the SMTP variables above in `backend/.env` and set `FRONTEND_URL` to the correct frontend origin before expecting email delivery. Reset tokens are cryptographically random, stored only as hashes, expire after one hour, and are single-use. Without SMTP host and sender configuration, the API reports that reset email is unavailable; it does not expose reset tokens or pretend to send email.

### Google and GitHub sign-in

OAuth buttons appear only for providers whose client ID and secret are configured in `backend/.env`. Create OAuth credentials with these backend callback URLs:

- Google: `http://localhost:5000/api/auth/oauth/google/callback`
- GitHub: `http://localhost:5000/api/auth/oauth/github/callback`

For production or a different local host/port, use the corresponding public API URL instead. Set `BACKEND_URL` to that URL and configure the identical callback URL in each provider application. Set `FRONTEND_URL` to the frontend origin. Google OAuth should request the OpenID, email, and profile scopes; GitHub uses `read:user` and `user:email`. The app requires a verified provider email, binds one-time OAuth state to an HTTP-only, same-site cookie, verifies the PKCE challenge, and does not automatically link an OAuth identity to an existing account with the same email. Sign in with the existing account first; administrator accounts cannot be created through social signup. Never commit OAuth secrets.

### Analytics and data coverage

Author, reader, and admin analytics support 7-day, 30-day, and 90-day views. Graphs use stored engagement events, reading history, audit events, user creation timestamps, reports, appeals, and current article statuses. Older accounts without a recorded creation timestamp are not assigned fabricated signup dates. Reader time is explicitly an estimate from article word count and saved reading progress; the app does not currently time active reading sessions. Empty or untracked periods are shown as empty states rather than sample data.

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

Author submissions are never published by automated moderation. They remain pending (or quarantined for higher-risk review) until an administrator approves them. Administrators can approve, reject, request changes, or quarantine a submission; authors can see reviewer feedback and resubmit rejected or returned work. Since quizzes are embedded in articles, they are approved as part of the article and are not available until the article is published.

## Validation

```powershell
npm run build --workspace frontend
npm run lint --workspace frontend
node --test backend/test/*.test.js
```

## Current limitations

- Gemini-backed tools require a valid API key and may be subject to Google API quotas; local deterministic tools remain available with `AI_PROVIDER=local`.
- Password-reset email and Google/GitHub sign-in require credentials from the respective providers; provider-backed flows cannot be exercised without them.
- External-link freshness checks are manual and run on demand; there is no scheduler.
- Without MongoDB, demo data and changes exist only in process memory and are lost on restart.
- Demo accounts and seed content are for local development; review credentials, secrets, CORS, and database configuration before deployment.
