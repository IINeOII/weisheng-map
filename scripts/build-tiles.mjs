#!/usr/bin/env node
/**
 * 把 extract-osm.py 抽出的候選地點，用 docs/js/categories.js 分類，切成 0.1 度見方的小檔案。
 * App 依照目前畫面需要的格子載入，不必一次下載全台灣。
 *
 * 用法：node scripts/build-tiles.mjs build/osm-candidates.ndjson docs/data/osm [資料時間] [--gov build/gov.json]
 *   --gov：scripts/import-gov.mjs 整理好的政府開放資料，一起切進格子
 * 輸出：
 *   docs/data/osm/index.json          格子清單、各類別數量、資料時間
 *   docs/data/osm/{free|cheap}/{格子}.json
 *   docs/data/osm/coverage.json       各預設區域的資料量（覆蓋率報告用）
 *   docs/data/osm/LICENSE.txt         ODbL 授權說明
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadBrowserScripts } from "./lib.mjs";
import { AREAS } from "./areas.mjs";

export const CELL = 0.1;
export const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;

const W = loadBrowserScripts("docs/js/categories.js");

/** 一筆 OSM 資料 → App 用的精簡格式；不屬於任何類別回傳 null */
export function toPlace(layerId, el) {
  const t = el.tags || {};
  const cat = W.classifyTags(layerId, t);
  if (!cat) return null;
  const addr = [t["addr:city"], t["addr:district"], t["addr:street"], t["addr:housenumber"]].filter(Boolean).join("") || t["addr:full"] || "";
  const p = {
    i: (el.type === "way" ? "w" : el.type === "relation" ? "r" : "n") + el.id,
    a: el.lat, o: el.lon, c: cat,
    n: t["name:zh"] || t.name || t.brand || t.operator || "",
    h: t.opening_hours, d: addr || undefined,
    p: t.phone || t["contact:phone"], w: t.website || t["contact:website"],
    f: t.fee, s: t.description,
  };
  for (const k of Object.keys(p)) if (p[k] === undefined || p[k] === "") delete p[k];
  return p;
}

/** 把元素陣列（或非同步產生器）分好類、切好格子；gov 是 importGov() 的結果（可省略） */
export async function buildTiles(elements, osmTimestamp = null, gov = null) {
  const cells = { free: new Map(), cheap: new Map() };
  const totals = { free: {}, cheap: {} };
  const areaCounts = Object.fromEntries(Object.keys(AREAS).map((a) => [a, { free: {}, cheap: {} }]));
  async function* all() {
    for await (const el of elements) for (const layerId of ["free", "cheap"]) yield [layerId, toPlace(layerId, el)];
    for (const { layer, p } of gov?.places || []) yield [layer, p];
  }
  for await (const [layerId, p] of all()) {
    if (!p) continue;
    const key = cellKey(p.a, p.o);
    if (!cells[layerId].has(key)) cells[layerId].set(key, []);
    cells[layerId].get(key).push(p);
    totals[layerId][p.c] = (totals[layerId][p.c] || 0) + 1;
    for (const [name, [s, w, n, e]] of Object.entries(AREAS)) {
      if (p.a >= s && p.a <= n && p.o >= w && p.o <= e) areaCounts[name][layerId][p.c] = (areaCounts[name][layerId][p.c] || 0) + 1;
    }
  }
  const files = new Map();
  const index = { version: 1, cell: CELL, generatedAt: new Date().toISOString(), osmTimestamp, totals, cells: {} };
  // 政府資料的出處：App 詳細資料與「關於」頁要標示（政府資料開放授權條款，CONSTRAINTS.md C14）
  if (gov) {
    index.gov = { generatedAt: gov.generatedAt, sources: {} };
    for (const [id, s] of Object.entries(gov.sources)) if (s.places) index.gov.sources[id] = { name: s.name, url: s.url, updated: s.updated, ...(s.kind ? { kind: s.kind } : {}) };
  }
  for (const layerId of ["free", "cheap"]) {
    index.cells[layerId] = {};
    for (const [key, list] of cells[layerId]) {
      files.set(`${layerId}/${key}.json`, list);
      index.cells[layerId][key] = list.length;
    }
  }
  files.set("index.json", index);
  files.set("coverage.json", { generatedAt: index.generatedAt, osmTimestamp, areas: AREAS, counts: areaCounts });
  return files;
}

async function* readNdjson(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

const LICENSE = `本資料夾的地點資料取自 OpenStreetMap，© OpenStreetMap 貢獻者。
依 Open Database License 1.0（ODbL）授權：https://opendatacommons.org/licenses/odbl/1-0/
這些檔案是 OpenStreetMap 的衍生資料庫，同樣以 ODbL 提供，歡迎自由使用，但須註明出處並以相同授權分享。

編號以 g 開頭的地點取自政府開放資料平臺（https://data.gov.tw），依「政府資料開放授權條款－第1版」使用：
https://data.gov.tw/license 。各資料集名稱與提供機關見 index.json 的 gov.sources。
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const g = args.indexOf("--gov");
  const govFile = g >= 0 ? args.splice(g, 2)[1] : null;
  const [src, outDir, ts] = args;
  if (!src || !outDir) { console.error("用法：node scripts/build-tiles.mjs 候選.ndjson 輸出資料夾 [資料時間] [--gov 政府資料.json]"); process.exit(1); }
  const gov = govFile ? JSON.parse(fs.readFileSync(govFile, "utf8")) : null;
  const files = await buildTiles(readNdjson(src), ts || null, gov);
  fs.rmSync(outDir, { recursive: true, force: true });
  let bytes = 0;
  for (const [rel, data] of files) {
    const f = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const s = JSON.stringify(data);
    bytes += s.length;
    fs.writeFileSync(f, s);
  }
  fs.writeFileSync(path.join(outDir, "LICENSE.txt"), LICENSE);
  const idx = files.get("index.json");
  const count = (l) => Object.values(idx.totals[l]).reduce((a, b) => a + b, 0);
  if (gov) console.log(`其中政府開放資料 ${gov.places.length} 筆`);
  console.log(`免費資源 ${count("free")} 筆、平價好物 ${count("cheap")} 筆，共 ${files.size - 2} 個格子檔，${(bytes / 1e6).toFixed(1)} MB → ${outDir}`);
  if (count("free") === 0) { console.error("免費資源一筆都沒有，分類或資料檔可能有問題"); process.exit(1); }
}
