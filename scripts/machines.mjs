#!/usr/bin/env node
/**
 * 狀態機文件與檢查（定義的唯一來源是 docs/js/machines.js）
 *
 *   node scripts/machines.mjs          更新 STATE_MACHINES.md 裡「自動產生」的段落（狀態圖與轉換表）
 *   node scripts/machines.mjs --check  只檢查，不寫檔（npm run check 會呼叫）
 *
 * 檢查項目：
 *   - 轉換的目標狀態都存在、每個狀態都從初始狀態走得到
 *   - app.js 送出的事件（M.xxx.send("EVENT") 或 { type: "EVENT" }）每個都有狀態會處理（打錯字的事件會默默沒反應）
 *   - STATE_MACHINES.md 是最新的
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrowserScripts, read, p } from "./lib.mjs";

const W = loadBrowserScripts("docs/js/machines.js");
const DOC = "STATE_MACHINES.md";
const START = "<!-- 自動產生：開始（node scripts/machines.mjs） -->";
const END = "<!-- 自動產生：結束 -->";

/** 回傳問題清單（空陣列代表沒問題） */
export function problems() {
  const out = [];
  for (const [id, def] of Object.entries(W.MACHINES)) {
    const states = Object.keys(def.states);
    if (!def.states[def.initial]) out.push(`${id}：初始狀態「${def.initial}」不存在`);
    const { targets } = W.machineNames(def);
    for (const t of targets) if (!def.states[t]) out.push(`${id}：轉換到不存在的狀態「${t}」`);
    // 從初始狀態走得到哪些狀態
    const seen = new Set([def.initial]), queue = [def.initial];
    while (queue.length) {
      const s = def.states[queue.shift()];
      for (const t of Object.values(s?.on || {})) for (const tr of [].concat(t)) {
        const to = typeof tr === "string" ? tr : tr.target;
        if (to && !seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    for (const s of states) if (!seen.has(s)) out.push(`${id}：狀態「${s}」從初始狀態走不到`);
  }
  // app.js 送出的事件
  const app = read("docs/js/app.js");
  for (const m of app.matchAll(/M\.(\w+)\.send\(\s*(?:"([A-Z_]+)"|\{\s*type:\s*"([A-Z_]+)")/g)) {
    const [, id, a, b] = m;
    const ev = a || b;
    const def = W.MACHINES[id];
    if (!def) { out.push(`app.js 送事件給不存在的狀態機「${id}」`); continue; }
    if (!W.machineNames(def).events.has(ev)) out.push(`app.js 送出「${id}.${ev}」，但沒有任何狀態會處理這個事件（打錯字？）`);
  }
  for (const m of app.matchAll(/M\.(\w+)\.can\(\s*"([A-Z_]+)"/g)) {
    const def = W.MACHINES[m[1]];
    if (def && !W.machineNames(def).events.has(m[2])) out.push(`app.js 檢查「${m[1]}.${m[2]}」，但沒有這個事件`);
  }
  return out;
}

/** 產生 Markdown：每個狀態機一張 Mermaid 狀態圖加一張轉換表 */
export function generate() {
  const parts = [];
  for (const [id, def] of Object.entries(W.MACHINES)) {
    const lines = ["```mermaid", "stateDiagram-v2", `  [*] --> ${def.initial}`];
    const rows = ["| 狀態 | 事件 | 到 | 動作 |", "|---|---|---|---|"];
    for (const [name, s] of Object.entries(def.states)) {
      const enter = [].concat(s.entry || []), exit = [].concat(s.exit || []);
      if (enter.length || exit.length) rows.push(`| ${name} | （進入／離開） | | ${[...enter.map((a) => "進入：" + a), ...exit.map((a) => "離開：" + a)].join("、")} |`);
      for (const [ev, t] of Object.entries(s.on || {})) {
        for (const tr of [].concat(t)) {
          const o = typeof tr === "string" ? { target: tr } : tr;
          const label = ev + (o.cond ? ` [${o.cond}]` : "");
          lines.push(`  ${name} --> ${o.target}: ${label}`);
          rows.push(`| ${name} | ${label} | ${o.target} | ${[].concat(o.actions || []).join("、")} |`);
        }
      }
    }
    lines.push("```");
    parts.push(`### ${id}（初始：${def.initial}）`, "", ...lines, "", ...rows, "");
  }
  return parts.join("\n");
}

function render(current) {
  const i = current.indexOf(START), j = current.indexOf(END);
  if (i < 0 || j < 0) throw new Error(`${DOC} 找不到自動產生段落的標記`);
  return current.slice(0, i + START.length) + "\n\n" + generate() + "\n" + current.slice(j);
}

export function docIsCurrent() {
  const cur = read(DOC).replace(/\r\n/g, "\n");
  return render(cur) === cur;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const list = problems();
  for (const x of list) console.log("  ✘ " + x);
  if (process.argv.includes("--check")) {
    if (!docIsCurrent()) { console.log(`  ✘ ${DOC} 不是最新的：執行 node scripts/machines.mjs 更新`); process.exit(1); }
    process.exit(list.length ? 1 : 0);
  }
  fs.writeFileSync(p(DOC), render(read(DOC).replace(/\r\n/g, "\n")));
  console.log(`已更新 ${DOC}${list.length ? `（另有 ${list.length} 個問題）` : ""}`);
  process.exit(list.length ? 1 : 0);
}
