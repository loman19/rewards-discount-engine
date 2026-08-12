import express, { Request, Response, NextFunction } from 'express';
import { InMemoryIdempotencyStore, IdempotencyStore } from './idempotency/IdempotencyStore';
import { evaluateInstantBankDiscount } from './engines/instantBankDiscount';
import { evaluateNoCostEmi } from './engines/noCostEmi';
import { evaluateExchangeDiscount } from './engines/exchangeDiscount';
import {
  InstantBankDiscountResult,
  NoCostEmiResult,
  ExchangeDiscountResult,
} from './types';
import {
  validateInstantBankDiscountRequest,
  validateNoCostEmiRequest,
  validateExchangeDiscountRequest,
} from './validation';

/**
 * This Express app plays the role that API Gateway + Lambda would play in
 * production. Each route:
 *   1. Requires an `Idempotency-Key` header (mirrors a client-generated
 *      request ID — e.g. cart checkout attempt ID).
 *   2. Tries to claim that key before doing any work.
 *      - If already completed -> return the cached result, do NOT recompute
 *        or double-apply a discount.
 *      - If claimed for the first time -> run the engine, then persist the
 *        result under that key.
 *   3. Runs the relevant pure engine function.
 *
 * Swapping InMemoryIdempotencyStore for a DynamoDB-backed store is the only
 * change needed to move this to production — none of the route or engine
 * code changes.
 */

export function createApp(store: IdempotencyStore = new InMemoryIdempotencyStore()) {
  const app = express();
  app.use(express.json());

  // Malformed JSON bodies make body-parser throw a SyntaxError, which would
  // otherwise fall through to Express's default HTML error page — wrong
  // content type for a JSON API, and it leaks a stack trace outside of
  // NODE_ENV=production.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Malformed JSON in request body.' });
    }
    next(err);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  function requireIdempotencyKey(req: Request, res: Response, next: NextFunction) {
    const key = req.header('Idempotency-Key');
    if (!key) {
      res.status(400).json({ error: 'Idempotency-Key header is required.' });
      return;
    }
    (req as any).idempotencyKey = key;
    next();
  }

  app.post('/discounts/instant-bank', requireIdempotencyKey, async (req: Request, res: Response) => {
    const key = `instant-bank:${(req as any).idempotencyKey}`;
    const claim = await store.tryClaim<InstantBankDiscountResult>(key);

    if (!claim.claimed) {
      if (claim.existing) {
        return res.status(200).json({ ...claim.existing.result, replayed: true });
      }
      return res.status(409).json({ error: 'Request with this Idempotency-Key is already being processed.' });
    }

    try {
      const payload = validateInstantBankDiscountRequest(req.body);
      const result = evaluateInstantBankDiscount(payload);
      await store.save(key, result);
      return res.status(200).json({ ...result, replayed: false });
    } catch (err) {
      await store.release(key);
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/discounts/no-cost-emi', requireIdempotencyKey, async (req: Request, res: Response) => {
    const key = `no-cost-emi:${(req as any).idempotencyKey}`;
    const claim = await store.tryClaim<NoCostEmiResult>(key);

    if (!claim.claimed) {
      if (claim.existing) {
        return res.status(200).json({ ...claim.existing.result, replayed: true });
      }
      return res.status(409).json({ error: 'Request with this Idempotency-Key is already being processed.' });
    }

    try {
      const payload = validateNoCostEmiRequest(req.body);
      const result = evaluateNoCostEmi(payload);
      await store.save(key, result);
      return res.status(200).json({ ...result, replayed: false });
    } catch (err) {
      await store.release(key);
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/discounts/exchange', requireIdempotencyKey, async (req: Request, res: Response) => {
    const key = `exchange:${(req as any).idempotencyKey}`;
    const claim = await store.tryClaim<ExchangeDiscountResult>(key);

    if (!claim.claimed) {
      if (claim.existing) {
        return res.status(200).json({ ...claim.existing.result, replayed: true });
      }
      return res.status(409).json({ error: 'Request with this Idempotency-Key is already being processed.' });
    }

    try {
      const payload = validateExchangeDiscountRequest(req.body);
      const result = evaluateExchangeDiscount(payload);
      await store.save(key, result);
      return res.status(200).json({ ...result, replayed: false });
    } catch (err) {
      await store.release(key);
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  return app;
}

// Only start listening when run directly (not when imported by tests).
if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Rewards engine listening on port ${PORT}`);
  });
}
