# Performance availability Worker

This Worker exposes `GET https://api.gaiensai.com/performances-availability`.
Its Durable Object is
the single Cloudflare-side Supabase Realtime subscriber and stores the latest
result of the existing public `get_performance_availability` RPC.

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
