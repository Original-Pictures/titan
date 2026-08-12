export * from "./exa.js";
export type * from "./types.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("Exa Gatekeeper worker is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
