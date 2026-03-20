# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v1.x    | Yes       |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

DM us on [X (@codependent_ai)](https://x.com/codependent_ai) or message the [Telegram channel](https://t.me/+xSE1P_qFPgU4NDhk) with:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)

We'll acknowledge within 48 hours and aim to patch critical issues within 7 days.

## Security model

Resonant is self-hosted software that runs on your machine:

- **No cloud backend** — your data stays local (SQLite + filesystem)
- **No telemetry** — nothing phones home
- **Auth is optional** — password protection is available but not required for local-only use
- **Agent SDK queries** go through your Claude Code subscription — we never see them
- **MCP servers** are user-configured — we don't bundle or recommend specific ones

### What to watch for

- **Exposed ports** — if you expose Resonant to the internet, set a password and use HTTPS
- **CLAUDE.md contents** — this file is sent to the AI on every query. Don't put secrets in it
- **`.env` and `resonant.yaml`** — contain credentials. Both are gitignored by default
- **Discord/Telegram tokens** — treat these as secrets. Never commit them
