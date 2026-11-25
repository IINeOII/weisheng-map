/**
 * 測試用的假資料與網路攔截
 * 刻意包含容易出錯的邊界情況：沒有名稱的地點、過期資料、贊助店家、分類不明的資料。
 */
import fs from "node:fs";
import { buildTiles } from "../../scripts/build-tiles.mjs";

export const CENTER = { latitude: 25.047, longitude: 121.517 };

const FREE = [
  { type: "node", id: 1, lat: 25.0482, lon: 121.516, tags: { amenity: "drinking_water", name: "台北車站飲水機", opening_hours: "24/7" } },
  { type: "node", id: 2, lat: 25.046, lon: 121.519, tags: { amenity: "social_facility", social_facility: "soup_kitchen", name: "測試供餐點", fee: "no" } },
  { type: "node", id: 3, lat: 25.0471, lon: 121.5141, tags: { amenity: "device_charging_station" } }, // 沒有名稱
  { type: "way", id: 4, center: { lat: 25.049, lon: 121.52 }, tags: { amenity: "social_facility", social_facility: "shelter", "social_facility:for": "homeless", name: "測試庇護中心" } },
  { type: "node", id: 5, lat: 25.045, lon: 121.515, tags: { amenity: "toilets", access: "yes" } }, // 沒有名稱
  { type: "node", id: 6, lat: 25.044, lon: 121.5175, tags: { office: "employment_agency", name: "測試就業服務站" } },
  { type: "node", id: 7, lat: 25.0475, lon: 121.5155, tags: { amenity: "bench" } }, // 不屬於任何類別，應被忽略
];
const CHEAP = [
  { type: "node", id: 11, lat: 25.0475, lon: 121.5165, tags: { shop: "convenience", name: "全家便利商店 測試店", brand: "全家便利商店" } },
  { type: "node", id: 12, lat: 25.0465, lon: 121.518, tags: { shop: "convenience", name: "7-ELEVEN 測試門市" } },
  { type: "node", id: 13, lat: 25.0485, lon: 121.515, tags: { tourism: "hostel", name: "測試青年旅館" } },
  { type: "node", id: 14, lat: 25.0455, lon: 121.516, tags: { shop: "supermarket", name: "全聯福利中心 測試店" } },
];

export const PLACES = [
  { id: "a1", layer: "cheap", category: "meal", name: "測試麵店", lat: 25.0472, lng: 121.5172, item: "陽春麵", price_twd: 45, status: "approved", last_verified: new Date().toISOString().slice(0, 10) },
  { id: "a2", layer: "cheap", category: "meal", name: "測試贊助便當", lat: 25.0468, lng: 121.5158, item: "雞腿便當", price_twd: 85, sponsored: true, sponsor_until: "2099-01-01", status: "approved", last_verified: new Date().toISOString().slice(0, 10) },
  { id: "a3", layer: "free", category: "food", name: "測試待用餐", lat: 25.0478, lng: 121.5185, conditions: "免證件", status: "approved", last_verified: "2020-01-01" }, // 過期
  { id: "a4", layer: "cheap", category: "meal", name: "到期的便當店", lat: 25.0469, lng: 121.5169, sponsored: true, sponsor_until: "2020-01-01", status: "approved" }, // 贊助已到期
  { id: "a5", layer: "free", category: "nope", name: "分類錯誤", lat: 25.047, lng: 121.517, status: "approved" }, // 應被忽略
];

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * 攔截所有對外連線。options:
 *  config: 要覆寫的 APP_CONFIG 欄位
 *  supabase: true 時模擬後端（回報會記錄在 posted 陣列）
 *  dataFails: true 時模擬地點資料完全拿不到
 *  onlyFallback: true 時模擬「同網站沒有資料，只有已發佈網站有」（本機預覽、App 的情況）
 */
export async function mockNetwork(page, options = {}) {
  const posted = [];
  const external = [];
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    external.push(route.request().url());
    route.fulfill({ status: 404, body: "" });
  });
  await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ body: TILE, contentType: "image/png" }));
  // 地點資料：用真正的建置程式（scripts/build-tiles.mjs）把測試資料切成格子檔，測試和正式環境走同一條路
  const files = await tiles();
  const fallbackHost = "iineoii.github.io";
  await page.route("**/data/osm/**", (r) => {
    const url = new URL(r.request().url());
    const isFallback = url.host === fallbackHost;
    if (options.dataFails || (options.onlyFallback && !isFallback)) return r.fulfill({ status: 404, body: "" });
    const rel = url.pathname.split("/data/osm/")[1];
    const data = files.get(rel);
    data ? r.fulfill({ json: data }) : r.fulfill({ status: 404, body: "" });
  });
  await page.route("https://pagead2.googlesyndication.com/**", (r) => r.fulfill({ body: "", contentType: "application/javascript" }));
  await page.route("**/data/places.json", (r) => r.fulfill({ json: PLACES }));
  if (options.supabase) {
    await page.route("https://test.supabase.co/**", async (r) => {
      if (r.request().method() === "POST") { posted.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, body: "" }); }
      r.fulfill({ json: PLACES });
    });
  }
  if (options.config) {
    const base = fs.readFileSync(new URL("../../docs/js/config.js", import.meta.url), "utf8");
    const patch = `\nObject.assign(window.APP_CONFIG, ${JSON.stringify(options.config)});\n`;
    await page.route("**/js/config.js", (r) => r.fulfill({ body: base + patch, contentType: "application/javascript" }));
  }
  return { posted, external };
}

/** 測試資料轉成 extract-osm.py 的輸出格式，再交給正式的建置程式 */
let tilesCache;
export async function tiles() {
  if (!tilesCache) {
    const els = [...FREE, ...CHEAP].map((e) => ({ type: e.type, id: e.id, lat: e.lat ?? e.center.lat, lon: e.lon ?? e.center.lon, tags: e.tags }));
    tilesCache = await buildTiles(els, "2026-11-20T00:00:00Z");
  }
  return tilesCache;
}

/** 模擬 Capacitor 原生環境；呼叫紀錄在 window.__calls */
export function nativeShim(platform) {
  return `
  window.__calls = [];
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "${platform}", Plugins: {
    Geolocation: {
      checkPermissions: async () => ({ location: "prompt", coarseLocation: "prompt" }),
      requestPermissions: async () => { __calls.push("perm"); return { location: "granted", coarseLocation: "granted" }; },
      getCurrentPosition: async () => ({ coords: { latitude: ${CENTER.latitude}, longitude: ${CENTER.longitude} } }),
    },
    AppLauncher: { openUrl: async ({ url }) => { __calls.push("open:" + url); } },
    Share: { share: async (o) => { __calls.push("share:" + o.title); } },
    Network: { addListener: (e, cb) => { window.__net = cb; }, getStatus: async () => ({ connected: true }) },
    App: { addListener: (e, cb) => { window.__back = cb; }, exitApp: () => __calls.push("exit") },
    SystemBars: { setStyle: async (o) => __calls.push("bars:" + o.bar + ":" + o.style) },
    SplashScreen: { hide: async () => __calls.push("splash") },
  } };`;
}

/** 收集頁面錯誤；測試結束時應為空 */
export function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
