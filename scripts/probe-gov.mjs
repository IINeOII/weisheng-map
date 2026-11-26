// 查看政府開放資料集的真實內容：下載網址、格式、編碼、欄位、前幾筆資料。
// 新增資料集之前先跑一次，確認欄位和座標格式，再寫對應規則（CLAUDE.md 規則 1、R7；流程見 SOP.md）。
//
// 用法：
//   node scripts/probe-gov.mjs 121332 125392
//   node scripts/probe-gov.mjs --save build/probe 121332   ← 另外把原始檔（轉成 UTF-8）和摘要存到資料夾
// 在 GitHub Actions 上：把編號寫進 sources/probe-ids.txt，推到 probe/ 開頭的分支，
// 「查看政府資料集」會跑這支程式，並把結果提交回同一個分支的 probe-results/（見 .github/workflows/probe.yml）。
import fs from "node:fs";
import path from "node:path";
import { fetchDatasetMeta, download, decode, parseTable, pickCoords } from "./gov-lib.mjs";

const args = process.argv.slice(2);
const si = args.indexOf("--save");
const saveDir = si >= 0 ? args.splice(si, 2)[1] : null;
const ids = args;
if (!ids.length) {
  console.error("請提供 data.gov.tw 的資料集編號，例如：node scripts/probe-gov.mjs 121332");
  process.exit(1);
}

const summary = ["| 編號 | 名稱 | 機關 | 結果 | 筆數 | 有座標 | 欄位 |", "|---|---|---|---|---:|---:|---|"];
for (const id of ids) {
  console.log(`\n========== ${id} ==========`);
  try {
    const meta = await fetchDatasetMeta(id);
    console.log("名稱：", meta.title);
    console.log("機關：", meta.publisher, "｜授權：", meta.license, "｜更新：", meta.updated);
    for (const r of meta.resources) console.log(` - [${r.format}] ${r.url}  ${r.description || ""}`);
    const pick = [...meta.resources].reverse().find((r) => /csv|json/i.test(r.format)) || meta.resources.at(-1);
    if (!pick) { console.log("沒有可下載的資源"); summary.push(`| ${id} | ${meta.title} | ${meta.publisher} | 沒有 CSV／JSON | 0 | 0 | |`); continue; }
    const buf = await download(pick.url);
    const { text, encoding } = decode(buf);
    console.log(`下載 ${pick.url}：${buf.length} bytes，編碼 ${encoding}`);
    const rows = parseTable(text, pick.format);
    const fields = Object.keys(rows[0] || {});
    const withCoords = rows.filter((r) => pickCoords(r)).length;
    console.log(`共 ${rows.length} 筆（${withCoords} 筆有可用座標）；欄位：${fields.join(" | ")}`);
    for (const row of rows.slice(0, process.env.PROBE_ALL ? 1e9 : 3)) console.log(JSON.stringify(row));
    summary.push(`| [${id}](https://data.gov.tw/dataset/${id}) | ${meta.title} | ${meta.publisher} | ok（${encoding}） | ${rows.length} | ${withCoords} | ${fields.join("、")} |`);
    if (saveDir) {
      fs.mkdirSync(saveDir, { recursive: true });
      const ext = /json/i.test(pick.format) || /^[[{]/.test(text.trimStart()) ? "json" : "csv";
      fs.writeFileSync(path.join(saveDir, `${id}.${ext}`), text);
      fs.writeFileSync(path.join(saveDir, `${id}.meta.json`), JSON.stringify({ ...meta, raw: undefined, picked: pick.url, encoding, rows: rows.length }, null, 2));
    }
  } catch (e) {
    const why = `${e.message} ${e.cause?.code || e.cause?.message || ""}`.trim();
    console.log("失敗：", why);
    summary.push(`| ${id} | | | 失敗：${why.replace(/\|/g, "／")} | 0 | 0 | |`);
  }
}
const md = `## 查看政府資料集\n\n${summary.join("\n")}\n`;
if (saveDir) fs.writeFileSync(path.join(saveDir, "SUMMARY.md"), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
