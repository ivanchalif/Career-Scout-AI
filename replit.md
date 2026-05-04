# Career Scout

AI-powered job matching dashboard that monitors inboxes for job postings, scores them against a user's career profile, and surfaces the best matches.

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + wouter routing
- **Auth**: Clerk (Replit-managed, white-label)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

| Artifact | Path | Description |
|---|---|---|
| `career-scout` | `/` | React+Vite frontend — landing page, dashboard, profile, posting detail |
| `api-server` | `/api` | Express backend — REST API for profiles, postings, match reports, dashboard |

## Database Schema

- `userProfiles` — career profile (skills[], experienceHistory JSONB, targetSalary, remotePreference)
- `jobPostings` — job postings per user (title, company, fullDescription, extractedSkills[], source, salaryMin/Max)
- `matchReports` — AI scoring results (fitScore, reasoning, matchedSkills[], missingSkills[], compensationGap)
- `gmailConnections` — Gmail OAuth credentials per user (accessToken, refreshToken, email, lastSyncedAt)

## API Routes

All routes are protected by Clerk auth (`requireAuth` middleware reads session cookies).

- `GET/PUT /api/profile` — career profile CRUD
- `GET/POST /api/postings` — list/create job postings (applies companyFilterSettings server-side)
- `GET/DELETE /api/postings/:id` — get/delete a specific posting
- `POST /api/postings/:id/analyze` — re-trigger AI scoring for a posting (LLM parse + fit score, updates match report)
- `GET/POST /api/match-reports` — match report management
- `GET /api/dashboard/summary` — aggregated stats (totalPostings, avgFitScore, topMatches, hasProfile, gmailConnected)
- `GET/PUT /api/filter-settings` — email import filter (subjectKeywords, fromAddresses, bodyKeywords, blockedBodyKeywords)
- `GET/PUT /api/company-filter-settings` — dashboard company filter (mode: off/include/exclude, companies[])
- `POST /api/storage/uploads/request-url` — request a presigned URL for file upload
- `GET /api/storage/public-objects/*` — serve public objects from object storage
- `GET /api/gmail/connect` — initiate Google OAuth (redirect) — requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET secrets
- `GET /api/gmail/callback` — Google OAuth callback; exchanges code, saves tokens, redirects to /profile
- `GET /api/gmail/status` — current user's Gmail connection status + posting count
- `DELETE /api/gmail/disconnect` — revoke token and delete connection
- `POST /api/gmail/sync` — scan Gmail inbox for job-related emails, create job_postings records

## Frontend Pages

- `/` — Public landing page (redirects to /dashboard if signed in)
- `/sign-in/*?` — Clerk sign-in (branded dark theme)
- `/sign-up/*?` — Clerk sign-up (branded dark theme)
- `/dashboard` — Job opportunities ranked by fit score, search + filter, add job modal
- `/postings/:id` — Posting detail: large score ring, matched/missing skills, AI reasoning, re-analyze button
- `/profile` — Career profile editor: skills tag input, experience history, salary target, remote preference, resume PDF upload, Gmail connect/sync/disconnect

## Key Files

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/api-spec/orval.config.ts` — Orval codegen config
- `lib/api-zod/src/generated/api.ts` — Generated Zod schemas
- `lib/api-client-react/src/generated/api.ts` — Generated React Query hooks + TypeScript types
- `lib/db/src/schema/` — Drizzle schema files
- `artifacts/api-server/src/app.ts` — Express app with Clerk middleware
- `artifacts/api-server/src/routes/` — Route handlers
- `artifacts/career-scout/src/App.tsx` — Clerk provider setup + routing
- `artifacts/career-scout/src/pages/` — Page components
- `artifacts/career-scout/src/components/layout.tsx` — Sidebar navigation with user menu

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/scripts run seed` — seed sample job postings and match reports into DB

## AI Scoring Engine

- **Integration**: OpenAI via Replit AI Integrations proxy (`@workspace/integrations-openai-ai-server`), model: `gpt-5-mini`
- **Pipeline**: (1) Parse raw job description → extract required/nice-to-have skills, salary range, remote type; (2) Score candidate profile against parsed requirements
- **Auto-trigger**: Scoring fires in the background after every new job posting (manual or Gmail sync)
- **Re-analyze**: `POST /api/postings/:id/analyze` re-runs the full pipeline synchronously and returns the updated match report
- **Output**: fitScore (0–100, conservative), reasoning (2–3 sentences), matchedSkills[], missingSkills[], compensationGap
- **Service**: `artifacts/api-server/src/lib/scoringService.ts`

## Notes

- `CLERK_PUBLISHABLE_KEY` is injected into the Vite build via `vite.config.ts` `define` block (not .env)
- `CLERK_PROXY_URL` is only set in production (the proxy is server-side only)
- AI scoring uses gpt-5-mini, runs as background task on new postings, synchronous on re-analyze
- Gmail integration: requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets (Google Cloud project with Gmail API enabled, OAuth 2.0 credentials, redirect URI = `https://${REPLIT_DEV_DOMAIN}/api/gmail/callback`)
- Gmail OAuth uses HMAC-signed state token to correlate callback with userId (no cookies needed across redirect)
- Gmail sync query: `subject:(job OR opportunity OR role OR position OR hiring OR offer OR recruiter ...) newer_than:7d`
- Deduplication: checks `gmail_message_id` column in `job_postings` to avoid re-processing same email
- Object storage: bucket provisioned, `lib/object-storage-web` client package available for frontend upload
- Resume upload on profile page uses native file input → presigned URL → PUT to object storage
- Application Prep section on posting detail shows matched/missing skill guidance when a match report exists
- Seed script at `scripts/seed.ts` inserts 5 sample postings + 3 match reports for demo/testing

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
