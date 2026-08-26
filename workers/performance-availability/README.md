# Performance availability Worker

This Worker exposes `GET /api/performance-availability`. Its Durable Object is
the single Cloudflare-side Supabase Realtime subscriber and stores the latest
result of the existing public `get_performance_availability` RPC.

## Deploy

1. Configure the Worker route `/api/performance-availability` on the host
   serving the frontend in the Cloudflare dashboard (or add that route to
   `wrangler.jsonc`).
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Worker secrets. The current
   RPC is public, so a service-role key is neither needed nor accepted here.
3. Deploy with `npx wrangler deploy --config workers/performance-availability/wrangler.jsonc`.
4. If the API uses a different host from the site, set
   `VITE_PERFORMANCE_AVAILABILITY_API_URL` in the frontend build environment.

The API uses a three-second shared Cloudflare cache. It never falls back to a
browser-to-Supabase request: on an outage the UI retains its local last-known
value where available and otherwise reports the fetch error.
