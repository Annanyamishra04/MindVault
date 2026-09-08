# Deployment — MindVault

A free-tier-friendly path to a production deployment: **Vercel** for the
Next.js app, **Supabase** for Postgres/Auth/pgvector, **Google AI
Studio** for the Gemini API key. No paid infrastructure, no Docker, no
separate vector database — the same architecture described in the
README's [Free-Tier Considerations](../README.md#free-tier-considerations)
section, just deployed instead of run locally.

This doc assumes you've already done local setup once (see the main
[README](../README.md#local-development-setup) and
[`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)) and are now promoting the
same app to a real, publicly-reachable deployment. If you haven't yet,
do local setup first — it's the fastest way to catch a misconfiguration
before it's live.

## 1. Required accounts/services

| Service | Free tier? | Used for |
|---|---|---|
| [Vercel](https://vercel.com) | Yes (Hobby) | Hosting the Next.js app |
| [Supabase](https://supabase.com) | Yes (Free) | Postgres, Auth, pgvector |
| [Google AI Studio](https://aistudio.google.com/app/apikey) | Yes | Gemini API key |
| GitHub (or GitLab/Bitbucket) | Yes | Source repo Vercel deploys from |

Nothing here requires a credit card at the tiers this app needs.

## 2. Required vs. optional vs. environment-specific configuration

| Variable | Required? | Where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Vercel project + local `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Vercel project + local `.env.local` |
| `AI_API_KEY` | **Required** for AI features (Summarize/Key Points/Tags/Rewrite, semantic search, related notes, Ask My Notes). The rest of the app works without it — see the README's [Environment Variables](../README.md#environment-variables) table. | Vercel project + local `.env.local` |
| `AI_MODEL` | Optional — defaults to `gemini-2.5-flash` if unset | Vercel project (only set to override the default) |
| `EMBEDDING_MODEL` | Optional — defaults to `gemini-embedding-2` if unset | Vercel project (only set to override the default) |

There is intentionally no `SUPABASE_SERVICE_ROLE_KEY` anywhere in this
list — see [Security](../README.md#security) in the README for why
nothing in this app needs one. **Never** set it as `NEXT_PUBLIC_*` if
you ever do add one for a future admin-only feature.

**Production vs. local values:** `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` can point at the *same* Supabase project
for both local development and production — Supabase doesn't require
separate projects per environment, though creating a second free
project for production (keeping local development's test data
separate) is a reasonable choice if you want that isolation. `AI_API_KEY`
can also be shared; Google AI Studio doesn't scope keys per-environment
either.

## 3. Supabase setup

Already covered in full in [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md).
The short version, for a deployment that doesn't already have a
Supabase project:

1. Create a Supabase project (free tier).
2. Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   from **Project Settings → API**.
3. Continue to [Applying migrations](#4-applying-migrations) below.

If you already have a Supabase project from local development, reuse it
— there's no separate "production" Supabase setup step beyond making
sure all migrations are applied (next section) and the auth redirect
URLs are configured (the section after that).

## 4. Applying migrations

Run all eight files in `supabase/migrations/`, **in order**, via the
Supabase SQL Editor (or `supabase db push` with the Supabase CLI) —
exactly as described in
[`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md#3-run-the-migrations-in-this-exact-order).
This is the same step whether you're setting up local development or
production — Supabase migrations aren't environment-specific.

If you're promoting an existing local Supabase project to be your
production database as-is (common for a personal/portfolio deployment),
you've likely already run all eight and there's nothing further to do
here — just confirm with the checklist in
[`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md#verification-checklist).

## 5. Configuring authentication redirect URLs

Supabase Auth needs to know which URLs it's allowed to redirect back to
after a signup confirmation email or password-related flow. This is the
one step that's genuinely different between local development and
production, because it's tied to a real domain:

1. In the Supabase dashboard, go to **Authentication → URL
   Configuration**.
2. Set **Site URL** to your production URL (e.g.
   `https://your-app.vercel.app`, or your custom domain if you've
   attached one).
3. Under **Redirect URLs**, add both:
   - `https://your-app.vercel.app/**` (production)
   - `http://localhost:3000/**` (keeps local development working
     against the same Supabase project)

Without this, email confirmation links (if you have email confirmations
enabled — see **Authentication → Providers → Email**) will redirect to
the wrong place after a user clicks them.

## 6. Gemini API configuration

1. Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey)
   (or reuse the one from local development — see the note in
   [section 2](#2-required-vs-optional-vs-environment-specific-configuration)
   above about shared keys).
2. Set it as `AI_API_KEY` in the Vercel project's environment variables
   (next section). It's never exposed to the browser — every Gemini
   call in this app happens server-side, in a Server Action (see the
   README's [Security](../README.md#security) section).
3. Leave `AI_MODEL` and `EMBEDDING_MODEL` unset unless you need to
   override the current defaults (`gemini-2.5-flash` /
   `gemini-embedding-2`) — see the extensive comments in `.env.example`
   for what changing `EMBEDDING_MODEL` requires.

## 7. Production deployment (Vercel)

1. Push this repository to GitHub (or GitLab/Bitbucket).
2. In Vercel, click **Add New → Project** and import the repo. Vercel
   auto-detects Next.js — no framework preset or build-command override
   is needed.
3. Before the first deploy (or in **Project Settings → Environment
   Variables** afterward), set the variables from
   [section 2](#2-required-vs-optional-vs-environment-specific-configuration):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `AI_API_KEY`, and optionally `AI_MODEL`/`EMBEDDING_MODEL`. Apply them
   to all three environments (Production/Preview/Development) unless
   you deliberately want preview deployments pointed at a different
   Supabase project or Gemini key.
4. Deploy. The production build command is the project's own `npm run
   build` (`next build`) — Vercel runs this automatically; there's
   nothing to override.
5. Once deployed, go back to
   [section 5](#5-configuring-authentication-redirect-urls) and confirm
   the Site URL/Redirect URLs match the actual `*.vercel.app` domain (or
   custom domain) Vercel assigned.

**No Docker.** This app has no background workers, no queue consumer,
and no process that needs to run outside of Vercel's own Next.js
runtime — see the README's [Free-Tier
Considerations](../README.md#free-tier-considerations) for why
(`after()`-based embedding indexing, no Redis, no cron). Introducing
Docker here would add operational surface area this architecture
doesn't need.

## 8. Post-deployment verification

Run through this after every production deploy, not just the first one:

- [ ] Visit the production URL; the marketing page (`/`) loads.
- [ ] Sign up with a fresh email; confirm you land on `/dashboard` (or
      see the "check your email" state, if email confirmations are on)
      — this exercises Supabase Auth + the `handle_new_user` trigger +
      RLS end-to-end against production.
- [ ] Create a note, confirm autosave and manual save (Cmd/Ctrl+S) both
      work.
- [ ] Open **AI Tools** on that note and run Summarize (or any AI
      action) — confirms `AI_API_KEY` is set correctly in Vercel and
      reachable from a serverless function.
- [ ] Open **Search by meaning** on `/notes` and search for something
      close to the note you just created — confirms the embedding
      pipeline (Gemini `embedContent` + `match_notes` RPC) works
      end-to-end in production.
- [ ] Visit `/assistant`, ask a question that note would answer —
      confirms the full Ask My Notes / RAG path.
- [ ] Log out, then try visiting `/dashboard` directly — confirms
      `proxy.ts`'s route protection is active in production, not just
      locally.
- [ ] Open browser dev tools → Network tab → reload any page → confirm
      the response headers include `x-content-type-options: nosniff`
      and `x-frame-options: DENY` (added in Phase 9 — see
      `next.config.ts`).
- [ ] Check the Vercel function logs for the signup/note-creation
      requests above — confirm no raw Supabase/Postgres error text or
      stack trace appears in anything that reached the *browser*
      (server-side console logging is fine and expected; see
      `app/(dashboard)/error.tsx` and `lib/ai/errors.ts`).

If any of these fail, the most common causes are: a missing/misspelled
environment variable in Vercel (recheck section 2), a migration that
wasn't applied (recheck section 4), or a Redirect URL mismatch (recheck
section 5) — in that order of likelihood.

## Rollback

Vercel keeps every previous deployment. If a deploy introduces a
regression, use **Vercel → Deployments → (previous deployment) →
Promote to Production** to roll back instantly without a new git push.
Database migrations in this project are additive-only (see the README's
[Development Roadmap](../README.md#development-roadmap) and the
comments in `supabase/migrations/`), so rolling back the app code does
not require rolling back the database schema.
