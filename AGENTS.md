Titan is Original Pictures' deployment of [Cloudflare OS](https://github.com/cloudflare/cloudflare-os): a thin wrapper that ships a pinned Cloudflare OS build with our branding, identity, integrations, and operational controls. Read [README.md](README.md) first for the deploy flow, and the submodule's own `cloudflare-os/AGENTS.md` for the platform internals.

## Layout

* This repo (`Original-Pictures/titan`) is the **wrapper**. It owns:
    * `deployment.jsonc` — all deploy configuration (account, Worker identities, route, Access, AI, storage, integrations, observability). JSONC: comments and trailing commas are allowed.
    * `scripts/deploy.mjs` — derives temporary Wrangler configs from the upstream base configs, builds, and deploys Workers in dependency order (gatekeepers → workshop → router). `scripts/deploy.test.mjs` covers config generation.
    * `packages/custom-gatekeeper`, `packages/error-reporter` — Workers we own.
    * `docs/`, and the `cloudflare-os-operator` skill under `.agents/skills/`.
* `cloudflare-os/` is the upstream platform as a git submodule (Workshop kernel, Gadgets, Blueprints, Gatekeepers, agents).

## The submodule is OUR fork — read before touching it

`cloudflare-os` is pinned in [`.gitmodules`](.gitmodules) to **[`Original-Pictures/cloudflare-os`](https://github.com/Original-Pictures/cloudflare-os)** — a fork of `cloudflare/cloudflare-os` — at an explicit commit on branch `titan/per-agent-instructions`, **not** to upstream. We fork only for product behavior that can't be expressed through the wrapper/Worker boundary (e.g. per-agent spawner instructions); everything else stays in this repo.

Consequences for agents:

* Inside `cloudflare-os/`, `origin` is **upstream** (`cloudflare/cloudflare-os`) and we have no write access. Push submodule branches to the `fork` remote (`Original-Pictures/cloudflare-os`) instead — never to `origin`.
* A product/kernel change is a two-repo change: commit on the fork branch in the submodule and push to `fork`, then in this repo bump the gitlink (`git add cloudflare-os`) and commit that pointer alongside any wrapper changes.
* Pulling an upstream release now means merging/rebasing our fork branch onto the new upstream commit — see [README "Upstream fork and upgrades"](README.md#upstream-fork-and-upgrades) and `.agents/skills/cloudflare-os-operator/references/upgrade-and-rollback.md`. Pin an explicit SHA, never a moving branch head.

## Making changes

* **Wrapper-only** (config, deploy logic, our Workers): edit here and run `pnpm check` — it validates `deployment.jsonc`, runs tests, builds, and does a Wrangler dry-run deploy.
* **Submodule**: for fast feedback run `pnpm --filter <pkg> types:check` (or `test`) inside `cloudflare-os`. The kernel (`workshop-backend`, `workshop-shared`) is held to a high bar; keep diffs small and doc-comment exported `workshop-shared` members (see the submodule's AGENTS.md).
* `pnpm deploy` is outward-facing (contacts Cloudflare) and hard to reverse — run it only when explicitly asked. `pnpm check` is the safe, network-light gate.

## Conventions

* Don't commit generated files (e.g. `cloudflare-os/packages/workshop-backend/src/generated/*`) or scratch working docs (`scratch-*.md`).
* Worker names in `deployment.jsonc` are permanent service identities — keep them unique and stable across deploys.
