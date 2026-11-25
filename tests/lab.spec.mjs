/**
 * 底圖比較頁（docs/lab/basemap.html）：給擁有者在手機上比較三種底圖用。
 * 測試環境不連外，所以只驗證切換、位置保留和「載入失敗」的畫面；真實速度與清晰度見 scripts/measure-load.mjs。
 */
import { test, expect } from "@playwright/test";

test.describe("底圖比較頁", () => {
  test.skip(({ isMobile }) => !isMobile, "給手機看的頁面");

  test.beforeEach(async ({ page }) => {
    // 外部底圖一律連不上：模擬離線或服務掛掉
    await page.route(/tile\.openstreetmap\.org|wmts\.nlsc\.gov\.tw|openfreemap\.org/, (r) => r.abort());
  });

  for (const [id, name] of [["osm", "現在的地圖"], ["nlsc", "國土測繪中心"], ["ofm", "OpenFreeMap"]]) {
    test(`${name}：底圖下載不到時說清楚，不會顯示「載完」`, async ({ page }) => {
      await page.goto(`/lab/basemap.html?map=${id}`);
      const info = page.locator("#info");
      await expect(info).toContainText("底圖載入失敗", { timeout: 15000 });
      await expect(info).not.toContainText("載完");
      await expect(page.getByRole("navigation", { name: "切換底圖" }).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    });
  }

  test("切換底圖時保留目前看的位置", async ({ page }) => {
    await page.goto("/lab/basemap.html?map=osm&lat=25.1&lng=121.6&z=16");
    await expect(page.getByRole("navigation", { name: "切換底圖" }).getByRole("link", { name: "國土測繪中心" })).toHaveAttribute("href", "?map=nlsc&lat=25.1&lng=121.6&z=16");
  });
});
