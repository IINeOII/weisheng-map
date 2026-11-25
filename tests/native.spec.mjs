/**
 * App 版行為測試（模擬 Capacitor 原生環境，不需要真的手機）
 * 驗證商店規範相關的行為：App 內不顯示贊助按鈕、不放 AdSense。
 * 注意：這只驗證「網頁程式在 App 模式下的分支」，真機上的權限彈窗、打包設定仍要在手機上測一次。
 */
import { test, expect } from "@playwright/test";
import { mockNetwork, nativeShim, collectErrors } from "./fixtures/mock.mjs";

for (const platform of ["ios", "android"]) {
  test.describe(`App 模式：${platform}`, () => {
    test.skip(({ isMobile }) => !isMobile, "只在手機尺寸跑");

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(nativeShim(platform));
      await mockNetwork(page, { config: { adsenseClient: "ca-pub-TEST", adsenseSlot: "1", supportLinks: [{ label: "贊助", url: "https://example.org/pay" }] } });
      await page.goto("/index.html");
      await expect(page.locator("#peek button").first()).toBeVisible();
    });

    test("啟動：關閉啟動畫面、設定系統列、不註冊 Service Worker", async ({ page }) => {
      await expect(page.locator("html")).toHaveClass(new RegExp(`is-${platform}`));
      const calls = await page.evaluate("window.__calls");
      expect(calls).toEqual(expect.arrayContaining(["splash", "bars:StatusBar:DARK", "bars:NavigationBar:LIGHT"]));
      expect(await page.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")).toBe(0);
    });

    test("定位走原生權限，導航開對應平台的地圖", async ({ page }) => {
      await page.locator("#locateBtn").click();
      await expect.poll(() => page.evaluate("!!window.__app.state.userPos")).toBe(true);
      await page.locator("#peek button").first().click();
      await page.locator('[data-track="navigate"]').click();
      const calls = await page.evaluate("window.__calls");
      expect(calls).toContain("perm");
      const nav = calls.find((c) => c.startsWith("open:"));
      expect(nav).toContain(platform === "ios" ? "maps.apple.com" : "google.com/maps");
    });

    test("分享走系統分享面板", async ({ page }) => {
      await page.locator("#peek button").first().click();
      await page.locator("#shareBtn").click();
      expect((await page.evaluate("window.__calls")).some((c) => c.startsWith("share:"))).toBe(true);
    });

    test("返回鍵由內而外：對話框 → 詳細資料 → 離開 App", async ({ page }) => {
      await page.locator("#peek button").first().click();
      await page.evaluate(() => window.__app.openModal("about"));
      await page.evaluate("window.__back()");
      await expect(page.locator("#modal")).toBeHidden();
      await expect(page.locator("#sheet")).toHaveAttribute("data-state", "detail");
      await page.evaluate("window.__back()");
      await expect(page.locator("#sheet")).toHaveAttribute("data-state", "peek");
      await page.evaluate("window.__back()");
      expect(await page.evaluate("window.__calls")).toContain("exit");
    });

    test("商店規範：App 內沒有贊助按鈕、沒有 AdSense", async ({ page }) => {
      await page.evaluate(() => window.__app.openModal("support"));
      await expect(page.locator("[data-track=donate_click]")).toHaveCount(0);
      await expect(page.locator("#modalBody")).not.toContainText("收據");
      await page.locator("#modalClose").click();
      await page.getByRole("tab", { name: /平價好物/ }).click();
      await page.locator("#openList").click();
      // 先確認清單已載滿（網頁版在第 5 筆後就會插廣告），否則「沒有廣告」會因為資料還沒來而假性通過
      await expect.poll(() => page.locator("#plist button").count()).toBeGreaterThanOrEqual(5);
      await expect(page.locator("ins.adsbygoogle")).toHaveCount(0);
      expect(await page.locator("script[src*=googlesyndication]").count()).toBe(0);
    });

    test("斷網時提示使用者", async ({ page }) => {
      await page.evaluate("window.__net(false)");
      await expect(page.locator("#toast")).toContainText("沒有網路");
    });

    test("外部連結交給系統開啟，不在 App 裡跳頁", async ({ page }) => {
      const errors = collectErrors(page);
      await page.evaluate(() => window.__app.openModal("about"));
      await page.locator("#modalBody").getByRole("link", { name: "OpenStreetMap" }).click();
      expect((await page.evaluate("window.__calls")).some((c) => c.includes("openstreetmap.org/copyright"))).toBe(true);
      expect(page.url()).toContain("/index.html");
      expect(errors).toEqual([]);
    });
  });
}
