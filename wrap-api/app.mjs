import { makeApp } from "./seller.mjs";
import { handle, upstreamOf, authHeaderOf } from "./handler.mjs";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "ALL /call/*",
    description: "A paid API: your call is forwarded to the wrapped API and its answer comes back",
    defaultPrice: null, // no default: the builder sets PRICE
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    match: (p) => p.startsWith("/call/") && p.length > "/call/".length,
    maxBody: 1_000_000,
    check: (e) => { upstreamOf(e); authHeaderOf(e); },
    bazaar: {
      serviceName: "Wrapped API",
      tags: ["api"],
      output: { example: { ok: true } },
    },
    handle,
  }, env, deps);
}
