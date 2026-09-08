# Supabase Project Setup — MindVault

This is the exact sequence to configure a Supabase project for MindVault
from scratch. Follow it in order; each step depends on the one before it.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) and create a free account if you don't have one.
2. Click **New Project**.
3. Choose an organization, name the project (e.g. `mindvault`), set a
   database password (save it somewhere — you won't need it for the app
   itself, but you'll want it if you ever connect `psql` directly), and
   pick a region close to you.
4. Wait for provisioning (usually under two minutes).

## 2. Get your API credentials

In your project, go to **Project Settings → API**. You'll need two
values for `.env.local`:

| Setting on the page | Environment variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

You do not need the `service_role` `secret` key. It bypasses Row Level
Security entirely, and nothing in this codebase uses it — see
[Security notes](#security-notes) below. Only generate/store it later if
you build a genuine server-only admin feature that needs it, and even
then, never put it in `NEXT_PUBLIC_*`, never commit it, and never
reference it from a Client Component.

## 3. Run the migrations, in this exact order

Open **SQL Editor** in the Supabase dashboard and run each file's
contents as a new query, **one at a time, in this order**:

1. `supabase/migrations/0001_init_schema.sql`
   Enables `pgvector`, creates `profiles`, `notes`, `tags`, `note_tags`,
   `note_embeddings`, their indexes, the `updated_at` triggers, and the
   trigger that auto-creates a `profiles` row (and keeps its email
   synced) from Supabase Auth events.
2. `supabase/migrations/0002_rls_policies.sql`
   Enables Row Level Security on every table and adds the policies that
   scope all access to `auth.uid()`.
3. `supabase/migrations/0003_vector_search.sql`
   Creates the `match_notes` and `match_related_notes` SQL functions
   used for semantic search and RAG retrieval.
4. `supabase/migrations/0004_tag_case_insensitive_uniqueness.sql`
   Replaces the case-sensitive `unique (user_id, name)` constraint on
   `tags` with a case-insensitive one, so "React" and "react" can't
   coexist as separate tags for the same user.
5. `supabase/migrations/0005_phase4_1_security_reliability.sql`
   Adds `search_note_ids`, `get_or_create_tag`, and
   `create_note_with_tags` — the app's keyword search and tag/note
   creation now go through these functions instead of building
   PostgREST filter strings or doing multi-step check-then-insert
   logic in application code. **The app will not build or behave
   correctly without this migration** — `lib/notes/queries.ts` and
   `lib/notes/actions.ts` call these functions directly.
6. `supabase/migrations/0006_phase7_semantic_search.sql`
   Adds the `'stale'` embedding status and `content_hash` /
   `embedding_model` / `embedding_dimensions` columns to
   `note_embeddings`, and updates `match_notes`/`match_related_notes`
   to filter on `embedding_model` — required for semantic search,
   related notes, and Ask My Notes retrieval to work correctly.
7. `supabase/migrations/0007_phase7_1_embedding_freshness.sql`
   Defense-in-depth: `match_notes`/`match_related_notes` also filter on
   `notes.embedding_status = 'ready'`, so a stale or failed embedding
   can never be returned as a search/related-notes/RAG result even if
   application-level logic has a bug.
8. `supabase/migrations/0008_phase7_2_atomic_embedding_commit.sql`
   Replaces the two-step (upsert embedding, then update status)
   embedding write with one atomic, content-version-checked function,
   closing a race where two concurrent reindex attempts could commit
   an embedding for a note that had already changed again. **Required**
   — `lib/ai/reindex-coordinator.ts` calls the functions this migration
   creates directly.

The order matters: each migration builds on tables, policies, or
constraints from the ones before it.

**Alternative (Supabase CLI):** if you have the [Supabase CLI](https://supabase.com/docs/guides/cli)
installed and linked to your project, you can run all eight at once
with `supabase db push` instead of the SQL Editor.

## 4. Confirm it worked

- **Table Editor** → you should see `profiles`, `notes`, `tags`,
  `note_tags`, `note_embeddings`. Each should show a green "RLS
  enabled" shield icon in the table list.
- **Database → Extensions** → `vector` should show as enabled.
- **Database → Functions** → `match_notes`, `match_related_notes`,
  `search_note_ids`, `get_or_create_tag`, `create_note_with_tags`,
  `set_updated_at`, `handle_new_user`, `handle_user_email_update`,
  `commit_note_embedding`, and `confirm_note_embedding_ready` (the
  latter two from migration 0008) should all be listed.

## 5. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Create an API key (free tier — no credit card required for the
   default rate limits).
3. This is your `AI_API_KEY`.

## 6. Set environment variables

```bash
cp .env.example .env.local
```

Fill in the five values from steps 2 and 5. `AI_MODEL` and
`EMBEDDING_MODEL` already have sensible current defaults in
`.env.example` and don't need to be changed unless Google retires the
default model — see the comments in that file.

## 7. Verify end-to-end

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/signup`, create an account, and confirm in
the Supabase dashboard (**Authentication → Users**, and **Table
Editor → profiles**) that both a user and a matching profile row were
created. This exercises the full chain: Supabase Auth → the
`handle_new_user` trigger → RLS allowing you to read your own new
profile.

## Verification checklist

Run through this after any schema change, not just the first setup:

- [ ] All eight migrations ran with no errors, in order
- [ ] `vector` extension shows as enabled under Database → Extensions
- [ ] All 5 tables exist and show "RLS enabled"
- [ ] Signing up creates both an `auth.users` row and a matching `profiles` row
- [ ] Changing your email (Authentication → Users → edit) updates `profiles.email` too
- [ ] A user cannot see another user's notes/tags/embeddings (see `scripts/local-verify/` for an automated version of this check you can run against a local Postgres instead of your real project)
- [ ] `select * from pg_indexes where tablename = 'note_embeddings';` shows no `ivfflat`/`hnsw` index — intentional at this scale, see the comment in `0001_init_schema.sql`
- [ ] `AI_API_KEY` in `.env.local` is a real key, and a manual `curl` to `models/gemini-embedding-2:embedContent` returns a 768-length vector when `output_dimensionality: 768` is set in the request body

## Security notes

- There is no `SUPABASE_SERVICE_ROLE_KEY` anywhere in this codebase and
  no `lib/supabase/admin.ts` file — nothing in the current feature set
  requires privileged, RLS-bypassing database access (verified by grep
  across `app/`, `components/`, and `lib/`). All application code should
  use the RLS-scoped `lib/supabase/server.ts` client. Only introduce a
  service-role key later if a genuine server-only admin/background
  feature needs one, and guard the file that reads it with
  `import "server-only"` so Next.js refuses to bundle it into the
  browser.
- Every table's RLS policies were verified against a real local
  Postgres + pgvector instance, not just read for correctness — see
  `scripts/local-verify/README.md` for how to reproduce that.

## Free-tier notes

Supabase's free tier (current as of mid-2026; recheck
[supabase.com/pricing](https://supabase.com/pricing) since these figures
change) includes 500MB database storage, 1GB file storage, 5GB
bandwidth, 50,000 monthly active users, and up to 2 active projects —
comfortably enough for a personal notes app and portfolio demo.

The one thing worth knowing before a job interview or demo day: **free
projects pause after 7 days with no database activity.** Data isn't
lost, but the project needs a manual "restore" click in the dashboard
and takes about 30 seconds to wake back up on the next request. If
you're demoing this live, open the dashboard and issue one query (or
just load the app) a few minutes beforehand.

pgvector itself has no separate cost or tier — it's a Postgres
extension included in every Supabase project, which is exactly why this
architecture avoids a dedicated (and typically paid) vector database.
