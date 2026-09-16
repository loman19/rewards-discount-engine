# Deploying to real AWS (Lambda + API Gateway + DynamoDB)

This is meant to be deployed **briefly, to prove it runs on real AWS
infrastructure**, then torn down — not left running as a long-lived service.
At this traffic volume (a handful of smoke-test requests) the whole exercise
costs effectively nothing regardless of AWS account age: Lambda and DynamoDB
are covered by AWS's permanent Always Free tier, and even API Gateway's
pay-per-request rate outside its free window is about $1 per million
requests.

## Prerequisites (one-time setup)

1. An AWS account (any account works — no special access needed).
2. AWS CLI installed and configured: `aws configure` (needs an access key ID
   and secret from IAM — create a user with programmatic access if you don't
   have one).
3. AWS SAM CLI installed (`brew install aws-sam-cli` on macOS, or see the
   [AWS SAM install docs](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)).

## Deploy

```bash
sam build           # bundles src/lambda.ts with esbuild — no manual dist/ copying needed
sam deploy --guided # first run only; asks for a stack name and confirms IAM changes,
                     # then writes samconfig.toml so future `sam deploy` needs no flags
```

`sam deploy --guided` will print outputs including `ApiUrl` when it finishes.
Copy that URL for the smoke test below (it's also visible any time via
`aws cloudformation describe-stacks --stack-name <your-stack-name> --query "Stacks[0].Outputs"`).

## Smoke test (this is your proof it's real)

```bash
API_URL="<paste ApiUrl output here>"

# Health check
curl -s "$API_URL/health"

# First call — computed fresh (replayed: false)
curl -s -X POST "$API_URL/discounts/instant-bank" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: proof-run-1" \
  -d '{"cardBin":"400123","cartValuePaise":2000000}'

# Retry with the SAME key — proves idempotency against a real DynamoDB table,
# not just the in-memory store (replayed: true, identical result)
curl -s -X POST "$API_URL/discounts/instant-bank" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: proof-run-1" \
  -d '{"cardBin":"400123","cartValuePaise":2000000}'
```

Save this transcript (or a screenshot of it, plus the AWS Console showing the
Lambda function, the API Gateway route, and the DynamoDB item) — that's your
evidence for a resume/interview claim of "deployed to AWS Lambda, API
Gateway, and DynamoDB," separate from keeping anything running long-term.

## Tear down

```bash
sam delete
```

Confirms and deletes the Lambda function, the HTTP API, the DynamoDB table,
and the CloudFormation stack itself — nothing billable is left behind.
