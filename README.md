# 維生地圖

同一套程式碼，產出三個版本：

- **網頁版**：放在 GitHub Pages，免費託管
- **Android App**：上架 Google Play
- **iOS App**：上架 App Store

App 版用 [Capacitor 8](https://capacitorjs.com) 把網頁包成原生 App，並加上這些原生功能：

- 原生定位權限
- 系統分享
- iPhone 用 Apple 地圖導航
- 網路中斷偵測
- Android 返回鍵
- 啟動畫面

## 資料夾

```
docs/                 網頁本體（網頁版與 App 共用；GitHub Pages 從這裡發佈）
  js/config.js        ← 主要設定檔
  js/native.js        App 原生功能介接（瀏覽器裡會自動退回網頁做法）
  privacy.html        隱私權政策（上架必備）
android/              Android Studio 專案
ios/                  Xcode 專案
assets/               App 圖示、啟動畫面、Google Play 主題圖片的原始檔
supabase/schema.sql   回報與贊助店家的資料表
STORE.md              商店文案、資料安全表單答案、審核備註
CLAUDE.md             專案規則與錯誤覆盤
CONSTRAINTS.md        外部限制清單（商店、地圖服務、法規）
tests/                自動化測試
scripts/              檢查、上架關卡、資料覆蓋率、換套件 ID
capacitor.config.json App 名稱、套件 ID、啟動畫面等設定
```

---

## 第 0 步：上架前一定要改的地方

| 檔案 | 要改什麼 | 為什麼 |
|---|---|---|
| `appId`（用下面的指令改） | 換成你自己的反向網域，例如 `org.yourname.weisheng` | 套件 ID 全世界唯一，上架後就不能改 |
| `capacitor.config.json` | `appendUserAgent` 裡的網址換成你的 GitHub 或網站 | 讓地圖服務知道是哪個 App 在使用 |
| `docs/js/config.js` | **`appTileUrl` 填入有金鑰的圖磚服務**（MapTiler、Stadia Maps 等） | OpenStreetMap 官方圖磚禁止 App 大量使用，沒換的話 App 的地圖可能被擋成空白 |
| `docs/js/config.js` | `supabaseUrl`、`supabaseAnonKey` | 開放回報與贊助刊登 |
| `docs/privacy.html` | 聯絡信箱 `privacy@example.org` | 兩個商店都會檢查隱私權政策 |

換 `appId` 不用手動改，執行這一行，就會同時改好 Capacitor、Android 和 iOS 三個地方：

```bash
node scripts/set-app-id.mjs org.yourname.weisheng
```

## 地點資料從哪裡來

使用者打開地圖時，**不會**即時去查第三方伺服器。資料流程是這樣：

1. GitHub Actions 每週一從 Geofabrik 下載 OpenStreetMap 的台灣資料檔
2. `scripts/extract-osm.py` 挑出可能有用的地點
3. `scripts/build-tiles.mjs` 用 `docs/js/categories.js` 分類，切成 0.1 度見方的小檔案
4. 這些檔案跟網站一起發佈到 `…/data/osm/`；App 只載入畫面需要的格子

想改分類規則，只要改 `categories.js`，下次發佈就會生效。地點資料不放進 git，每次發佈時重新建置。

## 在加任何功能之前：先看真實資料夠不夠

**最簡單：不用安裝任何東西。** 到 GitHub 倉庫 → Actions →「發佈網頁版」→ 點最近一次執行 → Summary 頁會列出每個區域、每個類別的數量。

在自己電腦上看也可以，只需要 Node.js 18 以上，不用 `npm install`，會讀已發佈網站上的資料：

```bash
node scripts/coverage.mjs 萬華     # 也可以換成 台北、新北、台中、台南、高雄、wanhua、taipei-station，或 南,西,北,東
```

標「沒有資料」「極少」的類別，使用者打開只會看到空地圖。先把資料補起來（MapComplete、和在地社福團體合作），比做新功能更重要。補進 OpenStreetMap 的資料，下一次每週更新後就會出現在地圖上。

## 測試與檢查

| 指令 | 什麼時候跑 |
|---|---|
| `npm run check` | 隨時（幾秒）：語法、圖示、離線快取清單、資料格式、App 設定一致 |
| `npm test` | 每次改完：靜態檢查，加上網頁版與模擬 App 的瀏覽器測試。第一次先執行 `npx playwright install chromium` |
| `npm run check:release` | 上架前：還沒填的金鑰、信箱、底圖都會被擋下 |

推到 GitHub 後，`.github/workflows/ci.yml` 會自動跑 `npm test`。專案規則和過去錯誤的覆盤在 `CLAUDE.md`；商店、地圖服務、法規等外部限制在 `CONSTRAINTS.md`。

## 在自己電腦上開始（Windows）

需要先安裝 [Git](https://git-scm.com/download/win) 和 [Node.js](https://nodejs.org/)（選 LTS 版）。安裝完後打開「命令提示字元」：

```bat
cd %USERPROFILE%\Documents
git clone https://github.com/IINeOII/weisheng-map.git
cd weisheng-map
npm install
npm run serve
```

最後一行執行後，打開 http://localhost:8080 就能在本機預覽。之後每次都要先 `cd` 進 `weisheng-map` 資料夾，再執行 npm 指令。

## 第 1 步：網頁版上線

網頁版由 `.github/workflows/pages.yml` 自動發佈：每次推到 `main`，GitHub 會先跑完整測試，**全部通過才發佈**。測試沒過，線上版本會維持原樣，不會把壞掉的版本放出去。

第一次設定只需要做一件事：Settings → Pages → Source 選 **GitHub Actions**。

> GitHub 免費帳號只有**公開**倉庫能用 Pages。倉庫是私人的話，三選一：
> - 改成公開。這個專案沒有任何秘密：Supabase 的 anon key 本來就設計成公開
> - 升級 GitHub Pro
> - 改用 Cloudflare Pages 或 Netlify，這兩個都能免費從私人倉庫發佈。發佈資料夾設為 `docs`，建置指令留空

網址會是 `https://你的帳號.github.io/weisheng-map/`，隱私權政策在 `…/privacy.html`。

本機預覽：`npm install` 之後執行 `npm run serve`，打開 http://localhost:8080

## 第 2 步：Android

需要先在電腦上安裝 [Android Studio](https://developer.android.com/studio)，Windows 和 Mac 都可以。

```bash
npm install
npm run android          # 開發用：檢查後同步網頁檔案，打開 Android Studio
npm run release:android  # 正式版：全部測試和上架關卡都通過才會打開
```

1. 在 Android Studio 用 USB 接上手機，或開一台模擬器，按 ▶ 執行
2. 正式版：Build → Generate Signed App Bundle → 建立 keystore
   - **keystore 檔和密碼一定要備份。弄丟了就再也不能更新這個 App。**
3. 到 [Play Console](https://play.google.com/console) 建立 App，上傳 `.aab`
   - 開發者帳號是一次性 25 美元
4. **新的個人帳號要先跑封閉測試**：至少 12 位測試人員、連續 14 天，才能申請正式上架（見 `STORE.md`）

## 第 3 步：iOS

需要一台 Mac，安裝 Xcode，並加入 Apple Developer Program（每年 99 美元）。

```bash
npm install
npm run ios              # 開發用
npm run release:ios      # 正式版：全部測試和上架關卡都通過才會打開
```

1. 在 Xcode 點左側的 App → Signing & Capabilities → Team 選你的開發者帳號
2. 接上 iPhone，按 ▶ 執行測試
3. 正式版：Product → Archive → Distribute App → App Store Connect
4. 到 App Store Connect 填資料（文案在 `STORE.md`），先用 TestFlight 測試，再送審

## 每次改完網頁之後

只要改了 `docs/` 裡的檔案：

- **網頁版**：push 到 GitHub 就會自動更新
- **App 版**：執行 `npx cap sync`，然後在 Android Studio 或 Xcode 重新打包，並把版本號往上加
  - Android：`android/app/build.gradle` 的 `versionCode`、`versionName`
  - iOS：Xcode 裡的 Version、Build

## 權限（已設定好）

- **Android**：`AndroidManifest.xml` 加了 `ACCESS_COARSE_LOCATION`、`ACCESS_FINE_LOCATION`，只在使用時定位，沒有背景定位
- **iOS**：`Info.plist` 加了 `NSLocationWhenInUseUsageDescription`（中文說明）和 `ITSAppUsesNonExemptEncryption = NO`

## 營收在 App 版的差別

| 項目 | 網頁版 | App 版 |
|---|---|---|
| 贊助按鈕 | 顯示 | **隱藏**。Apple 要求贊助開發者必須用 App 內購買，Google Play 只對免稅公益團體開放外部捐款 |
| AdSense | 只在平價好物圖層 | **關閉**。App 的 WebView 不能直接放 AdSense，之後可改接 AdMob 或 Google 的 WebView API for Ads |
| 店家刊登、企業合作 | 有 | 有。店家在 App 外跟你簽約付款，不受商店抽成規範 |
| 營運透明度 | 有 | 有 |

## 圖示與啟動畫面

原始檔在 `assets/`。要更換的話，替換以下檔案後執行 `npm run assets`：

- `icon-only.png`（1024 × 1024）
- `icon-foreground.png`
- `icon-background.png`
- `splash.png`（2732 × 2732）

## 其他

- 視覺系統、資料來源、Supabase 設定的說明都和網頁版相同，顏色與字級變數在 `docs/css/app.css` 最上方
- 地圖資料 © OpenStreetMap 貢獻者，ODbL 授權
- 字體：Chiron GoRound TC、Barlow Condensed（SIL OFL）；圖示：Lucide（ISC）
