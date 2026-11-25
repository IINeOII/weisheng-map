# 外部限制清單

這個專案好幾次「先做完才發現不能這樣做」：
- App 內的贊助按鈕
- App 內的 AdSense
- App 用 OSM 官方圖磚
- 在 Claude 預覽頁裡載不到地圖

這份清單記錄所有**不是我們能決定**的規則。動手做新功能之前先查這裡；查不到就先去查證，再補進來。

規則：每一條都要寫明**來源**、**查證日期**，以及**程式裡在哪裡落實**。超過 6 個月的條目，下次碰到相關功能時要重新查證。

| # | 限制 | 影響 | 程式裡怎麼處理 | 來源 | 查證日期 |
|---|---|---|---|---|---|
| C1 | Apple 要求「給開發者小費或贊助」必須用 App 內購買（審核準則 3.1.1） | iOS App 不能放外部贊助連結 | `app.js` 的 `supportView()`，App 模式下不顯示；`tests/native.spec.mjs` 有測試 | Apple 開發者論壇審核回覆 thread/744611 | 2026-11-24 |
| C2 | Google Play 付款政策：外部捐款只限可驗證的免稅團體 | Android App 不能放外部贊助連結 | 同 C1 | Play Console 政策通知（AnkiDroid 案例） | 2026-11-24 |
| C3 | 在 App 的 WebView 裡放 AdSense，必須用 Google 的 WebView API for Ads 等指定整合方式 | App 版暫不放廣告 | `app.js` 的 `insertAd()`，App 模式直接返回；有測試 | AdSense 計畫政策（support.google.com/admob/answer/48182） | 2026-11-24 |
| C4 | OSM 官方圖磚：App 必須送出能辨識的 User-Agent；發佈 App 大量使用須事先取得許可 | App 必須改用有金鑰的圖磚服務 | `config.js` 的 `appTileUrl`；`release-check.mjs` 沒填就擋下 | operations.osmfoundation.org/policies/tiles | 2026-11-24 |
| C5 | Google Play 個人帳號（2023/11/13 後建立）要先跑封閉測試：12 人、連續 14 天 | 正式上架至少多 3 週 | 流程面，記錄在 `STORE.md` | Play Console 說明 answer/14151465 | 2026-11-24 |
| C6 | 《公益勸募條例》：只有公立學校、行政法人、公益社團法人、財團法人能公益勸募 | 個人名義只能寫「贊助開發營運」，不能寫「捐款救助弱勢」 | `supportView()` 的文案；`config.js` 註解 | 法律百科 QA/1160（非法律意見） | 2026-11-13 |
| C7 | Capacitor 8 在 Android 用 CSS 變數 `--safe-area-inset-*` 提供安全區域 | 版面不能只用 `env(safe-area-inset-*)` | `app.css` 的 `--sa-*` 變數 | Capacitor 8 SystemBars 文件 | 2026-11-24 |
| C8 | iOS 必須提供 `NSLocationWhenInUseUsageDescription`，否則一要求定位就閃退或被退件 | — | `Info.plist`；`check.mjs` 會檢查 | Apple 文件 | 2026-11-24 |
| C9 | Claude 預覽頁（artifact）禁止連外部網站、遠端圖片、定位、Service Worker | 地圖 App 無法在 Claude 裡預覽 | 一律在本機或 GitHub Pages 測試 | artifact 頁面規範 | 2026-11-13 |
| C11 | GitHub 免費帳號只有**公開**倉庫能用 GitHub Pages；私人倉庫要 GitHub Pro 或改用其他託管 | 倉庫維持私人就無法發佈網頁版 | `pages.yml` 註解；README 第 1 步 | docs.github.com「GitHub's plans」 | 2026-11-25 |
| C12 | Overpass 公共伺服器嚴重超載，會封鎖大量使用的 IP；官方手冊說給一般大眾用的 App 不該以公共伺服器當後端，應改用資料檔 | 不能在使用者打開 App 時即時查 Overpass | 改為每週由 GitHub Actions 下載資料檔、預先建好靜態格子檔（`scripts/build-tiles.mjs`），App 只讀自家網站 | Overpass API 使用手冊；OSM 社群「Overpass API performance issues」討論串；2026-11-25 從 GitHub Actions 實測全部失敗 | 2026-11-25 |
| C13 | Geofabrik 每日提供台灣資料檔（已移除個人資料），ODbL 授權；請使用者負責任地下載，不要重複下載同一個檔案 | 衍生的格子檔也必須以 ODbL 提供並註明出處 | `pages.yml` 以「週」為單位快取，一週最多下載一次；`build-tiles.mjs` 輸出 LICENSE.txt；App 有 OSM 出處 | download.geofabrik.de、Geofabrik 部落格「Download responsibly」 | 2026-11-25 |
| C10 | 開發環境（Claude 的工作區）連不到 Overpass、OSM 圖磚、Android SDK | Claude 只能用假資料測試，真實資料與打包必須在你的電腦上跑 | `npm run coverage`、`npm run release:android` | 實測 | 2026-11-25 |

## 尚未查證、但未來功能會碰到的

- **推播通知**：iOS 網頁版需要使用者先把網站加入主畫面才能收推播；App 版需要申請推播憑證。
- **個資法**：若要讓店家或社福團體登入後台維護資料，會開始保存帳號資料，隱私權政策與資料安全表單要一起更新。
- **使用者產生內容**：Apple 準則 1.2 要求 UGC 要有檢舉與封鎖機制。目前回報全部先審核再公開；若改成直接公開，就要補這些機制。
