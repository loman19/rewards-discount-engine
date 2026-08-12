# Rewards & Discount Engine

A serverless-style rewards-eligibility engine implementing three customer-facing
discount mechanisms, built with idempotent, replay-safe request handling.

Built as a targeted portfolio project for the **Amazon Pay India — Rewards Team**
role (Software Dev Engineer I, Job ID 10470829). Every design decision below maps
directly to a phrase in that JD.

## Why this project, mapped to the JD

| JD language | What's implemented here |
|---|---|
| "Instant Bank Discount, No Cost EMI, and Exchange Discount" | Three standalone engines, one per feature: `src/engines/instantBankDiscount.ts`, `noCostEmi.ts`, `exchangeDiscount.ts` |
| "highly scalable, low latency mobile first products" | Stateless pure-function engines behind thin HTTP handlers — the same shape as an API Gateway → Lambda integration. No engine touches global state; latency is dominated only by the idempotency store lookup. |
| "mathematical, economic and gamification models to engage customers in an economically sustainable way" | `noCostEmi.ts` computes the *true* reducing-balance EMI vs. the *displayed* zero-interest EMI, and flags a `sustainable: false` per-order guard when the platform's interest subsidy exceeds a configured cap — i.e. the system knows when it's about to lose money on a promotion, not just how to display one. |
| "Lambda, ECS, ... SQS, DynamoDB" | `IdempotencyStore` is written as an interface (`src/idempotency/IdempotencyStore.ts`) with an in-memory implementation for local dev. It's designed to be a drop-in swap for a DynamoDB-backed store (`PutItem` with `attribute_not_exists(PK)` + TTL attribute) with zero changes to route or business logic. |
| "Operational Excellence — monitoring & operation of production services" | Every discount decision returns a `replayed: boolean` flag, making duplicate-vs-fresh processing observable at the API layer — the kind of signal you'd wire into a CloudWatch metric in production. |

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
```

## Running it

```bash
npm install
npm test          # runs all 19 tests
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

## Deliberate scope decisions

This build intentionally covers the **core engine + idempotency** only — not yet:
- A real DynamoDB adapter (interface is ready; swap is mechanical, not a redesign)
- A cross-request promotional budget tracker (currently each No-Cost-EMI check
  only guards its own order; a shared "campaign budget" that throttles/degrades
  as it depletes is the natural next iteration — this is what the JD's "economically
  sustainable" phrase is really pointing at, at the campaign level rather than the
  order level)
- AWS SAM/CDK infrastructure-as-code for actual Lambda deployment
- Load testing to produce real p99 latency numbers

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
  this is where the "economic model" the JD asks for actually lives.
