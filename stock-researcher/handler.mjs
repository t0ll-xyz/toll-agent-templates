// What one paid call does: read Toll's stock, fundamentals and insiders answers, and SEC EDGAR's filing list when Toll's
// answer carries a CIK. A part that cannot be read is null and named in notRead. When Toll says its free rate is used up
// (429): with TOLL_PAYER_KEY the matching x402 route is paid, without it the answer is 503 "quota".
import { json, payOf } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const QUOTA = { error: "Toll's free rate is reached. Set TOLL_PAYER_KEY to keep answering.", code: "quota" };

// the free read and the x402 route that answers the same question
const READS = {
  stock: (t) => [`${TOLL}/api/markets/stock/${t}`, `${TOLL}/api/x402/stock/${t}`],
  fundamentals: (t) => [`${TOLL}/api/markets/fundamentals/${t}`, `${TOLL}/api/x402/markets/fundamentals/${t}`],
  insiders: (t) => [`${TOLL}/api/markets/insiders/${t}`, `${TOLL}/api/x402/markets/insiders/${t}`],
};

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

// -> { data } | { quota: true } | { data: null }
async function tollRead(name, ticker, env, deps) {
  const get = deps.fetch ?? globalThis.fetch;
  const [free, paidUrl] = READS[name](ticker);
  try {
    let res = await get(free, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      const pay = payOf(env, deps);
      if (!pay) return { quota: true };
      res = await pay(paidUrl, { headers: { accept: "application/json" } });
      if (res.status === 429) return { quota: true };
    }
    if (!res.ok) return { data: null };
    return { data: await readJson(res) };
  } catch {
    return { data: null };
  }
}

async function secFilings(cik, env, deps) {
  const get = deps.fetch ?? globalThis.fetch;
  try {
    const res = await get(`https://data.sec.gov/submissions/CIK${String(cik).replace(/\D/g, "").padStart(10, "0")}.json`, {
      headers: { accept: "application/json", "user-agent": env.SEC_USER_AGENT.trim() },
    });
    if (!res.ok) return null;
    const j = await readJson(res);
    const r = j?.filings?.recent;
    if (!r || !Array.isArray(r.form)) return null;
    const recent = r.form.slice(0, 10).map((form, i) => ({
      form, date: r.filingDate?.[i] ?? null, accession: r.accessionNumber?.[i] ?? null, document: r.primaryDocument?.[i] ?? null,
    }));
    return { cik: String(cik), name: j.name ?? null, recent };
  } catch {
    return null;
  }
}

export async function handle(req, env, deps = {}) {
  const ticker = new URL(req.url).pathname.slice("/brief/".length).toUpperCase();
  const names = Object.keys(READS);
  const got = await Promise.all(names.map((n) => tollRead(n, ticker, env, deps)));
  if (got.some((g) => g.quota)) return json(QUOTA, 503);
  const brief = { ticker };
  names.forEach((n, i) => { brief[n] = got[i].data ?? null; });
  if (names.every((n) => brief[n] === null)) return json({ error: "Toll could not be read for this ticker. Nothing was charged.", code: "upstream" }, 502);

  const cik = brief.stock?.company?.cik ?? brief.fundamentals?.cik ?? null;
  brief.filings = cik ? await secFilings(cik, env, deps) : null;
  const notRead = [...names, "filings"].filter((n) => brief[n] === null);
  const { ticker: t, stock, fundamentals, insiders, filings } = brief;
  return json({ ticker: t, stock, fundamentals, insiders, filings, ...(notRead.length ? { notRead } : {}) });
}
