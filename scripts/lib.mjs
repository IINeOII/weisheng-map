// 檢查腳本共用的小工具：在 Node 裡載入網頁端的設定與類別定義（單一來源，不另外複製一份）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const p = (...a) => path.join(root, ...a);
export const read = (f) => fs.readFileSync(p(f), "utf8");
export const exists = (f) => fs.existsSync(p(f));

/** 執行 docs/js 裡的瀏覽器腳本，取得 window 上的東西 */
export function loadBrowserScripts(...files) {
  const window = {};
  const ctx = vm.createContext({ window, console });
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return window;
}

let failures = 0;
let warnings = 0;
export const ok = (msg) => console.log("  ✔ " + msg);
export const fail = (msg) => { failures++; console.log("  ✘ " + msg); };
export const warn = (msg) => { warnings++; console.log("  ! " + msg); };
export const section = (title) => console.log("\n" + title);
export function finish(name) {
  console.log(`\n${name}：${failures ? `${failures} 項錯誤` : "全部通過"}${warnings ? `，${warnings} 項提醒` : ""}`);
  process.exit(failures ? 1 : 0);
}
