/**
 * Idempotency layer.
 *
 * This reuses the same core pattern from real-world bidirectional sync work:
 * a write-once record keyed by an idempotency key, with a TTL, so that a
 * retried/duplicate request (network retry, client double-tap, SQS at-least-once
 * delivery) does not re-process a reward or discount twice.
 *
 * In production on AWS this is a DynamoDB table with:
 *   - PK = idempotencyKey
 *   - conditional PutItem (attribute_not_exists(PK)) to guarantee "only one writer wins"
 *   - a TTL attribute so old keys are auto-reaped by DynamoDB
 *
 * Here it's swapped for an in-memory Map behind the same interface, so the
 * business logic (engines/) never needs to know which backing store it's using.
 * Swapping this for a real DynamoDB-backed implementation is a drop-in change.
 */

export interface StoredResult<T> {
  result: T;
  storedAtMs: number;
}

export interface IdempotencyStore {
  /**
   * Attempts to claim a key. Returns { claimed: true } if this call is the
   * first to see the key (caller should proceed and later call `save`).
   * Returns { claimed: false, existing } if the key was already processed
   * (caller should short-circuit and return the cached result).
   */
  tryClaim<T>(key: string): Promise<{ claimed: true } | { claimed: false; existing: StoredResult<T> | null }>;

  save<T>(key: string, result: T): Promise<void>;
}

interface InternalRecord {
  status: 'in-flight' | 'complete';
  result?: unknown;
  storedAtMs: number;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, InternalRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  private isExpired(record: InternalRecord): boolean {
    return Date.now() - record.storedAtMs > this.ttlMs;
  }

  async tryClaim<T>(key: string): Promise<{ claimed: true } | { claimed: false; existing: StoredResult<T> | null }> {
    const existing = this.records.get(key);

    if (existing && !this.isExpired(existing)) {
      if (existing.status === 'complete') {
        return {
          claimed: false,
          existing: { result: existing.result as T, storedAtMs: existing.storedAtMs },
        };
      }
      // in-flight duplicate (e.g. two near-simultaneous retries) — treat as "not claimed",
      // caller decides how to handle (in this demo we just tell them nothing is ready yet)
      return { claimed: false, existing: null };
    }

    // conditional "put" simulation: only claim if absent or expired
    this.records.set(key, { status: 'in-flight', storedAtMs: Date.now() });
    return { claimed: true };
  }

  async save<T>(key: string, result: T): Promise<void> {
    this.records.set(key, { status: 'complete', result, storedAtMs: Date.now() });
  }

  /** Test/debug helper only. */
  _size(): number {
    return this.records.size;
  }
}
