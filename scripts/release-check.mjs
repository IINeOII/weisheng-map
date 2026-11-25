#!/usr/bin/env node
/**
 * 上架關卡：把 README「第 0 步」的手動清單變成自動檢查。
 * 任何一項沒做到就失敗，避免把測試用設定送去商店審核。
 * 用法：npm run check:release
 */
import { read, exists, loadBrowserScripts, ok, fail, warn, section, finish } from "./lib.mjs";

const cap = JSON.parse(read("capacitor.config.json"));
const CFG = loadBrowserScripts("docs/js/config.js").APP_CONFIG;

section("App 身分");
cap.appId === "tw.weisheng.map"
  ? warn("套件 ID 還是預設的 tw.weisheng.map。確認你擁有這個網域，或用 node scripts/set-app-id.mjs 換成自己的（上架後不能改）")
  : ok("套件 ID：" + cap.appId);
/YOUR_ACCOUNT/.test(cap.appendUserAgent || "") ? fail("capacitor.config.json 的 appendUserAgent 還有 YOUR_ACCOUNT，請換成你的網址") : ok("User-Agent 已設定");

section("外部服務（會影響 App 能不能用）");
CFG.appTileUrl
  ? (/tile\.openstreetmap\.org/.test(CFG.appTileUrl) ? fail("appTileUrl 不能用 OSM 官方圖磚（App 大量使用違反其政策）") : ok("App 底圖：" + new URL(CFG.appTileUrl.replace(/\{[a-z]\}/g, "0")).host))
  : fail("config.js 的 appTileUrl 是空的：App 會用 OSM 官方圖磚，可能被擋成空白地圖。請申請 MapTiler 或 Stadia Maps 金鑰");
CFG.supabaseUrl && CFG.supabaseAnonKey ? ok("回報後端已設定") : fail("config.js 沒有設定 Supabase：使用者無法回報，平價餐食與贊助也不會有資料");
const places = JSON.parse(read("docs/data/places.json"));
if (!CFG.supabaseUrl && places.length === 0) fail("沒有後端，places.json 也是空的：平價餐食圖層會是空的");

section("隱私權與聯絡");
/example\.org/.test(read("docs/privacy.html")) ? fail("privacy.html 的聯絡信箱還是 example.org") : ok("隱私權政策聯絡方式已填");
CFG.partnerEmail || CFG.partnerFormUrl ? ok("店家合作窗口已設定") : warn("沒有店家合作窗口：App 版的主要收入（店家刊登）沒有入口");
CFG.feedbackUrl ? ok("資料錯誤回報管道已設定") : warn("沒有 feedbackUrl：使用者發現資料錯了沒地方說");

section("商店資料");
const stars = (read("STORE.md").match(/★/g) || []).length;
stars ? warn(`STORE.md 還有 ${stars} 個 ★ 待填項目（隱私權網址、支援網址等）`) : ok("STORE.md 待填項目都處理了");

section("版本號（每次送審都要比上次大）");
if (exists("android/app/build.gradle")) {
  const g = read("android/app/build.gradle");
  console.log(`  · Android versionCode ${g.match(/versionCode (\d+)/)?.[1]}，versionName ${g.match(/versionName "([^"]+)"/)?.[1]}`);
}

finish("上架關卡");
