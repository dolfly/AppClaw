# AppClaw release guide

How to ship AppClaw and its optional **Stark vision** dependency (**`df-vision`** on npm).

## Artifacts

| Package | What it is | Where it publishes |
|--------|------------|--------------------|
| **AppClaw** (`appclaw`) | CLI / agent | npm (or install from Git tag) |
| **Stark vision** (`df-vision`) | Gemini + vision locate (screenshot → coordinates) | npm (`df-vision`) |
| **Device Farm** (optional) | Monorepo source in `packages/stark-vision` | Your existing Device Farm release process |

Released AppClaw must **not** depend on `file:../device-farm/...` — that only works when both repos are cloned side by side. Public installs need a **semver** dependency on **`df-vision`** from the registry.

## Release order

When **`df-vision`** changes:

1. **Publish `df-vision`** — from `device-farm/packages/stark-vision`, bump version, `npm publish`.
2. **Bump AppClaw** `package.json` dependency (e.g. `"df-vision": "^1.2.0"`).
3. **Publish AppClaw** — version bump, tag, `npm publish` (or GitHub Release + install instructions).

When only **AppClaw** changes (no stark API break):

1. Bump AppClaw version and publish. No `df-vision` publish required.

## Pre-publish checks (AppClaw)

- `npm run typecheck`
- Smoke: Appium session + one goal with `VISION_LOCATE_PROVIDER=stark` and a valid Gemini key (if you claim Stark support in release notes).
- Confirm `package.json` lists **`df-vision`** as a **registry** dependency, not `file:`.

## Versioning

- Use **semver** for both packages independently unless you intentionally lock them.
- Breaking changes in `df-vision` public exports → **minor/major** on `df-vision`, then bump AppClaw’s minimum range if needed.

## Local development (monorepo-style)

```bash
# Example: sibling clones
# appclaw/   device-farm/packages/stark-vision/

cd appclaw
npm pkg set dependencies.df-vision="file:../device-farm/packages/stark-vision"
npm install
cd ../device-farm/packages/stark-vision && npm run build
```

Revert `package.json` to a semver range before tagging a release.

## `df-vision` build

The package runs **`tsc` then webpack** (`packages/stark-vision/webpack.config.cjs`): single runtime file **`dist/bundle.js`** (minified) + **`dist/src/*.d.ts`** for typings. **`@google/genai`** and **`async-retry`** stay **external** (listed in `dependencies`).

Publish after `npm run build` so `main` resolves to **`dist/bundle.js`**. **AppClaw** uses a **default import** from `df-vision` (CJS under ESM).

## CI (recommended)

- **`df-vision`**: on tag, build, `npm publish` (with `NPM_TOKEN`).
- **appclaw**: on tag, `typecheck`, optional smoke, `npm publish`.

## Release notes

Mention:

- Default vision path: `VISION_LOCATE_PROVIDER=appium_mcp` vs `stark`.
- Required env for Stark: `GEMINI_API_KEY` / `STARK_VISION_API_KEY`, model resolution (`STARK_VISION_MODEL`, or Gemini `LLM_MODEL` when `LLM_PROVIDER=gemini`).
- Link to **`df-vision`** changelog if the release bumps that dependency.

## License note

If AppClaw is open source and `df-vision` uses a different license, state in the main **README** that Stark is an **optional npm dependency** with its own terms.
