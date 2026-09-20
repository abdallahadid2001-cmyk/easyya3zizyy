# MODULE_TRANSFER.md

## Module name

`hours-training-calculator` (Arabic/English game calculator + local OCR + lightweight anonymous analytics)

## Purpose

A mobile-first web app that converts game units into hours and computes soldier
counts, combat power, training resource consumption and bag-box totals.
Screenshots can be read locally in the browser (traditional OCR, no AI service)
to auto-fill the tables; every value stays manually editable.

## Main features

1. **5 calculation tables** (tabs, RTL/LTR aware):
   1. Hours calculation
   2. Soldiers vs hours
   3. Combat power
   4. Training resource consumption (wheat / wood / iron / silver / crystal)
   5. Bag boxes total
2. **Local OCR** from screenshots (`tesseract.js`), fully client-side:
   downscale → grayscale + contrast → region crop → digit-whitelist recognition →
   per-table parsing. No image is uploaded or stored anywhere.
3. **Manual override** of every OCR-filled field; AI/OCR-filled cells are highlighted.
4. **i18n** Arabic (default) + English, with RTL support.
5. **Excel export** via `xlsx`.
6. **Local persistence** in `localStorage` (debounced 300 ms; images are never persisted).
7. **Anonymous usage analytics**: one RPC write per event, no PII, no images, no logs.
8. **Admin dashboard** at `/admin`, password-protected server-side, read-only charts.

## Architecture (short)

- **Framework**: TanStack Start v1 (React 19 + TanStack Router, file-based routes) on Vite 7.
- **Rendering**: SSR; production target is a Cloudflare-Worker-style edge runtime (nitro).
- **Entry points**:
  - Client/app root: `src/routes/__root.tsx`
  - Router factory: `src/router.tsx`
  - Server entry: `src/server.ts`
  - Start config / middleware: `src/start.ts`
  - Main feature entry: `src/components/Calculator.tsx` (rendered by `src/routes/index.tsx`)
- **Backend calls**: `createServerFn` only (no edge functions). One Postgres RPC from the browser.
- **Styling**: Tailwind CSS v4 via `src/styles.css` (`@theme` tokens) + shadcn/ui components.

## Routes / pages

| Route    | File                    | Access | Notes                                        |
| -------- | ----------------------- | ------ | -------------------------------------------- |
| `/`      | `src/routes/index.tsx`  | public | Renders `<Calculator />`                      |
| `/admin` | `src/routes/admin.tsx`  | public URL, password-gated | Stats dashboard, `noindex` |
| root     | `src/routes/__root.tsx` | —      | Layout, head meta, error/404 boundaries       |

No API routes, no `_authenticated` subtree.

## Main components

- `src/components/Calculator.tsx` — the whole feature (tabs, tables, OCR wiring,
  export, toasts, local state). This is the single component the target project needs to mount.
- `src/components/ui/*` — standard shadcn/ui primitives (unmodified). Safe to drop if the
  target project already has its own copies; only re-point the imports.

## Hooks / services / utilities

- `src/hooks/use-mobile.tsx` — viewport helper.
- `src/lib/ocr-client.ts` — image preprocessing, cropping, OCR, per-table parsers.
- `src/lib/numbers.ts` — number parsing/formatting (incl. Arabic digits).
- `src/lib/i18n.ts` — translation dictionary + `Lang` type.
- `src/lib/stats.ts` — anonymous client id + fire-and-forget `record_activity` RPC.
- `src/lib/admin.functions.ts` — `getAdminStats` server function (password check + aggregation).
- `src/lib/utils.ts` — `cn` helper.
- `src/lib/error-capture.ts`, `error-page.ts`, `lovable-error-reporting.ts` — SSR error handling.
  These are host-platform plumbing; the target project may already have equivalents.
- `src/integrations/supabase/*` — generated Supabase clients/middleware/types (see risks).

## Dependencies

**Essential for the feature**

- `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-start`, `@tanstack/react-query`
- `tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`, `clsx`, `class-variance-authority`, `tw-animate-css`
- `tesseract.js` (local OCR)
- `xlsx` (Excel export)
- `@supabase/supabase-js` (analytics RPC + admin reads)
- `lucide-react` (icons), `sonner` (toasts)
- `recharts` (admin charts only)
- `zod` (validation)

**Only used by shadcn/ui primitives** (`@radix-ui/*`, `cmdk`, `vaul`, `embla-carousel-react`,
`react-day-picker`, `input-otp`, `react-resizable-panels`, `react-hook-form`,
`@hookform/resolvers`, `date-fns`) — keep only what the retained UI files import.

**Host/build-specific, likely re-bound on integration**: `@lovable.dev/vite-tanstack-config`,
`nitro`, `vite-tsconfig-paths`.

No new dependencies were added during this preparation.

## Backend (Supabase / Postgres) requirements

Migration of record: `supabase/migrations/20260705234739_*.sql` — it is the complete,
authoritative schema. Apply it as-is in the target project.

**Tables** (both essential, both empty at install time — no seed data required)

- `public.app_users` — `id uuid PK` (client-generated), `first_seen_date date`, `last_seen_date date`;
  index `app_users_last_seen_idx (last_seen_date)`. No foreign keys, no link to `auth.users`.
- `public.daily_stats` — `day date PK`, counters: `new_users`, `dau`, `ocr_total`,
  `ocr_success`, `ocr_fail`, `ocr_ms_sum bigint`, `ocr_ms_count`.

**RLS** — enabled on both tables with **zero policies** on purpose: no direct Data API access
for `anon`/`authenticated`. All writes go through the RPC. `GRANT ALL` to `service_role` only.

**Functions / RPC**

- `public.record_activity(p_client_id uuid, p_event text, p_duration_ms int default null)` —
  `SECURITY DEFINER`, validates event name, clamps duration ≤ 600000 ms, one upsert per call.
  `GRANT EXECUTE ... TO anon, authenticated`.

**Views**

- `public.stats_overview` (`security_invoker = on`) — aggregate read-only overview.
  Convenience only; `/admin` does not depend on it.

**Triggers**: none. **Storage buckets / policies**: none. **Edge functions**: none.
**Realtime**: not used. **Seed / demo data**: none.

## Auth requirements

The module has **no user authentication** and no sign-up flow. Users are anonymous,
identified by a UUID in `localStorage` (`stats.cid`).
`/admin` is protected by a single server-side password comparison (constant-time,
hashed) against the `ADMIN_PASSWORD` env var — not by Supabase Auth.

If the target project has auth, nothing here needs to change; this module simply
ignores the session.

## Storage requirements

None. Images are processed in memory in the browser and never uploaded or persisted.
Browser storage used: `localStorage` keys prefixed by the calculator state + `stats.cid`,
and `sessionStorage` key `stats.openedThisSession`.

## External APIs

None. There is no AI service, no third-party HTTP API. The only network calls are:

1. Supabase RPC `record_activity` (browser → database).
2. `/admin` server function → database (service-role read).
3. `tesseract.js` fetching its language/WASM assets from its CDN on first OCR run.

## Environment variables

See `.env.example` (placeholders only, no real values).

| Variable | Scope | Required for |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client | analytics RPC |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | analytics RPC |
| `VITE_SUPABASE_PROJECT_ID` | client | optional |
| `SUPABASE_URL` | server | SSR fallback, admin |
| `SUPABASE_PUBLISHABLE_KEY` | server | SSR fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | server secret | `/admin` only |
| `ADMIN_PASSWORD` | server secret | `/admin` only |

Never expose the service-role key or the admin password to client code.

## Build / run requirements

- Node 20+ (or Bun), package manager: Bun (`bun.lock` present).
- `bun install` → `bun run dev` (port 8080) / `bun run build` / `bun run preview`.
- Path alias `@/*` → `src/*` (`tsconfig.json` + `vite-tsconfig-paths`).
- Routes are file-based; `src/routeTree.gen.ts` is generated — do not hand-edit.

## Testing status

Verified on this repository:

- **Build**: PASS (`bun run build`, client + SSR + nitro output generated).
- **TypeScript**: PASS (no errors).
- **Lint**: formatting fully normalised; 10 non-blocking stylistic errors remain (see limitations).
- **Runtime**: `/` renders the calculator; `/admin` renders the password gate.
- **Database connectivity**: schema and RPC present and callable.
- No automated test suite exists in this project.

## Known limitations

- Local OCR accuracy depends on screenshot quality; parsers are heuristic and tuned to
  specific game screenshots. Manual correction is part of the intended flow.
- First OCR run downloads the tesseract language data (network + a few seconds).
- `xlsx` and `recharts` are large; they are eagerly imported and could be lazy-loaded.
- Remaining lint errors (stylistic only, no runtime impact): intentional empty `catch`
  blocks and a few `any` casts in `src/components/Calculator.tsx`, and one `prefer-const`
  in the generated `src/integrations/supabase/previewAuthStorage.ts` (generated file — do not edit).
- Analytics are approximate by design (counters, no per-event rows), and a user who clears
  `localStorage` counts as a new user.

## Known integration risks (to check inside the target project)

- **Table names**: `app_users`, `daily_stats` are generic and may collide. Prefix if needed.
- **RPC name**: `record_activity` may collide.
- **View name**: `stats_overview` may collide.
- **Routes**: `/` and `/admin` will conflict with existing routes; `/admin` especially.
- **Component names**: `Calculator`, and the entire `src/components/ui/*` set.
- **Hook/util names**: `use-mobile`, `cn`, `utils.ts`, `i18n.ts`, `numbers.ts`, `stats.ts`.
- **Types**: `Lang`, `SoldiersResult`, `PowerResult`, `ConsumptionResult`, `AdminStats`, `DailyRow`.
- **Supabase client**: this module imports the generated
  `@/integrations/supabase/client`; the target project almost certainly has its own —
  re-point imports to one single client instead of instantiating two.
- **Database types**: `src/integrations/supabase/types.ts` must be regenerated after merging
  schemas, not concatenated.
- **Global styles**: `src/styles.css` defines Tailwind v4 theme tokens and the `dir="rtl"`
  behaviour; merging it wholesale can override the target theme.
- **Env vars**: `ADMIN_PASSWORD` is a generic name and may clash.
- **Browser storage keys**: `stats.cid` and the calculator state keys are unprefixed.
- **Dependencies**: version conflicts on React 19, Tailwind 4, TanStack Router/Start,
  and duplicate `@radix-ui/*` copies.
- **Host plumbing**: `src/lib/error-capture.ts`, `error-page.ts`,
  `lovable-error-reporting.ts`, `src/server.ts`, `src/start.ts` and
  `@lovable.dev/vite-tanstack-config` are platform-specific and should not be duplicated
  in a target project that already has equivalents.

## What the target project must provide

- A Postgres/Supabase database with the migration applied (tables + RPC + grants + RLS as written).
- The environment variables listed above.
- A React 19 + Tailwind 4 host able to render `<Calculator lang setLang />`.
- Optional: a route for the admin dashboard and the two server-only secrets.

## Before pushing to GitHub

`.env` is currently present at the repo root and is **not** listed in `.gitignore`.
It holds only project-specific URL + publishable keys (no service-role key, no admin
password — those live in the platform secret store), but it is environment-specific.
Exclude it from the public repository and ship `.env.example` instead.

## What must NOT be copied / duplicated

- A second Supabase client instance or a second `types.ts`.
- A second copy of `src/components/ui/*` if the target already has shadcn/ui.
- The platform error-reporting/SSR plumbing if the target has its own.
- `.env` with real values, `node_modules`, `dist`, `.output`, `.wrangler`, `bun.lock`
  (if the target uses another package manager), and any Git metadata.
- The Lovable-generated files under `src/integrations/supabase/` should be regenerated
  against the target backend rather than copied verbatim.
