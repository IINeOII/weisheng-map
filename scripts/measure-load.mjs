#!/usr/bin/env node
/**
 * 量測網站在手機上的載入速度：模擬慢速 4G 與一般手機的 CPU，記錄各階段時間和下載量。
 * 要判斷「哪裡慢」時先量，不要猜（CLAUDE.md 規則 5 的精神）。
 *
 * 用法：node scripts/measure-load.mjs [網址] [--runs 3]
 * 預設量已發佈的網站。結果印在畫面上；在 GitHub Actions 裡也會寫進 Summary 頁。
 */
import fs from "node:fs";
import { chromium, devices } from "@playwright/test";

const args = process.argv.slice(2);
const ri = args.indexOf("--runs");
const runs = ri >= 0 ? +args.splice(ri, 2)[1] : 3;
const url = args[0] || "https://iineoii.github.io/weisheng-map/";

// Lighthouse 的「慢速 4G」設定，與 4 倍 CPU 減速（約等於中低階手機）
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU = 4;

const kind = (u, type) => {
  if (/tile\.openstreetmap|\/\d+\/\d+\/\d+\.png/.test(u)) return "底圖圖磚";
  if (/\/data\//.test(u)) return "地點資料";
  if (/fonts|woff2?/.test(u) || type === "font") return "字型";
  if (/\.js(\?|$)/.test(u)) return "程式";
  if (/\.css(\?|$)/.test(u)) return "樣式";
  return "其他";
};

async function once(browser, n) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], geolocation: { latitude: 25.0478, longitude: 121.517 }, permissions: ["geolocation"], serviceWorkers: "block" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, type: e.type }));
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.type = e.type; r.ttfb = e.response.timing ? e.response.timing.receiveHeadersEnd : null; } });
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });

  const t0 = Date.now();
  const marks = {};
  const mark = (name, fn) => fn().then(() => { marks[name] = Date.now() - t0; }).catch(() => { marks[name] = null; });
  await page.goto(url, { waitUntil: "commit", timeout: 120_000 });
  await Promise.all([
    mark("畫面出現（標題可見）", () => page.waitForSelector("h1, .brand, #map", { timeout: 60_000 })),
    mark("第一張底圖", () => page.waitForSelector(".leaflet-tile-loaded", { timeout: 90_000 })),
    mark("畫面上的底圖全部載完", () => page.waitForFunction(() => {
      const t = document.querySelectorAll(".leaflet-tile"); return t.length > 0 && [...t].every((x) => x.classList.contains("leaflet-tile-loaded"));
    }, null, { timeout: 120_000, polling: 200 })),
    mark("地點標記出現", () => page.waitForSelector(".leaflet-marker-icon", { timeout: 120_000 })),
  ]);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    markers: document.querySelectorAll(".leaflet-marker-icon").length,
    tiles: document.querySelectorAll(".leaflet-tile").length,
    dpr: devicePixelRatio,
    places: window.__app ? window.__app.state.places.free.size : null,
    fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").length,
  }));
  const byKind = {};
  for (const r of reqs.values()) {
    if (!r.bytes) continue;
    const k = kind(r.url, r.type);
    byKind[k] ||= { n: 0, bytes: 0, ms: [] };
    byKind[k].n++; byKind[k].bytes += r.bytes; byKind[k].ms.push((r.end - r.start) * 1000);
  }
  await ctx.close();
  console.log(`第 ${n} 次：`, JSON.stringify(marks));
  return { marks, byKind, info };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const results = [];
for (let i = 1; i <= runs; i++) results.push(await once(browser, i));
await browser.close();

const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sec = (ms) => (ms == null ? "逾時" : `${(ms / 1000).toFixed(1)} 秒`);
const kb = (b) => `${Math.round(b / 1024)} KB`;
const lines = [`## 載入速度（${url}）`, "", `模擬：慢速 4G（延遲 150ms、下載 1.6 Mbps）、CPU 減速 ${CPU} 倍、Pixel 7 畫面、不使用快取；共 ${runs} 次取中位數。量測機器在 GitHub 的機房（國外），從台灣連線的延遲會不同。`, "", "| 階段 | 時間 |", "|---|---:|"];
for (const k of Object.keys(results[0].marks)) lines.push(`| ${k} | ${sec(median(results.map((r) => r.marks[k])))} |`);
lines.push("", "| 類型 | 請求數 | 下載量 | 單一請求中位時間 |", "|---|---:|---:|---:|");
const kinds = [...new Set(results.flatMap((r) => Object.keys(r.byKind)))];
for (const k of kinds.sort((a, b) => (results[0].byKind[b]?.bytes || 0) - (results[0].byKind[a]?.bytes || 0))) {
  const ks = results.map((r) => r.byKind[k]).filter(Boolean);
  lines.push(`| ${k} | ${median(ks.map((x) => x.n))} | ${kb(median(ks.map((x) => x.bytes)))} | ${Math.round(median(ks.flatMap((x) => x.ms)))} ms |`);
}
const i = results[0].info;
lines.push("", `畫面上 ${i.tiles} 張底圖、${i.markers} 個標記（含群組）、已載入 ${i.places} 個免費資源地點、${i.fontsLoaded} 個字型檔；螢幕像素比 ${i.dpr}。`);
const text = lines.join("\n") + "\n";
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
