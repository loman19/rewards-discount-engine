import serverlessHttp from 'serverless-http';
import { createApp } from './app';
import { DynamoDbIdempotencyStore } from './idempotency/DynamoDbIdempotencyStore';

const tableName = process.env.IDEMPOTENCY_TABLE_NAME;
if (!tableName) {
  throw new Error('IDEMPOTENCY_TABLE_NAME environment variable is required in the Lambda runtime.');
}

const app = createApp(new DynamoDbIdempotencyStore(tableName));

export const handler = serverlessHttp(app);
