import { makeApp, json } from "./seller.mjs";
import { handle } from "./handler.mjs";

const MAX_BODY = 64 * 1024;

export function createApp(env = process.env, deps = {}) {
  return makeApp({
    sells: "POST /chat",
    description: "Chat completions from an AI model: send an OpenAI-style body, get the model's answer",
    defaultPrice: "0.001",
    methods: ["POST"],
    match: (p) => p === "/chat",
    maxBody: MAX_BODY,
    check: (e) => {
      if (!(e.MODEL_API_KEY ?? "").trim()) throw new Error("Set MODEL_API_KEY to your model API key (it stays on your host), for example: MODEL_API_KEY=... npm start");
      let u;
      try { u = new URL(e.MODEL_BASE_URL?.trim() || "https://api.openai.com/v1"); } catch { throw new Error("MODEL_BASE_URL must be a URL, for example https://api.openai.com/v1"); }
      if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) {
        throw new Error("MODEL_BASE_URL must be https (http only for localhost)");
      }
    },
    // not JSON, or not an object: a 400 before payment is asked
    precheck: async (req) => {
      let body;
      try { body = await req.clone().json(); } catch { body = null; }
      return body && typeof body === "object" && !Array.isArray(body) ? null : json({ error: "Send a JSON object, an OpenAI-style chat body." }, 400);
    },
    bazaar: {
      serviceName: "Model router",
      tags: ["ai", "chat", "llm"],
      bodyType: "json",
      input: { messages: [{ role: "user", content: "Say hello in five words." }] },
      output: { example: { choices: [{ message: { role: "assistant", content: "Hello there, nice to meet you." } }] } },
    },
    handle,
  }, env, deps);
}
