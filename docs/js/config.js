/**
 * 維生系統地圖 — 設定檔
 * 上線前只需要改這個檔案。沒填的功能會自動關閉，App 仍可運作。
 */
window.APP_CONFIG = {
  appName: "維生地圖",

  // 預設地圖中心（台北車站）與縮放
  defaultCenter: [25.0478, 121.5170],
  defaultZoom: 15,
  // 低於這個縮放等級不載入地點（避免一次抓太大範圍）
  minQueryZoom: 13,

  // 底圖：2026-11-26 決定網頁版先用 OSM 官方圖磚（免費、已在用）；有穩定收入後再評估 Google 地圖（CONSTRAINTS.md C18）。
  // OSM 官方圖磚只適合小流量，流量明顯變大時要換（比較頁 lab/basemap.html，選項見 C19、C20）
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者',

  // ── 手機 App 專用底圖（上架前必填）──
  // OSM 官方圖磚禁止「發佈 App 大量使用」，App 版必須改用有 API 金鑰的圖磚服務，例如：
  //   MapTiler：  "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=你的金鑰"
  //   Stadia Maps："https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key=你的金鑰"
  // 留空時 App 會暫時沿用上面的 tileUrl，只適合自己測試。
  appTileUrl: "",
  appTileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者',

  // 地點資料（由 GitHub Actions 每週從 OpenStreetMap 台灣資料檔產生，見 scripts/build-tiles.mjs）
  // 先找同一個網站底下的 data/osm；找不到（例如本機預覽、App）就改用已發佈的網站
  dataUrl: "data/osm",
  dataFallbackUrl: "https://iineoii.github.io/weisheng-map/data/osm",
  // 已下載的地點在手機上保留多久（毫秒）；資料每週更新一次
  cacheTtlMs: 3 * 24 * 60 * 60 * 1000,

  // ── 群眾回報 / 平價優惠 / 贊助店家後端（Supabase，免費方案即可）──
  // 留空 = 只讀取 data/deals.json，回報表單改為「複製內容」
  supabaseUrl: "",
  supabaseAnonKey: "",

  // ── 營收 ──
  // Google AdSense：留空就不載入任何廣告。
  // 依設計原則，廣告「只會」出現在平價圖層，免費資源圖層永遠無廣告。
  adsenseClient: "",      // 例："ca-pub-1234567890123456"
  adsenseSlot: "",        // 例："1234567890"

  // 贊助管道（任何一個留空就不顯示）
  // 注意：個人名義請用「贊助本工具開發營運」，不要寫成「捐款救助弱勢」（見設計文件的法規說明）
  supportLinks: [
    // { label: "單次贊助（綠界）", url: "https://..." },
    // { label: "每月支持（Buy Me a Coffee）", url: "https://..." },
  ],

  // 營運透明度（贊助頁顯示，每月手動更新）
  transparency: {
    month: "2026-11",
    monthlyCostTwd: 0,      // 網域、伺服器、圖磚等支出
    monthlyIncomeTwd: 0,    // 廣告 + 贊助 + 店家合作
    note: "目前由開發者自費維運。",
  },

  // 店家合作 / 刊登洽詢
  partnerEmail: "",        // 例："hello@example.org"
  partnerFormUrl: "",      // 例：Google 表單網址

  // 資料錯誤回報（可放 Google 表單或 GitHub Issues 網址）
  feedbackUrl: "",
};
