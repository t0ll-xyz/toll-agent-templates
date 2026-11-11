// What one paid call does: forward the method, query and body to UPSTREAM_URL plus the rest of the path after /call/.
// UPSTREAM_URL must be https on a public host. UPSTREAM_AUTH_HEADER ("Name: value") is added to the upstream call and
// never echoed: the value is replaced in anything that comes back. Redirects are not followed.
import { lookup as dnsLookup } from "node:dns/promises";
import { json, redact } from "./seller.mjs";

const MAX_ANSWER = 5_000_000;
const PRIVATE_NAMES = [/^localhost$/, /\.localhost$/, /\.local$/, /\.internal$/, /\.lan$/, /\.home\.arpa$/, /\.corp$/];

/** a dotted IPv4 (or an IPv6 text from a DNS answer) that is loopback, private, link-local, CGNAT, multicast or unspecified */
export function isPrivateAddress(addr) {
  const a = String(addr).toLowerCase();
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19));
  }
  if (a.includes(":")) {
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith("::ffff:") || a.startsWith("ff");
  }
  return true;
}

/** UPSTREAM_URL, checked: https, no credentials, a public host (no IP literal that is private, no IPv6 literal, no local names) */
export function upstreamOf(env) {
  const text = (env.UPSTREAM_URL ?? "").trim();
  if (!text) throw new Error("Set UPSTREAM_URL to the https URL of the API to wrap, for example: UPSTREAM_URL=https://api.example.com/v1");
  let u;
  try { u = new URL(text); } catch { throw new Error("UPSTREAM_URL must be a full https URL, for example https://api.example.com/v1"); }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.protocol !== "https:") throw new Error("UPSTREAM_URL must be https");
  if (u.username || u.password) throw new Error("UPSTREAM_URL must not carry a user or password: use UPSTREAM_AUTH_HEADER");
  if (host.startsWith("[")) throw new Error("UPSTREAM_URL must be a public host name, not an IPv6 address");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateAddress(host)) throw new Error("UPSTREAM_URL must be a public host: that address is private or local");
  } else if (!host.includes(".") || PRIVATE_NAMES.some((re) => re.test(host))) {
    throw new Error("UPSTREAM_URL must be a public host name, not a local or private one");
  }
  u.hash = "";
  u.search = "";
  return u;
}

/** UPSTREAM_AUTH_HEADER, checked: "Name: value" -> [name, value] or null. The error never repeats the value. */
export function authHeaderOf(env) {
  const text = (env.UPSTREAM_AUTH_HEADER ?? "").trim();
  if (!text) return null;
  const m = /^([A-Za-z0-9-]+):\s*(\S.*)$/.exec(text);
  if (!m) throw new Error("UPSTREAM_AUTH_HEADER must look like Name: value, for example: Authorization: Bearer abc");
  return [m[1], m[2]];
}

export async function handle(req, env, deps = {}) {
  const base = upstreamOf(env);
  const auth = authHeaderOf(env);
  const url = new URL(req.url);
  const rest = url.pathname.slice("/call/".length);
  const target = new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}/${rest}${url.search}`);
  // the path must stay under the upstream's own path
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname.replace(/\/+$/, "") + "/")) {
    return json({ error: "That path is not allowed." }, 400);
  }

  // the host must not resolve to a private address (a public name pointing inward)
  try {
    const addrs = await (deps.lookup ?? ((h) => dnsLookup(h, { all: true })))(target.hostname);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private");
  } catch {
    return json({ error: "The upstream host could not be reached safely. Nothing was charged.", code: "upstream" }, 502);
  }

  const headers = {};
  for (const h of ["content-type", "accept"]) if (req.headers.get(h)) headers[h] = req.headers.get(h);
  if (auth) headers[auth[0]] = auth[1];
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const get = deps.fetch ?? globalThis.fetch;
  const secrets = auth ? [auth[1], auth[1].split(/\s+/).pop()] : [];

  let res, bytes;
  try {
    res = await get(target.toString(), {
      method: req.method, headers, redirect: "manual", signal: AbortSignal.timeout(30_000),
      ...(hasBody ? { body: new Uint8Array(await req.arrayBuffer()) } : {}),
    });
    if (res.status >= 300 && res.status < 400) return json({ error: "The upstream answered with a redirect, which is not followed. Nothing was charged.", code: "upstream" }, 502);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return json({ error: "The upstream could not be reached. Nothing was charged.", code: "upstream" }, 502);
  }
  if (bytes.length > MAX_ANSWER) return json({ error: "The upstream answer is too large. Nothing was charged.", code: "upstream" }, 502);

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  const body = /json|text|xml|javascript/i.test(type) ? redact(new TextDecoder().decode(bytes), secrets) : bytes;
  return new Response(body, { status: res.status, headers: { "content-type": type, "cache-control": "no-store" } });
}
