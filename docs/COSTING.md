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

## Paid tiers — $5, $10, $25, $100 per month

Billing rates (approx., USD): Workers Paid base **$5/mo** (10M requests
included, then $0.30/M); CPU time $0.02/M CPU-ms; KV reads $0.50/M,
writes $5.00/M, storage $0.50/GB-mo; R2 storage $0.015/GB-mo, Class B
ops $0.36/M, egress free; Atlas M0 stays free up to 512 MB, M2 starts
at ~$9/mo. Pages free.

| Monthly budget | Workers base | KV | R2 | Mongo | Approx. sustained active users* | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| $5 | Included 10M req | free allowance | free allowance | Atlas M0 | ~5,000–20,000 | Workers Paid unlocks rate-limit headroom; likely the only line item |
| $10 | $5 + ~$1 overage | ~$2 (a few million writes) | <$1 | Atlas M0 | ~20,000–60,000 | Watch KV write cost — batch/coalesce counters if it dominates |
| $25 | $5 + ~$8 overage | ~$8 | ~$2 | M0 or M2 $9 | ~60,000–150,000 | May step Atlas to M2 for connection/storage headroom |
| $100 | $5 + ~$20 overage (70M req) | ~$30 | ~$5 | M2/M5 ~$25–40 | ~150,000–500,000 | Atlas becomes a real budget line; consider M10 only past this scale |

\* Assuming the same per-user mix as above (60 API requests + ~30 KV reads +
~1 download per user/month). Multiply by your real telemetry once deployed.

Rough rule of thumb: **each $1 of overage ≈ 3M extra requests or ~200k extra
KV writes**. The classic small-registry bill is almost entirely the $5
Workers base fee; KV writes and R2 reads are the two things to instrument
early.
