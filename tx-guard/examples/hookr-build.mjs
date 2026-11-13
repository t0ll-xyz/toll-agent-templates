// BUILD ON HOOKR, CHECK WITH TOLL, THEN SIGN.
//
// Hookr (hookr.fun) is a Uniswap v4 hook builder and launchpad on Robinhood Chain. Its MCP server
// (https://hookr.fun/api/mcp) builds unsigned calls: hookr_build_swap, hookr_build_launch, hookr_build_claim,
// hookr_build_agent_link, hookr_build_fill and the liquidity builders. Each answer carries `calls`: [{ to, data, value }].
// This file takes one such answer and asks Toll's pre-sign check about every call in it, with `from` set to the
// wallet the call was built for. That is the same question this template's POST /check sells.
//
//   node examples/hookr-build.mjs            asks Toll's free check (https://t0ll.xyz/api/tx/check), prints the word
//
// THE CALL BELOW IS REAL: what Hookr's hookr_build_agent_link returned on 2026-11-13 for Toll's own agent wallet
// (ERC-8004 agent #20030) on Hookr's Agent gate. It was built and simulated by Hookr. Nothing here signs or sends it.

/** one answer of a hookr_build_* tool: the wallet it was built for and the unsigned calls */
export const HOOKR_AGENT_LINK = {
  tool: "hookr_build_agent_link",
  wallet: "0xdc36d51963d08862c525045ccfd39fae6a0c7f40",
  calls: [{ to: "0xf95e6c8eeda88b4d8dfd43a087d153059a5107b0", data: "0xb1a867d50000000000000000000000000000000000000000000000000000000000004e3e", value: "0" }],
};

/** the body Toll's check (and this template's POST /check) takes for one built call */
export const checkBody = (wallet, call) => ({ chainId: 4663, from: wallet, to: call.to, data: call.data ?? "0x", value: String(call.value ?? "0") });

/**
 * Ask about every call of one hookr_build_* answer, in order. `url` is Toll's free check by default; point it at your
 * own tx-guard agent's /check to buy the same answer over x402 (pass a paying fetch as `get`).
 * Answers [{ to, action, warnings }]. An answer that is not 200 with an action is thrown, never read as ALLOW.
 */
export async function checkBuilt(built, { url = "https://t0ll.xyz/api/tx/check", get = globalThis.fetch } = {}) {
  const out = [];
  for (const call of built.calls) {
    const res = await get(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(checkBody(built.wallet, call)) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    if (!body || !["ALLOW", "WARN", "BLOCK"].includes(body.action)) throw new Error(`the check answered ${res.status} with no action: do not sign`);
    out.push({ to: call.to, action: body.action, warnings: (body.warnings ?? []).map((w) => ({ code: w.code, severity: w.severity, message: w.message })) });
  }
  return out;
}

/** sign only when every call of the answer is ALLOW; a WARN or a BLOCK goes to the person first */
export const maySign = (answers) => answers.length > 0 && answers.every((a) => a.action === "ALLOW");

// run as a script (not when a test imports it)
if (process.argv[1]?.endsWith("hookr-build.mjs")) {
  const answers = await checkBuilt(HOOKR_AGENT_LINK);
  for (const a of answers) {
    console.log(`${a.action}  ${HOOKR_AGENT_LINK.tool} -> ${a.to}`);
    for (const w of a.warnings) console.log(`  ${w.severity} ${w.code}: ${w.message}`);
  }
  console.log(maySign(answers) ? "Every call is ALLOW: the wallet may sign." : "Not every call is ALLOW: show the warnings to the person before signing.");
}
