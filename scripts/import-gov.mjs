#!/usr/bin/env node
/**
 * 匯入政府開放資料（食物銀行、愛心餐食、街友盥洗與中途之家），整理成地圖用的地點。
 *
 * 用法：
 *   node scripts/import-gov.mjs 輸出.json [--osm build/osm-lookup.ndjson] [--cache build/gov-cache] [--offline tests/fixtures/gov]
 *
 * 座標的來源，依序：
 *   1. sources/coords.csv（人工確認過的座標，優先）
 *   2. 資料集本身的座標（WGS84 或 TWD97）
 *   3. 同一個地址在其他資料集有座標
 *   4. OpenStreetMap 裡同地址或同名稱的地點（extract-osm.py 第三個參數產生）
 * 都找不到的列在「待補座標」，不放上地圖，也不猜位置（不使用逐筆線上地址查詢，見 CONSTRAINTS.md C15）。
 *
 * 某個資料集下載失敗時，改用上次成功的快取（--cache），並在報告中標示。
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { fetchDatasetMeta, download, decode, parseTable, pickCoords, cleanAddress, parseCsv, inTaiwan } from "./gov-lib.mjs";
import { DATASETS, exclusionReason } from "./gov-datasets.mjs";
import { root } from "./lib.mjs";
import { AREAS } from "./areas.mjs";

/** 地址比對用：統一寫法，去掉縣市以外的樓層等細節 */
export const addrKey = (a) => cleanAddress(a).replace(/(\d+)之(\d+)號/, "$1-$2號").replace(/(\d+)號之(\d+)$/, "$1-$2號");
/** 名稱比對用：去掉縣市、法人類別、括號、空白 */
export const nameKey = (n) => String(n || "")
  .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/台/g, "臺").replace(/[（(][^）)]*[）)]/g, "")
  .replace(/^(財團法人|社團法人)/, "")
  .replace(/^(臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹市|新竹縣|嘉義市|嘉義縣)(政府)?/, "").replace(/\s+/g, "");

/** 地址去掉縣市、鄉鎮區，只留路名門牌（OSM 的 addr:street + addr:housenumber 通常沒有縣市） */
export const addrTail = (a) => addrKey(a).replace(/^..[市縣]/, "").replace(/^[^路街道段巷弄號]{1,3}?[區鄉鎮市](?=.)/, "");
const CITY = (addr) => (cleanAddress(addr).match(/^(..[市縣])/) || [])[1] || "";
// OSM 比對只在這些城市的範圍內找，避免「中正路 18 號」對到別的縣市
const CITY_BOX = { 臺北市: AREAS.台北, 新北市: AREAS.新北, 桃園市: AREAS.桃園, 臺中市: AREAS.台中, 臺南市: AREAS.台南, 高雄市: AREAS.高雄 };
const inBox = (v, box) => box && v.lat >= box[0] && v.lat <= box[2] && v.lng >= box[1] && v.lng <= box[3];

async function readLookup(file) {
  const byAddr = new Map(), byName = new Map();
  if (!file || !fs.existsSync(file)) return { byAddr, byName, size: 0 };
  let size = 0;
  const add = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    size++;
    const v = { lat: e.lat, lng: e.lon, osm: `${e.type}/${e.id}`, name: e.name || "", city: e.city || "" };
    if (e.addr) add(byAddr, addrTail(e.addr), v);
    if (e.name) add(byName, nameKey(e.name), v);
  }
  return { byAddr, byName, size };
}

function readManual(file) {
  const m = new Map();
  if (!fs.existsSync(file)) return m;
  for (const r of parseCsv(fs.readFileSync(file, "utf8"))) {
    const c = pickCoords({ 緯度: r["緯度"], 經度: r["經度"] });
    if (r["地址"] && c) m.set(addrKey(r["地址"]), c);
  }
  return m;
}

/** 下載（或讀離線檔／快取）一個資料集，回傳 { meta, rows, status } */
async function loadDataset(ds, { offline, cache }) {
  if (offline) {
    const f = ["csv", "json"].map((x) => path.join(offline, `${ds.id}.${x}`)).find((f) => fs.existsSync(f));
    if (!f) return { meta: { title: ds.short }, rows: [], status: "缺少測試檔" };
    const { text } = decode(fs.readFileSync(f));
    return { meta: { title: ds.short, updated: "" }, rows: parseTable(text, path.extname(f)), status: "ok" };
  }
  const cacheFile = cache && path.join(cache, `${ds.id}.json`);
  try {
    const meta = await fetchDatasetMeta(ds.id);
    // 同一資料集常有好幾個年度的檔案，取最後一個 CSV／JSON（通常是最新的）
    const res = [...meta.resources].reverse().find((r) => /CSV|JSON/.test(r.format));
    if (!res) throw new Error("沒有 CSV 或 JSON 檔");
    const { text } = decode(await download(res.url));
    const rows = parseTable(text, res.format);
    if (!rows.length) throw new Error("檔案是空的");
    const out = { meta: { title: meta.title, updated: meta.updated, url: res.url }, rows };
    if (cacheFile) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ ...out, savedAt: new Date().toISOString() })); }
    return { ...out, status: "ok" };
  } catch (e) {
    if (cacheFile && fs.existsSync(cacheFile)) {
      const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      return { meta: saved.meta, rows: saved.rows, status: `下載失敗，改用 ${saved.savedAt.slice(0, 10)} 的資料（${e.message}）` };
    }
    return { meta: { title: ds.short }, rows: [], status: `下載失敗（${e.message}）` };
  }
}

export async function importGov({ offline, cache, lookupFile, manualFile = path.join(root, "sources/coords.csv"), datasets = DATASETS } = {}) {
  const lookup = await readLookup(lookupFile);
  const manual = readManual(manualFile);
  const sources = {}, raw = [], excluded = [];

  for (const ds of datasets) {
    const { meta, rows, status } = await loadDataset(ds, { offline, cache });
    sources[ds.id] = { name: ds.short, city: ds.city, title: meta.title, updated: meta.updated || "", url: `https://data.gov.tw/dataset/${ds.id}`, status, rows: rows.length, places: 0 };
    rows.forEach((row, n) => {
      const mapped = ds.map(row);
      for (const m of [mapped].flat().filter(Boolean)) {
        if (!m.name || !m.address) continue;
        const why = exclusionReason(m.name);
        if (why) { excluded.push({ source: ds.id, name: m.name, why }); continue; }
        raw.push({ ...m, source: ds.id, row: n, given: pickCoords({ 緯度: m.lat, 經度: m.lng }) });
      }
    });
  }

  // 有座標的地址先記下來，讓沒有座標的同地址資料可以借用
  const known = new Map();
  for (const r of raw) if (r.given) known.set(addrKey(r.address), r.given);

  const unique = (list, city) => {
    const box = CITY_BOX[city];
    if (!box) return null; // 不知道城市範圍就不比對，寧可列為待補
    const hits = (list || []).filter((v) => inBox(v, box));
    // 同名或同地址卻在不同地方（例如連鎖機構、不同區的同名道路）就不猜
    if (!hits.length) return null;
    const far = hits.some((h) => Math.hypot(h.lat - hits[0].lat, h.lng - hits[0].lng) > 0.002);
    return far ? null : [hits[0].lat, hits[0].lng];
  };

  const places = [], unresolved = [], how = {};
  const seen = new Map();
  for (const r of raw) {
    const k = addrKey(r.address);
    let c = null, via = "";
    if (manual.has(k)) { c = manual.get(k); via = "人工確認"; }
    else if (r.given) { c = r.given; via = "資料集座標"; }
    else if (known.has(k)) { c = known.get(k); via = "同地址的其他資料"; }
    else if ((c = unique(lookup.byAddr.get(addrTail(r.address)), CITY(r.address)))) via = "OSM 地址";
    else if ((c = unique(lookup.byName.get(nameKey(r.name)), CITY(r.address)))) via = "OSM 同名地點";
    if (!c || !inTaiwan(...c)) {
      if (!unresolved.some((u) => u.name === r.name && u.address === cleanAddress(r.address))) unresolved.push({ source: r.source, name: r.name, address: cleanAddress(r.address) });
      continue;
    }
    how[via] = (how[via] || 0) + 1;

    // 同一個地點、同一類別在不同資料集出現（例如社福中心同時是愛心餐食和實物銀行），合併成一筆
    const dup = `${r.category}|${k}`;
    if (seen.has(dup)) {
      const p = seen.get(dup);
      if (r.conditions && !p.e.includes(r.conditions)) p.e += ` ${r.conditions}`;
      if (!p.g.includes(r.source)) { p.g.push(r.source); sources[r.source].places++; } // 合併進來的也算有用到，出處要標示
      if (!p.h && r.opening) p.h = r.opening;
      if (!p.p && r.phone) p.p = r.phone;
      continue;
    }
    const p = {
      i: `g${r.source}-${r.row}${r.category === "shelter" ? "s" : ""}`,
      a: +c[0].toFixed(6), o: +c[1].toFixed(6), c: r.category, n: r.name,
      d: cleanAddress(r.address), p: r.phone || undefined, h: r.opening || undefined, e: r.conditions || "", g: [r.source],
    };
    for (const key of Object.keys(p)) if (p[key] === undefined || p[key] === "") delete p[key];
    if (!p.e) p.e = "";
    seen.set(dup, p);
    places.push(p);
    sources[r.source].places++;
  }
  for (const p of places) if (!p.e) delete p.e;

  return { generatedAt: new Date().toISOString(), sources, places: places.map((p) => ({ layer: "free", p })), unresolved, excluded, how, lookupSize: lookup.size };
}

/** GitHub Actions Summary 用的報告 */
export function report(result) {
  const lines = ["## 政府開放資料匯入", "", "| 資料集 | 狀態 | 原始筆數 | 放上地圖 |", "|---|---|---:|---:|"];
  for (const [id, s] of Object.entries(result.sources)) lines.push(`| [${s.name}](${s.url}) | ${s.status} | ${s.rows} | ${s.places} |`);
  lines.push("", `座標來源：${Object.entries(result.how).map(([k, v]) => `${k} ${v}`).join("、") || "無"}（OSM 對照表 ${result.lookupSize} 筆）`);
  if (result.excluded.length) {
    lines.push("", `<details><summary>依規則不放上地圖：${result.excluded.length} 筆</summary>`, "");
    for (const x of result.excluded) lines.push(`- ${x.name}（${x.why}）`);
    lines.push("", "</details>");
  }
  if (result.unresolved.length) {
    lines.push("", `### 待補座標：${result.unresolved.length} 筆`, "",
      "這些地點找不到可靠的座標，暫時沒有放上地圖。確認位置後，把「地址,緯度,經度」加到 `sources/coords.csv`，下次發佈就會出現。", "",
      "| 名稱 | 地址 | 查位置 |", "|---|---|---|");
    for (const u of result.unresolved) lines.push(`| ${u.name} | ${u.address} | [Google 地圖](https://www.google.com/maps/search/${encodeURIComponent(u.address)}) |`);
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const offline = opt("--offline"), cache = opt("--cache"), lookupFile = opt("--osm");
  const [out] = args;
  if (!out) { console.error("用法：node scripts/import-gov.mjs 輸出.json [--osm 對照表.ndjson] [--cache 快取資料夾] [--offline 測試資料夾]"); process.exit(1); }
  const result = await importGov({ offline, cache, lookupFile });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result));
  const text = report(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  // 全部資料集都拿不到才算失敗；個別失敗只警告，不擋住整個網站發佈
  if (!result.places.length) { console.error("政府資料一筆都沒有匯入"); process.exit(1); }
}
