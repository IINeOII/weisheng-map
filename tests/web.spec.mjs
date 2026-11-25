/**
 * 網頁版回歸測試
 * 每個 test 標題後面的 [B#] 對應 CLAUDE.md「覆盤」裡發生過的 Bug，確保同一個錯誤不會再出現。
 * 選擇器規則：只用 id、role、aria、data-* 屬性，不用樣式 class（改設計時 class 會變）。
 */
import { test, expect } from "@playwright/test";
import { mockNetwork, collectErrors, CENTER } from "./fixtures/mock.mjs";

test.use({ geolocation: CENTER, permissions: ["geolocation"] });

const app = (page, expr) => page.evaluate(expr);
const openApp = async (page, hash = "") => {
  await page.goto("/index.html" + hash);
  await expect(page.locator("#peek button").first()).toBeVisible();
};

test("首次載入：顯示免費資源、忽略未知分類、沒有錯誤", async ({ page }) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await openApp(page);
  // 6 筆 OSM（長椅被忽略）＋ 1 筆自有資料（分類錯誤那筆被忽略）
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBe(7);
  await expect(page.locator("body")).toHaveAttribute("data-layer", "free");
  expect(errors).toEqual([]);
});

test("網址 #cheap 直接打開平價好物，#free 打開免費資源 [B3]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page, "#cheap");
  await expect(page.locator("body")).toHaveAttribute("data-layer", "cheap");
  await expect.poll(() => app(page, "window.__app.state.places.cheap.size")).toBeGreaterThan(0);
  await openApp(page, "#free");
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBeGreaterThan(0);
});

test("隱藏的對話框和選單不會擋住地圖點擊 [B1]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  for (const sel of ["#modal", "#menu", "#target", "#toast"]) {
    await expect(page.locator(sel)).toBeHidden();
  }
  const hit = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 3);
    return el.closest("#modal, #menu") ? "blocked" : "ok";
  });
  expect(hit).toBe("ok");
});

test("浮動按鈕不會被下方面板蓋住 [B6]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  const fab = await page.locator("#locateBtn").boundingBox();
  const sheet = await page.locator("#sheet").boundingBox();
  const overlap = fab.x < sheet.x + sheet.width && fab.x + fab.width > sheet.x && fab.y < sheet.y + sheet.height && fab.y + fab.height > sheet.y;
  expect(overlap).toBe(false);
});

test("打開地點後，背景資料更新不會把詳細資料關掉 [B2]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await page.locator("#peek button").first().click();
  await expect(page.locator("#sheet")).toHaveAttribute("data-state", "detail");
  await page.evaluate(() => window.__app.map.panBy([40, 40], { animate: false }));
  await page.waitForTimeout(900); // 等資料重新載入
  await expect(page.locator("#sheet")).toHaveAttribute("data-state", "detail");
  await expect(page.locator("#detail h2")).toBeVisible();
});

test("沒有名稱的地點不會重複顯示類別名稱 [B7]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "window.__app.state.places.free.has('osm:node/3')")).toBe(true);
  await page.evaluate(() => window.__app.showDetail(window.__app.state.places.free.get("osm:node/3")));
  await expect(page.locator("#detail h2")).toHaveText("充電");
  await expect(page.locator("#detail")).toContainText("沒有標示名稱");
});

test("贊助店家只出現一次，過期的贊助不再標示 [B7]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page, "#cheap");
  await page.locator("#openList").click();
  await expect(page.locator("#promoSlot")).toContainText("測試贊助便當");
  await expect(page.locator("#plist")).not.toContainText("測試贊助便當");
  const expired = page.locator("#plist li", { hasText: "到期的便當店" });
  await expect(expired).toBeVisible();
  await expect(expired.getByText("贊助", { exact: true })).toHaveCount(0);
  await expect(page.locator("#plist").getByText("贊助", { exact: true })).toHaveCount(0);
});

test("廣告只出現在平價好物，免費資源連廣告程式都不載入", async ({ page }) => {
  await mockNetwork(page, { config: { adsenseClient: "ca-pub-TEST", adsenseSlot: "1" } });
  await openApp(page);
  await page.locator("#openList").click();
  await expect.poll(() => page.locator("#plist button").count()).toBeGreaterThanOrEqual(5); // 前提成立才檢查「沒有」
  await expect(page.locator("ins.adsbygoogle")).toHaveCount(0);
  expect(await page.locator("script[src*=googlesyndication]").count()).toBe(0);
  await page.getByRole("tab", { name: /平價好物/ }).click();
  await page.locator("#openList").click();
  await expect(page.locator("ins.adsbygoogle")).toHaveCount(1);
  await page.getByRole("tab", { name: /免費資源/ }).click();
  await page.locator("#openList").click();
  await expect(page.locator("#plist ins.adsbygoogle")).toHaveCount(0);
});

test("回報：名稱必填，送出的資料一律是待審、非贊助", async ({ page }) => {
  const net = await mockNetwork(page, { supabase: true, config: { supabaseUrl: "https://test.supabase.co", supabaseAnonKey: "k" } });
  await openApp(page);
  await page.locator("#addBtn").click();
  await page.locator("#pickOk").click();
  await page.getByRole("button", { name: "送出回報" }).click();
  expect(net.posted).toHaveLength(0);
  await page.locator("#f-name").fill("新的供餐點");
  await page.getByRole("button", { name: "送出回報" }).click();
  await expect(page.locator("#modalBody")).toContainText("已送出回報");
  expect(net.posted).toHaveLength(1);
  expect(net.posted[0]).toMatchObject({ name: "新的供餐點", status: "pending", sponsored: false });
});

test("沒有後端時，回報改成一般人看得懂的文字讓人複製 [B7]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await page.locator("#addBtn").click();
  await page.locator("#pickOk").click();
  await page.locator("#f-name").fill("新的供餐點");
  await page.getByRole("button", { name: "送出回報" }).click();
  const text = await page.locator("#reportResult pre").innerText();
  expect(text).toContain("名稱：新的供餐點");
  expect(text).not.toContain("{");
});

test("網頁版：有設定贊助管道時顯示；成本未填時不顯示 0%", async ({ page }) => {
  await mockNetwork(page, { config: { supportLinks: [{ label: "單次贊助", url: "https://example.org/pay" }] } });
  await openApp(page);
  await page.evaluate(() => window.__app.openModal("support"));
  await expect(page.getByRole("link", { name: "單次贊助" })).toBeVisible();
  await expect(page.locator("#modalBody")).not.toContainText("0%");
});

test("地點資料拿不到時，告訴使用者發生什麼事", async ({ page }) => {
  await mockNetwork(page, { dataFails: true });
  await page.goto("/index.html");
  await expect(page.locator("#toast")).toContainText("載入失敗");
});

test("同網站沒有資料時（本機預覽、App），改從已發佈的網站載入", async ({ page }) => {
  await mockNetwork(page, { onlyFallback: true });
  await openApp(page);
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBe(7);
});

test("關於頁顯示地點資料的日期", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "!!window.__app.state.dataInfo")).toBe(true);
  await page.evaluate(() => window.__app.openModal("about"));
  await expect(page.locator("#modalBody")).toContainText("地點資料更新於 2026-11-20");
});
