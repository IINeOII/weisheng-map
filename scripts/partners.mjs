/**
 * 合作團體提供的地點（sources/partners.csv）
 *
 * 來源：合作團體填寫「維生地圖：合作資源表」（Claude Sheets，下載成 CSV 後放到 sources/partners.csv；流程見 SOP.md SOP-6）。
 * 這裡是欄位名稱與規則的唯一來源：匯入（import-gov.mjs）、靜態檢查（check.mjs）、測試都用它。
 *
 * 規則（CLAUDE.md 規則 9）：
 *   - 「公開地址」不是「是」的不上地圖（例如女性庇護、中途之家）
 *   - 必填欄位缺漏、類別不認得、確認日期不是日期的，不上地圖，並在檢查與匯入報告中列出原因
 *   - 「需要先聯絡」寫進條件文字的開頭，讓人出發前就知道要不要先打電話
 */
import fs from "node:fs";
import { parseCsv, cleanAddress } from "./gov-lib.mjs";
import { loadBrowserScripts } from "./lib.mjs";

export const COLUMNS = ["提供團體", "地點名稱", "類別", "地址", "公開地址", "開放時間", "領取方式與條件", "需要先聯絡", "聯絡電話", "網站或粉專", "確認日期", "備註（不公開）"];
/** 放進公開倉庫的欄位：「備註（不公開）」不進倉庫 */
export const PUBLIC_COLUMNS = COLUMNS.filter((c) => c !== "備註（不公開）");
export const REQUIRED = ["提供團體", "地點名稱", "類別", "地址", "公開地址", "領取方式與條件", "需要先聯絡", "確認日期"];
export const CONTACT = { 不用: "不用先登記，直接去就可以", 先打電話: "請先打電話確認", 要社工轉介: "要先經社工評估轉介" };

const { LAYERS } = loadBrowserScripts("docs/js/categories.js");
const CATEGORY = Object.fromEntries(LAYERS.free.categories.map((c) => [c.label, c.id]));

/** 欄位名稱容許前後空白與「*」（必填記號） */
const clean = (s) => String(s ?? "").replace(/^﻿/, "").replace(/[*＊]/g, "").trim();

/** 從 Sheets 下載的 CSV 第一列可能是標題說明：找到真正的表頭（含「地點名稱」的那一列）再開始解析 */
export function parsePartnerCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const at = lines.findIndex((l) => l.split(",").map(clean).includes("地點名稱"));
  if (at < 0) return { rows: [], headers: [], problems: ["找不到表頭（含「地點名稱」的那一列）"] };
  const headers = lines[at].split(",").map(clean);
  const rows = parseCsv(lines.slice(at).join("\n"))
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [clean(k), clean(v)])))
    .filter((r) => Object.values(r).some(Boolean));
  const missing = PUBLIC_COLUMNS.filter((c) => !headers.includes(c));
  return { rows, headers, problems: missing.length ? [`缺少欄位：${missing.join("、")}`] : [] };
}

/** 台灣常見的日期寫法 → YYYY-MM-DD；不是日期就回傳空字串 */
export function toDate(s) {
  const m = clean(s).match(/^(\d{2,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return "";
  let y = +m[1];
  if (y < 1000) y += 1911; // 民國年
  const d = new Date(Date.UTC(y, +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || y < 2000) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * 一列 → { ok: true, place } 或 { ok: false, why }
 * place 的欄位和 gov-datasets.mjs 的 map() 輸出相同，另外多 verified、website
 */
export function mapPartnerRow(r) {
  const missing = REQUIRED.filter((c) => !r[c]);
  if (missing.length) return { ok: false, why: `缺少${missing.join("、")}` };
  if (r["公開地址"] !== "是") return { ok: false, why: "地址不公開" };
  const category = CATEGORY[r["類別"]];
  if (!category) return { ok: false, why: `類別「${r["類別"]}」不認得，請從下拉選單選` };
  const verified = toDate(r["確認日期"]);
  if (!verified) return { ok: false, why: `確認日期「${r["確認日期"]}」不是日期` };
  const contact = CONTACT[r["需要先聯絡"]];
  if (!contact) return { ok: false, why: `需要先聯絡「${r["需要先聯絡"]}」請從下拉選單選` };
  return {
    ok: true,
    place: {
      category, name: r["地點名稱"], address: cleanAddress(r["地址"]), opening: r["開放時間"] || "",
      conditions: `${contact}。${r["領取方式與條件"].replace(/[。.]$/, "")}。`,
      phone: r["聯絡電話"] || "", website: /^https?:\/\//.test(r["網站或粉專"]) ? r["網站或粉專"] : "",
      verified, org: r["提供團體"],
    },
  };
}

/** 讀 sources/partners.csv；檔案不存在就是沒有合作資料 */
export function readPartners(file) {
  if (!file || !fs.existsSync(file)) return { rows: [], problems: [] };
  return parsePartnerCsv(fs.readFileSync(file, "utf8"));
}

const q = (v) => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
/** 寫成 sources/partners.csv 的格式（只有公開欄位，UTF-8 加 BOM，Excel 打開不會亂碼） */
export function toPartnerCsv(rows) {
  return "\uFEFF" + [PUBLIC_COLUMNS.join(","), ...rows.map((r) => PUBLIC_COLUMNS.map((c) => q(r[c] ?? "")).join(","))].join("\n") + "\n";
}

/**
 * 公開倉庫裡不能有的東西（check.mjs 會擋）：不公開地址的列、「備註（不公開）」欄位
 * 回傳問題清單
 */
export function leaks(parsed) {
  const out = [];
  if (parsed.headers.includes("備註（不公開）")) out.push("有「備註（不公開）」欄位：這個倉庫是公開的，請用 scripts/add-partners.mjs 匯入（會自動拿掉）");
  const hidden = parsed.rows.filter((r) => r["公開地址"] !== "是").length;
  if (hidden) out.push(`有 ${hidden} 列「公開地址」不是「是」：這個倉庫是公開的，地址會外洩，請用 scripts/add-partners.mjs 匯入（會自動拿掉）`);
  return out;
}
