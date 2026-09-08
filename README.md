# MindVault

MindVault is an AI-powered notes app that helps you capture, organize, and understand your notes better. Beyond simple note-taking, it uses AI to summarize your notes, extract key points, suggest tags, and even let you ask natural-language questions about everything you've written — with answers grounded in your own notes.

**Live demo:** 
https://mind-vault-flax-zeta.vercel.app/

## Features

- **Secure authentication** — sign up and log in with email/password
- **Notes CRUD** — create, edit, delete, and autosave notes
- **Favorites & tags** — organize notes with starred favorites and custom tags
- **Keyword search** — quickly find notes by title or content
- **AI Tools** (powered by Google Gemini)
  - Summarize any note in a few sentences
  - Extract key points automatically
  - Get AI-suggested tags
  - Rewrite notes to be clearer, shorter, or more professional
- **Semantic search** — find notes by meaning, not just exact keywords
- **Related notes** — automatically discover notes similar to the one you're viewing
- **Ask My Notes** — ask questions in plain language and get answers sourced directly from your own notes, with citations
- **Dark/light theme** and keyboard shortcuts for fast navigation

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend:** Next.js Server Actions
- **Database & Auth:** Supabase (Postgres + Auth + pgvector for vector search)
- **AI:** Google Gemini API

## Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/Annanyamishra04/MindVault.git
   cd MindVault
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   Copy `.env.example` to `.env.local` and fill in your own values:
   ```bash
   cp .env.example .env.local
   ```

   | Variable | Where to get it |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
   | `AI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) (free) |
   | `AI_MODEL` | Defaults to `gemini-3.6-flash` |
   | `EMBEDDING_MODEL` | Defaults to `gemini-embedding-2` |

4. **Set up the database**

   Create a free project at [supabase.com](https://supabase.com), then run all 8 SQL files in `supabase/migrations/` (in order, via the Supabase SQL Editor). Full instructions: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md).

5. **Run the app**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Deployment

Deployed on [Vercel](https://vercel.com) — connect the GitHub repo, add the same environment variables in Vercel's project settings, and deploy. Full details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Project Structure

```
app/            Routes (auth, dashboard, notes, assistant, settings)
components/     UI components (notes, AI tools, layout)
lib/            Server Actions, AI provider logic, Supabase clients, validation
supabase/       Database migrations
```

## License

Personal project — all rights reserved.
