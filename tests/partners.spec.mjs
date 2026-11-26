/**
 * 合作團體資料（scripts/partners.mjs、add-partners.mjs、import-gov.mjs 的合作團體部分）
 * 測試檔 tests/fixtures/partners/ 全部虛構，模擬從 Claude Sheets「合作資源表」下載的 CSV。
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { parsePartnerCsv, mapPartnerRow, toPartnerCsv, leaks, toDate, PUBLIC_COLUMNS } from "../scripts/partners.mjs";
import { mergePartners } from "../scripts/add-partners.mjs";
import { importGov, report } from "../scripts/import-gov.mjs";
import { decode } from "../scripts/gov-lib.mjs";

const SHEET = "tests/fixtures/partners/sheet-download.csv";
const sheetText = () => fs.readFileSync(SHEET, "utf8");

test.describe("合作團體資料", () => {
  test.skip(({ isMobile }) => isMobile, "和畫面尺寸無關，只跑一次");

  test("讀得懂從試算表下載的 CSV：跳過標題列、民國年、需要先聯絡寫進條件", () => {
    const { rows, problems } = parsePartnerCsv(sheetText());
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(5);
    const first = mapPartnerRow(rows[0]);
    expect(first).toMatchObject({ ok: true, place: { category: "food", verified: "2026-11-20", website: "https://example.org", org: "測試協會" } });
    expect(first.place.conditions).toBe("不用先登記，直接去就可以。不用證件，一人一份，送完為止。");
    expect(mapPartnerRow(rows[4]).place).toMatchObject({ verified: "2026-11-01", conditions: expect.stringMatching(/^請先打電話確認/) });
    expect(toDate("2026/12/1")).toBe("2026-12-01");
    expect(toDate("下週")).toBe("");
    expect(toDate("2026-02-30")).toBe("");
  });

  test("不公開地址、類別填錯、缺必填的列不上地圖，並說出原因", () => {
    const { rows } = parsePartnerCsv(sheetText());
    expect(mapPartnerRow(rows[2])).toEqual({ ok: false, why: "地址不公開" });
    expect(mapPartnerRow(rows[3]).why).toContain("類別「吃的」不認得");
    expect(mapPartnerRow({ ...rows[0], 確認日期: "" }).why).toContain("缺少確認日期");
  });

  test("匯入到公開倉庫前，拿掉不公開的列和備註欄；同一個團體整批取代、其他團體不動", () => {
    const old = [
      { 提供團體: "測試協會", 地點名稱: "已經收掉的舊據點", 公開地址: "是" },
      { 提供團體: "別的團體", 地點名稱: "別人的據點", 公開地址: "是" },
    ];
    const r = mergePartners(old, [sheetText()]);
    expect(r.hiddenDropped).toBe(1);
    expect(r.rejected.map((x) => x.name)).toEqual(["類別填錯的地點"]);
    expect(r.rows.map((x) => x["地點名稱"])).toEqual(["別人的據點", "測試共食餐桌", "測試澡堂", "測試物資發放"]);
    const csv = toPartnerCsv(r.rows);
    expect(csv).not.toContain("祕密路");
    expect(csv).not.toContain("備註");
    expect(csv).not.toContain("冬天會加開週六");
    const back = parsePartnerCsv(decode(Buffer.from(csv)).text);
    expect(back.headers).toEqual(PUBLIC_COLUMNS);
    expect(leaks(back)).toEqual([]);
  });

  test("靜態檢查會擋：直接把試算表下載檔放進倉庫（有不公開地址和備註）", () => {
    const problems = leaks(parsePartnerCsv(sheetText()));
    expect(problems.join("\n")).toMatch(/備註（不公開）/);
    expect(problems.join("\n")).toMatch(/1 列「公開地址」不是「是」/);
  });

  test("匯入地圖：顯示團體與確認日期；不公開的地點連名稱都不出現在公開報告", async () => {
    const r = await importGov({ datasets: [], manualFile: "tests/fixtures/gov/coords.csv", partnersFile: SHEET });
    const names = r.places.map((x) => x.p.n);
    expect(names).toEqual(expect.arrayContaining(["測試共食餐桌", "測試澡堂", "測試物資發放"]));
    const meal = r.places.find((x) => x.p.n === "測試共食餐桌").p;
    expect(meal).toMatchObject({ c: "food", v: "2026-11-20", w: "https://example.org", a: 25.0462 });
    expect(r.sources[meal.g[0]]).toMatchObject({ kind: "partner", name: "測試協會", rows: 4, places: 2, updated: "2026-11-20" });
    const text = report(r);
    expect(text).not.toContain("測試女性中途之家");
    expect(text).toContain("（不公開的地點）（地址不公開）");
    expect(text).toMatch(/\| 測試協會 \| 4 \| 2 \| 2026-11-20/);
  });
});
