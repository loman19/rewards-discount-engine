# Rewards & Discount Engine

A serverless-style rewards-eligibility engine implementing three customer-facing
discount mechanisms, built with idempotent, replay-safe request handling.

Built as a portfolio project demonstrating backend patterns common to e-commerce
checkout discount systems — bank-offer eligibility, no-cost EMI, and device trade-in
valuation — with an emphasis on correctness under retries and duplicate delivery.

## Design goals

| Goal | What's implemented here |
|---|---|
| Three independent discount mechanisms | Standalone engines, one per feature: `src/engines/instantBankDiscount.ts`, `noCostEmi.ts`, `exchangeDiscount.ts` |
| Scalable, low-latency, stateless design | Stateless pure-function engines behind thin HTTP handlers — the same shape as an API Gateway → Lambda integration. No engine touches global state; latency is dominated only by the idempotency store lookup. |
| Economically sustainable promotions | `noCostEmi.ts` computes the *true* reducing-balance EMI vs. the *displayed* zero-interest EMI, and flags a `sustainable: false` per-order guard when the platform's interest subsidy exceeds a configured cap — i.e. the system knows when it's about to lose money on a promotion, not just how to display one. |
| Cloud-portable persistence | `IdempotencyStore` is written as an interface (`src/idempotency/IdempotencyStore.ts`) with an in-memory implementation for local dev. It's designed to be a drop-in swap for a DynamoDB-backed store (`PutItem` with `attribute_not_exists(PK)` + TTL attribute) with zero changes to route or business logic. |
| Observability | Every discount decision returns a `replayed: boolean` flag, making duplicate-vs-fresh processing observable at the API layer — the kind of signal you'd wire into a monitoring dashboard in production. |

## The idempotency pattern (the differentiator)

This directly reuses a pattern from real production experience: bidirectional
CRM↔ERP sync work required preventing double-writes when webhooks or retries
delivered the same event twice (webhook TTL keys, DMS SCN dedup, self-write
anti-join). The same *shape* of problem shows up here: a customer's checkout
request can be retried by the client, retried by a flaky network, or (in a real
SQS-backed system) delivered more than once by design (`at-least-once` delivery).

The guarantee this project proves (see `tests/idempotency.test.ts`):
- The **first** request with a given `Idempotency-Key` computes and stores the result.
- **Any retry** with the same key returns the *exact same* cached result — the
  discount is never recomputed, and a customer can never be granted a reward twice
  by retrying.
- **Different** keys are always treated as independent transactions, even with
  identical payloads.

## Project structure

```
src/
  types.ts                        # shared request/response shapes
  validation.ts                    # request-body validation at the API boundary
  idempotency/
    IdempotencyStore.ts            # interface + in-memory impl (swap for DynamoDB in prod)
  engines/
    instantBankDiscount.ts         # BIN-based bank offer eligibility + capped discount
    noCostEmi.ts                   # true-EMI vs displayed-EMI, interest subsidy calc
    exchangeDiscount.ts            # depreciation-curve trade-in valuation
  app.ts                           # Express routes wiring engines behind idempotency
tests/
  instantBankDiscount.test.ts
  noCostEmi.test.ts
  exchangeDiscount.test.ts
  idempotency.test.ts              # proves the replay-safety guarantee end-to-end
  idempotencyStore.test.ts         # unit tests on the store itself (in-flight duplicates, release)
  apiValidation.test.ts            # health check, malformed JSON, input validation, stuck-key regression
```

## Running it

```bash
npm install
npm test          # runs all 29 tests
npm run build      # compiles to dist/
npm start          # starts the server on :3000 (after build)
# or for local dev without a separate build step:
npm run dev
```

### Try it manually

```bash
# First call — computed fresh
curl -X POST http://localhost:3000/discounts/instant-bank \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123" \
  -d '{"cardBin":"400123","cartValuePaise":2000000}'

# Retry with the SAME key — returns the cached result, replayed: true
curl -X POST http://localhost:3000/discounts/instant-bank \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123" \
  -d '{"cardBin":"400123","cartValuePaise":2000000}'
```

## Bugs found in audit, and fixed

Before adding new features, the existing code was audited by actually running the
server and probing it (not just reading the source). Four real bugs were found and
fixed, each with a regression test in `tests/apiValidation.test.ts` or
`tests/idempotencyStore.test.ts`:

1. **`/health` required an `Idempotency-Key` header.** The header-check middleware
   was registered globally with `app.use()` before any routes existed, so it applied
   to `/health` too. In production this would fail ALB/ECS/Lambda health checks (they
   don't send business headers), getting a healthy service killed by its own
   orchestrator. Fixed by scoping the middleware to only the three discount routes.
2. **A failed request permanently locked its idempotency key.** `tryClaim` marked a
   key `'in-flight'` synchronously, but on validation failure the route handler
   returned 400 without ever calling `save()` — so the key stayed locked for its
   full 24h TTL, and a corrected retry with the *same* key got a `409` forever.
   Fixed by adding `IdempotencyStore.release(key)`, called from every route's catch
   block.
3. **No input validation at the API boundary.** Missing fields silently produced
   `null`/`NaN` fields in a `200` response instead of a `400`; a negative `ageMonths`
   produced an exchange-discount value *higher* than the device's original price.
   Fixed with `src/validation.ts` — explicit presence/type/range checks per request
   shape, run before any engine executes.
4. **Malformed JSON returned an HTML stack-trace page.** body-parser's JSON error
   fell through to Express's default HTML error handler. Fixed with a JSON-specific
   error-handling middleware right after `express.json()`.

## Deliberate scope decisions

This build intentionally covers the **core engine + idempotency** only — not yet:
- A real DynamoDB adapter (interface is ready; swap is mechanical, not a redesign)
- A cross-request promotional budget tracker (currently each No-Cost-EMI check
  only guards its own order; a shared "campaign budget" that throttles/degrades
  as it depletes is the natural next iteration — economic sustainability at the
  campaign level rather than just the order level)
- AWS SAM/CDK infrastructure-as-code for actual Lambda deployment
- Load testing to produce real p99 latency numbers
- Schema-based validation (zod or similar) — `src/validation.ts` is hand-rolled and
  closes the specific gaps found in the audit; a schema library would be a cleaner
  long-term replacement

These are good "what would you build next" answers in an interview, and a good todo
list for iterating with Claude Code from here.

## Talking about this in an interview

- **"Walk me through a system you designed"** → start with the idempotency guarantee
  and why retries are dangerous in a rewards system specifically (double-crediting a
  discount is a direct financial loss, unlike a duplicated log line).
- **"How would you scale this?"** → each engine is a pure function with no shared
  state; horizontal scaling is just running more Lambda invocations. The only
  shared-state bottleneck is the idempotency store, which is why DynamoDB (not an
  in-memory map) is the real answer — single-digit-millisecond conditional writes
  at effectively unlimited scale.
- **"What would you build next?"** → the campaign-level budget tracker (see above) —
  this is where the real economic-sustainability model actually lives.
- **"Tell me about a bug you found"** → the stuck-idempotency-key bug (see above): a
  failed request left a key permanently claimed because the error path never called
  `save()` or released the claim. Found by actually running the server and retrying
  a corrected request, not by reading the code — a reminder that idempotency logic
  needs to be tested on its failure paths, not just its happy path.
