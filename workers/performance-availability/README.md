# Performance availability Worker

This Worker exposes `GET https://api.gaiensai.com/performances-availability`
and `GET https://api.gaiensai.com/app-data-cache`.
Its Durable Object is
the single Cloudflare-side Supabase Realtime subscriber and stores the latest
result of the existing public `get_performance_availability` RPC. A second
Durable Object keeps a shared snapshot of configs (with credentials removed),
leaderboard, rehearsal data, issue controls, and the three QR-validation ticket
fields. Ticket fields are only returned through
`/app-data-cache/ticket?code=...`, which returns one matching ticket rather
than the whole ticket list. `/app-data-cache/user-counters` is separately
cached by a hash of the authenticated user's token, so student counters are
never shared between users.

The same token-hashed private cache is used by
`/app-data-cache/student-dashboard`, `/app-data-cache/junior-dashboard`,
`/app-data-cache/student-issue-bootstrap`, and
`/app-data-cache/junior-issue-bootstrap`. Browser-facing responses remain
`private, no-store`; only an internal response stored under the hashed cache
key is cacheable for three seconds.

## Deploy

1. Ensure `api.gaiensai.com` is a proxied DNS record in the `gaiensai.com`
   Cloudflare zone. The Worker route is configured in `wrangler.jsonc`.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Worker secrets. The current
   RPC is public, so a service-role key is neither needed nor accepted here.
3. Deploy with `npx wrangler deploy --config workers/performance-availability/wrangler.jsonc`.
4. If the API uses a different host from the site, set
   `VITE_PERFORMANCE_AVAILABILITY_API_URL` in the frontend build environment.

## GitHub Actions deployment

`.github/workflows/deploy-performance-availability-worker.yml` deploys this
Worker after the `CI` workflow succeeds for `main`. Configure these repository
secrets in GitHub before the first push:

- `CF_WORKERS_API_TOKEN`: a scoped Cloudflare API token with permission to
  deploy Workers and update the `gaiensai.com` Worker route.
- `CF_WORKERS_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` remain Cloudflare Worker Secrets. Do
not add them to GitHub Actions; Wrangler preserves existing Worker Secrets
when this workflow deploys a new version.

The API uses a three-second shared Cloudflare cache. It never falls back to a
browser-to-Supabase request: on an outage the UI retains its local last-known
value where available and otherwise reports the fetch error.
