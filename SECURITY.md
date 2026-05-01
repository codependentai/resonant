# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v2.2.x  | Yes       |
| < v2.2  | Best effort |

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
- **Runtime queries** go through the runtime you configure locally. Claude Code uses your Claude Code login, OpenAI Codex uses local Codex auth, and API/BYOK providers use your own keys where supported. We never see them
- **MCP servers** are user-configured — we don't bundle or recommend specific ones

### What to watch for

- **Exposed ports** — do not port-forward `3002` directly. Use Tailscale for private access. If you use Cloudflare Tunnel for a public hostname, put Cloudflare Access in front of it and keep Resonant's own password enabled
- **Identity files and `CLAUDE.md` contents** — these are sent to the runtime as identity/context. Don't put secrets in them
- **`.env`, `.mcp.json`, and `resonant.yaml`** — may contain credentials or endpoints. They are gitignored by default
- **Discord/Telegram tokens** — treat these as secrets. Never commit them
- **VAPID keys** — required for web push, but still credentials. Keep them in `.env` or secure environment storage
