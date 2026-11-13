import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { COPIES, TEMPLATES } from "../scripts/sync.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("every synced copy equals its shared source (run: npm run sync)", () => {
  for (const c of COPIES) {
    assert.ok(existsSync(join(root, c.to)), `${c.to} exists`);
    assert.equal(readFileSync(join(root, c.to), "utf8"), readFileSync(join(root, c.from), "utf8"), `${c.to} differs from ${c.from}`);
  }
});

const ENV = {
  "coin-safety": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "TOLL_KEY", "TOLL_PAYER_KEY"],
  "stock-researcher": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "SEC_USER_AGENT", "TOLL_PAYER_KEY"],
  "model-router": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL"],
  "wrap-api": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "UPSTREAM_URL", "UPSTREAM_AUTH_HEADER"],
  blank: ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "page-reader": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "agent-trust": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "llm-task": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL"],
  "wallet-check": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "launch-feed": ["PAY_TO", "AGENT_ID", "PRICE", "PORT"],
  "tx-guard": ["PAY_TO", "AGENT_ID", "PRICE", "PORT", "TOLL_PAYER_KEY"],
};

test("each template has its files and its .env.example names exactly its env vars, in order", () => {
  for (const t of TEMPLATES) {
    for (const f of ["server.mjs", "app.mjs", "handler.mjs", "seller.mjs", "package.json", ".env.example", "vercel.json", "railway.json", "README.md", "api/index.mjs", "test/server.test.mjs"]) {
      assert.ok(existsSync(join(root, t, f)), `${t}/${f}`);
    }
    const names = readFileSync(join(root, t, ".env.example"), "utf8").split("\n")
      .map((l) => /^#?\s*([A-Z_]+)=/.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual(names, ENV[t], `${t} .env.example`);
    const pkg = JSON.parse(readFileSync(join(root, t, "package.json"), "utf8"));
    assert.equal(pkg.dependencies["@tollxyz/x402-seller"], "^0.3.1");
    assert.equal(pkg.name, t);
  }
});

function* files(dir) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".git" || n === "package-lock.json") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

test("no file names the launcher, a private key or an address that is not on the allowlist", () => {
  const banned = new RegExp("AGENT" + "BOX", "i");
  const allowed = new Set([
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
    "0x00000000000000000000000000000000000000a1", // the made-up PAY_TO of the tests
    "0x00000000000000000000000000000000000000a2",
    "0x00000000000000000000000000000000000000a3",
    "0x0000000000000000000000000000000000000000", // the example token in the bazaar listing
    // tx-guard/examples/hookr-build.mjs: a real call Hookr's MCP built (hookr_build_agent_link, 2026-11-13)
    "0xf95e6c8eeda88b4d8dfd43a087d153059a5107b0", // Hookr's Agent gate (its `to`)
    "0xdc36d51963d08862c525045ccfd39fae6a0c7f40", // Toll's own agent wallet, ERC-8004 agent #20030 (its `from`)
  ]);
  for (const f of files(root)) {
    if (f.endsWith("repo.test.mjs")) continue;
    const text = readFileSync(f, "utf8");
    const where = relative(root, f);
    assert.doesNotMatch(text, banned, where);
    assert.doesNotMatch(text, /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, `${where} has a 64-hex value (a key?)`);
    for (const m of text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) assert.ok(allowed.has(m[0].toLowerCase()), `${where}: ${m[0]}`);
    // the two template names are allowed; everywhere else these words are not used
    const words = text.replaceAll("coin-safety", "").replaceAll("Coin safety checker", "");
    assert.doesNotMatch(words, /\b(safe|safely|safety|guarantee[sd]?|protects?|enforces?)\b/i, `${where} uses a word we do not use`);
  }
});
