// 查看政府開放資料集的真實內容：下載網址、格式、編碼、欄位、前幾筆資料。
// 新增資料集之前先跑一次，確認欄位和座標格式，再寫對應規則（CLAUDE.md 規則 1、R7）。
//
// 用法：node scripts/probe-gov.mjs 121332 125392
import { fetchDatasetMeta, download, decode, parseTable } from "./gov-lib.mjs";

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("請提供 data.gov.tw 的資料集編號，例如：node scripts/probe-gov.mjs 121332");
  process.exit(1);
}

for (const id of ids) {
  console.log(`\n========== ${id} ==========`);
  try {
    const meta = await fetchDatasetMeta(id);
    console.log("名稱：", meta.title);
    console.log("機關：", meta.publisher, "｜授權：", meta.license, "｜更新：", meta.updated);
    for (const r of meta.resources) console.log(` - [${r.format}] ${r.url}  ${r.description || ""}`);
    const pick = meta.resources.find((r) => /csv|json/i.test(r.format)) || meta.resources[0];
    if (!pick) { console.log("沒有可下載的資源"); continue; }
    const buf = await download(pick.url);
    const { text, encoding } = decode(buf);
    console.log(`下載 ${pick.url}：${buf.length} bytes，編碼 ${encoding}`);
    const rows = parseTable(text, pick.format);
    console.log(`共 ${rows.length} 筆；欄位：${Object.keys(rows[0] || {}).join(" | ")}`);
    for (const row of rows.slice(0, 3)) console.log(JSON.stringify(row));
  } catch (e) {
    console.log("失敗：", e.message);
  }
}
