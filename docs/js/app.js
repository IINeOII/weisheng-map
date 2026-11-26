/* 維生地圖 — 主程式 */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG;
  const LAYERS = window.LAYERS;
  const $ = (s, r = document) => r.querySelector(s);
  const ic = window.icon;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hydrateIcons = (root = document) => root.querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = ic(el.dataset.icon, +(el.dataset.size || 22));
  });

  // ── 狀態 ──
  // 資料放在 state；「現在處在哪個畫面／階段」由狀態機管（machines.js），見下方 M
  const state = {
    layer: "free",
    active: {},
    places: { free: new Map(), cheap: new Map() },
    userPos: null,
    selected: null,
    chains: null,
    adsLoaded: false,
    get sheet() { return M.sheet.state; }, // 舊程式與測試相容：唯讀
  };
  const M = {}; // 狀態機：sheet（下方面板）、load（地點資料）、locate（定位）
  for (const id of Object.keys(LAYERS)) state.active[id] = new Set(LAYERS[id].categories.map((c) => c.id));

  /** 統計事件：接上 Plausible / GoatCounter 等不追蹤個人的工具即可（贊助曝光數要靠它） */
  function track(name, props) {
    try {
      if (window.plausible) window.plausible(name, { props });
      else if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "event/" + name, event: true });
    } catch (e) { /* 統計失敗不影響使用 */ }
  }

  hydrateIcons();

  // ── 地圖 ──
  const map = L.map("map", { zoomControl: false, attributionControl: true }).setView(CFG.defaultCenter, CFG.defaultZoom);
  const useAppTiles = window.Native.isApp && CFG.appTileUrl;
  if (window.Native.isApp && !CFG.appTileUrl) console.warn("[維生地圖] 尚未設定 appTileUrl：上架前請改用有金鑰的圖磚服務");
  L.tileLayer(useAppTiles ? CFG.appTileUrl : CFG.tileUrl, { maxZoom: 19, attribution: useAppTiles ? CFG.appTileAttribution : CFG.tileAttribution }).addTo(map);
  const clusterOpts = { showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 18 };
  const groups = { free: L.markerClusterGroup(clusterOpts), cheap: L.markerClusterGroup(clusterOpts) };
  const markers = new Map();
  let meMarker = null;

  const cat = (p) => window.findCategory(p.layer, p.category);

  function pinIcon(p, selected) {
    const c = cat(p);
    return L.divIcon({
      className: "",
      html: `<div class="sign-pin${p.sponsored ? " sponsored" : ""}${selected ? " selected" : ""}" style="--c:${c.color}"><div class="plate">${ic(c.icon, 18)}</div></div>`,
      iconSize: [34, 40], iconAnchor: [17, 40],
    });
  }

  // ── 工具 ──
  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function distParts(m) {
    return m < 1000 ? { n: Math.max(10, Math.round(m / 10) * 10), u: "m" } : { n: (m / 1000).toFixed(m < 10000 ? 1 : 0), u: "km" };
  }
  const walkMin = (m) => Math.max(1, Math.round(m / 80)); // 步行約每分鐘 80 公尺
  function distHtml(m) { const d = distParts(m); return `${d.n}<small>${d.u}</small>`; }
  function daysSince(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  const refPoint = () => state.userPos || map.getCenter();

  // 提示訊息。key 代表「誰顯示的」：收起時只收自己那則，不會把別人剛顯示的提示（例如「只顯示食物」）一起收掉
  let toastTimer, toastKey = null;
  function toast(msg, ms = 2600, iconName, key = null) {
    const el = $("#toast");
    if (!msg) { el.hidden = true; toastKey = null; return; }
    el.innerHTML = (iconName ? ic(iconName, 18) : "") + `<span>${esc(msg)}</span>`;
    el.hidden = false;
    toastKey = key;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { el.hidden = true; toastKey = null; }, ms);
  }
  function hideToast(key) { if (toastKey === key) toast(""); }

  function chainFor(p) {
    if (!state.chains || p.category !== "rescue") return null;
    return state.chains.chains.find((c) => new RegExp(c.match, "i").test(p.name || "")) || null;
  }

  // ── 下方面板（狀態機 sheet：peek／list／detail／pick，定義在 machines.js）──
  M.sheet = window.startMachine("sheet", {
    actions: {
      selectPlace: (ctx, e) => selectMarker(e.id),
      clearSelection: () => selectMarker(null),
      showTarget: () => { $("#target").hidden = false; },
      hideTarget: () => { $("#target").hidden = true; },
      openReport: () => {
        const c = map.getCenter();
        openModal("report", { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
      },
    },
  });
  M.sheet.subscribe((s) => { $("#sheet").dataset.state = s; document.body.dataset.sheet = s; });
  // 浮動按鈕永遠待在面板上方
  if (window.ResizeObserver) new ResizeObserver(([e]) => document.documentElement.style.setProperty("--sheet-h", e.target.offsetHeight + "px")).observe($("#sheet"));
  $("#grab").onclick = () => M.sheet.send("TOGGLE");
  $("#listClose").onclick = () => M.sheet.send("CLOSE");
  map.on("click", () => M.sheet.send("MAP_TAP"));

  function selectMarker(id) {
    if (state.selected && markers.has(state.selected)) {
      const old = state.places[state.layer].get(state.selected) || state.places.free.get(state.selected) || state.places.cheap.get(state.selected);
      if (old) markers.get(state.selected).setIcon(pinIcon(old, false));
    }
    state.selected = id;
    if (id && markers.has(id)) {
      const p = state.places[state.layer].get(id);
      if (p) markers.get(id).setIcon(pinIcon(p, true));
    }
  }

  // ── 繪製 ──
  function visiblePlaces(layerId) {
    const act = state.active[layerId];
    return [...state.places[layerId].values()].filter((p) => act.has(p.category));
  }

  function nearby() {
    const ref = refPoint();
    const b = map.getBounds().pad(0.3);
    return visiblePlaces(state.layer)
      .filter((p) => b.contains([p.lat, p.lng]))
      .map((p) => ({ p, d: distM(ref, p) }))
      .sort((a, b2) => a.d - b2.d);
  }

  function renderMarkers() {
    const g = groups[state.layer];
    const list = visiblePlaces(state.layer);
    const want = new Set(list.map((p) => p.id));
    const drop = [];
    g.eachLayer((m) => { if (!want.has(m._placeId)) drop.push(m); });
    if (drop.length) g.removeLayers(drop);
    const add = [];
    for (const p of list) {
      let m = markers.get(p.id);
      if (!m) {
        m = L.marker([p.lat, p.lng], { icon: pinIcon(p, false), title: p.name || cat(p).label, keyboard: true, zIndexOffset: p.sponsored ? 500 : 0 });
        m._placeId = p.id;
        m.on("click", (e) => { L.DomEvent.stopPropagation(e); showDetail(p); });
        markers.set(p.id, m);
      }
      if (!g.hasLayer(m)) add.push(m);
    }
    if (add.length) g.addLayers(add);
    renderChips();
    renderSheet();
  }

  let pressTimer = null, longPressed = false;
  function renderChips() {
    const counts = {};
    const b = map.getBounds();
    for (const p of state.places[state.layer].values()) if (b.contains([p.lat, p.lng])) counts[p.category] = (counts[p.category] || 0) + 1;
    const nav = $("#chips");
    nav.innerHTML = "";
    for (const c of LAYERS[state.layer].categories) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.style.setProperty("--c", c.color);
      btn.setAttribute("aria-pressed", state.active[state.layer].has(c.id));
      btn.innerHTML = `<span class="badge-ic">${ic(c.icon, 17)}</span>${esc(c.label)}<span class="n">${counts[c.id] || 0}</span>`;
      btn.onclick = () => {
        if (longPressed) { longPressed = false; return; } // 長按放開後瀏覽器還會補一個 click，不能再切換一次
        const set = state.active[state.layer];
        set.has(c.id) ? set.delete(c.id) : set.add(c.id);
        renderMarkers();
      };
      // 長按：只看這一類。三個階段：沒按 → 按住（計時中）→ 已觸發；放開或滑走時回到沒按
      btn.addEventListener("pointerdown", () => {
        clearTimeout(pressTimer);
        longPressed = false;
        pressTimer = setTimeout(() => {
          longPressed = true;
          state.active[state.layer] = new Set([c.id]);
          renderMarkers();
          toast(`只顯示${c.label}，再點其他類別可加回來`, 2600, null, "chips");
        }, 550);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(pressTimer)));
      nav.appendChild(btn);
    }
  }

  function renderSheet() {
    const items = nearby();
    renderPeek(items);
    renderList(items);
    if (M.sheet.state === "detail" && state.selected) {
      const p = state.places[state.layer].get(state.selected);
      if (p) $("#detail").querySelector(".d-dist")?.replaceWith(distBlock(p));
    }
  }

  function renderPeek(items) {
    const el = $("#peek");
    const nearest = items.find((x) => !x.p.sponsored) || items[0];
    if (!nearest) {
      const [title, hint] = emptyText();
      el.innerHTML = `<div class="peek-empty" data-empty="${esc(M.load.state)}"><b>${title}</b><span>${hint}</span></div>`;
      return;
    }
    const { p, d } = nearest;
    const c = cat(p);
    el.innerHTML = `
      <button class="signboard" style="--c:${c.color}" aria-label="查看 ${esc(p.name || c.label)}">
        <span class="band"></span>
        <span class="what"><span class="kind">${ic(c.icon, 15)}${state.userPos ? "離你最近的" : "畫面中央最近的"}${esc(c.label)}</span>
          <span class="name">${esc(p.name || c.label)}</span></span>
        <span class="how"><span class="dist">${distHtml(d)}</span>
          ${state.userPos ? `<span class="walk">${ic("footprints", 14)}走路 ${walkMin(d)} 分鐘</span>` : ""}</span>
      </button>
      <div class="peek-foot"><span class="ctx">附近共 ${items.length} 處</span>
        <button class="text-btn" id="openList">${ic("list", 18)}看全部</button></div>`;
    el.querySelector(".signboard").onclick = () => showDetail(p);
    $("#openList").onclick = () => M.sheet.send("OPEN_LIST");
  }

  /**
   * 附近沒有地點時要說什麼：依「地點資料」狀態機（machines.js 的 load）決定，
   * 不能在載入失敗或還在載入時說「這附近還沒有資料」，那會讓人以為真的沒有，還叫人去回報
   */
  function emptyText() {
    const what = state.layer === "free" ? "免費資源" : "平價好店";
    switch (M.load.state) {
      case "zoomedOut": case "tooWide":
        return ["放大地圖就會顯示這一區", "用兩指放大，或按右邊的定位鈕"];
      case "idle": case "loading":
        return ["正在載入這一區…", "網路慢的時候要等幾秒"];
      case "failed":
        return ["這一區的資料暫時載入失敗", "請確認網路，移動地圖就會再試一次"];
      default: // ready、stale
        return ["這附近還沒有資料", `知道這附近有${what}嗎？按右邊的 ＋ 告訴大家`];
    }
  }

  function renderList(items) {
    const promoted = renderPromo(items);
    const ol = $("#plist");
    ol.innerHTML = "";
    if (!items.length) {
      const [title, hint] = emptyText();
      $("#listTitle").textContent = title;
      ol.innerHTML = `<li class="empty" data-empty="${esc(M.load.state)}">${hint}</li>`;
      return;
    }
    $("#listTitle").textContent = `附近 ${items.length} 處${LAYERS[state.layer].label}`;
    items.filter((x) => x.p.id !== promoted).slice(0, 60).forEach(({ p, d }, i) => {
      const c = cat(p);
      const sub = !p.name ? "沒有標示名稱" : p.item ? `${esc(p.item)}${p.priceTwd != null ? ` <span class="price">$${esc(p.priceTwd)}</span>` : ""}` : esc(p.opening || p.address || c.label);
      const li = document.createElement("li");
      li.innerHTML = `<button class="row" style="--c:${c.color}">
        <span class="ic${p.sponsored ? " sp" : ""}">${ic(c.icon, 20)}</span>
        <span style="min-width:0"><div class="nm">${esc(p.name || c.label)}${p.sponsored ? '<span class="tag-sp">贊助</span>' : ""}</div><div class="sub">${sub}</div></span>
        <span class="d">${distHtml(d)}</span></button>`;
      li.firstElementChild.onclick = () => showDetail(p);
      ol.appendChild(li);
      if (i === 4 && LAYERS[state.layer].ads) insertAd(ol); // 廣告只會插在平價圖層清單
    });
  }

  // ── 詳細資料 ──
  function distBlock(p) {
    const d = distM(refPoint(), p);
    const div = document.createElement("div");
    div.className = "d-dist";
    div.innerHTML = `<span class="dist">${distHtml(d)}</span>` +
      (state.userPos ? `<span class="walk">${ic("footprints", 16)}走路約 ${walkMin(d)} 分鐘</span>` : `<span class="walk">從地圖中央算起</span>`);
    return div;
  }

  function showDetail(p) {
    if (!M.sheet.can("SHOW_DETAIL")) return; // 例如回報選點時點到標記：不理會，免得選到一半跳走
    const c = cat(p);
    const facts = [];
    if (p.item || p.priceTwd != null) facts.push(["badge-percent", `${esc(p.item || "")} ${p.priceTwd != null ? `<span class="price">NT$${esc(p.priceTwd)}</span>` : ""}`]);
    if (p.opening) facts.push(["clock", esc(p.opening)]);
    if (p.address) facts.push(["map-pin", esc(p.address)]);
    if (p.conditions) facts.push(["info", esc(p.conditions)]);
    if (p.fee === "no") facts.push(["heart", "免費"]);
    if (p.fee === "yes") facts.push(["circle-alert", "需要付費"]);
    if (p.phone) facts.push(["phone", `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`]);
    if (p.description) facts.push(["pencil", esc(p.description)]);

    let fresh = "";
    const age = daysSince(p.lastVerified);
    if (p.source === "own" && age != null) {
      fresh = age > 60 ? `<p class="note stale">${age} 天前確認過，可能已經變動，出發前最好先問一下</p>` : `<p class="note">${age === 0 ? "今天" : age + " 天前"}確認過</p>`;
    } else if (p.source === "osm") {
      fresh = `<p class="note">資料來自 OpenStreetMap 社群</p>`;
    } else if (p.source === "gov") {
      const names = (p.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join("、");
      fresh = `<p class="note" data-source="gov">資料來自政府開放資料${names ? `：${names}` : ""}。內容以機關公告為準，出發前最好先打電話確認。</p>`;
    }

    const ch = chainFor(p);
    const deal = ch ? `<div class="deal-times"><h3>${esc(ch.name)}</h3><ul>${ch.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${ch.app ? `<p class="note">${esc(ch.app)}</p>` : ""}<p class="note">${esc(state.chains.disclaimer)}</p></div>` : "";

    const nav = window.Native.navigationUrl(p.lat, p.lng);
    const links = [`<button class="btn quiet" id="shareBtn">${ic("share-2", 18)}分享</button>`];
    if (p.website) links.push(`<a class="btn quiet" href="${esc(p.website)}" target="_blank" rel="noopener nofollow${p.sponsored ? " sponsored" : ""}">${ic("external-link", 18)}網站</a>`);
    if (p.osmUrl) links.push(`<a class="btn quiet" href="${p.osmUrl}" target="_blank" rel="noopener">${ic("pencil", 18)}修正資料</a>`);
    else if (CFG.feedbackUrl) links.push(`<a class="btn quiet" href="${esc(CFG.feedbackUrl)}" target="_blank" rel="noopener">${ic("pencil", 18)}回報錯誤</a>`);

    const el = $("#detail");
    el.innerHTML = `
      <div class="d-top" style="--c:${c.color}">
        <span class="ic${p.sponsored ? " sp" : ""}">${ic(c.icon, 26)}</span>
        <div><div class="kind">${p.name ? esc(c.label) : "沒有標示名稱"}${p.sponsored ? '<span class="tag-sp">贊助</span>' : ""}</div>
        <h2>${esc(p.name || c.label)}</h2></div>
      </div>
      <div class="d-dist"></div>
      ${facts.length ? `<ul class="facts">${facts.map(([i, h]) => `<li>${ic(i, 20)}<span>${h}</span></li>`).join("")}</ul>` : ""}
      ${deal}${fresh}
      <div class="btn-row"><a class="btn solid" href="${nav}" target="_blank" rel="noopener" data-track="navigate">${ic("navigation", 20)}走路導航</a></div>
      ${links.length ? `<div class="d-links">${links.join("")}</div>` : ""}
      <div class="btn-row"><button class="btn quiet small" id="detailBack">${ic("chevron-down", 18)}回到附近</button></div>`;
    el.querySelector(".d-dist").replaceWith(distBlock(p));
    $("#detailBack").onclick = () => M.sheet.send("CLOSE");
    $("#shareBtn").onclick = async () => {
      const where = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
      const text = [p.name || c.label, c.label !== (p.name || c.label) ? c.label : "", p.address, p.opening].filter(Boolean).join("\n");
      const r = await window.Native.share({ title: p.name || c.label, text, url: where });
      if (r === "copied") toast("已複製地點資訊，可以貼給朋友");
      else if (r === "failed") toast("這台裝置不支援分享", 3000, "circle-alert");
      track("place_share", { category: p.category });
    };
    el.scrollTop = 0;
    M.sheet.send({ type: "SHOW_DETAIL", id: p.id });
    // 讓地點出現在面板上方
    const m = markers.get(p.id);
    const go = () => {
      const lift = Math.min($("#sheet").offsetHeight, map.getSize().y * 0.7) / 2;
      map.panTo(map.unproject(map.project([p.lat, p.lng]).add([0, lift])), { animate: true });
    };
    if (m && groups[state.layer].hasLayer(m) && groups[state.layer].getVisibleParent(m) !== m) groups[state.layer].zoomToShowLayer(m, go);
    else go();
    track("place_open", { layer: p.layer, category: p.category, sponsored: !!p.sponsored });
  }

  // ── 營收版位（只出現在平價圖層） ──
  function renderPromo(items) {
    const slot = $("#promoSlot");
    slot.innerHTML = "";
    if (state.layer !== "cheap") return;
    const sp = items.find((x) => x.p.sponsored);
    if (sp) {
      const p = sp.p;
      slot.innerHTML = `<button class="promo"><span class="ic">${ic("star", 22)}</span>
        <b>${esc(p.name)}<span class="tag-sp">贊助</span></b>
        <span>${esc([p.item, p.priceTwd != null ? "NT$" + p.priceTwd : "", p.description].filter(Boolean).join("，"))}</span></button>`;
      slot.firstElementChild.onclick = () => { track("sponsor_click", { id: p.id }); showDetail(p); };
      track("sponsor_impression", { id: p.id });
      return p.id;
    } else {
      slot.innerHTML = `<button class="promo house"><span class="ic">${ic("store", 22)}</span>
        <b>你的店有平價餐點或惜食優惠？</b><span>合作刊登，讓附近想省錢的人找到你</span></button>`;
      slot.firstElementChild.onclick = () => openModal("partner");
    }
  }

  function insertAd(ol) {
    if (!CFG.adsenseClient || !CFG.adsenseSlot) return;
    if (window.Native.isApp) return; // App 內不能直接放 AdSense，需改接 AdMob（見 README）
    ensureAdsScript();
    const li = document.createElement("li");
    li.className = "ad";
    li.innerHTML = `<div class="lbl">廣告</div><ins class="adsbygoogle" style="display:block"
      data-ad-client="${esc(CFG.adsenseClient)}" data-ad-slot="${esc(CFG.adsenseSlot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    ol.appendChild(li);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* 被擋就算了 */ }
  }
  function ensureAdsScript() {
    if (state.adsLoaded) return;
    state.adsLoaded = true;
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.requestNonPersonalizedAds = 1; // 不做個人化追蹤廣告
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CFG.adsenseClient);
    document.head.appendChild(s);
  }

  // ── 載入資料（狀態機 load：idle／zoomedOut／loading／ready／stale／failed／tooWide）──
  let loadTimer, loadSeq = 0, slowTimer;
  const scheduleLoad = () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadVisible, 450); };
  M.load = window.startMachine("load", {
    actions: {
      // 慢網路才提示「載入中」：快的時候閃一下反而干擾
      startSlowHint: () => { clearTimeout(slowTimer); slowTimer = setTimeout(() => toast("正在載入這一區…", 0, null, "load"), 400); },
      stopSlowHint: () => { clearTimeout(slowTimer); hideToast("load"); },
      hintStale: () => toast("目前沒有網路，先顯示上次存下的資料", 3500, "wifi-off", "load"),
      hintFailed: () => toast("地點資料暫時載入失敗，移動地圖會再試一次", 4000, "circle-alert", "load"),
    },
  });
  M.load.subscribe((s) => { document.body.dataset.load = s; });

  async function loadVisible() {
    const layerId = state.layer;
    const seq = ++loadSeq; // 比較晚送出的請求才算數：舊的結果回來時直接丟掉
    if (map.getZoom() < CFG.minQueryZoom) { M.load.send("ZOOMED_OUT"); renderMarkers(); return; }
    M.load.send("FETCH");
    renderSheet(); // 空清單馬上改說「正在載入」
    let result = "FAILED";
    try {
      const { places, stale, tooWide } = await window.Sources.fetchOsm(layerId, map.getBounds());
      for (const p of places) if (!state.places[layerId].has(p.id)) state.places[layerId].set(p.id, p);
      result = tooWide ? "TOO_WIDE" : stale ? "STALE" : "LOADED";
    } catch (e) {
      console.warn(e);
    }
    if (seq !== loadSeq) return;
    M.load.send(result);
    if (layerId === state.layer) renderMarkers();
  }

  async function loadOwn() {
    try {
      for (const p of await window.Sources.fetchOwnPlaces()) state.places[p.layer]?.set(p.id, p);
      renderMarkers();
    } catch (e) { console.warn("自有資料載入失敗", e); }
  }

  // ── 圖層切換 ──
  function setLayer(id, fromHash) {
    if (!LAYERS[id]) id = "free";
    if (id === state.layer && map.hasLayer(groups[id])) return;
    M.sheet.send("LAYER_CHANGED");
    loadSeq++; // 上一個圖層還沒回來的結果不再算數
    map.removeLayer(groups[state.layer]);
    state.layer = id;
    document.body.dataset.layer = id;
    document.querySelectorAll(".switch button").forEach((b) => b.setAttribute("aria-selected", b.dataset.layer === id));
    $('meta[name="theme-color"]').content = "#1B2A41";
    map.addLayer(groups[id]);
    if (!fromHash && location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    track("layer_switch", { layer: id });
    renderMarkers();
    scheduleLoad();
  }
  document.querySelectorAll(".switch button").forEach((b) => (b.onclick = () => setLayer(b.dataset.layer)));
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (LAYERS[h]) setLayer(h, true);
    else if (["support", "partner", "about"].includes(h)) openModal(h);
  });
  map.on("moveend", () => { scheduleLoad(); renderChips(); renderSheet(); });

  // ── 定位（狀態機 locate：idle／locating／located）──
  M.locate = window.startMachine("locate", {
    actions: {
      requestPosition: async () => {
        toast("正在找你的位置…", 0, "locate-fixed", "locate");
        try {
          const { lat, lng } = await window.Native.getPosition();
          state.userPos = L.latLng(lat, lng);
          const meIcon = L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [20, 20] });
          if (!meMarker) meMarker = L.marker(state.userPos, { icon: meIcon, interactive: false, zIndexOffset: 2000 }).addTo(map);
          else meMarker.setLatLng(state.userPos);
          M.locate.send("FOUND");
          hideToast("locate");
          map.setView(state.userPos, Math.max(map.getZoom(), 16));
        } catch (e) {
          M.locate.send("FAILED");
          toast(e.message || "無法取得位置，可以直接拖曳地圖找", 4000, "circle-alert", "locate");
        }
      },
    },
    guards: { hasPosition: () => !!state.userPos },
  });
  M.locate.subscribe((s) => {
    const b = $("#locateBtn");
    b.classList.toggle("on", s === "located");
    b.setAttribute("aria-busy", s === "locating");
    document.body.dataset.locate = s;
  });
  $("#locateBtn").onclick = () => M.locate.send("LOCATE"); // 找位置時再按，狀態機不理會，不會重複要求權限

  // ── 選單 ──
  const menu = $("#menu");
  $("#menuBtn").onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; $("#menuBtn").setAttribute("aria-expanded", !menu.hidden); };
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  menu.querySelectorAll("button").forEach((b) => (b.onclick = () => { menu.hidden = true; openModal(b.dataset.open); }));

  // ── 對話框 ──
  const modal = $("#modal");
  let lastFocus = null;
  function closeModal() { modal.hidden = true; $("#modalBody").innerHTML = ""; if (lastFocus) lastFocus.focus(); }
  $("#modalClose").onclick = closeModal;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  function openModal(kind, data) {
    const views = { support: supportView, partner: partnerView, about: aboutView, report: reportView, feedback: feedbackView };
    if (!views[kind]) return;
    lastFocus = document.activeElement;
    const body = $("#modalBody");
    body.innerHTML = views[kind](data);
    hydrateIcons(body);
    modal.hidden = false;
    $(".modal-card").scrollTop = 0;
    track("modal_open", { kind });
    if (kind === "report") bindReportForm(data);
    $("#modalClose").focus();
  }

  function supportView() {
    const t = CFG.transparency || {};
    const cost = t.monthlyCostTwd || 0, income = t.monthlyIncomeTwd || 0;
    const pct = cost ? Math.min(100, Math.round((income / cost) * 100)) : 0;
    // 兩大商店都不允許 App 內用外部連結贊助開發者，所以 App 版不顯示贊助按鈕
    const links = window.Native.isApp ? [] : (CFG.supportLinks || []).filter((l) => l.url);
    const app = window.Native.isApp;
    return `<h2 id="modalTitle">讓這張地圖一直免費</h2>
      <p class="lede">維生地圖不用註冊、不收費。${app ? "營運成本每月公開在這裡。" : "你的支持用來付伺服器和地圖服務，也讓我們能派人實地確認資料。"}</p>
      <div class="pledge"><span class="ic">${ic("heart", 22)}</span>
        <p><b>免費資源地圖永遠不放廣告。</b>廣告和店家刊登只出現在「平價好物」，而且一定會標示「贊助」。</p></div>
      <h3>${esc(t.month || "")} 營運狀況</h3>
      ${!cost ? `<p class="note">${esc(t.note || "收支會在這裡每月公開。")}</p>` : `<div class="meter">
        <div class="nums"><span class="big">${pct}%</span><span class="of">本月收入 NT$${income.toLocaleString()}／成本 NT$${cost.toLocaleString()}</span></div>
        <div class="track"><i style="width:${pct}%"></i></div>
        ${t.note ? `<p class="note">${esc(t.note)}</p>` : ""}
      </div>`}
      ${app ? "" : `<div class="stack">${links.length
        ? links.map((l, i) => `<a class="btn ${i ? "quiet" : "solid"}" href="${esc(l.url)}" target="_blank" rel="noopener" data-track="donate_click">${esc(l.label)}</a>`).join("")
        : `<p class="note">贊助管道還在準備中。</p>`}</div>`}
      <h3>${app ? "你可以這樣幫忙" : "不出錢也能幫忙"}</h3>
      <ul><li>按地圖上的 ＋，補上你知道的資源或平價好店</li><li>發現資料錯了，點地點裡的「修正資料」</li><li>把這個網址傳給需要的人，或轉給社工</li></ul>
      ${app ? "" : `<p class="note">這裡的贊助是支持本工具的開發與營運，不是公益勸募，所以無法開立捐款收據。</p>`}`;
  }

  function partnerView() {
    const contact = [
      CFG.partnerFormUrl && `<a class="btn solid" href="${esc(CFG.partnerFormUrl)}" target="_blank" rel="noopener">填寫合作表單</a>`,
      CFG.partnerEmail && `<p>來信：<b>${esc(CFG.partnerEmail)}</b></p>`,
    ].filter(Boolean).join("");
    return `<h2 id="modalTitle">店家與企業合作</h2>
      <p class="lede">我們只和真正幫得上忙的店家合作。</p>
      <div class="offer" style="--c:var(--navy)"><span class="ic" style="color:var(--amber)">${ic("star", 22)}</span>
        <div><h3>平價店家刊登</h3><p>在「平價好物」地圖用醒目的標誌顯示，排在附近清單最上面，並標示「贊助」。只收有百元內餐點或學生、長者優惠的店。</p></div></div>
      <div class="offer" style="--c:var(--jade)"><span class="ic">${ic("hand-heart", 22)}</span>
        <div><h3>待用餐、免費餐合作</h3><p>提供待用餐或免費餐的店家，會同時出現在「免費資源」地圖。<span class="free-tag">完全不收費。</span></p></div></div>
      <div class="offer" style="--c:#3B5BDB"><span class="ic">${ic("handshake", 22)}</span>
        <div><h3>企業 ESG 認養</h3><p>認養一個城市的資料維護，或贊助寒流避寒點即時更新這類專案，會在關於頁和年度報告中具名致謝。</p></div></div>
      <div class="refuse"><b>我們不接的合作：</b>博弈、借貸與當鋪、投資理財推銷、成人內容、菸酒、減重療程。這些業別可能傷害手頭緊的使用者。</div>
      <div class="stack">${contact || '<p class="note">合作窗口還在準備中。</p>'}</div>`;
  }

  // 政府資料開放授權條款要求標示出處：列出實際用到的資料集
  function govSourcesItem() {
    const list = Object.values(state.dataInfo?.gov?.sources || {});
    if (!list.length) return "";
    const links = list.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join("、");
    return `<li data-source="gov">食物銀行、愛心餐食與待用餐、街友盥洗與中途之家、社福中心、就業服務站、免費手機充電站：政府開放資料（${links}），依<a href="https://data.gov.tw/license" target="_blank" rel="noopener">政府資料開放授權條款第 1 版</a>使用</li>`;
  }

  function aboutView() {
    return `<h2 id="modalTitle">關於維生地圖</h2>
      <p class="lede">幫手頭緊的人找到附近的免費食物、飲水、充電、盥洗、住所和就業資源，也幫每個想省錢的人找到划算的餐食和住宿。</p>
      <h3>怎麼用</h3>
      <ul><li>上方切換「免費資源」和「平價好物」兩張地圖</li><li>點類別可以開關，長按只看那一類</li><li>按定位鈕，下方會顯示離你最近的地點和走路時間</li></ul>
      <h3>資料從哪裡來</h3>
      <ul><li>地圖和大部分地點：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> 貢獻者（ODbL 授權）</li>
      ${govSourcesItem()}
      <li>平價餐點、待用餐、贊助店家：使用者回報，經人工確認</li>
      <li>超商惜食時段：各品牌公開資訊，${esc(state.chains?.lastChecked || "")} 確認</li></ul>
      ${state.dataInfo?.osmTimestamp ? `<p class="note">地點資料更新於 ${esc(state.dataInfo.osmTimestamp.slice(0, 10))}，每週更新一次。</p>` : ""}
      <h3>隱私</h3>
      <p>不用註冊。你的位置只在你的手機上用來算距離，不會上傳。${window.Native.isApp ? "" : "廣告是非個人化廣告。"}<a href="privacy.html">閱讀完整隱私權政策</a></p>
      <div class="refuse">資料可能有誤或過期，出發前打電話確認最保險。需要急難協助可撥 <b>1957</b> 福利諮詢專線；有立即危險請撥 <b>110</b> 或 <b>119</b>。</div>`;
  }

  function feedbackView() {
    return `<h2 id="modalTitle">回報資料錯誤</h2>
      <p class="lede">在地圖上點那個地點，再點「修正資料」，就能直接在 OpenStreetMap 改正，任何人都能編輯。</p>
      ${CFG.feedbackUrl ? `<div class="stack"><a class="btn solid" href="${esc(CFG.feedbackUrl)}" target="_blank" rel="noopener">開啟回報表單</a></div>` : ""}
      <p>想新增地點，請關掉這個視窗，按地圖右邊的 ＋。</p>`;
  }

  // ── 回報地點 ──
  // 十字準星的顯示與收起由狀態機 sheet 的 pick 狀態負責（進入時顯示、離開時一定收起）
  $("#addBtn").onclick = () => M.sheet.send("START_PICK");
  $("#pickCancel").onclick = () => M.sheet.send("CANCEL");
  $("#pickOk").onclick = () => M.sheet.send("CONFIRM");
  hydrateIcons($("#target"));
  $("#target").querySelector("svg").setAttribute("width", 46);

  const categoryOptions = (layerId) => LAYERS[layerId].categories.filter((c) => c.id !== "sponsored")
    .map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("");

  function reportView() {
    const L0 = state.layer;
    return `<h2 id="modalTitle">回報一個地點</h2>
      <p class="lede">送出後由人工確認，通常幾天內就會出現在地圖上。</p>
      <form class="report" id="reportForm" novalidate>
        <label>這是</label>
        <div class="seg2">
          <label><input type="radio" name="layer" value="free" ${L0 === "free" ? "checked" : ""}><span class="free">${ic("heart", 18)}免費資源</span></label>
          <label><input type="radio" name="layer" value="cheap" ${L0 === "cheap" ? "checked" : ""}><span class="cheap">${ic("badge-percent", 18)}平價好物</span></label>
        </div>
        <label for="f-cat">類別</label>
        <select id="f-cat" name="category">${categoryOptions(L0)}</select>
        <label for="f-name">名稱</label>
        <input id="f-name" name="name" required maxlength="80" placeholder="例如：○○教會週三供餐、△△麵店">
        <div class="cheap-only"><div class="two">
          <div><label for="f-item">品項</label><input id="f-item" name="item" maxlength="60" placeholder="例如：陽春麵"></div>
          <div><label for="f-price">價格（元）</label><input id="f-price" name="price_twd" type="number" min="0" max="5000" inputmode="numeric"></div>
        </div></div>
        <label for="f-open">時間</label>
        <input id="f-open" name="opening" maxlength="80" placeholder="例如：週一到週五 11:30–13:00">
        <label for="f-cond">條件或注意事項</label>
        <input id="f-cond" name="conditions" maxlength="120" placeholder="例如：免證件、要先登記、限 65 歲以上">
        <label for="f-desc">其他補充</label>
        <textarea id="f-desc" name="description" maxlength="400"></textarea>
        <label for="f-src">資訊來源（可不填）</label>
        <input id="f-src" name="source_url" type="url" maxlength="300" placeholder="粉專或官網網址">
        <p class="hint">請不要填寫任何人的個人資料。</p>
        <div class="stack"><button class="btn solid" type="submit">送出回報</button></div>
        <div id="reportResult"></div>
      </form>`;
  }

  function bindReportForm(pos) {
    const f = $("#reportForm");
    const sync = () => {
      const layer = f.querySelector("input[name=layer]:checked").value;
      f.elements.namedItem("category").innerHTML = categoryOptions(layer);
      f.querySelector(".cheap-only").hidden = layer !== "cheap";
    };
    f.querySelectorAll("input[name=layer]").forEach((r) => (r.onchange = sync));
    sync();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const val = (k) => String(fd.get(k) || "").trim() || null;
      const report = {
        layer: fd.get("layer"), category: fd.get("category"), name: val("name"),
        item: val("item"), price_twd: fd.get("price_twd") ? Number(fd.get("price_twd")) : null,
        opening: val("opening"), conditions: val("conditions"), description: val("description"), source_url: val("source_url"),
        lat: pos.lat, lng: pos.lng,
      };
      if (!report.name) { const n = f.elements.namedItem("name"); n.setCustomValidity("請填寫名稱"); n.reportValidity(); n.setCustomValidity(""); n.focus(); return; }
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "送出中…";
      const out = $("#reportResult");
      try {
        const r = await window.Sources.submitReport(report);
        if (r.ok) {
          track("report_submit", { layer: report.layer, category: report.category });
          $("#modalBody").innerHTML = `<div class="done"><div class="ic">${ic("heart", 30)}</div>
            <h2 id="modalTitle" style="margin:0 0 6px">已送出回報</h2><p class="lede">謝謝你。確認後就會出現在地圖上。</p>
            <button class="btn quiet" id="doneClose">回到地圖</button></div>`;
          $("#doneClose").onclick = closeModal;
          return;
        }
        if (r.offline) {
          const lbl = { layer: "地圖", category: "類別", name: "名稱", item: "品項", price_twd: "價格", opening: "時間", conditions: "條件", description: "補充", source_url: "來源" };
          const val2 = (k, v) => k === "layer" ? LAYERS[v].label : k === "category" ? window.findCategory(report.layer, v).label : v;
          const text = Object.entries(report).filter(([k, v]) => v != null && lbl[k]).map(([k, v]) => `${lbl[k]}：${val2(k, v)}`).join("\n")
            + `\n位置：${report.lat}, ${report.lng}\nhttps://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lng}#map=19/${report.lat}/${report.lng}`;
          out.innerHTML = `<p>線上回報還沒開放。請複製下面的內容${CFG.feedbackUrl ? `，貼到<a href="${esc(CFG.feedbackUrl)}" target="_blank" rel="noopener">回報表單</a>` : "傳給我們"}：</p>
            <pre class="copybox">${esc(text)}</pre><button type="button" class="btn quiet" id="copyBtn">${ic("copy", 18)}複製內容</button>`;
          $("#copyBtn").onclick = async () => {
            try { await navigator.clipboard.writeText(text); $("#copyBtn").textContent = "已複製"; } catch (er) { $("#copyBtn").textContent = "請長按上面的文字複製"; }
          };
          btn.hidden = true;
          return;
        }
        throw new Error("HTTP " + r.status);
      } catch (err) {
        out.innerHTML = `<p class="stale">沒有送出成功，請檢查網路後再按一次。</p>`;
        btn.disabled = false; btn.textContent = "送出回報";
      }
    };
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-track]");
    if (a) track(a.dataset.track, {});
  });

  // ── App 內：外部連結交給系統開啟 ──
  if (window.Native.isApp) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (/^(https?:|tel:|mailto:)/i.test(href)) { e.preventDefault(); window.Native.openExternal(href); }
    });
  }

  // ── Android 返回鍵：由內而外一層層關閉 ──
  window.Native.onBackButton(() => {
    if (!modal.hidden) { closeModal(); return true; }
    if (!menu.hidden) { menu.hidden = true; return true; }
    if (M.sheet.can("BACK")) { M.sheet.send("BACK"); return true; }
    return false;
  });

  // ── 網路狀態 ──
  window.Native.onNetworkChange((online) => {
    if (online) { toast("網路恢復了", 1800); scheduleLoad(); loadOwn(); }
    else toast("目前沒有網路，先顯示上次存下的資料", 4000, "wifi-off");
  });

  // ── 啟動 ──
  (function init() {
    // 地點資料一開始就載，不等超商惜食時段、也不等延遲：慢網路上標記才不會比底圖晚好幾秒出現（量測見 scripts/measure-load.mjs）
    window.Sources.fetchChainDiscounts().then((c) => { state.chains = c; renderSheet(); });
    window.Sources.dataInfo().then((d) => (state.dataInfo = d));
    const h = location.hash.slice(1);
    map.addLayer(groups.free);
    if (LAYERS[h] && h !== "free") setLayer(h, true);
    else { renderMarkers(); loadVisible(); if (["support", "partner", "about"].includes(h)) openModal(h); }
    loadOwn();
    window.Native.ready();
  })();

  if (!window.Native.isApp && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // 給測試與代理用：目前狀態一次看完（各狀態機的狀態也寫在 <body data-sheet / data-load / data-locate>）
  window.__app = {
    state, map, setLayer, openModal, showDetail,
    get machines() { return Object.fromEntries(Object.entries(M).map(([k, m]) => [k, m.state])); },
  };
})();
