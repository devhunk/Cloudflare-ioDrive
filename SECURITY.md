# Security Policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for credentials, authentication bypasses, or data exposure. Use GitHub's private vulnerability reporting from the repository's **Security** tab.

Include the affected route, expected behavior, reproduction steps, and impact. If private reporting is unavailable, contact the repository owner privately before disclosing details.

## Deployment rules

- Never commit `.dev.vars`, `.env`, `wrangler.toml`, API tokens, or access keys.
- Production and Demo must use different `SITE_ID` values.
- Demo must set `DEMO_MODE=true` and must not receive production secrets.
- Rotate a secret immediately if it was exposed in logs, commits, screenshots, or a public Demo.
