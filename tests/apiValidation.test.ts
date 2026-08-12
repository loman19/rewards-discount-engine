import request from 'supertest';
import { createApp } from '../src/app';
import { InMemoryIdempotencyStore } from '../src/idempotency/IdempotencyStore';

describe('Health check', () => {
  it('responds 200 without requiring an Idempotency-Key header', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Malformed JSON body', () => {
  it('returns a JSON 400 error, not an HTML error page', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', 'malformed-json-1')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(res.status).toBe(400);
    expect(res.type).toBe('application/json');
    expect(res.body).toHaveProperty('error');
  });
});

describe('Input validation at the API boundary', () => {
  it('rejects a no-cost-emi request missing required fields with 400, not a 200 full of nulls', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/no-cost-emi')
      .set('Idempotency-Key', 'missing-fields-1')
      .send({ tenureMonths: 6, annualInterestRatePercent: 14 }); // cartValuePaise missing

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cartValuePaise/);
  });

  it('rejects a negative ageMonths on the exchange endpoint instead of producing a value above the original price', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/exchange')
      .set('Idempotency-Key', 'negative-age-1')
      .send({ deviceCategory: 'phone', ageMonths: -5, condition: 'excellent', originalPricePaise: 5_000_000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ageMonths/);
  });

  it('rejects an invalid deviceCategory enum value', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/exchange')
      .set('Idempotency-Key', 'bad-category-1')
      .send({ deviceCategory: 'toaster', ageMonths: 6, condition: 'good', originalPricePaise: 5_000_000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/deviceCategory/);
  });

  it('rejects a negative cartValuePaise on the instant-bank endpoint', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/discounts/instant-bank')
      .set('Idempotency-Key', 'negative-cart-1')
      .send({ cardBin: '400123', cartValuePaise: -5_000_000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cartValuePaise/);
  });
});

describe('A failed request must not permanently lock its Idempotency-Key', () => {
  it('lets a corrected retry with the same key succeed after an earlier validation failure', async () => {
    const app = createApp(new InMemoryIdempotencyStore());
    const key = 'stuck-key-regression-1';

    const failed = await request(app)
      .post('/discounts/no-cost-emi')
      .set('Idempotency-Key', key)
      .send({ cartValuePaise: 12_00_000, tenureMonths: 0, annualInterestRatePercent: 14 }); // invalid tenure

    expect(failed.status).toBe(400);

    const retry = await request(app)
      .post('/discounts/no-cost-emi')
      .set('Idempotency-Key', key)
      .send({ cartValuePaise: 12_00_000, tenureMonths: 6, annualInterestRatePercent: 14 }); // corrected

    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(false);
    expect(retry.body.emiPaisePerMonth).toBe(200_000);
  });
});
