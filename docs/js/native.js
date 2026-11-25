/**
 * 原生 App 介接層
 * 在 Android／iOS App 裡改用原生功能；在一般瀏覽器裡自動退回網頁做法。
 * 不需要打包工具：Capacitor 會把已安裝的外掛掛在 window.Capacitor.Plugins 上。
 */
(function () {
  const Cap = window.Capacitor;
  const isApp = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const platform = isApp ? Cap.getPlatform() : "web"; // "android" | "ios" | "web"
  const P = (isApp && Cap.Plugins) || {};

  /** 取得目前位置，回傳 { lat, lng }；失敗時丟出含中文訊息的錯誤 */
  async function getPosition() {
    if (isApp && P.Geolocation) {
      let perm = await P.Geolocation.checkPermissions();
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
        perm = await P.Geolocation.requestPermissions({ permissions: ["location", "coarseLocation"] });
      }
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
        throw new Error("沒有定位權限。可以到手機的「設定」打開，或直接拖曳地圖找。");
      }
      const pos = await P.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("這個瀏覽器不能定位，請直接拖曳地圖。"));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => reject(new Error("沒有取得位置權限，可以直接拖曳地圖找。")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  }

  /** 用系統的瀏覽器或對應 App 開啟網址 */
  async function openExternal(url) {
    if (isApp && P.AppLauncher) {
      try { await P.AppLauncher.openUrl({ url }); return; } catch (e) { /* 改用下面的方式 */ }
    }
    window.open(url, "_blank", "noopener");
  }

  /** 步行導航網址：iPhone 開 Apple 地圖，其他開 Google 地圖 */
  function navigationUrl(lat, lng) {
    if (platform === "ios") return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
  }

  /** 分享；回傳 "shared" | "copied" | "failed" */
  async function share({ title, text, url }) {
    try {
      if (isApp && P.Share) { await P.Share.share({ title, text, url, dialogTitle: "分享這個地點" }); return "shared"; }
      if (navigator.share) { await navigator.share({ title, text, url }); return "shared"; }
    } catch (e) {
      if (e && (e.name === "AbortError" || /cancel/i.test(e.message || ""))) return "cancelled";
    }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); return "copied"; } catch (e) { return "failed"; }
  }

  /** 網路狀態變化：cb(true/false) */
  function onNetworkChange(cb) {
    if (isApp && P.Network) {
      P.Network.addListener("networkStatusChange", (s) => cb(!!s.connected));
      P.Network.getStatus().then((s) => { if (!s.connected) cb(false); }).catch(() => {});
    } else {
      window.addEventListener("online", () => cb(true));
      window.addEventListener("offline", () => cb(false));
    }
  }

  /** Android 返回鍵：handler 回傳 true 代表已處理，否則離開 App */
  function onBackButton(handler) {
    if (!(isApp && P.App)) return;
    P.App.addListener("backButton", () => {
      if (!handler()) P.App.exitApp();
    });
  }

  /** App 啟動完成：關閉啟動畫面、設定系統列顏色 */
  async function ready() {
    if (!isApp) return;
    document.documentElement.classList.add("is-app", "is-" + platform);
    try {
      if (P.SystemBars) {
        await P.SystemBars.setStyle({ style: "DARK", bar: "StatusBar" });     // 上方藍黑底：白色圖示
        await P.SystemBars.setStyle({ style: "LIGHT", bar: "NavigationBar" }); // 下方白底：深色圖示
      }
    } catch (e) { /* 舊版系統不支援就算了 */ }
    try { if (P.SplashScreen) await P.SplashScreen.hide({ fadeOutDuration: 250 }); } catch (e) { /* 略 */ }
  }

  window.Native = { isApp, platform, getPosition, openExternal, navigationUrl, share, onNetworkChange, onBackButton, ready };
})();
