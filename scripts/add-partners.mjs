#!/usr/bin/env node
/**
 * 把合作團體填好的「合作資源表」併進 sources/partners.csv（流程見 SOP.md SOP-6）
 *
 * 用法（Windows 的命令提示字元也一樣）：
 *   node scripts/add-partners.mjs 下載的檔案.csv [另一個團體的.csv ...]
 *
 * 檔案從哪來：
 *   - Claude Sheets 的「合作資源表」：下載成 CSV
 *   - 團體用 Excel 填的：在 Excel 選「另存新檔 → CSV UTF-8（逗號分隔）」；舊版 Excel 存成 Big5 的 CSV 也讀得懂
 *
 * 會做的事：
 *   1. 拿掉「公開地址」不是「是」的列，以及「備註（不公開）」欄位：這個倉庫是公開的，這些不能進來
 *   2. 檢查每一列（必填、類別、日期），有問題的列不收，列出原因，請團體或你改好再匯一次
 *   3. 同一個團體的資料整批取代（團體交來的表就是它目前的完整清單）；其他團體的不動
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "./gov-lib.mjs";
import { root } from "./lib.mjs";
import { parsePartnerCsv, mapPartnerRow, toPartnerCsv, readPartners, PUBLIC_COLUMNS } from "./partners.mjs";

/** 回傳 { rows: 新的完整清單, added, rejected: [{org,name,why}], hiddenDropped, orgs } */
export function mergePartners(existingRows, incomingTexts) {
  const incoming = [], rejected = [];
  let hiddenDropped = 0;
  for (const text of incomingTexts) {
    const parsed = parsePartnerCsv(text);
    if (parsed.problems.length) { rejected.push({ org: "", name: "（整個檔案）", why: parsed.problems.join("；") }); continue; }
    for (const r of parsed.rows) {
      const res = mapPartnerRow(r);
      if (!res.ok && res.why === "地址不公開") { hiddenDropped++; continue; }
      if (!res.ok) { rejected.push({ org: r["提供團體"], name: r["地點名稱"] || "（沒有名稱）", why: res.why }); continue; }
      incoming.push(Object.fromEntries(PUBLIC_COLUMNS.map((c) => [c, r[c] || ""])));
    }
  }
  const orgs = [...new Set(incoming.map((r) => r["提供團體"]))];
  const kept = existingRows.filter((r) => !orgs.includes(r["提供團體"]));
  return { rows: [...kept, ...incoming], added: incoming.length, replaced: existingRows.length - kept.length, rejected, hiddenDropped, orgs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("用法：node scripts/add-partners.mjs 下載的檔案.csv [更多檔案.csv]"); process.exit(1); }
  const target = path.join(root, "sources", "partners.csv");
  const existing = readPartners(target).rows;
  const texts = files.map((f) => decode(fs.readFileSync(path.resolve(f))).text);
  const r = mergePartners(existing, texts);
  fs.writeFileSync(target, toPartnerCsv(r.rows));
  console.log(`已更新 sources/partners.csv：${r.orgs.join("、") || "（沒有團體）"}，收進 ${r.added} 筆（取代舊的 ${r.replaced} 筆），現在共 ${r.rows.length} 筆`);
  if (r.hiddenDropped) console.log(`不公開地址的 ${r.hiddenDropped} 筆已拿掉，沒有寫進倉庫`);
  if (r.rejected.length) {
    console.log(`\n這 ${r.rejected.length} 筆沒有收，請改好再匯一次：`);
    for (const x of r.rejected) console.log(`  - ${x.org ? x.org + "／" : ""}${x.name}：${x.why}`);
  }
  console.log("\n下一步：npm run check，然後開 PR；PR 的「建置地點資料」Summary 會列出每筆有沒有找到座標。");
}
