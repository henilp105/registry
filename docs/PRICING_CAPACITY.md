# Free-Tier Capacity & Pricing Estimate

This stack is designed to run at **$0/month** within free-tier limits of
Cloudflare Workers, Cloudflare KV, Cloudflare R2, Cloudflare Pages, and
MongoDB Atlas M0. Below is the approximate math for "how many users can
this sustain".

## Assumptions (per active registry user / month)

- 60 API requests/month (login, profile view, search, package views)
- 1 package page view with 1–2 tarball downloads from time to time
- 1 maintainer publish every few weeks (≈ 0.2 publish requests)
- 1 KV cache hit/miss pair per page view
- Tarballs: average 500 KB, ~5 GB total tarball storage across all packages

## Free-tier ceilings

| Resource | Free limit | Supports (per active user/mo) | Approx. ceiling |
| --- | --- | --- | --- |
| Workers requests | 100,000 / day → ~3M / mo | ~60 requests | ~50,000 req-users/mo |
| Workers CPU | 10 ms/request, 128 MB | ~8 ms avg | same order |
| KV reads | 100,000 / day → ~3M / mo | ~30 reads (2 per page view × 15 views) | ~100,000 views/mo |
| KV writes | 1,000 / day → ~30,000 / mo | ~1 write per uncached view | ~30,000/mo writes (rate-limit counters) |
| R2 storage | 10 GB-month | ~5 GB total | ~10 GB of tarballs, ~free egress |
| R2 ops | 10M Class B/mo free | ~1 GET per download | ~10M downloads/mo |
| Atlas M0 | 512 MB, ~100 connections | — | ~hundreds of active users, thousands of documents |
| Pages | unlimited static | — | — |

## Rough end-user answer

- **Sustainable at $0/mo:** on the order of **200–500 regularly active
  users**, or up to **~5,000–10,000 registered users** with sporadic
  activity, assuming the request/working-set mix above.
- Binding constraint is **Workers KV writes** (1,000/day) because the
  rate-limiter uses KV; heavy unauthenticated search traffic will hit that
  first. The design already exempts `/health` and caches hot reads to stay
  under it.
- If traffic exceeds that, the first paid step is Workers Paid (~$5/mo),
  which removes KV-write throttling above the free allotment; everything
  else can still stay free up to the R2/storage limits.

## Per-user cost

Effectively **$0 per user** within the free ceilings above. Above them,
cost is dominated by KV/R2/Workers usage, not by seats.
