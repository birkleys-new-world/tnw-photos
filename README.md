# TNW Photos

Lightweight photo ingest → rank → share for The New World.

**Phase 1 (this repo):**
- Ingest a folder in your browser → generates tiny thumbnails client-side (full-res never leaves your machine).
- Owner ranks each photo 1–5, flags/unflags, organises by folder ("gallery").
- Generate an unguessable share link; friends swipe:
  - **raw mode:** ← pass · → I want an edit · ↑ send me the raw
  - **edited mode:** ← pass · → I want full rez
- Votes persist in Firestore (auth-free; per-guest id in localStorage).

**Phase 2 (not yet built):** a local companion that detects the plugged-in folder, writes
metadata back to it (`.tnw-meta.json` sidecar), and fulfils friend requests by uploading only
the requested full-res on demand, then deleting it after download.

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind · Firebase (Firestore, web SDK) · Vercel.

## Setup (owner)
1. `cp .env.example .env.local` and paste your Firebase Web API Key (visible only in the
   Firebase console UI under Project settings → Your apps → SDK setup & config).
2. `npm install && npm run dev`.
3. Open `/` to ingest and rank; share `/s/<token>`.

## Deploy
Vercel: import the repo, set the `NEXT_PUBLIC_FIREBASE_*` env vars from `.env.local`.
