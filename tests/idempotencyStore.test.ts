import { InMemoryIdempotencyStore } from '../src/idempotency/IdempotencyStore';

describe('InMemoryIdempotencyStore', () => {
  it('returns claimed:false with existing:null for an in-flight duplicate (concurrent claim before save)', async () => {
    const store = new InMemoryIdempotencyStore();
    const key = 'concurrent-key';

    const first = await store.tryClaim(key);
    expect(first).toEqual({ claimed: true });

    // A second request for the same key arrives before the first has called
    // save() — this is the "in-flight duplicate" branch.
    const second = await store.tryClaim(key);
    expect(second).toEqual({ claimed: false, existing: null });
  });

  it('allows a fresh claim after release (so a failed request does not permanently lock the key)', async () => {
    const store = new InMemoryIdempotencyStore();
    const key = 'released-key';

    const first = await store.tryClaim(key);
    expect(first).toEqual({ claimed: true });

    await store.release(key);

    const second = await store.tryClaim(key);
    expect(second).toEqual({ claimed: true });
  });

  it('release on a key that was never claimed is a harmless no-op', async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(store.release('never-claimed')).resolves.toBeUndefined();
  });
});
