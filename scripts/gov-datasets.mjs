// 政府開放資料集清單：要匯入哪些、每一筆怎麼對應到地圖上的類別。
import { loadBrowserScripts } from "./lib.mjs";
const W = loadBrowserScripts("docs/js/categories.js");

// 新增資料集前先用 scripts/probe-gov.mjs 看真實欄位（CLAUDE.md 規則 1、R7），授權見 CONSTRAINTS.md C14。
//
// map(row) 回傳一個或多個地點：
//   { category, name, address, lat?, lng?, phone?, opening?, conditions? }
// 座標沒有的話留空，由 import-gov.mjs 用「同地址的其他資料」「OSM 的地址或名稱」「sources/coords.csv」補上。

const pick = (row, ...keys) => { for (const k of keys) if (row[k]) return String(row[k]).trim(); return ""; };
const oneLine = (s, max = 90) => {
  const t = String(s || "").replace(/\s*[\r\n]+\s*/g, "；").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};
const phone = (s) => oneLine(String(s || "").replace(/^電話[:：]\s*/, ""), 40);

const FOOD_BANK = "實物銀行：通常要先經社工評估或持相關證明才能領取，出發前請先打電話詢問。";
const JOBS = "公立就業服務：找工作、職業訓練、失業給付都可以來問，免費。";
const SOCIAL = "社會福利服務中心：遇到急難、經濟困難、沒有地方住，都可以來找社工，請先打電話。";
// 只服務特定年齡或身分的就業據點：一般人去了用不到（規則 9），在各資料集的 map 裡略過
const NOT_GENERAL_JOBS = /銀髮|身心障礙|個案管理/;
const timeOf = (...parts) => oneLine(parts.filter(Boolean).join(" "), 60);

export const DATASETS = [
  {
    id: "121332", city: "臺北市", short: "臺北市愛心餐食補給站",
    map: (r) => ({
      category: "food", name: `臺北市${r["機構名稱"]}`, address: r["地址"], lat: r["緯度"], lng: r["經度"], phone: r["電話"],
      conditions: "愛心餐食補給站：急需餐食可以來這裡詢問，請先打電話確認領取方式。",
    }),
  },
  {
    id: "135279", city: "臺北市", short: "臺北市政府實物銀行",
    // 只收社福中心：其他是平宅、學校、中途之家等內部發放點，一般人去了也領不到（另見排除規則）
    map: (r) => (/社會福利服務中心$/.test(r["機構名稱"]) ? {
      category: "food", name: `臺北市${r["機構名稱"]}`, address: r["地址"], conditions: FOOD_BANK,
    } : null),
  },
  {
    id: "121330", city: "臺北市", short: "臺北市街友中途之家暨盥洗服務據點",
    map: (r) => {
      const base = { name: r["服務單位名稱"], address: r["地址"], phone: r["電話"] };
      const out = [{ ...base, category: "hygiene", opening: oneLine(r["盥洗時間"]), conditions: "提供街友盥洗（洗澡）服務，第一次去可以先打電話問。" }];
      if (/中途之家/.test(r["類型"])) out.push({ ...base, category: "shelter", conditions: "街友中途之家：需要先經社工評估、轉介才能入住，請先打電話或到社福中心詢問。" });
      return out;
    },
  },
  {
    id: "83868", city: "臺中市", short: "臺中市實(食)物銀行",
    map: (r) => ({
      category: "food", name: r["辦理單位"], address: r["地址"], lat: r["Y坐標"], lng: r["X坐標"], phone: r["連絡電話"],
      opening: oneLine(r["服務時間"], 60), conditions: r["服務對象"] ? `服務對象：${oneLine(r["服務對象"])}` : FOOD_BANK,
    }),
  },
  {
    id: "91950", city: "臺中市", short: "臺中市食物銀行聯盟店",
    map: (r) => ({
      category: "food", name: r["單位名稱"], address: r["地址"], lat: r["Y坐標"], lng: r["X坐標"], phone: r["連絡電話"],
      opening: oneLine(r["服務時間"], 60), conditions: r["服務對象"] ? `服務對象：${oneLine(r["服務對象"])}` : FOOD_BANK,
    }),
  },
  {
    id: "171101", city: "嘉義市", short: "嘉義市實(食)物銀行服務據點",
    map: (r) => ({
      category: "food", name: `嘉義市實物銀行（${r["服務區域"] || ""}）`.replace("（）", ""), address: r["地址"],
      lat: r["緯度"], lng: r["經度"], phone: r["聯絡電話"], opening: oneLine(r["服務時間"], 60),
      conditions: `${FOOD_BANK}辦理單位：${r["辦理單位"]}`,
    }),
  },
  {
    id: "125392", city: "新北市", short: "新北市政府實物銀行社福中心分行及領用站",
    map: (r) => {
      const area = r.area || "";
      const addr = String(r.address || "");
      return {
        category: "food", name: /^新北市/.test(r.title) ? r.title : `新北市${r.title}`,
        address: `${r.county || "新北市"}${addr.startsWith(area) ? "" : area}${addr}`, phone: r.localcallservice,
        conditions: /公所/.test(r.title) ? `實物銀行領用站：${FOOD_BANK.replace("實物銀行：", "")}` : FOOD_BANK,
      };
    },
  },
  {
    id: "147413", city: "桃園市", short: "桃園市安家實物銀行服務據點",
    map: (r) => ({
      category: "food", name: pick(r, "單位/機構名稱"), address: pick(r, "單位/機構地址"), phone: phone(pick(r, "電話")),
      opening: oneLine(pick(r, "開放物資領取時間"), 60), conditions: FOOD_BANK,
    }),
  },

  // ── 2026-11-26 新增（probe 結果見 SOP.md 的流程；欄位照 GitHub Actions 實際下載的檔案）──
  {
    // 「現在餓了」能直接去的少數來源：下班時間和假日不用先找社工（桃園市社會局網站 sab.tycg.gov.tw/cp.aspx?n=7363，2026-11-26 查證）
    id: "147521", city: "桃園市", short: "桃園市安心點愛心餐食合作店家",
    map: (r) => ({
      category: "food", name: pick(r, "店名"), address: pick(r, "店面地址", "地址"),
      conditions: "桃園市「安心點」愛心餐食店家：平常要先到各區家庭服務中心找社工評估、拿到點數才能兌換。下班時間或假日臨時急需用餐，可以到有營業的愛心店家兌換一次餐點（每人每年最多 3 次）。",
    }),
  },
  {
    id: "95723", city: "嘉義市", short: "嘉義市愛心待用店家",
    map: (r) => ({
      category: "food", name: pick(r, "辦理單位"), address: pick(r, "地址"), lat: r["緯度"], lng: r["經度"], phone: phone(pick(r, "連絡電話")),
      conditions: "愛心待用店家：通常要先由社工或社福單位轉介、拿到餐券，請先打電話問店家或嘉義市政府社會處。",
    }),
  },
  {
    // 2017–2018 年的清單，之後停止更新：明白寫出來，讓人知道可能已撤除（規則：寧可說清楚，不要讓人白跑）
    id: "28592", city: "全國", short: "中央機關免費手機充電站（2017–2018）",
    map: (r) => ({
      category: "charge", name: pick(r, "充電站名稱"), address: pick(r, "地址"), lat: r["緯度"], lng: r["經度"],
      conditions: "免費手機充電站：設在郵局、戶政事務所、車站等洽公場所，只有開放時間能用。這份清單是 2017–2018 年的，之後沒有更新，可能已經撤除。",
    }),
  },
  {
    id: "121331", city: "臺北市", short: "臺北市社會福利服務中心",
    map: (r) => ({ category: "social", name: `臺北市${pick(r, "機構名稱")}`, address: pick(r, "地址"), phone: pick(r, "電話"), conditions: SOCIAL }),
  },
  {
    id: "169060", city: "新北市", short: "新北市街友外展服務中心",
    map: (r) => ({
      category: "social", name: pick(r, "title"), address: `${r.county || "新北市"}${r.town || ""}${r.address || ""}`, phone: pick(r, "localcallservice"),
      conditions: "街友外展服務：需要找住處、餐食、就業或就醫協助，可以打電話請社工協助。",
    }),
  },
  {
    id: "133048", city: "臺北市", short: "臺北市就業服務處",
    map: (r) => (NOT_GENERAL_JOBS.test(r["名稱"]) ? null : {
      category: "jobs", name: /^臺北市/.test(r["名稱"]) ? r["名稱"] : `臺北市${r["名稱"]}`, address: pick(r, "地址"), phone: pick(r, "電話"), conditions: JOBS,
    }),
  },
  {
    id: "83682", city: "臺中市", short: "臺中市政府就業服務據點",
    map: (r) => (NOT_GENERAL_JOBS.test(r["據點名稱"]) ? null : {
      category: "jobs", name: `臺中市${pick(r, "據點名稱")}`.replace(/^臺中市臺中市/, "臺中市"), address: pick(r, "地址"),
      lat: r["空間位置-緯度"], lng: r["空間位置-經度"], phone: pick(r, "連絡電話"), opening: oneLine(pick(r, "服務時間"), 60), conditions: JOBS,
    }),
  },
  {
    id: "53473", city: "臺南市", short: "臺南市就業服務據點",
    map: (r) => (NOT_GENERAL_JOBS.test(r["站名"]) ? null : {
      category: "jobs", name: pick(r, "站名"), address: pick(r, "機構地址"), lat: r["緯度"], lng: r["經度"], phone: pick(r, "電話"),
      opening: timeOf(r["開放日"], r["開放時間"]), conditions: JOBS,
    }),
  },
  {
    id: "63250", city: "嘉義市", short: "嘉義市就業服務據點",
    map: (r) => (NOT_GENERAL_JOBS.test(r["據點名稱"]) ? null : {
      category: "jobs", name: pick(r, "據點名稱"), address: pick(r, "地址"), lat: r["緯度"], lng: r["經度"], phone: pick(r, "連絡電話"),
      opening: oneLine(pick(r, "服務時間"), 60), conditions: JOBS,
    }),
  },
  {
    id: "159504", city: "花蓮縣", short: "花蓮縣就業服務據點",
    map: (r) => (NOT_GENERAL_JOBS.test(r["據點名稱"]) ? null : {
      category: "jobs", name: pick(r, "據點名稱"), address: pick(r, "地址"), lat: r["Y坐標"], lng: r["X坐標"], phone: pick(r, "連絡電話"),
      opening: oneLine(pick(r, "服務時間"), 60), conditions: JOBS,
    }),
  },
];

/**
 * 不放上地圖的地點（不論來自哪個資料集）：
 * - 家暴、性侵、婦女庇護相關：地點需要保密，公開標示可能讓加害人找上門
 * - 只服務特定個案（「限…個案」）、學校、平宅：一般人去了領不到，白跑一趟
 */
export const EXCLUDE = [
  [W.SENSITIVE_NAME, "家暴與婦女庇護相關，地點需要保密"],
  [/限[^）)]*個案|更生保護|觀護人/, "只服務特定個案"],
  [/國小|國中|高中|學校/, "學校內部發放"],
  [/平宅/, "平宅住戶內部發放"],
];

export const exclusionReason = (name) => { for (const [re, why] of EXCLUDE) if (re.test(name || "")) return why; return null; };
