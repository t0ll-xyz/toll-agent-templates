// Copies shared/seller.mjs into each template as seller.mjs, and shared/testkit.mjs as test/kit.mjs,
// so every folder works alone after `npx degit t0ll-xyz/toll-agent-templates/<id>`. Run: npm run sync
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const TEMPLATES = ["coin-safety", "stock-researcher", "model-router", "wrap-api", "blank"];
const root = fileURLToPath(new URL("../", import.meta.url));

export const COPIES = TEMPLATES.flatMap((t) => [
  { from: "shared/seller.mjs", to: `${t}/seller.mjs` },
  { from: "shared/testkit.mjs", to: `${t}/test/kit.mjs` },
]);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const c of COPIES) copyFileSync(join(root, c.from), join(root, c.to));
  console.log(`synced ${COPIES.length} files`);
}
