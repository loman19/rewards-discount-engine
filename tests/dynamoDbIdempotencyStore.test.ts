import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDbIdempotencyStore } from '../src/idempotency/DynamoDbIdempotencyStore';

// Exercises the store against a mocked DynamoDBDocumentClient rather than
// real AWS or LocalStack, so `npm test` stays fast, free, and credential-free
// while still proving the conditional-write / claim-once logic is correct.
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

function newStore() {
  const raw = new DynamoDBClient({ region: 'us-east-1' });
  return new DynamoDbIdempotencyStore('rewards-idempotency-test', 86400, raw);
}

describe('DynamoDbIdempotencyStore', () => {
  it('claims a key via a conditional PutItem when none exists', async () => {
    ddbMock.on(PutCommand).resolves({});
    const store = newStore();

    const result = await store.tryClaim('fresh-key');

    expect(result).toEqual({ claimed: true });
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input).toMatchObject({
      TableName: 'rewards-idempotency-test',
      Item: expect.objectContaining({ idempotencyKey: 'fresh-key', status: 'in-flight' }),
      ConditionExpression: 'attribute_not_exists(idempotencyKey) OR expiresAt < :now',
    });
  });

  it('returns the cached result on a conditional-check failure against a completed record', async () => {
    ddbMock.on(PutCommand).rejects(
      new ConditionalCheckFailedException({ message: 'conditional check failed', $metadata: {} })
    );
    ddbMock.on(GetCommand).resolves({
      Item: {
        idempotencyKey: 'done-key',
        status: 'complete',
        result: JSON.stringify({ discountPaise: 500 }),
        storedAtMs: 123,
      },
    });
    const store = newStore();

    const result = await store.tryClaim('done-key');

    expect(result).toEqual({
      claimed: false,
      existing: { result: { discountPaise: 500 }, storedAtMs: 123 },
    });
  });

  it('returns existing:null on a conditional-check failure against an in-flight record', async () => {
    ddbMock.on(PutCommand).rejects(
      new ConditionalCheckFailedException({ message: 'conditional check failed', $metadata: {} })
    );
    ddbMock.on(GetCommand).resolves({
      Item: { idempotencyKey: 'in-flight-key', status: 'in-flight', storedAtMs: 123 },
    });
    const store = newStore();

    const result = await store.tryClaim('in-flight-key');

    expect(result).toEqual({ claimed: false, existing: null });
  });

  it('returns existing:null if the record was released between the failed PutItem and the GetItem', async () => {
    ddbMock.on(PutCommand).rejects(
      new ConditionalCheckFailedException({ message: 'conditional check failed', $metadata: {} })
    );
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const store = newStore();

    const result = await store.tryClaim('raced-key');

    expect(result).toEqual({ claimed: false, existing: null });
  });

  it('rethrows non-conditional errors instead of swallowing them', async () => {
    ddbMock.on(PutCommand).rejects(new Error('throttled'));
    const store = newStore();

    await expect(store.tryClaim('any-key')).rejects.toThrow('throttled');
  });

  it('save() overwrites the record as complete with a JSON-stringified result', async () => {
    ddbMock.on(PutCommand).resolves({});
    const store = newStore();

    await store.save('done-key', { discountPaise: 750 });

    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input).toMatchObject({
      Item: expect.objectContaining({
        idempotencyKey: 'done-key',
        status: 'complete',
        result: JSON.stringify({ discountPaise: 750 }),
      }),
    });
  });

  it('release() deletes the record', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const store = newStore();

    await store.release('done-key');

    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input).toEqual({
      TableName: 'rewards-idempotency-test',
      Key: { idempotencyKey: 'done-key' },
    });
  });
});
