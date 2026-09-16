import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { IdempotencyStore, StoredResult } from './IdempotencyStore';

/**
 * Real DynamoDB-backed implementation of IdempotencyStore, matching the
 * semantics of InMemoryIdempotencyStore exactly (same interface, same
 * in-flight/complete/expired state machine) so app.ts and the engines never
 * change when swapping stores.
 *
 * Table shape (see template.yaml):
 *   PK: idempotencyKey (S)
 *   status: 'in-flight' | 'complete'
 *   result: JSON-stringified result (only present when status === 'complete')
 *   storedAtMs: epoch ms the record was last written
 *   expiresAt: epoch SECONDS — DynamoDB TTL attribute, so stale records are
 *              auto-reaped without a background job
 *
 * DynamoDB's own TTL sweep is best-effort and can lag by hours, so `tryClaim`
 * does not rely on it for correctness: the conditional PutItem explicitly
 * allows reclaiming a key whose `expiresAt` has already passed, via
 * `attribute_not_exists(idempotencyKey) OR expiresAt < :now`. This is the
 * real-world reason the in-memory version's `isExpired` check exists too —
 * here it's expressed as a DynamoDB condition instead of a JS comparison.
 */
export class DynamoDbIdempotencyStore implements IdempotencyStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly ttlSeconds: number;

  constructor(tableName: string, ttlSeconds: number = 24 * 60 * 60, client?: DynamoDBClient) {
    this.tableName = tableName;
    this.ttlSeconds = ttlSeconds;
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async tryClaim<T>(key: string): Promise<{ claimed: true } | { claimed: false; existing: StoredResult<T> | null }> {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            idempotencyKey: key,
            status: 'in-flight',
            storedAtMs: nowMs,
            expiresAt: nowSeconds + this.ttlSeconds,
          },
          ConditionExpression: 'attribute_not_exists(idempotencyKey) OR expiresAt < :now',
          ExpressionAttributeValues: { ':now': nowSeconds },
        })
      );
      return { claimed: true };
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) {
        throw err;
      }
      // Someone else holds the key (in-flight or complete) — find out which.
      const existing = await this.doc.send(
        new GetCommand({ TableName: this.tableName, Key: { idempotencyKey: key } })
      );

      if (!existing.Item) {
        // Raced with a release() between our failed PutItem and this GetItem.
        // Same contract as InMemoryIdempotencyStore's in-flight branch: tell
        // the caller nothing is ready yet rather than looping here.
        return { claimed: false, existing: null };
      }

      if (existing.Item.status === 'complete') {
        return {
          claimed: false,
          existing: { result: JSON.parse(existing.Item.result) as T, storedAtMs: existing.Item.storedAtMs },
        };
      }

      return { claimed: false, existing: null };
    }
  }

  async save<T>(key: string, result: T): Promise<void> {
    const nowMs = Date.now();
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          idempotencyKey: key,
          status: 'complete',
          result: JSON.stringify(result),
          storedAtMs: nowMs,
          expiresAt: Math.floor(nowMs / 1000) + this.ttlSeconds,
        },
      })
    );
  }

  async release(key: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { idempotencyKey: key } }));
  }
}
