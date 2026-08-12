declare namespace Cloudflare {
  interface Env {
    EXA_API_KEY?: string;
  }

  interface GlobalProps {
    mainModule: typeof import("./index.js");
    durableNamespaces: "ExaGatekeeper";
  }
}
