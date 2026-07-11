# TypeScript 7 Migration Plan

> Authored 2026-07-10 from a two-scout recon (config/toolchain + source patterns) against the
> official TS 7.0 GA announcement (2026-07-08). Verdict: **GO — smallest migration in the fleet.**
> Source is clean on all eight TS7 syntax removals, strict mode is already on repo-wide,
> no compiler-API tooling exists, and vitest/tsx/Vite are all esbuild-based (TS-version-independent).

## Why

TS 7.0 replaces the JS-hosted compiler with the native Go port as standard `tsc` — ~10x faster
builds and typechecks (VS Code: 77.8s → 7.5s), 60% fewer LSP crashes, 6–26% less memory.
For a repo whose `check` and `build` are pure `tsc`, this is nearly free speed.
As the public OSS flagship, being TS7-native the week of GA is also signal.

## Phase-0 recon correction (2026-07-11)

The Phase 0 recon below claimed "~9 latent strict errors" in `outlook.ts`/`orchestrator.ts`.
That claim was **wrong** — independently gate-checked before Phase 2 began. The errors were
artifacts of dead workspace symlinks (`node_modules/@resonant/*` pointing at the deleted
`C:/resonant-v1`), which `npm install` alone healed. No source changes were needed; the
baseline was **verified 0 strict errors in all three packages** once the symlinks were fixed.
Phases 0–2 are complete as of 2026-07-11.

## Current state (verified 2026-07-10)

- TS `^5.7.0` declared in all three packages (5.9.3 resolved on disk)
- `strict: true` effectively on everywhere — **0 strict errors** in `shared` and `frontend`
- No `baseUrl` anywhere; `moduleResolution: bundler`; targets ES2020/ES2022; no CLI file-path tsc calls
- No `.github/workflows` — no CI protects the baseline (fix as part of this plan)
- Distribution is clone-and-run; `@resonant/shared` is `private: true`, not on npm → no external
  consumers to break with TS7-emitted declarations

## Phase 0 — Repair the baseline (no TS change; do first, any day) — DONE 2026-07-11

The migration needs a true zero-error starting line. Two pre-existing issues block that:

1. **Dead workspace symlinks** — `node_modules/@resonant/{backend,frontend,shared}` still point
   at `C:/resonant-v1/...`, deleted in the 2026-07-09 folder rename. Backend typecheck throws
   12–14 phantom `TS2307` errors today. **Fix: `npm install` at repo root**, re-verify links.
2. ~~**Real pre-existing strict errors in backend (~9)**~~ — **CORRECTED 2026-07-11: this was
   wrong.** The reported errors in `src/services/outlook.ts` and `src/services/orchestrator.ts`
   were phantom `TS2307`-adjacent symptoms of the dead symlinks in item 1, not real strict
   violations. `npm install` alone resolved them; no source edits were made or needed. Verified
   independently before Phase 2 began — see the correction note above.
3. Housekeeping: delete `packages/frontend/.svelte-kit/` (orphaned May-era SvelteKit prototype
   output; excluded from compilation, pure debris).
4. Verify green: `npm run check --workspaces` and `node scripts/build.mjs` + `vitest run`.

## Phase 1 — TS 6.0 bridge (quarantine-clean immediately) — DONE 2026-07-11

TS 7.0 is spec'd as behavior-identical to a clean 6.0. Do the deprecation work here where
errors are warnings, not walls.

1. Bump `typescript` → `^6.0.x` in root + all three packages.
2. **`types` arrays become explicit** (TS7 default flips `["*"]` → `[]`):
   - `packages/backend/tsconfig.json`: `"types": ["node"]` **and add `@types/node` as an explicit
     devDependency** (today it resolves only by hoisting accident; 28 backend files use bare
     `fs/path/crypto/os/url` imports)
   - `packages/shared/tsconfig.json`: `"types": []` (verified zero node-builtin usage)
   - root `tsconfig.json`: `"types": []`
   - frontend: already explicit (`["vite/client"]`) — no change
3. Enable `stableTypeOrdering` (forced in 7; adopt early). No snapshot tests exist that could
   break on ordering — verified.
4. Fix any 6.0 deprecation warnings surfaced by `check`.
5. Full verify: check + build + vitest, all packages.

## Phase 2 — TS 7.0 flip (NOT before 2026-07-11 — npm 3-day quarantine; GA was 07-08) — DONE 2026-07-11

1. ✅ Bumped `typescript` → `^7.0.0` in `packages/shared`, `packages/frontend`,
   `packages/backend`. `npm install` resolved `typescript@7.0.2`; `npx tsc -v` reports
   `Version 7.0.2` (native Go compiler) repo-wide (deduped).
2. ✅ Typecheck pilot in dependency order — `shared` → `frontend` → `backend`, each via
   `npx tsc --noEmit`: **all three clean, 0 errors, nothing surfaced.**
3. ✅ Two flagged items verified live on the native binary:
   - `tsc -b` behavior: `shared`'s composite build (`tsc -b --force`, after deleting
     `dist/` + `tsconfig.tsbuildinfo` first) regenerated a full clean `dist/` — all four
     `.d.ts`/`.js`/`.map` sets (`index`, `protocol`, `types`) present and correct.
     `frontend`'s `tsc -b` (reference-less, incremental noEmit) also exits 0.
   - `frontend` esModuleInterop default-flip: confirmed no-op as predicted — `frontend`'s
     tsconfig still doesn't extend root and never sets `esModuleInterop` explicitly; both
     `tsc --noEmit` and `tsc -b` are clean under TS7 (which forces it true internally).
4. ✅ `node scripts/build.mjs` green (shared → backend → frontend, including `vite build`,
   700KB main chunk warning only — pre-existing, unrelated to TS7). ✅ `npx vitest run` green:
   6 test files, 103 tests passed, 0 failed.
5. ✅ Measured — see timing table below.

### TS6 vs TS7 timing (this machine, `npx tsc --noEmit` per package, 3 runs each, median reported)

| Package  | TS 6.0.3 (JS-hosted)     | TS 7.0.2 (native Go)   | Speedup |
|----------|--------------------------|-------------------------|---------|
| shared   | 3.671s / 4.249s / 6.168s → **4.25s** | 3.057s / 2.952s / 2.905s → **2.95s** | ~1.4x |
| frontend | 13.801s / 11.933s / 12.257s → **12.26s** | 3.929s / 3.933s / 4.716s → **3.93s** | ~3.1x |
| backend  | 29.431s / 31.406s / 51.830s → **31.41s** | 8.475s / 8.246s / 7.501s → **8.25s** | ~3.8x |

Both sets measured identically (`time npx tsc --noEmit`, cold each run, same shell/machine),
directly before and after the version bump — not vendor benchmarks. `npx` resolution overhead
(~2-3s) is included in every number and partly compresses the visible ratio; raw `tsc` binary
invocation (no `npx`) would show a larger gap. Backend shows the largest win as the
largest/most dependency-heavy package, consistent with the announcement's claims.

## Phase 3 — Hardening (with, or right after, the flip)

1. **Add CI** — `.github/workflows/check.yml`: `npm ci` → `npm run check --workspaces` →
   `vitest run` on push/PR. The repo is public OSS with zero CI today; the 9 latent strict
   errors survived precisely because nothing gated them.
2. README: note TS7-native + the measured speedup.
3. Editors: VS Code needs the TS7 extension until built-in support lands — note in CONTRIBUTING
   if contributor friction appears. Parallel-install alias trick exists if ever needed:
   `"@typescript/native": "npm:typescript@^7.0.x"` alongside a pinned 6.x.

## Rollback

Revert the `typescript` version bumps. All Phase 1 config changes (explicit `types`,
`stableTypeOrdering`, `@types/node` dep) are fully valid on 5.x/6.x — no ratchet, no lock-in.

## Explicit non-risks (verified, stop re-checking)

- Source syntax: zero hits on all eight TS7 removals (namespace-`module`, import `assert`,
  JS postfix `!`, JSDoc `?`-type, Closure JSDoc, `no-default-lib`, ES5/downlevel, ordering-
  sensitive snapshots). JS/MJS scripts are outside tsc entirely (no allowJs/checkJs anywhere).
- Test runner: vitest 3 via esbuild — no compiler API. `tsx` likewise.
- Agent SDK `.d.ts` (0.2.141 installed here): no TS7-removed syntax. (Separate note: this repo
  still pins `^0.2.139` — resonant-simon moved to 0.3.201 on 2026-07-09 for 1M-context
  awareness; consider the same bump here as its own task, not part of this migration.)

## Sequence summary

`npm install` (heal symlinks) → fix 9 backend strict errors → delete .svelte-kit debris →
green baseline → TS 6.0 + explicit types arrays → green → **wait for 2026-07-11+** →
TS 7.0 → verify `-b` + frontend interop → measure → CI + README.

Estimated effort: Phase 0+1 ≈ one Mason session. Phase 2 ≈ an hour plus verification.
