// 政府開放資料共用工具：取得資料集描述、下載、判斷編碼、解析 CSV／JSON、座標轉換。
// 只用 Node 內建功能，Windows 也能跑。

const UA = "weisheng-map/1.0 (+https://github.com/IINeOII/weisheng-map)";
const TIMEOUT = 60_000;

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
  return res;
}

/** data.gov.tw 資料集描述：名稱、機關、授權、資源清單。欄位名稱容錯處理，回傳 raw 方便除錯。 */
export async function fetchDatasetMeta(id) {
  const res = await get(`https://data.gov.tw/api/v2/rest/dataset/${id}`);
  const json = await res.json();
  const r = json.result || json;
  const dist = r.distribution || r.resources || [];
  return {
    id: String(id),
    title: r.title || r.datasetName || "",
    publisher: r.publisher || r.agency || r.publisherOrgName || "",
    license: r.license || r.licenseName || "",
    updated: r.modifiedDate || r.updateDate || r.modified || "",
    resources: dist.map((d) => ({
      url: d.resourceDownloadUrl || d.downloadURL || d.accessURL || d.url || "",
      format: (d.resourceFormat || d.format || "").toUpperCase(),
      description: d.resourceDescription || d.description || "",
      encoding: d.resourceCharacterEncoding || d.characterEncoding || "",
    })).filter((d) => d.url),
    raw: r,
  };
}

export async function download(url) {
  const res = await get(url);
  return Buffer.from(await res.arrayBuffer());
}

/** UTF-8（含 BOM）、UTF-16、Big5 自動判斷。 */
export function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("big5").decode(buf), encoding: "big5" };
  }
}

/** RFC 4180 CSV：引號、引號內換行、CRLF。回傳物件陣列，欄位名稱去空白。 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** JSON 可能是陣列，也可能把資料包在 result.records、data 之類的欄位裡：找第一個「物件陣列」。 */
export function parseJsonRows(text) {
  const root = JSON.parse(text);
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.length && typeof v[0] === "object" && !Array.isArray(v[0]) ? v : null;
    for (const k of Object.keys(v)) { const f = walk(v[k]); if (f) return f; }
    return null;
  };
  return (walk(root) || []).map((o) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k.trim(), typeof val === "string" ? val.trim() : val])));
}

export function parseTable(text, format = "") {
  const t = text.trimStart();
  if (/json/i.test(format) || t.startsWith("[") || t.startsWith("{")) return parseJsonRows(text);
  return parseCsv(text);
}

/** TWD97 TM2（EPSG:3826，中央經線 121°）轉 WGS84。誤差在公尺以內，足夠標地圖。 */
export function twd97ToWgs84(x, y) {
  const a = 6378137, b = 6356752.314245, k0 = 0.9999, lng0 = (121 * Math.PI) / 180, dx = 250000;
  const e = Math.sqrt(1 - (b * b) / (a * a));
  x -= dx;
  const M = y / k0;
  const mu = M / (a * (1 - e ** 2 / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256));
  const e1 = (1 - Math.sqrt(1 - e ** 2)) / (1 + Math.sqrt(1 - e ** 2));
  const fp = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const e2 = e ** 2 / (1 - e ** 2);
  const C1 = e2 * Math.cos(fp) ** 2, T1 = Math.tan(fp) ** 2;
  const R1 = (a * (1 - e ** 2)) / (1 - e ** 2 * Math.sin(fp) ** 2) ** 1.5;
  const N1 = a / Math.sqrt(1 - e ** 2 * Math.sin(fp) ** 2);
  const D = x / (N1 * k0);
  const lat = fp - ((N1 * Math.tan(fp)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * e2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * e2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lng = lng0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * e2 + 24 * T1 ** 2) * D ** 5) / 120) / Math.cos(fp);
  return [(lat * 180) / Math.PI, (lng * 180) / Math.PI];
}

/** 全形數字與符號轉半形；去掉換行、括號內說明、樓層、鄰里，讓地址比較好查。 */
export function cleanAddress(addr) {
  return String(addr || "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[\r\n]+/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/台/g, "臺")
    .replace(/\d+鄰/g, "")
    .replace(/(?<=[區鄉鎮市])[^\s區鄉鎮市路街道段巷弄號]{1,4}里(?=[^區鄉鎮市\s]*[路街道])/g, "")
    .replace(/(\d+號)(之\d+)?.*$/, "$1$2")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Nominatim 地址轉座標。依使用規範：每秒最多 1 次、自訂 User-Agent、結果要快取。
 * 只在建置時呼叫，而且只查快取裡沒有的地址（scripts/import-gov.mjs）。
 * 回傳 { lat, lng, precision: "house" | "street" | "area" } 或 null。
 */
let lastCall = 0;
export async function geocode(address) {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    q: address, countrycodes: "tw", format: "jsonv2", limit: "1", "accept-language": "zh-TW",
  });
  const res = await get(url);
  const [hit] = await res.json();
  if (!hit) return null;
  const lat = +hit.lat, lng = +hit.lon;
  if (!inTaiwan(lat, lng)) return null;
  const t = hit.addresstype || hit.type || "";
  const precision = /house|building|amenity|office|shop|place_of_worship|townhall|social_facility/.test(t) || hit.category === "amenity" || hit.category === "building" ? "house"
    : /road|street|residential|pedestrian|primary|secondary|tertiary|unclassified/.test(t) ? "street" : "area";
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6), precision, matched: hit.display_name };
}

/** 台灣本島與離島的大致範圍，用來擋掉經緯度寫反、填 0 或格式錯的資料。 */
export const inTaiwan = (lat, lng) => lat > 21.8 && lat < 26.5 && lng > 118 && lng < 122.2;

/**
 * 從一筆資料找出座標。欄位名稱各機關不同，依序嘗試；經緯度寫反、TWD97 都會自動處理。
 * 回傳 [lat, lng] 或 null。
 */
export function pickCoords(row, fields = {}) {
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(n) ? n : NaN; };
  const find = (names) => { for (const n of names) if (row[n] !== undefined && row[n] !== "") return num(row[n]); return NaN; };
  const lat = find(fields.lat || ["緯度", "wgs84aY", "WGS84Y", "Lat", "lat", "LAT", "latitude", "Latitude", "Y坐標", "Y座標", "y", "Y"]);
  const lng = find(fields.lng || ["經度", "wgs84aX", "WGS84X", "Lng", "lng", "Lon", "lon", "LNG", "longitude", "Longitude", "X坐標", "X座標", "x", "X"]);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (inTaiwan(lat, lng)) return [lat, lng];
    if (inTaiwan(lng, lat)) return [lng, lat];
    // TWD97：X 約 15～35 萬，Y 約 240～280 萬
    if (lng > 1e5 && lng < 4e5 && lat > 2.3e6 && lat < 2.9e6) { const p = twd97ToWgs84(lng, lat); if (inTaiwan(...p)) return p; }
    if (lat > 1e5 && lat < 4e5 && lng > 2.3e6 && lng < 2.9e6) { const p = twd97ToWgs84(lat, lng); if (inTaiwan(...p)) return p; }
  }
  const tx = find(fields.twd97x || ["twd97X", "TWD97X", "TWD97_X"]);
  const ty = find(fields.twd97y || ["twd97Y", "TWD97Y", "TWD97_Y"]);
  if (Number.isFinite(tx) && Number.isFinite(ty)) { const p = twd97ToWgs84(tx, ty); if (inTaiwan(...p)) return p; }
  return null;
}
