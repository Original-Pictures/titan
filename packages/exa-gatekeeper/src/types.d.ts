/** Search strategy supported by Titan's bounded Exa capability. */
export type ExaSearchType = "auto" | "fast" | "instant";

/** Optional content returned with each result. Highlights are recommended for agent workflows. */
export interface ExaSearchContents {
  highlights?: boolean;
  /** `0` forces a live crawl; `-1` permits cached content only. */
  maxAgeHours?: number;
}

/** A bounded Exa web-search request. */
export interface ExaSearchRequest {
  query: string;
  type?: ExaSearchType;
  /** Number of results from 1 through 25. Defaults to 10. */
  numResults?: number;
  /** Domains or domain/path prefixes accepted by Exa. */
  includeDomains?: string[];
  /** ISO 8601 lower bound for publication time. */
  startPublishedDate?: string;
  contents?: ExaSearchContents;
}

/** Search result fields safe and useful for a Gadget context. */
export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
}

/** Read-only, deployment-funded web search powered by Exa. */
export interface ExaSearchSession {
  search(request: ExaSearchRequest): Promise<ExaSearchResponse>;
}
