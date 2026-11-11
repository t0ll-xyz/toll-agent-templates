// What one paid call does: read Toll's stock, fundamentals and insiders answers, and SEC EDGAR's filing list when Toll's
// answer carries a CIK. The default answer is a short brief a person or an agent can read at once; ?full=1 adds every
// field that was read under "raw". A part that cannot be read is null and named in notRead. When Toll says its free
// rate is used up (429): with TOLL_PAYER_KEY the matching x402 route is paid, without it the answer is 503 "quota".
import { json, payOf } from "./seller.mjs";

const TOLL = "https://t0ll.xyz";
const QUOTA = { error: "Toll's free rate is reached. Set TOLL_PAYER_KEY to keep answering.", code: "quota" };
const FILINGS_SHOWN = 3;

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

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v ? v : null);
const round = (v, d) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** the filing's page on sec.gov from its CIK, accession number and main document; null when one is missing */
export function filingUrl(cik, accession, document) {
  const c = String(cik ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const a = String(accession ?? "").replace(/-/g, "");
  if (!c || !/^\d{18}$/.test(a) || !document || !/^[\w.-]+$/.test(document)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${c}/${a}/${document}`;
}

/** $1,234.56 / $967.6M / $4.21T: money a person reads at a glance; "not read" for null */
export function money(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "not read";
  const a = Math.abs(v);
  for (const [unit, size] of [["T", 1e12], ["B", 1e9], ["M", 1e6]]) if (a >= size) return `$${(v / size).toFixed(a / size >= 100 ? 1 : 2)}${unit}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * THE BRIEF: the few facts someone asks a stock token for, from what was read. Every number is Toll's or SEC's own;
 * a part that was not read is null here and named in notRead by the caller, never a zero.
 */
export function briefOf(ticker, { stock, fundamentals, insiders, filings }) {
  const name = str(stock?.name) ?? str(fundamentals?.name) ?? str(stock?.company?.name) ?? str(filings?.name);

  // price: the chain price (the deepest USDG pool) against the Chainlink reference feed, and the gap between them
  const chain = num(stock?.prices?.chain?.usd), reference = num(stock?.prices?.reference?.usd);
  const gapGiven = num(stock?.prices?.differences?.chain_vs_reference_pct);
  const gap = gapGiven ?? (chain !== null && reference ? round(((chain - reference) / reference) * 100, 2) : null);
  const pool = obj(stock?.prices?.chain?.pool);
  const price = stock ? {
    chain_usd: round(chain, 2), reference_usd: round(reference, 2), gap_pct: gap,
    reference_source: "Chainlink feed on Robinhood Chain",
    ...(str(stock.session) ? { session: stock.session } : {}),
    ...(pool ? { deepest_pool: { venue: str(pool.venue), quote: str(pool.quote), depth_usd: round(num(pool.depth_usd), 0) } } : {}),
  } : null;

  // the latest 3 filings: SEC's own list when it was read, else the list inside Toll's stock answer
  const cik = filings?.cik ?? stock?.company?.cik ?? fundamentals?.cik ?? null;
  const fromSec = Array.isArray(filings?.recent)
    ? filings.recent.map((f) => ({ form: str(f.form), date: str(f.date), url: filingUrl(cik, f.accession, f.document) })) : null;
  const fromToll = Array.isArray(stock?.company?.filings)
    ? stock.company.filings.map((f) => ({ form: str(f?.form), date: str(f?.filed), url: str(f?.url) })) : null;
  const latest = (fromSec ?? fromToll)?.filter((f) => f.form).slice(0, FILINGS_SHOWN) ?? null;

  // insiders: Form 4 buys and sells in Toll's window
  const tot = obj(insiders?.totals);
  const side = (s) => (obj(s) ? { count: num(s.count) ?? 0, shares: num(s.shares), value_usd: num(s.value_usd) } : null);
  const ins = tot ? {
    window_days: num(insiders?.window?.days), buys: side(tot.purchases), sells: side(tot.sales),
    ...(obj(tot.sales_split?.plan) ? { sells_on_a_plan: num(tot.sales_split.plan.count) ?? 0 } : {}),
  } : null;

  // earnings: the next date only when an answer carries one; the last results filing is always said when known
  const lastReport = obj(fundamentals?.latest_filing) ?? obj(stock?.fundamentals?.last_filing);
  const next = str(stock?.earnings?.next) ?? str(fundamentals?.next_earnings) ?? str(stock?.next_earnings);
  const earnings = {
    next,
    last_report: lastReport ? { form: str(lastReport.form), filed: str(lastReport.filed), period_end: str(lastReport.period_end) ?? null, url: str(lastReport.url) } : null,
  };

  const f = obj(stock?.fundamentals);
  const basics = f && f.state !== "not-read" && (num(f.revenue) !== null || num(f.pe) !== null) ? {
    period: str(f.ttm_label), revenue_usd: num(f.revenue), net_income_usd: num(f.net_income), eps_diluted: num(f.eps_diluted),
    pe: num(f.pe), market_cap_usd: num(f.market_cap_usd),
  } : null;

  // one line to read or to show as it is
  const parts = [`${ticker}${name ? ` · ${name}` : ""}`];
  if (price && price.chain_usd !== null) {
    parts.push(price.reference_usd !== null
      ? `chain ${money(price.chain_usd)} vs reference ${money(price.reference_usd)}${gap !== null ? ` (${gap > 0 ? "+" : ""}${gap}%)` : ""}`
      : `chain ${money(price.chain_usd)}, reference not read`);
  } else parts.push("price not read");
  parts.push(latest?.length ? `latest filings: ${latest.map((x) => `${x.form}${x.date ? ` ${x.date}` : ""}`).join(", ")}` : "filings not read");
  if (ins && ins.buys && ins.sells) {
    const worth = (s) => (s.value_usd !== null && s.count > 0 ? ` (${money(s.value_usd)})` : "");
    parts.push(`insiders${ins.window_days ? ` ${ins.window_days}d` : ""}: ${ins.buys.count} buys${worth(ins.buys)}, ${ins.sells.count} sells${worth(ins.sells)}`);
  } else parts.push("insiders not read");
  parts.push(next ? `next earnings ${next}`
    : earnings.last_report?.filed ? `next earnings not known (last results ${earnings.last_report.form ?? "filing"} ${earnings.last_report.filed})` : "next earnings not known");

  return {
    ticker, name: name ?? null, brief: parts.join(". ") + ".",
    price, filings: latest, insiders: ins, earnings,
    ...(basics ? { basics } : {}),
    page: str(stock?.page) ?? `${TOLL}/markets/${ticker}`,
  };
}

export async function handle(req, env, deps = {}) {
  const url = new URL(req.url);
  const ticker = url.pathname.slice("/brief/".length).toUpperCase();
  const full = url.searchParams.get("full") === "1";
  const names = Object.keys(READS);
  const got = await Promise.all(names.map((n) => tollRead(n, ticker, env, deps)));
  if (got.some((g) => g.quota)) return json(QUOTA, 503);
  const raw = {};
  names.forEach((n, i) => { raw[n] = got[i].data ?? null; });
  if (names.every((n) => raw[n] === null)) return json({ error: "Toll could not be read for this ticker. Nothing was charged.", code: "upstream" }, 502);

  const cik = raw.stock?.company?.cik ?? raw.fundamentals?.cik ?? null;
  raw.filings = cik ? await secFilings(cik, env, deps) : null;
  const brief = briefOf(ticker, raw);
  // filings: SEC's list was not read AND Toll's stock answer carried none either
  const notRead = [...names, "filings"].filter((n) => (n === "filings" ? !brief.filings?.length : raw[n] === null));
  return json({
    ...brief,
    ...(notRead.length ? { notRead } : {}),
    source: "toll markets + SEC EDGAR",
    ...(full ? { raw } : { more: "add ?full=1 for every field that was read, under raw" }),
  });
}
