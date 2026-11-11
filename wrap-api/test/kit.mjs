// Test helpers shared by every template's test (copied into each folder as test/kit.mjs by scripts/sync.mjs).
// No real network: upstreams and the facilitator are stubbed with an injected fetch; servers run on local ports.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PAY_TO = "0x00000000000000000000000000000000000000a1"; // a made-up wallet, not a real one
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const OWN_ENV = [
  "PAY_TO", "AGENT_ID", "PRICE", "PORT", "TOLL_KEY", "TOLL_PAYER_KEY", "SEC_USER_AGENT",
  "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL", "UPSTREAM_URL", "UPSTREAM_AUTH_HEADER",
];

export const jsonRes = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/**
 * A fetch stub. `route(url, init)` answers an upstream call (return a Response, or undefined for "not mine").
 * The facilitator (x402.t0ll.xyz) always verifies and settles. `calls` records every upstream call (not the facilitator's).
 */
export function stub(route) {
  const calls = [];
  const facilitator = [];
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://x402.t0ll.xyz/")) {
      facilitator.push(url);
      if (url.endsWith("/verify")) return jsonRes({ isValid: true, payer: PAY_TO });
      return jsonRes({ success: true, transaction: "0x" + "ab".repeat(32), network: "eip155:4663", payer: PAY_TO });
    }
    const headers = Object.fromEntries(new Headers(init.headers ?? {}));
    let body = init.body;
    if (body instanceof Uint8Array) body = Buffer.from(body).toString("utf8");
    calls.push({ url, method: init.method ?? "GET", headers, body });
    const res = await route(url, init);
    if (!res) throw new Error(`unexpected upstream call: ${url}`);
    return res;
  };
  return { fetch, calls, facilitator };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

/** the 402 an unpaid request gets, decoded */
export async function unpaid(app, url, init = {}) {
  const res = await app(new Request(url, init));
  const header = res.headers.get("payment-required");
  return { res, v1: res.status === 402 ? await res.clone().json() : null, v2: header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null };
}

/** pay a route the way a buyer would, minus the signature (the facilitator is stubbed): ask, read the 402, send the payment header */
export async function paid(app, url, init = {}) {
  const { v2 } = await unpaid(app, url, init);
  if (!v2) throw new Error("no 402 to pay");
  const headers = new Headers(init.headers ?? {});
  headers.set("payment-signature", b64({ x402Version: 2, accepted: v2.accepts[0], payload: { signature: "0x00" } }));
  return app(new Request(url, { ...init, headers }));
}

/** run server.mjs of a template folder as a child process with exactly the env given (the template's own vars cleared first) */
export function run(dir, env) {
  const clean = { ...process.env };
  for (const k of OWN_ENV) delete clean[k];
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.mjs", dir))], {
    env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"], cwd: fileURLToPath(dir),
  });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { err += String(d); });
  const exited = new Promise((r) => child.on("exit", (c) => r(c)));
  return { child, exited, out: () => out, err: () => err, stop: async () => { child.kill(); await exited; } };
}

export async function waitFor(f, ms = 8000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 40));
  }
}

export const freePort = () => String(38_000 + Math.floor(Math.random() * 2000));

/** capture everything written to the console while `f` runs */
export async function captureLogs(f) {
  const lines = [];
  const saved = {};
  for (const k of ["log", "error", "warn", "info", "debug"]) {
    saved[k] = console[k];
    console[k] = (...a) => lines.push(a.map(String).join(" "));
  }
  try { await f(); } finally { for (const k of Object.keys(saved)) console[k] = saved[k]; }
  return lines.join("\n");
}

/** the tests every template shares: it refuses to start without PAY_TO, a 402 names chain, USDG, PAY_TO and the price, GET / is free */
export function commonTests({ test, assert, dir, env, price, atomic, sells, unpaidUrl, unpaidInit }) {
  test("it does not start without PAY_TO, and says what to set", async () => {
    const s = run(dir, { ...env, PAY_TO: "", PORT: freePort() });
    assert.notEqual(await s.exited, 0);
    assert.match(s.err(), /PAY_TO/);
  });

  test("it does not start with a PAY_TO that is not an address", async () => {
    const s = run(dir, { ...env, PAY_TO: "0x1234", PORT: freePort() });
    assert.notEqual(await s.exited, 0);
    assert.match(s.err(), /PAY_TO/);
  });

  test("an unpaid request gets a 402 naming eip155:4663, USDG, PAY_TO and the price; GET / is free", async () => {
    const port = freePort();
    const s = run(dir, { ...env, PAY_TO, PORT: port });
    try {
      await waitFor(() => s.out().includes(port) || s.err().length > 0);
      assert.equal(s.err(), "");
      const res = await fetch(`http://127.0.0.1:${port}${unpaidUrl}`, unpaidInit);
      assert.equal(res.status, 402);
      const body = await res.json();
      assert.equal(body.accepts[0].payTo.toLowerCase(), PAY_TO);
      assert.equal(body.accepts[0].asset.toLowerCase(), USDG);
      assert.equal(body.accepts[0].maxAmountRequired, atomic);
      const v2 = JSON.parse(Buffer.from(res.headers.get("payment-required"), "base64").toString("utf8"));
      assert.equal(v2.accepts[0].network, "eip155:4663");
      assert.equal(v2.accepts[0].amount, atomic);
      assert.ok(v2.extensions?.bazaar, "the 402 carries the bazaar listing");

      const free = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(free.status, 200);
      const info = await free.json();
      assert.equal(info.sells, sells);
      assert.equal(info.price, price);
      assert.equal(info.payTo, PAY_TO);
      assert.equal(info.facilitator, "https://x402.t0ll.xyz");
    } finally {
      await s.stop();
    }
  });
}
