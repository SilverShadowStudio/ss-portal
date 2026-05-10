# Silvershadow Studio — Client Portal

**Stack:** React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Supabase + Framer Motion

**Repo:** SilverShadowStudio/ss-portal
**Live:** https://ss-portal.vercel.app

## Setup

1. Clone repo
2. `npm install --legacy-peer-deps`
3. `npm run dev`

## Environment

Supabase credentials are in `.env`. Do not commit this file publicly.

## Deploy

Push to `main` → Vercel auto-deploys.

## Database

Migrations are in `supabase/migrations/`. Run the two new ones in Supabase SQL editor:
- `20260509000001_account_type.sql`
- `20260509000002_orders_table.sql`

## Dropbox

Dropbox sync is fully wired via edge functions. Connect via Admin → Settings → Dropbox.
The webhook at `supabase/functions/dropbox-webhook` auto-syncs new files into scene rounds.

## Structure

```
src/
  pages/          Client and admin pages
  components/     Shared components
  contexts/       Auth context
  hooks/          Custom hooks
  lib/            Utilities and constants
  integrations/   Supabase client and types
supabase/
  functions/      Edge functions (Deno)
  migrations/     SQL migrations
```

