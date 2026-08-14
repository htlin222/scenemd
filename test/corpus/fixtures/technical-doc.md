# Deploy pipeline reference

This service deploys from a single command. The steps below are ordered and each one gates the next.

## Build

```bash
npm ci
npm run build
```

The build must be reproducible. Lockfile drift fails the pipeline before anything ships.

## Database migration

```sql
ALTER TABLE documents ADD COLUMN presentation_config TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS documents_updated_at_idx ON documents(updated_at DESC);
```

Migrations are forward-only. A rollback is a new migration, never an edit to an applied one.

## Worker deployment

```bash
npx wrangler deploy -c worker/wrangler.jsonc
npx wrangler pages deploy dist --project-name=scenemd
```

The Worker deploys before Pages so the Durable Object class exists when the new frontend arrives.

## Verification

- Check the health endpoint returns the new build time
- Confirm migrations applied with a schema query
- Tail production logs for five minutes before walking away

## Rollback

Every deploy is tagged. Rolling back is deploying the previous tag, not reverting commits under pressure.
