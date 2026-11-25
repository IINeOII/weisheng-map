#!/usr/bin/env node
/**
 * 一次更換 App 的套件 ID（Android applicationId 與 iOS Bundle ID）
 * 用法：node scripts/set-app-id.mjs org.yourname.weisheng
 */
import fs from "node:fs";
import path from "node:path";

const next = process.argv[2];
if (!next || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$/.test(next)) {
  console.error("請提供合法的套件 ID，例如：node scripts/set-app-id.mjs org.yourname.weisheng");
  console.error("規則：全小寫英文、數字、底線，用點分隔，至少兩段，每段以英文字母開頭。");
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (...a) => path.join(root, ...a);
const read = (f) => fs.readFileSync(p(f), "utf8");
const write = (f, s) => fs.writeFileSync(p(f), s);

const cfg = JSON.parse(read("capacitor.config.json"));
const prev = cfg.appId;
if (prev === next) { console.log("套件 ID 已經是 " + next); process.exit(0); }
const esc = prev.replace(/\./g, "\\.");

// 1. Capacitor 設定
cfg.appId = next;
write("capacitor.config.json", JSON.stringify(cfg, null, 2) + "\n");

// 2. Android：build.gradle、strings.xml、MainActivity 套件路徑
if (fs.existsSync(p("android"))) {
  write("android/app/build.gradle", read("android/app/build.gradle").replace(new RegExp(`"${esc}"`, "g"), `"${next}"`));
  const strings = "android/app/src/main/res/values/strings.xml";
  write(strings, read(strings).replace(new RegExp(`>${esc}<`, "g"), `>${next}<`));
  const javaRoot = p("android/app/src/main/java");
  const oldDir = path.join(javaRoot, ...prev.split("."));
  const newDir = path.join(javaRoot, ...next.split("."));
  const main = path.join(oldDir, "MainActivity.java");
  if (fs.existsSync(main)) {
    const src = fs.readFileSync(main, "utf8").replace(new RegExp(`^package ${esc};`, "m"), `package ${next};`);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "MainActivity.java"), src);
    fs.rmSync(main);
    // 清掉空的舊資料夾
    let d = oldDir;
    while (d !== javaRoot && fs.existsSync(d) && fs.readdirSync(d).length === 0) { fs.rmdirSync(d); d = path.dirname(d); }
  }
  console.log("✔ Android 已更新");
}

// 3. iOS：Xcode 專案的 Bundle ID
const pbx = "ios/App/App.xcodeproj/project.pbxproj";
if (fs.existsSync(p(pbx))) {
  write(pbx, read(pbx).replace(new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${esc};`, "g"), `PRODUCT_BUNDLE_IDENTIFIER = ${next};`));
  console.log("✔ iOS 已更新");
}

console.log(`完成：${prev} → ${next}`);
console.log("接著執行 npx cap sync");
