# Integrations

Connect agents and Gadgets to GitHub, Google (Drive/Docs/Sheets/Gmail/Calendar), Slack, Linear, and
Exa Web Search using private Gatekeeper Workers. The OAuth Gatekeepers ship with the pinned
`cloudflare-os` submodule; the Exa Gatekeeper is wrapper-owned. Nothing patches upstream: enabling
an integration deploys its Worker and binds it into Workshop, exactly like the
[custom Gatekeeper](customization.md#custom-gatekeepers).

## How it works

Cloudflare OS discovers integrations from `GATEKEEPER_<NAME>` service bindings. Every Gatekeeper
needs agent discovery; OAuth Gatekeepers additionally need a browser callback:

- **Agent discovery** — the Workshop backend binds each Gatekeeper's `GatekeeperVendor` entrypoint
  so agents and Gadgets can call it.
- **OAuth callbacks** — the browser must reach the Gatekeeper Worker at
  `https://<your-host>/gatekeeper/<name>/oauth`. A **router** Worker owns the public origin, serves
  the frontend, forwards `/api` to the backend, and dispatches `/gatekeeper/<name>/*` to the right
  Gatekeeper. The backend becomes private behind it.

`scripts/deploy.mjs` builds the router automatically when at least one OAuth integration is enabled.
Private ambient Gatekeepers such as Exa do not change the public topology and work with either a
custom domain or a `workers.dev` route.

```
                    ┌────────────────────── router (public origin) ──────────────────────┐
users ── HTTPS ───▶ │  /gatekeeper/<name>/*  →  gatekeeper Worker (OAuth + typed session)  │
                    │  /api, /blueprint-*    →  workshop backend (private)                 │
                    │  everything else       →  frontend assets (SPA)                      │
                    └─────────────────────────────────────────────────────────────────────┘
                         backend also binds each GATEKEEPER_<NAME> vendor for agent discovery
```

## OAuth prerequisite: a custom domain

OAuth redirect URIs must be stable, so integrations require a Workshop **custom domain**. In
[`deployment.jsonc`](../deployment.jsonc) set:

```jsonc
"workers": {
  "workshop": { "name": "op-titan", "route": { "customDomain": "os.example.com" } },
  ...
}
```

The hostname must be in an active Cloudflare zone on your account; Wrangler creates DNS and TLS.
A `workers.dev` route cannot host path-scoped OAuth callbacks and the deploy will refuse to proceed
when an OAuth integration is enabled. Exa Web Search does not have this requirement.

## 1. Enable the integrations you want

In `deployment.jsonc`, flip `enabled` and keep a unique Worker name per service:

```jsonc
"integrations": {
  "github": { "enabled": true,  "name": "op-titan-github" },
  "google": { "enabled": true,  "name": "op-titan-google" },
  "slack":  { "enabled": true,  "name": "op-titan-slack" },
  "linear": { "enabled": true,  "name": "op-titan-linear" },
  "exa":    { "enabled": true,  "name": "op-titan-exa" }
}
```

The router Worker name comes from `workers.router.name` (default `op-titan-router`). Exa is never
bound into that router because it has no browser-facing endpoints.

## Exa Web Search

Exa is an auto-provisioned, read-only singleton exposed to Gadget code as `EXA_SEARCH`. Its narrow
contract supports `auto`, `fast`, and `instant` search, 1–25 results, domain and publication-date
filters, and optional highlights/cache age. The Exa Worker makes the outbound request and returns
only title, URL, publication date, author, and highlights; the API key never crosses the service
binding.

Each call asks the Gatekeeper approval queue to authorize an observation before transmitting the
query to Exa. Search terms therefore leave Titan only after authorization, and upstream error bodies
are not passed into Gadget context. The deployment uses a shared Exa account, so allowed users share
its quota and cost authority.

After the first deployment has created the exact Exa Worker identity, install its API key
interactively. Do not paste the key into chat, a Gadget UI, `deployment.jsonc`, or a tracked file:

```bash
pnpm exec wrangler secret put EXA_API_KEY --name op-titan-exa
```

This command immediately deploys a new Worker version. Confirm the Wrangler account and exact Worker
name first. Then open `/admin`, choose whether the ambient Exa Gatekeeper is disabled, optional, or
enabled, and run one approved low-cost search with highlights. Verify returned links and excerpts,
the Exa usage record, and the expected Worker logs without logging request bodies or credentials.

## 2. Register an OAuth app per service

Each service issues its own client credentials. The redirect URI is always
`https://<your-host>/gatekeeper/<name>/oauth`. Using `os.example.com` as the host:

| Service | Console | Redirect URI | Notes |
| --- | --- | --- | --- |
| **GitHub** | [Developer settings → OAuth Apps](https://github.com/settings/developers) | `https://os.example.com/gatekeeper/github/oauth` | Create an **OAuth App**, *not* a GitHub App — GitHub Apps ignore OAuth scopes and break email-based sign-in. |
| **Google** | [Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) | `https://os.example.com/gatekeeper/google/oauth` | Enable the APIs you want (Drive, Docs, Sheets, Gmail, Calendar). Configure the OAuth consent screen; add test users while unverified. Client type: **Web application**. |
| **Slack** | [api.slack.com/apps](https://api.slack.com/apps) | `https://os.example.com/gatekeeper/slack/oauth` | Create an app from scratch. **Do NOT enable Token Rotation** — it can't be undone and breaks two-way (bot tokens aren't refreshed). For two-way (mentions/DMs/slash/replies), add bot scopes + Event Subscriptions (Request URL `…/gatekeeper/slack/events`) and set `SLACK_SIGNING_SECRET` (see below). Read-only user-token installs need only `CLIENT_ID`/`CLIENT_SECRET`. |
| **Linear** | [Settings → API → OAuth applications](https://linear.app/settings/api) | `https://os.example.com/gatekeeper/linear/oauth` | Create an OAuth application; requested scopes are `read` and `write`. |

Copy each app's **Client ID** and **Client Secret** for the next step.

## 3. Deploy, then install the secrets

Client credentials are Wrangler secrets — never put them in `deployment.jsonc` or any tracked file.
Deploy first so the Workers exist, then set the secrets on each by name:

```bash
pnpm deploy
```

```bash
wrangler secret put CLIENT_ID     --name op-titan-github
wrangler secret put CLIENT_SECRET --name op-titan-github
wrangler secret put CLIENT_ID     --name op-titan-google
wrangler secret put CLIENT_SECRET --name op-titan-google
wrangler secret put CLIENT_ID     --name op-titan-slack
wrangler secret put CLIENT_SECRET --name op-titan-slack
# Slack two-way only (inbound events + slash commands); omit for a read-only install:
wrangler secret put SLACK_SIGNING_SECRET --name op-titan-slack
wrangler secret put CLIENT_ID     --name op-titan-linear
wrangler secret put CLIENT_SECRET --name op-titan-linear
```

Secrets take effect without a redeploy. Until they are set, a Gatekeeper's connect page reports that
its client credentials are not configured.

## 4. Connect and verify

1. Open `/admin` and confirm each enabled integration appears and is allowed for your users.
2. As a user, connect an account (e.g. **Connect GitHub**), complete the OAuth flow, and grant the
   resource you want (a repo, a Drive folder, a Slack workspace/channel, a Linear team).
3. Ask an agent something that exercises it, e.g. *"list the open issues in this GitHub repo"* or
   *"summarize this Google Doc."* Approve or reject the queued actions from the Gatekeeper's
   approval queue.

## Optional sign-in

GitHub and Google can also back the login page ("Continue with GitHub/Google"). That is a separate
`AUTH_GATEKEEPERS` allowlist and is independent of this starter's Cloudflare Access sign-in; see the
upstream [`gatekeeper-github`](../cloudflare-os/packages/gatekeeper-github/README.md) and
[`gatekeeper-google`](../cloudflare-os/packages/gatekeeper-google/README.md) READMEs before mixing
sign-in methods.

## Going wider: any MCP server

For services beyond these four, the upstream `gatekeeper-mcp` Worker connects **any** Model Context
Protocol server (Notion, Sentry, and many hosted endpoints) by URL, running OAuth discovery
automatically. It follows the same enablement pattern; wire it in `scripts/deploy.mjs` the way the
four services above are wired (build it, add a `GATEKEEPER_MCP` vendor binding on the backend and a
router binding), then connect endpoints from `/admin`. This mirrors a connector-catalog style of
integration if you want breadth over per-service depth.

## Rolling back

Set an integration's `enabled` back to `false` and redeploy. The Gatekeeper Worker is no longer
bound and disappears from discovery; delete the Worker and its secrets separately if you want it
fully removed. Disabling every OAuth integration returns the deployment to the single-backend
topology even if private ambient integrations such as Exa remain enabled.
