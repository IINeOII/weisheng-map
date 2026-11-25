#!/usr/bin/env node
/**
 * 靜態檢查：不用開瀏覽器，幾秒內抓出「會默默壞掉」的錯誤。
 * 每一項都對應過去真的發生過、或差點發生的問題（見 CLAUDE.md 覆盤）。
 * 用法：npm run check
 */
import vm from "node:vm";
import fs from "node:fs";
import { read, exists, p, loadBrowserScripts, ok, fail, warn, section, finish } from "./lib.mjs";

// 1. JavaScript 語法
section("JavaScript 語法");
for (const f of fs.readdirSync(p("docs/js")).filter((n) => n.endsWith(".js"))) {
  try { new vm.Script(read("docs/js/" + f), { filename: f }); ok(f); }
  catch (e) { fail(`${f}：${e.message}`); }
}

// 2. 圖示：程式裡用到的名稱都要存在，否則會顯示空白而不會報錯 [B5 類]
section("圖示名稱");
const w = loadBrowserScripts("docs/js/icons.js", "docs/js/categories.js");
// 圖示不存在時 icon() 會回傳空的 <svg></svg>，所以看裡面有沒有內容
const probe = (name) => /<svg[^>]*>\s*<\w/.test(w.icon(name));
const used = new Set();
const grab = (text, re) => { for (const m of text.matchAll(re)) used.add(m[1]); };
for (const f of ["docs/js/app.js", "docs/js/native.js"]) grab(read(f), /\bic\(\s*"([a-z0-9-]+)"/g);
grab(read("docs/index.html"), /data-icon="([a-z0-9-]+)"/g);
for (const layer of Object.values(w.LAYERS)) { used.add(layer.icon); for (const c of layer.categories) used.add(c.icon); }
const missing = [...used].filter((n) => !probe(n));
missing.length ? fail("找不到這些圖示：" + missing.join("、")) : ok(`${used.size} 個圖示都存在`);
const nested = [...used].filter((n) => (w.icon(n).match(/<svg/g) || []).length > 1);
nested.length ? fail("這些圖示有巢狀的 <svg>，會吞掉後面的文字 [B5]：" + nested.join("、")) : ok("沒有巢狀 <svg>");

// 3. 離線快取清單：漏掉檔案會讓離線功能整個失效，而且不會有任何錯誤訊息
section("離線快取清單（sw.js）");
const sw = read("docs/sw.js");
const shell = JSON.parse("[" + sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].replace(/,\s*$/, "") + "]");
const missingFiles = shell.filter((f) => f !== "./" && !exists("docs/" + f));
missingFiles.length ? fail("清單裡的檔案不存在：" + missingFiles.join("、")) : ok(`清單 ${shell.length} 個檔案都存在`);
const html = read("docs/index.html");
const local = [...html.matchAll(/(?:src|href)="((?!https?:|#|data:)[^"]+\.(?:js|css|webmanifest|svg|png))"/g)].map((m) => m[1]);
const notCached = local.filter((f) => !shell.includes(f));
notCached.length ? fail("index.html 用到但沒放進離線快取：" + notCached.join("、") + "（請加進 sw.js 的 SHELL，並把 VERSION 加一）") : ok("index.html 引用的檔案都在快取清單裡");

// 4. 資料檔格式
section("資料檔");
const validCats = Object.fromEntries(Object.entries(w.LAYERS).map(([id, l]) => [id, new Set(l.categories.map((c) => c.id))]));
for (const f of ["docs/data/places.json", "docs/data/chain-discounts.json", "docs/manifest.webmanifest", "capacitor.config.json"]) {
  try { JSON.parse(read(f)); ok(f + " 格式正確"); } catch (e) { fail(`${f}：${e.message}`); }
}
const places = JSON.parse(read("docs/data/places.json"));
places.forEach((x, i) => {
  const where = `places.json 第 ${i + 1} 筆（${x.name || "沒有名稱"}）`;
  if (!validCats[x.layer]) fail(`${where}：layer 必須是 free 或 cheap`);
  else if (!validCats[x.layer].has(x.category)) fail(`${where}：${x.layer} 圖層沒有「${x.category}」這個類別`);
  if (!(x.lat >= -90 && x.lat <= 90 && x.lng >= -180 && x.lng <= 180)) fail(`${where}：座標不合理`);
  if (x.status && !["pending", "approved", "rejected"].includes(x.status)) fail(`${where}：status 不正確`);
  if (x.sponsored && !x.sponsor_until) warn(`${where}：贊助沒有到期日`);
});
if (places.length) ok(`places.json ${places.length} 筆已檢查`);
const chains = JSON.parse(read("docs/data/chain-discounts.json"));
const age = Math.floor((Date.now() - new Date(chains.lastChecked)) / 86400000);
age > 120 ? warn(`超商惜食時段已經 ${age} 天沒確認，請重新查證後更新 lastChecked`) : ok(`超商惜食時段 ${age} 天前確認`);

// 5. CSS 防呆
section("CSS");
/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("docs/css/app.css"))
  ? ok("有 [hidden] 防護規則") : fail("app.css 少了 [hidden] { display: none !important; }，隱藏的對話框會擋住整個畫面 [B1]");

// 6. 原生專案與網頁的設定一致
section("App 設定");
const cap = JSON.parse(read("capacitor.config.json"));
if (exists("android/app/build.gradle")) {
  read("android/app/build.gradle").includes(`"${cap.appId}"`) ? ok("Android 套件 ID 一致") : fail("Android 的 applicationId 和 capacitor.config.json 不一致，請用 scripts/set-app-id.mjs 修改");
  /ACCESS_FINE_LOCATION/.test(read("android/app/src/main/AndroidManifest.xml")) ? ok("Android 有定位權限") : fail("AndroidManifest.xml 少了定位權限");
}
if (exists("ios/App/App/Info.plist")) {
  read("ios/App/App.xcodeproj/project.pbxproj").includes(`PRODUCT_BUNDLE_IDENTIFIER = ${cap.appId};`) ? ok("iOS Bundle ID 一致") : fail("iOS 的 Bundle ID 和 capacitor.config.json 不一致，請用 scripts/set-app-id.mjs 修改");
  /NSLocationWhenInUseUsageDescription/.test(read("ios/App/App/Info.plist")) ? ok("iOS 有定位權限說明") : fail("Info.plist 少了 NSLocationWhenInUseUsageDescription，上架會被退");
}

finish("靜態檢查");
