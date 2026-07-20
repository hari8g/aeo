# Plan 2 — Step 31 Implementation Record

**Date**: 2026-07-16  
**Plan source**: `aop_implementation_plan_p2.md` (STEP 31 — package.json polish)  
**Status**: Complete  

---

## 1. Objective

Audit agent `package.json` files for consistent exports, scripts, and workspace deps; ensure `src/index.ts` re-exports class + `*_MANIFEST`.

## 2. Files changed

All `packages/agents/**/package.json` (except shared base):

- `exports["."]` → `{ types, import, default }` pointing at `dist/`
- `scripts.build` / `scripts.dev` (`tsx src/index.ts`) / `scripts.clean`
- deps: `@avp/shared`, `@avp/agent-base` workspace; `tsx` + `typescript` + `@types/node` as devDeps

## 3. How it was done

Automated polish pass across 22 agent packages. Verified `pnpm -r build` succeeds.

## 4. Verification

`pnpm -r build` green for all workspace packages including agents.

## 5. Deviations / naming note

p2 summary mentions `@avp/agents-learn-org-learning`. **Kept** existing package name `@avp/agents-learn-organizational-learning` (no rename) to avoid breaking imports. Treat `org-learning` as a documentation alias only.

## 6. Unlocks

Consistent agent packaging for publish/CI and Step 32 E2E imports.
