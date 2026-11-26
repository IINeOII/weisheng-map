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

test("政府開放資料的地點：顯示取用條件、時間和出處；關於頁列出資料集", async ({ page }) => {
  await mockNetwork(page, { gov: true });
  await openApp(page);
  const id = "gov:121332-0";
  await expect.poll(() => app(page, `window.__app.state.places.free.has("${id}")`)).toBe(true);
  await page.evaluate((id) => window.__app.showDetail(window.__app.state.places.free.get(id)), id);
  const d = page.locator("#detail");
  await expect(d.getByRole("heading", { name: "臺北市中正社會福利服務中心" })).toBeVisible();
  await expect(d).toContainText("實物銀行：通常要先經社工評估");
  await expect(d).toContainText("愛心餐食補給站");
  const note = d.locator('[data-source="gov"]');
  await expect(note.getByRole("link", { name: "臺北市愛心餐食補給站" })).toHaveAttribute("href", "https://data.gov.tw/dataset/121332");
  await expect(note.getByRole("link", { name: "臺北市政府實物銀行" })).toBeVisible();
  await expect(d.getByRole("link", { name: /修正資料/ })).toHaveCount(0); // 不是 OSM 的資料，不能叫人去 OSM 改

  await page.evaluate(() => window.__app.openModal("about"));
  const about = page.locator('#modalBody [data-source="gov"]');
  await expect(about).toContainText("政府資料開放授權條款");
  await expect(about.getByRole("link", { name: "臺北市街友中途之家暨盥洗服務據點" })).toBeVisible();
});

test("沒有政府資料時，關於頁不顯示空的政府資料來源", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "!!window.__app.state.dataInfo")).toBe(true);
  await page.evaluate(() => window.__app.openModal("about"));
  await expect(page.locator("#modalBody")).toContainText("OpenStreetMap");
  await expect(page.locator('#modalBody [data-source="gov"]')).toHaveCount(0);
});

test("啟動時地點資料不等超商惜食時段資料：那份資料很慢，地點照樣先出來 [B8]", async ({ page }) => {
  await mockNetwork(page);
  let release;
  const held = new Promise((r) => (release = r));
  await page.route("**/data/chain-discounts.json", async (route) => { await held; await route.continue(); });
  await openApp(page);
  // 惜食時段資料還卡著，免費資源的地點已經載入
  await expect.poll(() => app(page, "window.__app.state.places.free.size"), { timeout: 4000 }).toBe(7);
  expect(await app(page, "window.__app.state.chains")).toBeNull();
  release();
  await expect.poll(() => app(page, "!!window.__app.state.chains")).toBe(true);
});

test("首次載入不下載中文網頁字型（約 2.8 MB，會拖住底圖和地點資料）[B9]", async ({ page }) => {
  const fonts = [];
  page.on("request", (r) => { if (/\.woff2?(\?|$)/.test(r.url())) fonts.push(r.url()); });
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBe(7); // 先確認畫面真的載完（規則 13）
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.filter((u) => !/barlow-condensed/.test(u))).toEqual([]);
});

// ── 狀態機（docs/js/machines.js，清單見 STATE_MACHINES.md）──

test("回報選點時：點到標記、拉面板不會跳走；切換圖層會收起十字準星 [B10]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBe(7);
  const body = page.locator("body"), target = page.locator("#target");
  await page.locator("#addBtn").click();
  await expect(body).toHaveAttribute("data-sheet", "pick");
  await expect(target).toBeVisible();
  await page.evaluate(() => window.__app.showDetail(window.__app.state.places.free.get("osm:node/1"))); // 等於點到標記
  await expect(body).toHaveAttribute("data-sheet", "pick");
  await page.locator("#grab").click();
  await expect(body).toHaveAttribute("data-sheet", "pick");
  await expect(target).toBeVisible();
  await page.getByRole("tab", { name: /平價好物/ }).click();
  await expect(body).toHaveAttribute("data-sheet", "peek");
  await expect(target).toBeHidden();
  // 回報流程本身照常：選點 → 對準 → 表單，準星收起
  await page.locator("#addBtn").click();
  await page.locator("#pickOk").click();
  await expect(page.locator("#reportForm")).toBeVisible();
  await expect(target).toBeHidden();
});

test("地點資料載入失敗時，空清單說「載入失敗」，不說「這附近還沒有資料」[B11]", async ({ page }) => {
  await mockNetwork(page, { dataFails: true });
  await page.route("**/data/places.json", (r) => r.fulfill({ status: 503, body: "" })); // 真的斷線時，自有資料也拿不到
  await page.goto("/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-load", "failed");
  await expect(page.locator("#peek")).toContainText("暫時載入失敗");
  await expect(page.locator("#peek")).not.toContainText("還沒有資料");
  await expect(page.locator("#toast")).toContainText("載入失敗");
});

test("地圖縮太小時，空清單請使用者放大，而不是說沒有資料", async ({ page }) => {
  await mockNetwork(page, { config: { defaultZoom: 10 } });
  await page.route("**/data/places.json", (r) => r.fulfill({ json: [] }));
  await page.goto("/index.html");
  await expect(page.locator("body")).toHaveAttribute("data-load", "zoomedOut");
  await expect(page.locator("#peek")).toContainText("放大地圖");
});

test("長按類別：只顯示那一類，放開後不會又切換，提示也不會被資料載入收掉 [B12]", async ({ page }) => {
  await mockNetwork(page);
  await openApp(page);
  await expect.poll(() => app(page, "window.__app.state.places.free.size")).toBe(7);
  const chip = page.locator("#chips button", { hasText: "飲水" });
  await chip.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator("#toast")).toContainText("只顯示飲水");
  await expect.poll(() => app(page, "[...window.__app.state.active.free]")).toEqual(["water"]);
  // 移動地圖觸發資料載入，載完後提示還在
  await page.evaluate(() => window.__app.map.panBy([30, 0], { animate: false }));
  await page.waitForTimeout(1000); // 等 0.45 秒的延遲載入跑完
  await expect(page.locator("body")).toHaveAttribute("data-load", "ready");
  // 要檢查「看得到」：收起的提示文字還留在元素裡，只檢查文字會假性通過（反向驗證時發現）
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("只顯示飲水");
  await expect.poll(() => app(page, "[...window.__app.state.active.free]")).toEqual(["water"]);
});

test("定位時連按不會重複要求位置；找到後按鈕顯示已定位", async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (ok, no, o) => { window.__geoCalls++; setTimeout(() => real(ok, no, o), 400); };
  });
  await mockNetwork(page);
  await openApp(page);
  const btn = page.locator("#locateBtn");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-busy", "true");
  await btn.click();
  await btn.click();
  await expect(page.locator("body")).toHaveAttribute("data-locate", "located");
  await expect(btn).toHaveAttribute("aria-busy", "false");
  expect(await app(page, "window.__geoCalls")).toBe(1);
  expect(await app(page, "window.__app.machines")).toMatchObject({ sheet: "peek", locate: "located" });
});

test("狀態機的動作沒有實作時，啟動就在主控台報錯（不會默默沒反應）", async ({ page }) => {
  const errors = collectErrors(page);
  await mockNetwork(page);
  await openApp(page);
  expect(errors).toEqual([]); // 正式的實作都齊全
  await page.evaluate(() => window.startMachine("sheet", { actions: {} }));
  expect(errors.join("\n")).toMatch(/狀態機 sheet.*showTarget/);
});

test("合作團體提供的地點：寫出團體與確認日期，超過 60 天提醒可能已變動；關於頁列出團體", async ({ page }) => {
  await mockNetwork(page, { gov: true });
  await openApp(page);
  const find = (name) => page.evaluate((n) => [...window.__app.state.places.free.values()].find((p) => p.name === n)?.id, name);
  await expect.poll(() => find("測試共食餐桌")).toBeTruthy();
  const show = async (name) => page.evaluate((id) => window.__app.showDetail(window.__app.state.places.free.get(id)), await find(name));
  const d = page.locator("#detail");

  await show("測試共食餐桌");
  await expect(d.locator('[data-source="partner"]')).toBeVisible();
  await expect(d.locator('[data-source="partner"]')).toContainText(/由測試協會提供，.*確認過/);
  await expect(d).toContainText("不用先登記，直接去就可以");
  await expect(d.getByRole("link", { name: /網站/ })).toHaveAttribute("href", "https://example.org");

  await show("測試澡堂"); // 確認日期 2020-01-01
  await expect(d.locator('[data-source="partner"]')).toContainText("可能已經變動");

  // 不公開地址的地點不會出現在地圖上
  expect(await find("測試女性中途之家")).toBeUndefined();

  await page.evaluate(() => window.__app.openModal("about"));
  const about = page.locator('#modalBody [data-source="partner"]');
  await expect(about).toBeVisible();
  await expect(about.getByRole("link", { name: "測試協會" })).toHaveAttribute("href", "https://example.org");
  await expect(about).toContainText("第二測試團體");
});
