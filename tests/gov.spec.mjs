/**
 * 政府開放資料匯入測試（scripts/import-gov.mjs）
 * 測試檔 tests/fixtures/gov/ 的欄位結構照抄 2026-11-25 實際下載的檔案，內容是假的，刻意放了邊界情況。
 * 真實資料是否正確，要看 GitHub Actions「發佈網頁版」Summary 頁的「政府開放資料匯入」表格。
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importGov, report, addrKey } from "../scripts/import-gov.mjs";
import { DATASETS } from "../scripts/gov-datasets.mjs";
import { twd97ToWgs84, decode, cleanAddress } from "../scripts/gov-lib.mjs";
import { buildTiles, cellKey } from "../scripts/build-tiles.mjs";

const FIX = "tests/fixtures/gov";
const run = (opts = {}) => importGov({ offline: FIX, lookupFile: `${FIX}/osm-lookup.ndjson`, manualFile: `${FIX}/coords.csv`, partnersFile: null, ...opts });
const byName = (r, name, cat) => r.places.map((x) => x.p).find((p) => p.n === name && (!cat || p.c === cat));

test.describe("政府開放資料", () => {
  test.skip(({ isMobile }) => isMobile, "和畫面尺寸無關，只跑一次");

  test("座標：WGS84、經緯度寫反、TWD97 都轉成正確位置", async () => {
    const r = await run();
    expect(byName(r, "臺北市中正社會福利服務中心", "food")).toMatchObject({ a: 25.03292, o: 121.50775 });
    expect(byName(r, "臺北市大同社會福利服務中心")).toMatchObject({ a: 25.06606, o: 121.515119 }); // 原始資料經緯度寫反
    const tc = byName(r, "臺中市愛心食物銀行(大里店)");
    expect(tc.a).toBeCloseTo(24.1067, 3); // TWD97 → WGS84
    expect(tc.o).toBeCloseTo(120.698, 3);
    const [lat, lng] = twd97ToWgs84(302050, 2770950); // 台北車站附近
    expect(lat).toBeCloseTo(25.0458, 3);
    expect(lng).toBeCloseTo(121.5158, 3);
  });

  test("家暴與婦女庇護、只服務特定個案、學校內部發放的地點不上地圖", async () => {
    const r = await run();
    const names = r.places.map((x) => x.p.n).join("|");
    expect(names).not.toMatch(/婦女|國小|限.*個案|法扶/);
    expect(r.excluded.map((x) => x.why)).toContain("只服務特定個案");
    // 同一條規則也套在 OSM 資料（categories.js），見 data.spec.mjs
  });

  test("同一個地點在兩個資料集都有：合併成一筆，條件都保留、來源都列出", async () => {
    const r = await run();
    const p = byName(r, "臺北市中正社會福利服務中心", "food");
    expect(p.g).toEqual(["121332", "135279"]);
    expect(p.e).toContain("愛心餐食");
    expect(p.e).toContain("實物銀行");
    expect(r.places.filter((x) => x.p.c === "food" && x.p.d === p.d)).toHaveLength(1);
  });

  test("沒有座標的資料：依序用同地址的資料、人工座標、OSM 地址、OSM 名稱補上", async () => {
    const r = await run();
    expect(byName(r, "臺北市中正社會福利服務中心", "hygiene")).toMatchObject({ a: 25.03292, h: expect.stringContaining("週一至週五") }); // 同地址
    expect(byName(r, "社團法人台灣芒草心慈善協會淋浴服務據點-香香澡堂")).toMatchObject({ a: 25.0339, o: 121.4995 }); // sources/coords.csv
    expect(byName(r, "新北市土城社會福利服務中心")).toMatchObject({ a: 24.9823 }); // OSM 地址：排除高雄、雙溪區的同名路
    expect(byName(r, "新北市板橋區公所")).toMatchObject({ a: 25.0128 }); // OSM 名稱
    expect(r.how).toMatchObject({ 資料集座標: 5, 同地址的其他資料: 2, 人工確認: 1, "OSM 地址": 1, "OSM 同名地點": 1 });
  });

  test("地址比對一定要對上同一個區：沒標區、或別區的同名道路都不採用", async () => {
    const r = await run();
    // 板橋區公所的地址在對照表裡只有一筆沒標區的，不採用；改由「OSM 同名地點」找到
    expect(byName(r, "新北市板橋區公所")).toMatchObject({ a: 25.0128 });
    expect(byName(r, "新北市土城社會福利服務中心").a).not.toBeCloseTo(25.03, 2);
  });

  test("找不到可靠座標就不放上地圖、不猜位置，列在報告裡等人補", async () => {
    const r = await run();
    expect(byName(r, "廣安居")).toBeUndefined(); // OSM 有兩個同名地點，距離很遠
    expect(r.unresolved.map((u) => u.name)).toEqual(["臺北市沒有座標中心", "廣安居", "桃園家庭服務中心"]); // 同一地點只列一次
    const md = report(r);
    expect(md).toContain("待補座標：3 筆");
    expect(md).toContain("sources/coords.csv");
    expect(md).toContain("https://data.gov.tw/dataset/121330");
    expect(r.sources["135279"].places).toBe(1); // 合併進別筆的也要算，才會標示出處
  });

  test("嘉義市：地址和時間裡的換行整理成一行", async () => {
    const r = await run();
    const p = byName(r, "嘉義市實物銀行（西區）");
    expect(p).toMatchObject({ d: "嘉義市西區玉康路160號", h: "週一至週五8:00~12:00；週六8:00~12:00", a: 23.47204 });
    expect(p.e).toContain("測試基金會");
  });

  test("中途之家另外標成「住所」，並寫清楚要先轉介", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-gov-"));
    fs.writeFileSync(path.join(dir, "coords.csv"), "地址,緯度,經度\n臺北市大同區歸綏街205號4樓,25.0581,121.5133\n");
    const r = await run({ manualFile: path.join(dir, "coords.csv") });
    expect(byName(r, "廣安居", "hygiene")).toBeTruthy();
    expect(byName(r, "廣安居", "shelter").e).toContain("轉介");
  });

  test("Big5 編碼的檔案（桃園市）正確解碼，電話去掉「電話:」", async () => {
    expect(decode(fs.readFileSync(`${FIX}/147413.csv`)).encoding).toBe("big5");
    const r = await run({ manualFile: path.join(FIX, "coords.csv") });
    expect(r.unresolved.find((u) => u.source === "147413").name).toBe("桃園家庭服務中心");
    const row = DATASETS.find((d) => d.id === "147413").map({ "單位/機構名稱": "甲", "單位/機構地址": "乙", 電話: "電話:03-1234567" });
    expect(row.phone).toBe("03-1234567");
  });

  test("地址寫法統一：全形數字、樓層、鄰里、之幾號", () => {
    expect(cleanAddress("新北市板橋區漢生東路２５８號三樓")).toBe("新北市板橋區漢生東路258號");
    expect(cleanAddress("臺中市大里區立仁里3鄰甲興路100號")).toBe("臺中市大里區甲興路100號");
    expect(cleanAddress("嘉義市西區玉康路160號\n(再耕園1樓)")).toBe("嘉義市西區玉康路160號");
    expect(addrKey("臺中市北區崇德路一段631號之2")).toBe(addrKey("臺中市北區崇德路一段631之2號"));
  });

  test("某個資料集下載失敗：改用上次的快取，並在報告中說明", async () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-cache-"));
    const ds = DATASETS.filter((d) => d.id === "121332");
    fs.writeFileSync(path.join(cache, "121332.json"), JSON.stringify({
      savedAt: "2026-11-18T00:00:00Z", meta: { title: "快取", updated: "" },
      rows: [{ 機構名稱: "快取中心", 地址: "臺北市中正區快取路1號", 經度: "121.5", 緯度: "25.04" }],
    }));
    process.env.GOV_API_BASE = "http://127.0.0.1:9"; // 連不上
    try {
      const r = await importGov({ cache, datasets: ds, manualFile: path.join(cache, "none.csv"), partnersFile: null });
      expect(r.sources["121332"].status).toContain("改用 2026-11-18");
      expect(r.places.map((x) => x.p.n)).toEqual(["臺北市快取中心"]);
      const none = await importGov({ datasets: ds, manualFile: path.join(cache, "none.csv"), partnersFile: null });
      expect(none.sources["121332"].status).toContain("下載失敗");
      expect(none.places).toHaveLength(0);
    } finally { delete process.env.GOV_API_BASE; }
  });

  test("和 OSM 資料一起切格子，索引記錄出處", async () => {
    const gov = await run();
    const files = await buildTiles([], "2026-11-20T00:00:00Z", gov);
    const index = files.get("index.json");
    expect(index.gov.sources["121332"]).toMatchObject({ name: "臺北市愛心餐食補給站", url: "https://data.gov.tw/dataset/121332" });
    expect(index.gov.sources["147413"]).toBeUndefined(); // 沒有任何一筆放上地圖的資料集不列（桃園的測試資料都沒有座標）
    const cell = files.get(`free/${cellKey(25.03292, 121.50775)}.json`);
    expect(cell.find((p) => p.i === "g121332-0").g).toEqual(["121332", "135279"]);
    expect(index.totals.free.food).toBe(gov.places.filter((x) => x.p.c === "food").length);
  });
});

test.describe("政府開放資料：2026-11-26 新增的資料集（充電、待用餐、社福、就業）", () => {
  test.skip(({ isMobile }) => isMobile, "和畫面尺寸無關，只跑一次");
  const MORE = "tests/fixtures/gov-more";
  const run2 = () => importGov({ offline: MORE, lookupFile: `${MORE}/osm-lookup.ndjson`, manualFile: `${FIX}/coords.csv`, partnersFile: null });
  const all = (r, cat) => r.places.map((x) => x.p).filter((p) => !cat || p.c === cat);

  test("免費手機充電站：去掉郵遞區號、同一個車站的多個充電點合併、寫明資料可能過期", async () => {
    const r = await run2();
    expect(byName(r, "臺中市西屯區戶政事務所", "charge")).toMatchObject({ a: 24.165784, o: 120.633595, d: "臺中市西屯區市政北二路386號" });
    expect(all(r, "charge").filter((p) => p.d === "雲林縣斗六市民生路187號")).toHaveLength(1);
    expect(all(r, "charge")).toHaveLength(4);
    for (const p of all(r, "charge")) expect(p.e).toContain("2017–2018");
  });

  test("桃園安心點與嘉義市待用店家：寫清楚什麼時候可以直接去、什麼時候要先找社工", async () => {
    const r = await run2();
    expect(byName(r, "麒麟美食吧")).toMatchObject({ c: "food", a: 24.9381, e: expect.stringContaining("每人每年最多 3 次") }); // OSM 地址
    expect(r.unresolved.map((u) => u.name)).toEqual(expect.arrayContaining(["美吉寶早餐店", "台鋼漢堡王桃園八德店"])); // 找不到座標就不猜
    expect(byName(r, "早安美芝城德安店")).toMatchObject({ c: "food", a: 23.48392, e: expect.stringContaining("轉介") });
  });

  test("就業服務站：只收一般人都能用的；各縣市的座標欄位、TWD97、郵遞區號都處理好", async () => {
    const r = await run2();
    const names = all(r, "jobs").map((p) => p.n);
    expect(names).toContain("臺北市艋舺就業服務站");
    expect(byName(r, "臺北市艋舺就業服務站")).toMatchObject({ a: 25.0352, d: "臺北市萬華區艋舺大道101號" });
    expect(names.join("|")).not.toMatch(/銀髮|個案管理/); // 只服務長者或個案的據點不放（規則 9）
    expect(names).toContain("嘉義就業中心");
    expect(byName(r, "臺中市豐原就業服務站").a).toBeCloseTo(24.2466, 3); // 欄位叫「空間位置-緯度」
    expect(byName(r, "玉里就業服務站").a).toBeCloseTo(23.33, 1); // TWD97
    expect(byName(r, "臺南市政府勞工局職訓就服中心").h).toContain("星期一至星期五");
  });

  test("社福中心與街友外展：放在社福服務類別，出處都標示", async () => {
    const r = await run2();
    expect(byName(r, "臺北市中山社會福利服務中心")).toMatchObject({ c: "social", g: ["121331"] });
    expect(r.unresolved.map((u) => u.address)).toContain("新北市板橋區富山街8、10號");
    for (const p of r.places.map((x) => x.p)) expect(p.g.length).toBeGreaterThan(0);
    for (const id of ["28592", "147521", "95723", "133048", "83682", "53473", "63250", "159504", "121331"]) expect(r.sources[id].places).toBeGreaterThan(0);
  });
});
