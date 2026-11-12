import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.mjs";
import { privateIp, readable } from "../handler.mjs";
import { PAY_TO, stub, paid, commonTests } from "./kit.mjs";

const dir = new URL("../", import.meta.url);
const env = { PAY_TO };
const READ = (u) => `http://agent.test/read?url=${encodeURIComponent(u)}`;
const page = (html, headers = { "content-type": "text/html; charset=utf-8" }, status = 200) => new Response(html, { status, headers });
const pub = async () => [{ address: "93.184.216.34", family: 4 }];

commonTests({ test, assert, dir, env: {}, price: "0.01", atomic: "10000", sells: "GET /read?url=", unpaidUrl: "/read?url=https%3A%2F%2Fexample.com%2F" });

test("a URL that is not public https is a 400 before payment is asked, and nothing is fetched", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch, lookup: pub });
  for (const bad of ["", "nope", "http://example.com/", "https://user:pw@example.com/", "https://example.com:8443/", "https://localhost/", "https://10.0.0.5/", "https://127.0.0.1/", "https://[::1]/", "https://intranet/", "https://box.internal/"]) {
    const res = await app(new Request(READ(bad)));
    assert.equal(res.status, 400, bad);
  }
  assert.equal(s.calls.length, 0);
});

test("a paid call answers the title and the text, without scripts, styles or markup", async () => {
  const html = "<html><head><title> A &amp; B </title><style>p{color:red}</style></head><body><script>var x='secret'</script><h1>Hello</h1><p>one&nbsp;two &#169; three</p><!-- hidden --></body></html>";
  const s = stub((url) => (url === "https://example.com/a" ? page(html) : undefined));
  const res = await paid(createApp(env, { fetch: s.fetch, lookup: pub }), READ("https://example.com/a"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: "https://example.com/a", title: "A & B", text: "Hello one two \u00a9 three", words: 5, truncated: false });
  assert.ok(res.headers.get("payment-response"), "the payment settled");
});

test("a host that resolves to a private address is refused after payment is checked, and the buyer is not charged", async () => {
  const s = stub(() => undefined);
  const app = createApp(env, { fetch: s.fetch, lookup: async () => [{ address: "10.1.2.3", family: 4 }] });
  const res = await paid(app, READ("https://looks-public.example/"));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("payment-response"), null, "not settled");
  assert.equal(s.calls.length, 0, "nothing was fetched");
});

test("a redirect is followed only to a public https page, and each hop is resolved again", async () => {
  const seen = [];
  const look = async (h) => { seen.push(h); return [{ address: h === "inside.example" ? "192.168.1.9" : "93.184.216.34", family: 4 }]; };
  const s = stub((url) => {
    if (url === "https://example.com/start") return new Response(null, { status: 302, headers: { location: "https://other.example/end" } });
    if (url === "https://other.example/end") return page("<title>End</title><p>done</p>");
    if (url === "https://example.com/bad") return new Response(null, { status: 302, headers: { location: "https://inside.example/" } });
    if (url === "https://example.com/plain") return new Response(null, { status: 301, headers: { location: "http://other.example/" } });
    return undefined;
  });
  const app = createApp(env, { fetch: s.fetch, lookup: look });
  const ok = await paid(app, READ("https://example.com/start"));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url, "https://other.example/end");
  assert.deepEqual(seen, ["example.com", "other.example"]);
  assert.equal((await paid(app, READ("https://example.com/bad"))).status, 400);
  assert.equal((await paid(app, READ("https://example.com/plain"))).status, 502);
  assert.equal(s.calls.some((c) => c.url.includes("inside.example")), false);
});

test("what is not a page, or cannot be read, is a 502 that is not settled; long text is cut and says so", async () => {
  const s = stub((url) => {
    if (url.endsWith("/img")) return page("x", { "content-type": "image/png" });
    if (url.endsWith("/404")) return page("no", undefined, 404);
    if (url.endsWith("/empty")) return page("<html><script>1</script></html>");
    if (url.endsWith("/long")) return page(`<p>${"word ".repeat(5000)}</p>`);
    return undefined;
  });
  const app = createApp(env, { fetch: s.fetch, lookup: pub });
  for (const p of ["/img", "/404", "/empty"]) {
    const res = await paid(app, READ(`https://example.com${p}`));
    assert.equal(res.status, 502, p);
    assert.equal(res.headers.get("payment-response"), null, p);
  }
  const long = await (await paid(app, READ("https://example.com/long"))).json();
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, 8000);
});

test("privateIp and readable, on their own", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) assert.equal(privateIp(ip), false, ip);
  assert.deepEqual(readable("<title>T</title><body>a<br>b</body>"), { title: "T", text: "a b" });
});
