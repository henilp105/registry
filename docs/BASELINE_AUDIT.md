

---

## D41 closed — rate limiting, documented but never implemented

**Severity: high (availability).** D41 recorded that `docs/api-reference.md`
documents a rate-limiting scheme with `X-RateLimit-*` headers that is "not
implemented anywhere", alongside a 429 handler that nothing raises. Now implemented
as documented.

Two bugs were found while doing it, both in the new code.

### Counter keyed by client alone, so the three budgets collided

`#rateCounters` was keyed by `clientKey(...)` with no bucket component, so the
auth, upload and general counters shared one slot per client. Auth traffic ate the
upload allowance and vice versa, and every client effectively got the tightest of
the three limits.

Measured: a brand-new client that had signed up and logged in — two auth requests
— then saw `X-RateLimit-Remaining: 2` on its **first** upload, against a budget of
5.

The first live check missed it because every probe used a distinct address and made
requests of only one kind, so the collision never arose. Finding it required a
client that made requests of more than one kind, which is exactly what a real user
does and a synthetic probe does not. The key now includes the bucket.

### Turning the limiter on broke the verification harnesses

`write_path_audit.mjs` fell from 69/69 to 49/69 the moment the limiter was
enabled: its three uploads exceeded the 5/hour budget and everything downstream
failed. A harness that cannot verify anything is worse than no harness, so both
harnesses now give each synthetic client its own source address, which is what
independent CI runners look like.

This is not working around the control. Per-address limiting of anonymous traffic
*is* the documented behaviour, and the harnesses now depend on it working — the
fuzz harness's publisher pool genuinely cannot be created from a single address,
because eight signups exceed the 10/minute auth budget.

The same exercise surfaced a real harness bug: the racing-publish probes had been
switched to a pool publisher's token, but a publish token is **scoped**, so the
package landed in that publisher's namespace rather than the one under test. The
probes now use the namespace-scoped token with distinct addresses, which also
makes them more faithful — the unique-index race is on `(name, namespace)` and is
global, not per client.

### Design decisions, and what each costs

| Decision | Reason | Cost accepted |
|---|---|---|
| Per account, not per address | a NAT or shared CI runner puts many users behind one IP; per-address lets one deny service to the rest | one extra HMAC verify per request — no DB round trip, no KDF |
| Durable Object, not KV | KV is eventually consistent, so a counter there under-counts and therefore does not rate limit | one DO round trip, on routes that already make one |
| Durable Object, not Worker memory | isolates are ephemeral and numerous; an in-Worker counter is per-isolate and trivially bypassed | — |
| Cache hits not counted | flooding cached reads is the cheap way to load the registry; Cloudflare serves them and the Atlas cap is untouched | a cache-flooding client is not limited |
| Fails open | a limiter that breaks and takes the API down with it adds availability risk rather than reducing it | no protection while the counter store is down |
| Fixed window | one counter and one timestamp per key; no eviction sweep, bounded memory | a boundary burst of up to 2x the limit |

### Verified against the live cluster

`scripts/rate_limit_probe.cjs`, 16/16:

- auth refused on request **11**, first ten not refused
- general refused on request **101**
- upload bucket is **5**, distinct from the others, refused on request 6
- refusals carry `X-RateLimit-Limit`, `Remaining: 0`, `Retry-After`, and a `code: 429` body
- a different address keeps its own budget
- `/health`, `/`, `/apidocs` and `/apidocs/openapi.json` are exempt
- CORS headers survive alongside the rate headers

25 unit tests, each verified to fail under mutation: dropping the negative clamp,
removing the window reset, widening the upload bucket to all writes, allowing
`remaining` to go negative.

