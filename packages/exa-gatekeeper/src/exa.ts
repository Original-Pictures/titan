import {
  DurableObject,
  RpcStub,
  RpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type {
  ExaSearchRequest,
  ExaSearchResponse,
  ExaSearchResult,
  ExaSearchSession,
} from "./types.js";
import TYPES_CODE from "./types-code.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_QUERY_LENGTH = 4_096;
const MAX_RESULTS = 25;
const MAX_DOMAINS = 1_200;
const MAX_DOMAIN_LENGTH = 512;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 4_096;
const MAX_AUTHOR_LENGTH = 500;
const MAX_DATE_LENGTH = 100;
const MAX_HIGHLIGHT_LENGTH = 4_000;
const MAX_HIGHLIGHTS_PER_RESULT = 5;

const EXA_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><rect width='256' height='256' rx='48' fill='#23000'/><path d='M55 64h146v30H89v19h91v29H89v20h112v30H55z' fill='#ffffff'/></svg>"
    ),
};

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> &
  Partial<{ [Symbol.dispose](): void }>;

type HttpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type ExaApiResult = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
  highlights?: unknown;
};

type ExaApiResponse = { results?: unknown };

export function describeExaVendor(): VendorDescription {
  return {
    displayName: "Exa Web Search",
    url: "https://exa.ai/",
    logo: EXA_ICON,
    color: "#000000",
    tagline: "Search the live web with relevant excerpts",
    description:
      "Searches Exa from a private Titan service using a deployment-managed API key. Queries leave Titan and may incur Exa usage charges.",
    autoProvisionsAccount: true,
    providesAuth: false,
  };
}

export function describeExaAccount(): AccountDescription {
  return {
    displayName: "Exa Web Search",
    avatar: EXA_ICON,
    singleton: { tsType: "ExaSearchSession" },
  };
}

function nonEmptyString(
  value: unknown,
  name: string,
  maxLength: number
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new TypeError(`${name} must be at most ${maxLength} characters.`);
  }
  return value;
}

export function normalizeSearchRequest(
  request: ExaSearchRequest
): Required<Pick<ExaSearchRequest, "query" | "type" | "numResults">> &
  Omit<ExaSearchRequest, "query" | "type" | "numResults"> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Exa search request must be an object.");
  }

  const query = nonEmptyString(request.query, "query", MAX_QUERY_LENGTH);
  const type = request.type ?? "auto";
  if (!(["auto", "fast", "instant"] as const).includes(type)) {
    throw new TypeError("type must be auto, fast, or instant.");
  }

  const numResults = request.numResults ?? 10;
  if (
    !Number.isInteger(numResults) ||
    numResults < 1 ||
    numResults > MAX_RESULTS
  ) {
    throw new TypeError(
      `numResults must be an integer from 1 through ${MAX_RESULTS}.`
    );
  }

  let includeDomains: string[] | undefined;
  if (request.includeDomains !== undefined) {
    if (
      !Array.isArray(request.includeDomains) ||
      request.includeDomains.length > MAX_DOMAINS
    ) {
      throw new TypeError(
        `includeDomains must contain at most ${MAX_DOMAINS} strings.`
      );
    }
    includeDomains = request.includeDomains.map((domain, index) =>
      nonEmptyString(domain, `includeDomains[${index}]`, MAX_DOMAIN_LENGTH)
    );
  }

  let startPublishedDate: string | undefined;
  if (request.startPublishedDate !== undefined) {
    startPublishedDate = nonEmptyString(
      request.startPublishedDate,
      "startPublishedDate",
      100
    );
    if (
      !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(startPublishedDate) ||
      !Number.isFinite(Date.parse(startPublishedDate))
    ) {
      throw new TypeError("startPublishedDate must be a valid ISO 8601 date.");
    }
  }

  let contents: ExaSearchRequest["contents"];
  if (request.contents !== undefined) {
    if (
      !request.contents ||
      typeof request.contents !== "object" ||
      Array.isArray(request.contents)
    ) {
      throw new TypeError("contents must be an object.");
    }
    if (
      request.contents.highlights !== undefined &&
      typeof request.contents.highlights !== "boolean"
    ) {
      throw new TypeError("contents.highlights must be a boolean.");
    }
    if (
      request.contents.maxAgeHours !== undefined &&
      (!Number.isInteger(request.contents.maxAgeHours) ||
        request.contents.maxAgeHours < -1)
    ) {
      throw new TypeError(
        "contents.maxAgeHours must be an integer greater than or equal to -1."
      );
    }
    contents = {
      ...(request.contents.highlights !== undefined
        ? { highlights: request.contents.highlights }
        : {}),
      ...(request.contents.maxAgeHours !== undefined
        ? { maxAgeHours: request.contents.maxAgeHours }
        : {}),
    };
  }

  return {
    query,
    type,
    numResults,
    ...(includeDomains !== undefined ? { includeDomains } : {}),
    ...(startPublishedDate !== undefined ? { startPublishedDate } : {}),
    ...(contents !== undefined ? { contents } : {}),
  };
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value
    ? value.slice(0, maxLength)
    : undefined;
}

function optionalHttpUrl(value: unknown): string | undefined {
  const url = optionalString(value, MAX_URL_LENGTH);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSearchResponse(
  value: ExaApiResponse
): ExaSearchResponse {
  if (!value || !Array.isArray(value.results)) {
    throw new Error("Exa returned an invalid search response.");
  }

  const results: ExaSearchResult[] = [];
  for (const raw of (value.results as ExaApiResult[]).slice(0, MAX_RESULTS)) {
    const title = optionalString(raw?.title, MAX_TITLE_LENGTH);
    const url = optionalHttpUrl(raw?.url);
    if (!title || !url) continue;

    const publishedDate = optionalString(raw.publishedDate, MAX_DATE_LENGTH);
    const author = optionalString(raw.author, MAX_AUTHOR_LENGTH);
    const highlights = Array.isArray(raw.highlights)
      ? raw.highlights
          .filter(
            (item): item is string => typeof item === "string" && Boolean(item)
          )
          .slice(0, MAX_HIGHLIGHTS_PER_RESULT)
          .map((item) => item.slice(0, MAX_HIGHLIGHT_LENGTH))
      : undefined;
    results.push({
      title,
      url,
      ...(publishedDate ? { publishedDate } : {}),
      ...(author ? { author } : {}),
      ...(highlights ? { highlights } : {}),
    });
  }
  return { results };
}

function searchError(status: number): Error {
  if (status === 401)
    return new Error(
      "Exa API authentication failed; ask an operator to rotate EXA_API_KEY."
    );
  if (status === 429) return new Error("Exa rate limit exceeded; retry later.");
  if (status === 400 || status === 422) {
    return new Error(`Exa rejected the search parameters (HTTP ${status}).`);
  }
  return new Error(`Exa search failed (HTTP ${status}).`);
}

@validateRpc()
export class ExaSearchSessionImpl
  extends RpcTarget
  implements ExaSearchSession
{
  readonly #approvalQueue: ObservationQueue;
  readonly #apiKey: string;
  readonly #fetch: HttpFetch;

  constructor(
    approvalQueue: ObservationQueue,
    apiKey: string,
    fetcher: HttpFetch = fetch.bind(globalThis)
  ) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#apiKey = apiKey;
    this.#fetch = fetcher;
  }

  async search(request: ExaSearchRequest): Promise<ExaSearchResponse> {
    const normalized = normalizeSearchRequest(request);
    await this.#approvalQueue.authorizeObservation({
      title: "Search the web with Exa",
      description: `Send a web search to Exa for “${normalized.query.slice(
        0,
        160
      )}”.`,
    });

    const response = await this.#fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(normalized),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw searchError(response.status);

    let body: ExaApiResponse;
    try {
      body = (await response.json()) as ExaApiResponse;
    } catch {
      throw new Error("Exa returned a non-JSON search response.");
    }
    return normalizeSearchResponse(body);
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}

@validateRpc()
export class ExaGatekeeper
  extends DurableObject<Cloudflare.Env>
  implements Gatekeeper<ExaSearchSession>
{
  async describe(): Promise<ResourceDescription> {
    return {
      url: "exa://web-search",
      title: "Exa Web Search",
      snippet: "Search the web through Titan's deployment-managed Exa account.",
      suggestedBindingName: "EXA_SEARCH",
      tsType: "ExaSearchSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<[]> {
    return [];
  }

  async startSession(
    approvalQueue: RpcStub<ApprovalQueue>
  ): Promise<ExaSearchSession> {
    if (!this.env.EXA_API_KEY) {
      throw new Error(
        "Exa Web Search is not configured; an operator must install EXA_API_KEY."
      );
    }
    return new ExaSearchSessionImpl(approvalQueue.dup(), this.env.EXA_API_KEY);
  }

  async addObserver(
    _id: string,
    _user: Fetcher<GatekeeperUserVerifier>
  ): Promise<void> {}
  async removeObserver(_id: string): Promise<void> {}

  applyAction(_action: number): Promise<void> {
    throw new Error("Exa Web Search is read-only and implements no actions.");
  }

  rejectAction(_action: number): Promise<void> {
    throw new Error("Exa Web Search submits no actions.");
  }

  revertAction(_action: number): Promise<void> {
    throw new Error("Exa Web Search has no actions to revert.");
  }
}

@validateRpc()
export class ExaAccount
  extends WorkerEntrypoint<Cloudflare.Env>
  implements GatekeeperUser
{
  async describe(): Promise<AccountDescription> {
    return describeExaAccount();
  }

  async getSingletonGatekeeperClass(): Promise<
    DurableObjectClass<Gatekeeper<ExaSearchSession>>
  > {
    return this.ctx.exports.ExaGatekeeper({});
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error("Exa Web Search has no URL-addressed resources.");
  }

  startResourceConfigurator(
    _resourceUrlPattern: string
  ): Promise<ResourceConfiguratorFrame> {
    throw new Error("Exa Web Search has no URL-addressed resources.");
  }

  async ensureResources(
    _resourceUrlPatterns: string[]
  ): Promise<{ url?: string }> {
    return {};
  }

  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("Exa Web Search has no connect flow.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ExaVerifier({});
  }
}

@validateRpc()
export class ExaVerifier
  extends WorkerEntrypoint<Cloudflare.Env>
  implements GatekeeperUserVerifier
{
  verify(): void {}
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env> {
  async describe(): Promise<VendorDescription> {
    return describeExaVendor();
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.ExaAccount({});
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions
  ): Promise<{ url: string }> {
    throw new Error(
      "Exa Web Search is auto-provisioned and has no connect flow."
    );
  }

  async getSupportedResources(_options?: {
    userId?: string;
  }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}
