import request from 'supertest';
import { createApp } from '../src/app';
import { InMemoryIdempotencyStore } from '../src/idempotency/IdempotencyStore';

describe('Idempotency guarantees at the API layer', () => {
  it('rejects requests missing the Idempotency-Key header', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/instant-bank')
      .send({ cardBin: '400123', cartValuePaise: 10_00_000 });

    expect(res.status).toBe(400);
  });

  it('processes a request once and replays the cached result on retry (no double discount)', async () => {
    const app = createApp(new InMemoryIdempotencyStore());
    const key = 'checkout-attempt-abc-123';
    const body = { cardBin: '400123', cartValuePaise: 10_00_000 };

    const first = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(200);
    expect(first.body.replayed).toBe(false);
    expect(first.body.eligible).toBe(true);

    // Simulate a client retry (e.g. network timeout, user double-taps "apply
    // coupon") with the SAME idempotency key.
    const retry = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', key)
      .send(body);

    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    // The discount amount must be identical — not recomputed, not doubled.
    expect(retry.body.discountPaise).toBe(first.body.discountPaise);
  });

  it('treats different idempotency keys as independent transactions', async () => {
    const app = createApp(new InMemoryIdempotencyStore());
    const body = { cardBin: '400123', cartValuePaise: 10_00_000 };

    const first = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', 'order-1')
      .send(body);

    const second = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', 'order-2')
      .send(body);

    expect(first.body.replayed).toBe(false);
    expect(second.body.replayed).toBe(false); // NOT treated as a duplicate of order-1
  });

  it('applies the same idempotency guarantee to the No Cost EMI endpoint', async () => {
    const app = createApp(new InMemoryIdempotencyStore());
    const key = 'emi-checkout-1';
    const body = { cartValuePaise: 12_00_000, tenureMonths: 6, annualInterestRatePercent: 14 };

    const first = await request(app).post('/discounts/no-cost-emi').set('Idempotency-Key', key).send(body);
    const retry = await request(app).post('/discounts/no-cost-emi').set('Idempotency-Key', key).send(body);

    expect(first.body.replayed).toBe(false);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.emiPaisePerMonth).toBe(first.body.emiPaisePerMonth);
  });

  it('applies the same idempotency guarantee to the Exchange Discount endpoint', async () => {
    const app = createApp(new InMemoryIdempotencyStore());
    const key = 'exchange-checkout-1';
    const body = { deviceCategory: 'phone', ageMonths: 12, condition: 'good', originalPricePaise: 40_000_00 };

    const first = await request(app).post('/discounts/exchange').set('Idempotency-Key', key).send(body);
    const retry = await request(app).post('/discounts/exchange').set('Idempotency-Key', key).send(body);

    expect(first.body.replayed).toBe(false);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.estimatedValuePaise).toBe(first.body.estimatedValuePaise);
  });
});
