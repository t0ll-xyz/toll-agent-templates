import { makeApp } from "./seller.mjs";
import { handle } from "./handler.mjs";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /hello",
    description: "A hello from a paid agent (replace this with what you sell)",
    defaultPrice: null, // no default: the builder sets PRICE
    methods: ["GET"],
    match: (p) => p === "/hello",
    bazaar: {
      serviceName: "My agent",
      tags: ["agent"],
      output: { example: { hello: "world" } },
    },
    handle,
  }, env, deps);
}
