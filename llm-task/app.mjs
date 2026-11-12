import { makeApp, json } from "./seller.mjs";
import { handle, askOf } from "./handler.mjs";

const MAX_BODY = 64 * 1024;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "POST /task",
    description: "Summarize a text, translate it, or pull out its key points: send { task, text, to? }, get { result }",
    defaultPrice: "0.02",
    methods: ["POST"],
    match: (p) => p === "/task",
    maxBody: MAX_BODY,
    check: (e) => {
      if (!(e.MODEL_API_KEY ?? "").trim()) throw new Error("Set MODEL_API_KEY to your model API key (it stays on your host), for example: MODEL_API_KEY=... npm start");
      let u;
      try { u = new URL(e.MODEL_BASE_URL?.trim() || "https://api.openai.com/v1"); } catch { throw new Error("MODEL_BASE_URL must be a URL, for example https://api.openai.com/v1"); }
      if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) throw new Error("MODEL_BASE_URL must be https (http only for localhost)");
    },
    // a body that is not a task we do is a 400 before payment is asked
    precheck: async (req) => {
      let body;
      try { body = await req.clone().json(); } catch { body = null; }
      const ask = askOf(body);
      return typeof ask === "string" ? json({ error: ask }, 400) : null;
    },
    bazaar: {
      serviceName: "Text task",
      tags: ["ai", "summarize", "translate"],
      input: { example: { task: "summarize", text: "A long text." } },
      output: { example: { task: "summarize", result: "A two-sentence summary of the text.", model: "gpt-4o-mini" } },
    },
    handle,
  }, env, deps);
}
