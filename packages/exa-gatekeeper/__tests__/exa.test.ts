import { describe, expect, it, vi } from "vitest";
import {
  ExaSearchSessionImpl,
  describeExaAccount,
  describeExaVendor,
  normalizeSearchRequest,
  normalizeSearchResponse,
} from "../src/exa.js";

describe("exa-gatekeeper", () => {
  it("describes an auto-provisioned singleton", () => {
    expect(describeExaVendor()).toMatchObject({
      displayName: "Exa Web Search",
      autoProvisionsAccount: true,
      providesAuth: false,
    });
    expect(describeExaAccount()).toMatchObject({
      singleton: { tsType: "ExaSearchSession" },
    });
  });

  it("normalizes bounded requests and rejects unsupported options", () => {
    expect(normalizeSearchRequest({ query: "latest film production news" })).toEqual({
      query: "latest film production news",
      type: "auto",
      numResults: 10,
    });
    expect(() => normalizeSearchRequest({ query: "x", numResults: 26 })).toThrow(/1 through 25/);
    expect(() => normalizeSearchRequest({ query: "x", type: "deep" as "auto" })).toThrow(/type/);
    expect(() => normalizeSearchRequest({ query: "x", startPublishedDate: "not-a-date" }))
      .toThrow(/ISO 8601/);
  });

  it("keeps only the documented response fields and bounds untrusted arrays", () => {
    const response = normalizeSearchResponse({
      results: [{
        title: "Example",
        url: "https://example.com/",
        author: null,
        highlights: ["Relevant excerpt", 42],
        text: "must not escape",
      }],
    });
    expect(response).toEqual({
      results: [{
        title: "Example",
        url: "https://example.com/",
        highlights: ["Relevant excerpt"],
      }],
    });

    expect(normalizeSearchResponse({
      results: Array.from({ length: 30 }, (_, index) => ({
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
      })),
    }).results).toHaveLength(25);
    expect(normalizeSearchResponse({
      results: [{ title: "Unsafe", url: "javascript:alert(1)" }],
    }).results).toEqual([]);
  });

  it("authorizes before sending a credentialed Exa request", async () => {
    const events: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      events.push("fetch");
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "Titan web search",
        type: "fast",
        numResults: 3,
        contents: { highlights: true },
      });
      return Response.json({
        results: [{ title: "Titan", url: "https://example.com", highlights: ["Result"] }],
      });
    });
    const session = new ExaSearchSessionImpl(
      {
        async authorizeObservation() {
          events.push("authorize");
        },
      },
      "secret",
      fetcher,
    );

    await expect(session.search({
      query: "Titan web search",
      type: "fast",
      numResults: 3,
      contents: { highlights: true },
    })).resolves.toEqual({
      results: [{ title: "Titan", url: "https://example.com", highlights: ["Result"] }],
    });
    expect(events).toEqual(["authorize", "fetch"]);
  });

  it("does not expose an upstream error body", async () => {
    const session = new ExaSearchSessionImpl(
      { async authorizeObservation() {} },
      "secret",
      async () => new Response('{"error":"private upstream detail"}', { status: 429 }),
    );
    await expect(session.search({ query: "x" })).rejects.toThrow("rate limit exceeded");
    await expect(session.search({ query: "x" })).rejects.not.toThrow("private upstream detail");
  });
});
