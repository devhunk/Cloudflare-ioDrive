# Maintenance Guide

## Source of truth

- Runtime code: `src/`
- Cloudflare configuration template: `wrangler.toml.example`
- Production and Demo deployment: `.github/workflows/deploy.yml`
- Fork one-click deployment: `.github/workflows/deploy-button.yml`
- Database schema history: `database/migrations/`

Do not commit generated `wrangler.toml` or `dist/`.

## Required checks

```bash
npm ci
npm run check
```

`npm run check` performs TypeScript checking and a Wrangler dry-run build. It is not a behavioral test suite.

## Environment invariants

| Environment | SITE_ID | DEMO_MODE | Secrets | Writes |
| --- | --- | --- | --- | --- |
| Production | unique production value | unset | production-only | enabled |
| Demo | unique demo value | `true` | none | blocked |

JWTs are scoped to `SITE_ID`. Changing `SITE_ID` invalidates existing sessions.

`PUBLIC_DOMAIN` must be the Worker hostname without a scheme. WebDAV uses it for
internal authenticated callbacks. Public multipart uploads are capped by
`PUBLIC_UPLOAD_MAX_BYTES` (2 GiB by default), bound to a 24-hour capability, and
must use 20 MiB parts except for the final part.

## Database changes

Create a new numbered SQL file instead of editing an applied migration. CI applies migrations when `CLOUDFLARE_D1_API_TOKEN` is configured with D1 Edit permission; otherwise apply them manually before deploying code:

```bash
npx wrangler d1 migrations apply META_DB --remote
```

## Branches

`main` is the deployment source. The remote `demo` branch is legacy and does not deploy; delete it only after confirming that no historical work is needed.

## Release verification

- Production root loads and unauthenticated admin APIs return 401.
- Demo dashboard loads without credentials.
- Demo API writes return 403.
- Production and Demo use different D1/R2 resources and different `SITE_ID` values.
