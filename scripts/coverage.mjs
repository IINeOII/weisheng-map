#!/usr/bin/env node
/**
 * 資料覆蓋率：使用者打開地圖時，看得到東西嗎？
 * 數字來自 App 實際使用的同一份資料（scripts/build-tiles.mjs 產生），不是另外查詢，所以兩者一致。
 *
 * 用法（只需要 Node.js 18 以上，不用 npm install）：
 *   node scripts/coverage.mjs                 # 列出所有預設區域
 *   node scripts/coverage.mjs 萬華             # 或 台北、新北、桃園、台中、台南、高雄、台北車站
 *   node scripts/coverage.mjs wanhua          # 英文別名
 *   node scripts/coverage.mjs 25.03,121.49,25.06,121.52   # 自訂範圍（南,西,北,東）
 *   node scripts/coverage.mjs 萬華 --dir 某資料夾           # 指定資料位置（測試用）
 *
 * 讀取順序：--dir 指定的資料夾 → 本機的 docs/data/osm → 已發佈的網站（config.js 的 dataFallbackUrl）
 */
import fs from "node:fs";
import { loadBrowserScripts, p } from "./lib.mjs";
import { AREAS, ALIAS } from "./areas.mjs";

const W = loadBrowserScripts("docs/js/config.js", "docs/js/categories.js");
const args = process.argv.slice(2);
const dirAt = args.indexOf("--dir");
const localDir = dirAt >= 0 ? args.splice(dirAt, 2)[1] : p("docs/data/osm");

async function load(rel) {
  const f = `${localDir}/${rel}`;
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const url = `${W.APP_CONFIG.dataFallbackUrl}/${rel}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "WeishengMap-coverage/1.0" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const raw = (args[0] || "").trim();
const arg = ALIAS[raw.toLowerCase()] || raw;
let bbox = null;
if (arg && !AREAS[arg]) {
  bbox = arg.split(",").map(Number);
  if (bbox.length !== 4 || bbox.some(isNaN)) {
    console.error("範圍格式錯誤。可用：" + Object.keys(AREAS).join("、") + "（或英文 " + Object.keys(ALIAS).join(", ") + "），或 南,西,北,東");
    process.exit(1);
  }
}

let cov, index;
try {
  cov = await load("coverage.json");
  index = await load("index.json");
} catch (e) {
  console.error("讀不到地點資料：" + e.message);
  console.error("網站還沒發佈過資料的話，請到 GitHub → Actions →「發佈網頁版」執行一次。");
  process.exit(1);
}

// 自訂範圍：載入碰到的格子，逐筆計算
async function countBbox([s, w, n, e]) {
  const out = { free: {}, cheap: {} };
  for (const layerId of ["free", "cheap"]) {
    for (let y = Math.floor(s / index.cell); y <= Math.floor(n / index.cell); y++)
      for (let x = Math.floor(w / index.cell); x <= Math.floor(e / index.cell); x++) {
        const k = `${y}_${x}`;
        if (!index.cells[layerId][k]) continue;
        for (const r of await load(`${layerId}/${k}.json`))
          if (r.a >= s && r.a <= n && r.o >= w && r.o <= e) out[layerId][r.c] = (out[layerId][r.c] || 0) + 1;
      }
  }
  return out;
}

const targets = bbox ? [["自訂範圍", bbox, await countBbox(bbox)]]
  : (arg ? [arg] : Object.keys(AREAS)).map((a) => [a, AREAS[a], cov.counts[a]]);

const verdict = (n) => n == null ? "只靠回報" : n === 0 ? "❌ 沒有資料" : n < 10 ? "⚠️  極少" : n < 50 ? "△ 偏少" : "✔";
const area = ([s, w, n, e]) => Math.round(Math.abs((n - s) * 111 * (e - w) * 111 * Math.cos((s * Math.PI) / 180)));
const when = (cov.osmTimestamp || cov.generatedAt || "").slice(0, 10);
const md = [`## OpenStreetMap 資料覆蓋率（資料日期 ${when}）`, ""];

for (const [name, box, counts] of targets) {
  const rows = [];
  for (const layer of Object.values(W.LAYERS))
    for (const c of layer.categories) {
      const fromOsm = c.id !== "sponsored" && c.id !== "meal";
      rows.push({ layer: layer.label, cat: c.label, n: fromOsm ? counts[layer.id][c.id] || 0 : null });
    }
  console.log(`\n${name}（約 ${area(box)} 平方公里，資料日期 ${when}）\n`);
  console.log("圖層      類別          數量   評估");
  console.log("─".repeat(44));
  for (const r of rows) console.log(`${r.layer.padEnd(6, "　")}${r.cat.padEnd(7, "　")}${String(r.n ?? "—").padStart(6)}   ${verdict(r.n)}`);
  md.push(`### ${name}（約 ${area(box)} 平方公里）`, "", "| 圖層 | 類別 | 數量 | 評估 |", "|---|---|---:|---|",
    ...rows.map((r) => `| ${r.layer} | ${r.cat} | ${r.n ?? "—"} | ${verdict(r.n)} |`), "");
}
console.log("\n「沒有資料」「極少」的類別，代表使用者打開會看到空地圖：先用 MapComplete 或和在地團體合作補資料，再加新功能。");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
