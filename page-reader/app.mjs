import { makeApp, json } from "./seller.mjs";
import { handle, askedUrl } from "./handler.mjs";

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "GET /read?url=",
    description: "Read one public web page: its title and its readable text, without scripts, styles or markup",
    defaultPrice: "0.01",
    methods: ["GET"],
    match: (p) => p === "/read",
    // a URL that is not public-looking https is a 400 before any payment is asked
    precheck: (req, url) => (typeof askedUrl(url) === "string" ? json({ error: askedUrl(url) }, 400) : null),
    bazaar: {
      serviceName: "Page reader",
      tags: ["web", "reader", "extract"],
      output: { example: { url: "https://example.com/", title: "Example Domain", text: "Example Domain This domain is for use in examples.", words: 9, truncated: false } },
    },
    handle,
  }, env, deps);
}
