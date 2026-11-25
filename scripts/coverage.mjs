#!/usr/bin/env node
/**
 * 資料覆蓋率：查詢 OpenStreetMap 上「真的有多少」地點，回答最根本的問題：
 * 使用者打開地圖時，看得到東西嗎？
 *
 * 用法：
 *   npm run coverage                 # 預設台北市
 *   npm run coverage -- 新北          # 台北、新北、桃園、台中、台南、高雄、萬華、台北車站
 *   npm run coverage -- 25.03,121.49,25.06,121.52   # 自訂範圍（南,西,北,東）
 *
 * 查詢條件直接讀 docs/js/categories.js，和 App 顯示的完全一致。
 */
import fs from "node:fs";
import { loadBrowserScripts, p } from "./lib.mjs";

const AREAS = {
  台北: [24.96, 121.45, 25.21, 121.67],
  新北: [24.67, 121.28, 25.30, 122.01],
  桃園: [24.59, 120.98, 25.12, 121.48],
  台中: [24.00, 120.46, 24.45, 121.45],
  台南: [22.88, 120.03, 23.41, 120.66],
  高雄: [22.47, 120.17, 23.47, 121.05],
  萬華: [25.01, 121.48, 25.05, 121.51],
  台北車站: [25.035, 121.505, 25.06, 121.53],
};

const arg = process.argv[2] || "台北";
const bbox = AREAS[arg] || arg.split(",").map(Number);
if (bbox.length !== 4 || bbox.some(isNaN)) {
  console.error("範圍格式錯誤。可用：" + Object.keys(AREAS).join("、") + "，或 南,西,北,東");
  process.exit(1);
}
const name = AREAS[arg] ? arg : "自訂範圍";
const w = loadBrowserScripts("docs/js/config.js", "docs/js/categories.js");
const endpoints = w.APP_CONFIG.overpassEndpoints;

const rows = [];
for (const layer of Object.values(w.LAYERS)) {
  for (const c of layer.categories) {
    if (!c.overpass.length) { rows.push({ layer: layer.label, cat: c.label, n: null }); continue; }
    rows.push({ layer: layer.label, cat: c.label, q: `(${c.overpass.map((s) => s + ";").join("")});out count;` });
  }
}
const query = `[out:json][timeout:120][bbox:${bbox.join(",")}];` + rows.filter((r) => r.q).map((r) => r.q).join("");

let json, lastErr;
for (const url of endpoints) {
  try {
    process.stdout.write(`查詢 ${new URL(url).host} …`);
    const res = await fetch(url, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "WeishengMap-coverage/1.0" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    json = await res.json();
    console.log(" 完成");
    break;
  } catch (e) { lastErr = e; console.log(" 失敗（" + e.message + "）"); }
}
if (!json) { console.error("所有 Overpass 伺服器都連不上：" + lastErr?.message); process.exit(1); }

const counts = json.elements.filter((e) => e.type === "count").map((e) => +e.tags.total);
let i = 0;
for (const r of rows) if (r.q) r.n = counts[i++];

const km2 = Math.abs((bbox[2] - bbox[0]) * 111 * (bbox[3] - bbox[1]) * 111 * Math.cos((bbox[0] * Math.PI) / 180));
const verdict = (n) => n == null ? "只靠回報" : n === 0 ? "❌ 沒有資料" : n < 10 ? "⚠️  極少" : n < 50 ? "△ 偏少" : "✔";
console.log(`\n${name}（約 ${Math.round(km2)} 平方公里）OpenStreetMap 資料量\n`);
console.log("圖層      類別          數量   評估");
console.log("─".repeat(44));
for (const r of rows) console.log(`${r.layer.padEnd(6, "　")}${r.cat.padEnd(7, "　")}${String(r.n ?? "—").padStart(6)}   ${verdict(r.n)}`);

const report = { area: name, bbox, checkedAt: new Date().toISOString(), rows: rows.map(({ q, ...r }) => r) };
fs.mkdirSync(p("reports"), { recursive: true });
const out = p("reports", `coverage-${name}-${report.checkedAt.slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n已存到 ${out}`);
console.log("「沒有資料」「極少」的類別，代表使用者打開會看到空地圖：先用 MapComplete 或和在地團體合作補資料，再加新功能。");
