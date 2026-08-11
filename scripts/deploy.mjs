import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One deployment per checkout; use separate worktrees for concurrent deploys.
const generatedName = "wrangler.prod.jsonc";
const generatedPaths = {
  workshop: join(root, "cloudflare-os/packages/workshop-backend", generatedName),
  context: join(root, "cloudflare-os/packages/gatekeeper-context", generatedName),
  customGatekeeper: join(root, "packages/custom-gatekeeper", generatedName),
  errorReporter: join(root, "packages/error-reporter", generatedName),
  router: join(root, "cloudflare-os/packages/router", generatedName),
  github: join(root, "cloudflare-os/packages/gatekeeper-github", generatedName),
  google: join(root, "cloudflare-os/packages/gatekeeper-google", generatedName),
  slack: join(root, "cloudflare-os/packages/gatekeeper-slack", generatedName),
  linear: join(root, "cloudflare-os/packages/gatekeeper-linear", generatedName),
};

// Built-in Cloudflare OS gatekeepers this starter can deploy. Each is discovered by the backend and
// router from a `GATEKEEPER_<NAME>` binding (see cloudflare-os auth-vendors.ts / router/src/index.ts).
// `pkg` is the pnpm workspace name to build; the package directory is generatedPaths[id]'s dirname.
const INTEGRATIONS = [
  { id: "github", pkg: "@gadgets/github-gatekeeper", binding: "GATEKEEPER_GITHUB" },
  { id: "google", pkg: "@gadgets/google-gatekeeper", binding: "GATEKEEPER_GOOGLE" },
  { id: "slack", pkg: "@gadgets/slack-gatekeeper", binding: "GATEKEEPER_SLACK" },
  { id: "linear", pkg: "@gadgets/linear-gatekeeper", binding: "GATEKEEPER_LINEAR" },
];

// The enabled integrations, each carrying its configured Worker name. Absent/false `integrations`
// yields [], which keeps the pre-router single-backend topology unchanged.
function enabledIntegrations(config) {
  const configured = config.integrations ?? {};
  return INTEGRATIONS
    .filter((it) => configured[it.id]?.enabled)
    .map((it) => ({ ...it, name: configured[it.id].name }));
}

const requiredPaths = [
  "accountId",
  "workers.workshop.name",
  "workers.context.name",
  "workers.customGatekeeper.name",
  "access.issuer",
  "access.audience",
  "access.admins",
  "aiGateway.enabled",
  "errorReporting.enabled",
  "context.sharingDomain",
  "customGatekeeper.name",
  "customGatekeeper.message",
  "observability.enabled",
  "observability.headSamplingRate",
  "observability.logs.invocationLogs",
  "observability.traces.enabled",
  "observability.traces.headSamplingRate",
];

const aiGatewayPaths = [
  "aiGateway.name",
  "aiGateway.accountId",
  "aiGateway.providers",
  "aiGateway.workersAi.mode",
];

const errorReportingPaths = [
  "workers.errorReporter.name",
  "errorReporting.environment",
];

const resourcePaths = [
  "context.kvNamespaceId",
  "resources.blueprintsKvNamespaceId",
  "resources.avatarsKvNamespaceId",
  "resources.blueprintContentBucket",
];

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

export function validateConfig(config) {
  const activePaths = [
    ...requiredPaths,
    ...(config.aiGateway?.enabled ? aiGatewayPaths : []),
    ...(config.errorReporting?.enabled ? errorReportingPaths : []),
  ];
  for (const path of activePaths) {
    const value = valueAt(config, path);
    if (value === undefined || value === null || value === "" || Array.isArray(value) && !value.length) {
      throw new Error(`Missing required deployment value: ${path}`);
    }
  }

  for (const path of resourcePaths) {
    const value = valueAt(config, path);
    if (value === undefined || value !== null && (typeof value !== "string" || !value)) {
      throw new Error(`Deployment resource must be null or a non-empty string: ${path}`);
    }
  }

  let activeConfig = !config.aiGateway.enabled
    ? { ...config, aiGateway: { enabled: false } }
    : config.aiGateway.workersAi.mode === "direct"
      ? { ...config, aiGateway: {
        ...config.aiGateway,
        workersAi: { mode: "direct" },
      } }
      : config;
  if (!config.errorReporting.enabled) {
    activeConfig = {
      ...activeConfig,
      workers: { ...activeConfig.workers, errorReporter: undefined },
      errorReporting: { enabled: false },
    };
  }
  const placeholder = JSON.stringify(activeConfig).match(/<[^>]+>/)?.[0];
  if (placeholder) throw new Error(`Replace deployment placeholder ${placeholder}.`);

  const stringPaths = activePaths.filter((path) => ![
    "access.admins",
    "aiGateway.enabled",
    "aiGateway.providers",
    "errorReporting.enabled",
    "observability.enabled",
    "observability.headSamplingRate",
    "observability.logs.invocationLogs",
    "observability.traces.enabled",
    "observability.traces.headSamplingRate",
  ].includes(path));
  for (const path of stringPaths) {
    if (typeof valueAt(config, path) !== "string") {
      throw new Error(`Deployment value must be a string: ${path}`);
    }
  }

  if (!/^[a-f\d]{32}$/i.test(config.accountId) ||
      config.aiGateway.enabled && !/^[a-f\d]{32}$/i.test(config.aiGateway.accountId)) {
    throw new Error("Cloudflare account IDs must be 32 hexadecimal characters.");
  }
  const integrations = enabledIntegrations(config);
  const workerNames = Object.entries(config.workers)
    .filter(([key]) => key !== "errorReporter" || config.errorReporting.enabled)
    .filter(([key]) => key !== "router" || integrations.length > 0)
    .map(([, worker]) => worker.name)
    .concat(integrations.map((it) => it.name));
  if (new Set(workerNames).size !== workerNames.length) {
    throw new Error("Every deployed Worker name (Workshop, Context, gatekeepers, router) must be unique.");
  }
  if (!workerNames.every((name) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))) {
    throw new Error("Worker names must use lowercase letters, numbers, and hyphens.");
  }

  const route = config.workers.workshop.route;
  if (!route || Boolean(route.workersDev) === Boolean(route.customDomain)) {
    throw new Error("Set exactly one Workshop route: workersDev or customDomain.");
  }
  if (route.workersDev !== undefined && route.workersDev !== true) {
    throw new Error("Workshop workersDev must be boolean true when selected.");
  }
  if (route.customDomain !== undefined && typeof route.customDomain !== "string") {
    throw new Error("Workshop customDomain must be a string.");
  }
  const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (route.customDomain && !hostnamePattern.test(route.customDomain)) {
    throw new Error("Workshop customDomain must be a lowercase hostname.");
  }

  for (const it of INTEGRATIONS) {
    const entry = config.integrations?.[it.id];
    if (entry !== undefined && typeof entry.enabled !== "boolean") {
      throw new Error(`integrations.${it.id}.enabled must be a boolean.`);
    }
  }
  if (integrations.length > 0) {
    if (typeof config.workers.router?.name !== "string" || !config.workers.router.name) {
      throw new Error("Enabling integrations requires a router Worker name: workers.router.name.");
    }
    if (!route.customDomain) {
      throw new Error(
        "Integrations require a Workshop custom domain, because OAuth redirect URIs need a stable " +
        "host. Set workers.workshop.route.customDomain instead of workersDev.");
    }
    for (const it of integrations) {
      if (typeof it.name !== "string" || !it.name) {
        throw new Error(`Integration "${it.id}" needs a Worker name: integrations.${it.id}.name.`);
      }
    }
  }

  const issuer = new URL(config.access.issuer);
  if (issuer.protocol !== "https:" ||
      issuer.origin !== config.access.issuer.replace(/\/$/, "")) {
    throw new Error("Cloudflare Access issuer must be an HTTPS origin only.");
  }
  if (!config.access.audience.trim() || config.access.audience !== config.access.audience.trim()) {
    throw new Error("Cloudflare Access audience must not be blank or padded with whitespace.");
  }
  if (!Array.isArray(config.access.admins) ||
      !config.access.admins.every((email) =>
        typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email))) {
    throw new Error("Every Access administrator must be an email address.");
  }

  if (typeof config.aiGateway.enabled !== "boolean") {
    throw new Error("AI Gateway enabled must be a boolean.");
  }
  if (config.aiGateway.enabled) {
    const providers = new Set(["anthropic", "openai", "google", "cloudflare"]);
    if (!Array.isArray(config.aiGateway.providers) ||
        !config.aiGateway.providers.every((provider) => providers.has(provider))) {
      throw new Error("AI Gateway providers must be anthropic, openai, google, or cloudflare.");
    }
    const workersAi = config.aiGateway.workersAi;
    if (!(["direct", "gateway"].includes(workersAi.mode))) {
      throw new Error("Workers AI mode must be direct or gateway.");
    }
    if (workersAi.mode === "gateway" &&
        (typeof workersAi.gateway !== "string" || !workersAi.gateway.trim())) {
      throw new Error("Workers AI gateway mode requires a gateway name string.");
    }
  }

  if (typeof config.errorReporting.enabled !== "boolean") {
    throw new Error("Error reporting enabled must be a boolean.");
  }
  const release = config.errorReporting.release;
  if (release !== null &&
      (typeof release !== "string" || !release.trim() || release !== release.trim())) {
    throw new Error("Error reporting release must be null or a non-padded string.");
  }

  const sampling = config.observability.headSamplingRate;
  if (typeof config.observability.enabled !== "boolean") {
    throw new Error("Observability enabled must be a boolean.");
  }
  if (typeof sampling !== "number" || sampling < 0 || sampling > 1) {
    throw new Error("Observability headSamplingRate must be between 0 and 1.");
  }
  if (typeof config.observability.logs.invocationLogs !== "boolean" ||
      typeof config.observability.traces.enabled !== "boolean") {
    throw new Error("Observability log and trace controls must be booleans.");
  }
  const traceSampling = config.observability.traces.headSamplingRate;
  if (typeof traceSampling !== "number" || traceSampling < 0 || traceSampling > 1) {
    throw new Error("Observability trace sampling must be between 0 and 1.");
  }
  return config;
}

function routeConfig(route) {
  return route.workersDev
    ? { workers_dev: true, routes: undefined }
    : { workers_dev: false, routes: [{ pattern: route.customDomain, custom_domain: true }] };
}

function setCommon(config, deployment, name, route = { workersDev: false }) {
  config.account_id = deployment.accountId;
  config.name = name;
  config.workers_dev = route.workersDev;
  delete config.routes;
  if (route.customDomain) Object.assign(config, routeConfig(route));
  config.observability = {
    ...config.observability,
    enabled: deployment.observability.enabled,
    head_sampling_rate: deployment.observability.headSamplingRate,
    logs: {
      ...config.observability?.logs,
      invocation_logs: deployment.observability.logs.invocationLogs,
    },
    traces: {
      ...config.observability?.traces,
      enabled: deployment.observability.traces.enabled,
      head_sampling_rate: deployment.observability.traces.headSamplingRate,
    },
  };
}

export function generateConfigs(config, bases) {
  validateConfig(config);
  const integrations = enabledIntegrations(config);
  // With integrations, a router Worker owns the public origin and the backend goes private behind
  // it (mirrors the upstream production topology in cloudflare-os/packages/router). Without them,
  // the backend stays directly on the route and serves the frontend itself.
  const routerMode = integrations.length > 0;
  const workshop = structuredClone(bases.workshop);
  const context = structuredClone(bases.context);
  const customGatekeeper = structuredClone(bases.customGatekeeper);
  const errorReporter = config.errorReporting.enabled
    ? structuredClone(bases.errorReporter)
    : undefined;

  setCommon(workshop, config, config.workers.workshop.name,
    routerMode ? { workersDev: false } : config.workers.workshop.route);
  workshop.vars = {
    ADMINS: config.access.admins,
    CF_ACCESS_ISS: config.access.issuer.replace(/\/$/, ""),
    CF_ACCESS_AUD: config.access.audience,
  };
  if (config.aiGateway.enabled) {
    Object.assign(workshop.vars, {
      CF_AI_GATEWAY: config.aiGateway.name,
      CF_AI_GATEWAY_ACCOUNT_ID: config.aiGateway.accountId,
      CF_AI_GATEWAY_PROVIDERS: config.aiGateway.providers.join(","),
    });
    workshop.secrets = {
      ...workshop.secrets,
      required: [...new Set([
        ...(workshop.secrets?.required ?? []),
        "CF_AI_GATEWAY_API_TOKEN",
      ])],
    };
    if (config.aiGateway.workersAi.mode === "gateway") {
      workshop.vars.CF_AI_GATEWAY_WAI = config.aiGateway.workersAi.gateway;
    } else {
      workshop.vars.CF_AI_GATEWAY_WAI_DIRECT = "true";
    }
  }
  workshop.ai = { binding: "WORKERS_AI" };
  workshop.services = [
    ...(config.errorReporting.enabled ? [{
      binding: "ERROR_REPORTER",
      service: config.workers.errorReporter.name,
      entrypoint: "ErrorReporter",
      props: {
        service: config.workers.workshop.name,
        environment: config.errorReporting.environment,
        ...(config.errorReporting.release ? { release: config.errorReporting.release } : {}),
      },
    }] : []),
    {
      binding: "GATEKEEPER_CONTEXT",
      service: config.workers.context.name,
      entrypoint: "GatekeeperVendor",
      props: { sharingDomain: config.context.sharingDomain },
    },
    {
      binding: "GATEKEEPER_CUSTOM",
      service: config.workers.customGatekeeper.name,
      entrypoint: "GatekeeperVendor",
    },
    // Vendor bindings for the built-in gatekeepers. The backend discovers integrations by scanning
    // GATEKEEPER_* env keys and calls their GatekeeperVendor entrypoint (auth-vendors.ts).
    ...integrations.map((it) => ({
      binding: it.binding,
      service: it.name,
      entrypoint: "GatekeeperVendor",
    })),
  ];
  workshop.kv_namespaces = [
    { binding: "BLUEPRINTS", ...(config.resources.blueprintsKvNamespaceId
      ? { id: config.resources.blueprintsKvNamespaceId } : {}) },
    { binding: "AVATARS", ...(config.resources.avatarsKvNamespaceId
      ? { id: config.resources.avatarsKvNamespaceId } : {}) },
  ];
  workshop.r2_buckets = [
    { binding: "BLUEPRINT_CONTENT", ...(config.resources.blueprintContentBucket
      ? { bucket_name: config.resources.blueprintContentBucket } : {}) },
  ];
  // In router mode the router serves the frontend and the backend only answers /api and
  // /blueprint-screenshot forwarded to it, so it needs no assets of its own.
  if (routerMode) {
    delete workshop.assets;
  } else {
    workshop.assets = {
      directory: "../workshop-frontend/dist",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api", "/api/*", "/blueprint-screenshot/*"],
    };
  }

  setCommon(context, config, config.workers.context.name);
  context.kv_namespaces = [
    { binding: "CONTEXT_COLLECTIONS", ...(config.context.kvNamespaceId
      ? { id: config.context.kvNamespaceId } : {}) },
  ];

  setCommon(customGatekeeper, config, config.workers.customGatekeeper.name);
  customGatekeeper.vars = {
    CUSTOM_NAME: config.customGatekeeper.name,
    CUSTOM_MESSAGE: config.customGatekeeper.message,
  };

  if (errorReporter) {
    setCommon(errorReporter, config, config.workers.errorReporter.name);
  }

  // Router and per-service gatekeeper configs, only when at least one integration is enabled.
  let router;
  const gatekeepers = {};
  if (routerMode) {
    const host = config.workers.workshop.route.customDomain;

    router = structuredClone(bases.router);
    setCommon(router, config, config.workers.router.name, config.workers.workshop.route);
    // Router owns the origin: forward to the private backend and dispatch /gatekeeper/<name>/* to
    // each gatekeeper's default (fetch) entrypoint. The base's ASSETS stanza serves the frontend.
    router.services = [
      { binding: "WORKSHOP_BACKEND", service: config.workers.workshop.name },
      ...integrations.map((it) => ({ binding: it.binding, service: it.name })),
    ];

    for (const it of integrations) {
      const gatekeeper = structuredClone(bases[it.id]);
      setCommon(gatekeeper, config, it.name, { workersDev: false });
      // The gatekeeper builds its OAuth redirect URI from BASE_URL; the router routes this path to
      // it. Client credentials are Wrangler secrets set out of band (see docs/integrations.md).
      gatekeeper.vars = { ...gatekeeper.vars, BASE_URL: `https://${host}/gatekeeper/${it.id}` };
      gatekeepers[it.id] = gatekeeper;
    }
  }

  return {
    workshop,
    context,
    customGatekeeper,
    ...(router && { router }),
    ...gatekeepers,
    ...(errorReporter && { errorReporter }),
  };
}

async function readJsonc(path) {
  const errors = [];
  const result = parse(await readFile(path, "utf8"), errors);
  if (errors.length) {
    const where = relative(root, path) || path;
    throw new Error(`${where}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  }
  return result;
}

// Every validateConfig message names a config path, so say which file those paths live in.
async function readDeployment(path) {
  const config = await readJsonc(path);
  try {
    return validateConfig(config);
  } catch (error) {
    throw new Error(`${relative(root, path)}: ${error.message}`);
  }
}

function run(args, cwd = root, env = process.env) {
  const result = spawnSync("pnpm", args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const where = relative(root, cwd) || ".";
    throw new Error(`${where}: pnpm ${args.join(" ")} failed. Its output is above.`);
  }
}

function requireSubmodule() {
  if (!existsSync(join(root, "cloudflare-os/package.json"))) {
    throw new Error("CloudflareOS submodule is not initialized. Run git submodule update --init.");
  }
}

function build(config) {
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/gatekeeper-context", "build"]);
  run(["--dir", "packages/custom-gatekeeper", "run", "build"]);
  for (const it of enabledIntegrations(config)) {
    run(["--dir", "cloudflare-os", "--filter", it.pkg, "build"]);
  }
  if (config.errorReporting.enabled) {
    run(["--dir", "packages/error-reporter", "run", "build"]);
  }
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/workshop-frontend", "build"], root, {
    ...process.env,
    VITE_CF_ACCESS_MODE: "true",
  });
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/workshop-backend", "build"]);
}

async function main() {
  requireSubmodule();
  const config = await readDeployment(join(root, "deployment.jsonc"));
  const integrations = enabledIntegrations(config);
  const bases = {
    workshop: await readJsonc(join(root, "cloudflare-os/packages/workshop-backend/wrangler.jsonc")),
    context: await readJsonc(join(root, "cloudflare-os/packages/gatekeeper-context/wrangler.jsonc")),
    customGatekeeper: await readJsonc(join(root, "packages/custom-gatekeeper/wrangler.jsonc")),
    errorReporter: await readJsonc(join(root, "packages/error-reporter/wrangler.jsonc")),
  };
  if (integrations.length > 0) {
    bases.router = await readJsonc(join(root, "cloudflare-os/packages/router/wrangler.jsonc"));
    for (const it of integrations) {
      bases[it.id] = await readJsonc(join(dirname(generatedPaths[it.id]), "wrangler.jsonc"));
    }
  }
  const generated = generateConfigs(config, bases);

  try {
    for (const [name, generatedConfig] of Object.entries(generated)) {
      await writeFile(generatedPaths[name], JSON.stringify(generatedConfig, null, 2) + "\n");
    }
    const check = process.argv.includes("--check");
    if (check) run(["test"]);
    build(config);
    const deployArgs = check ? ["--dry-run"] : [];
    // Deploy dependencies before their dependents: gatekeepers before the backend that binds their
    // vendor entrypoints, and the backend before the router that fronts it.
    const order = [
      ...(config.errorReporting.enabled ? ["errorReporter"] : []),
      "context",
      "customGatekeeper",
      ...integrations.map((it) => it.id),
      "workshop",
      ...(integrations.length > 0 ? ["router"] : []),
    ];
    for (const key of order) {
      run(["exec", "wrangler", "deploy", "--config", generatedName, ...deployArgs],
        dirname(generatedPaths[key]));
    }
  } finally {
    await Promise.all(Object.values(generatedPaths).map((path) => rm(path, { force: true })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    // One line, no stack: every failure here is a config or subprocess problem, not a script bug.
    console.error(`\nDeploy failed. ${error.message}`);
    process.exitCode = 1;
  }
}
