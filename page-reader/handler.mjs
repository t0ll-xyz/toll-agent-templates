// What one paid call does: fetch the page the caller named and answer its title and readable text.
// Only public https pages: the host is resolved and refused when it is a private, loopback or link-local address, and
// every redirect (at most 3) is checked the same way. The page is read up to 1 MB; the text is cut at 8,000 characters.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { json } from "./seller.mjs";

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 8_000;
const HOPS = 3;
const TIMEOUT_MS = 10_000;

/** true for an address a public page never has: private, loopback, link-local, multicast, unspecified */
export function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9")
    || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** the URL the caller asked for, or the words that say why it is refused (no lookup here: this runs before payment) */
export function askedUrl(here) {
  const raw = here.searchParams.get("url") ?? "";
  if (!raw) return "Use /read?url=https://... with the page to read.";
  let u;
  try { u = new URL(raw); } catch { return "url is not a URL."; }
  if (u.protocol !== "https:") return "Only https pages are read.";
  if (u.username || u.password || u.port) return "The URL must not carry credentials or a port.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? privateIp(host) : !host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return "That host is not a public one.";
  return u;
}

/** the host resolves to public addresses only */
async function publicHost(u, deps) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !privateIp(host);
  try {
    const found = await (deps.lookup ?? lookup)(host, { all: true });
    return found.length > 0 && found.every((x) => !privateIp(x.address));
  } catch { return false; }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
});

/** a page's title and its text: scripts, styles and markup removed, white space collapsed */
export function readable(html) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 300);
  const text = decode(html
    .replace(/<(script|style|noscript|svg|template|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return { title, text };
}

async function body(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8");
}

export async function handle(req, env, deps = {}) {
  let u = askedUrl(new URL(req.url));
  if (typeof u === "string") return json({ error: u }, 400);
  const get = deps.fetch ?? globalThis.fetch;
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!(await publicHost(u, deps))) return json({ error: "That host is not a public one. Nothing was charged.", code: "refused" }, 400);
    let res;
    try {
      res = await get(u.href, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/html,text/plain;q=0.8", "user-agent": "page-reader/1" } });
    } catch {
      return json({ error: "The page could not be reached. Nothing was charged.", code: "upstream" }, 502);
    }
    if (res.status >= 300 && res.status < 400) {
      let next;
      try { next = new URL(res.headers.get("location") ?? "", u); } catch { next = null; }
      if (!next || next.protocol !== "https:" || next.username || next.password || next.port) return json({ error: "The page redirects somewhere that is not read. Nothing was charged.", code: "refused" }, 502);
      u = next;
      continue;
    }
    if (!res.ok) return json({ error: `The page answered ${res.status}. Nothing was charged.`, code: "upstream" }, 502);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!/^text\/(html|plain)|application\/xhtml/.test(type)) return json({ error: "That is not a web page (html or plain text). Nothing was charged.", code: "type" }, 502);
    const raw = await body(res);
    const { title, text } = type.startsWith("text/plain") ? { title: "", text: raw.replace(/\s+/g, " ").trim() } : readable(raw);
    if (!text) return json({ error: "The page has no readable text. Nothing was charged.", code: "empty" }, 502);
    const cut = text.length > MAX_TEXT;
    const shown = cut ? text.slice(0, MAX_TEXT) : text;
    return json({ url: u.href, title, text: shown, words: shown.split(" ").length, truncated: cut });
  }
  return json({ error: "Too many redirects. Nothing was charged.", code: "refused" }, 502);
}
