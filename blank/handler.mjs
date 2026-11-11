// This is the paid route: it runs only after a payment is verified, and the payment settles only when you answer below 400.
// Replace the body with your own code. `req` is a web Request, `env` is process.env, `deps.fetch` is fetch (tests stub it).
import { json } from "./seller.mjs";

export async function handle(req, env, deps = {}) {
  // To check a coin with Toll's free check first, uncomment these two lines (add your own 0x... token):
  // const check = await (deps.fetch ?? fetch)("https://t0ll.xyz/api/check?addr=0x...").then((r) => r.json());
  // return json({ hello: "world", verdict: check.verdict });
  return json({ hello: "world" });
}
