# Exa Gatekeeper

This private, read-only Gatekeeper gives Titan agents and Gadgets a typed `EXA_SEARCH.search()`
capability. The Worker—not the Gadget—calls `https://api.exa.ai/search` and holds `EXA_API_KEY` as
a Wrangler secret. Each query is authorized as an observation before it leaves Titan.

The exposed request surface is intentionally smaller than Exa's full API: `auto`, `fast`, and
`instant` search, at most 25 results, optional domain/date filters, and bounded highlights. Response
shaping drops fields that are not part of the Gadget contract.

## Secret

Never put an Exa key in `deployment.jsonc`, a Gadget setting, or a tracked file. After the first
deployment creates the configured Exa Worker, install the secret interactively:

```sh
pnpm exec wrangler secret put EXA_API_KEY --name <exa-worker-name>
```

`wrangler secret put` creates and immediately deploys a new Worker version. Verify the exact account
and Worker name before running it. The integration reports a configuration error until the secret
exists.

## Observer and cost policy

The capability is deployment-funded and uses one server-side Exa account. Its verifier accepts
authenticated workspace collaborators because search results contain public web data, but every
allowed user can consume the shared Exa quota. Keep the ambient Gatekeeper disabled or optional in
`/admin` unless that authority and cost model are acceptable.
