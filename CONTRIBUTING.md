# Contributing to Resonant

Thanks for your interest in contributing. Resonant is built from a year of daily production use — the architecture is opinionated by design. This guide helps you contribute effectively.

## How to reach us

- **Bug reports** — [GitHub Issues](https://github.com/codependentai/resonant/issues)
- **Feature proposals** — [GitHub Issues](https://github.com/codependentai/resonant/issues) (open an issue before writing code)
- **Questions & discussion** — [GitHub Discussions](https://github.com/codependentai/resonant/discussions)
- **Updates** — Follow [@codependentai](https://tiktok.com/@codependentai) on TikTok

## What we welcome

These can go straight to a PR:

- **Bug fixes** — with a clear description of what was broken and how you fixed it
- **Documentation** — typos, clarifications, better examples, translations
- **Accessibility** — contrast fixes, ARIA improvements, keyboard navigation, screen reader support
- **Themes** — new CSS theme files in `examples/themes/` (see the [theme docs](examples/themes/README.md))
- **Platform fixes** — Windows/macOS/Linux edge cases, path handling, PM2 configs
- **Test coverage** — we don't have tests yet and would love them

## What needs an issue first

Open a GitHub Issue to discuss before writing code:

- **New features** — describe the use case, not just the implementation
- **New integrations** — additional communication channels, notification systems
- **Hook system changes** — the context injection pipeline is load-bearing infrastructure
- **Orchestrator changes** — scheduling, triggers, failsafe behavior
- **Database schema changes** — migrations affect existing users
- **Dependency additions** — we keep the dependency tree intentionally small

## What we won't accept

The following are architectural decisions, not oversights:

- **Alternative AI backends** — Resonant is built on Claude Code Agent SDK. That's the product.
- **Framework swaps** — SvelteKit frontend, Express backend. These aren't changing.
- **Cloud-hosted variants** — Resonant is self-hosted. That's the point.
- **Electron/Tauri wrappers** — the PWA approach is intentional

## Development setup

```bash
git clone https://github.com/codependentai/resonant.git
cd resonant
npm install
node scripts/setup.mjs
npm run build
```

For development with hot reload:

```bash
npm run dev              # Backend (tsx watch)
npm run dev:frontend     # Frontend (Vite dev server with proxy)
```

## PR guidelines

- **One thing per PR.** Bug fix? One PR. New theme? One PR. Don't bundle unrelated changes.
- **Describe what and why.** Not just what you changed — why it matters.
- **Test your changes.** Start the server, send a message, verify WebSocket connects, check settings load.
- **Don't break the build.** Run `npm run build` before submitting. Both backend (`tsc`) and frontend (`vite build`) must pass.
- **Match the existing style.** Look at the code around your change and follow the same patterns.
- **No generated code.** If you used an AI to write it, review it thoroughly. We will.

## Code style

- TypeScript strict mode
- No semicolons in frontend (Svelte), semicolons in backend
- CSS through variables (`var(--token)`), not hardcoded colors
- Functions over classes where possible
- Descriptive variable names over comments

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
