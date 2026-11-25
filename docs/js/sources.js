/**
 * 資料來源
 * 1. OpenStreetMap 地點 — 每週預先整理好的靜態檔（docs/data/osm），依畫面所在的格子載入
 *    不在使用者打開時即時查詢 Overpass：公共伺服器不穩定，且官方不建議一般 App 這樣用（CONSTRAINTS.md C12）
 * 2. 自有資料 — Supabase（有設定時）或 data/places.json：群眾回報、人工整理、贊助店家
 */
(function () {
  const CFG = window.APP_CONFIG;
  const memCache = new Map();

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 空間滿或被停用就算了 */ }
  }

  async function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      // 地點資料比底圖重要：慢網路上請瀏覽器先下載它（不支援的瀏覽器會忽略這個設定）
      const res = await fetch(url, { signal: ctrl.signal, priority: "high" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // ── 資料索引：決定從哪個網址拿、資料是哪一天的、哪些格子有東西 ──
  let indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const bases = [CFG.dataUrl, CFG.dataFallbackUrl].filter(Boolean);
        let lastErr;
        for (const base of bases) {
          try {
            const index = await getJson(`${base}/index.json`);
            storageSet("osm:index", { base, index });
            return { base, index };
          } catch (e) { lastErr = e; }
        }
        const saved = storageGet("osm:index"); // 離線：用上次存下的索引
        if (saved) return { ...saved, offline: true };
        indexPromise = null; // 下次再試
        throw lastErr || new Error("找不到地點資料");
      })();
    }
    return indexPromise;
  }

  /** 畫面範圍會碰到的格子 */
  function cellsFor(bounds, cell) {
    const keys = [];
    for (let y = Math.floor(bounds.getSouth() / cell); y <= Math.floor(bounds.getNorth() / cell); y++)
      for (let x = Math.floor(bounds.getWest() / cell); x <= Math.floor(bounds.getEast() / cell); x++) keys.push(`${y}_${x}`);
    return keys;
  }

  /** 精簡格式 → App 用的地點物件；編號 g 開頭的是政府開放資料 */
  function expand(layerId, r, index) {
    if (r.i[0] === "g") {
      const srcs = (r.g || []).map((id) => index && index.gov && index.gov.sources[id]).filter(Boolean);
      return {
        id: `gov:${r.i.slice(1)}`, source: "gov", sources: srcs,
        layer: layerId, category: r.c, name: r.n || "", lat: r.a, lng: r.o,
        address: r.d || "", opening: r.h || "", phone: r.p || "", conditions: r.e || "", website: "", fee: "", description: "",
      };
    }
    const type = { n: "node", w: "way", r: "relation" }[r.i[0]];
    const id = r.i.slice(1);
    return {
      id: `osm:${type}/${id}`, source: "osm", osmUrl: `https://www.openstreetmap.org/${type}/${id}`,
      layer: layerId, category: r.c, name: r.n || "", lat: r.a, lng: r.o,
      address: r.d || "", opening: r.h || "", phone: r.p || "", website: r.w || "",
      fee: r.f || "", description: r.s || "",
    };
  }

  /**
   * 載入某圖層在畫面範圍內的地點
   * 回傳 { places, stale }；stale 代表目前離線、用的是之前存下的資料
   */
  async function fetchOsm(layerId, bounds) {
    const { base, index, offline } = await loadIndex();
    const have = index.cells[layerId] || {};
    const keys = cellsFor(bounds, index.cell).filter((k) => have[k]);
    if (keys.length > 60) return { places: [], tooWide: true }; // 範圍太大，等使用者放大
    const places = [];
    let stale = !!offline;
    await Promise.all(keys.map(async (k) => {
      const ck = `osm:${index.generatedAt}:${layerId}:${k}`;
      if (memCache.has(ck)) { places.push(...memCache.get(ck)); return; }
      const saved = storageGet(ck);
      if (saved && Date.now() - saved.t < CFG.cacheTtlMs) { memCache.set(ck, saved.p); places.push(...saved.p); return; }
      try {
        const list = (await getJson(`${base}/${layerId}/${k}.json`)).map((r) => expand(layerId, r, index));
        memCache.set(ck, list);
        storageSet(ck, { t: Date.now(), p: list });
        places.push(...list);
      } catch (e) {
        if (saved) { stale = true; places.push(...saved.p); return; }
        throw e;
      }
    }));
    return { places, stale };
  }

  /** 資料是哪一天的（給「關於」頁顯示） */
  async function dataInfo() {
    try { const { index } = await loadIndex(); return { osmTimestamp: index.osmTimestamp, generatedAt: index.generatedAt, gov: index.gov || null }; }
    catch (e) { return null; }
  }

  // ── 自有資料（群眾回報 / 贊助）──
  const hasBackend = () => !!(CFG.supabaseUrl && CFG.supabaseAnonKey);

  function sbHeaders(extra) {
    return Object.assign(
      { apikey: CFG.supabaseAnonKey, Authorization: "Bearer " + CFG.supabaseAnonKey },
      extra || {}
    );
  }

  function normalizeOwn(p) {
    const today = new Date().toISOString().slice(0, 10);
    const sponsorActive = p.sponsored && (!p.sponsor_until || p.sponsor_until >= today);
    return {
      id: "own:" + p.id,
      source: "own",
      layer: p.layer,
      category: sponsorActive ? "sponsored" : p.category,
      name: p.name,
      lat: +p.lat, lng: +p.lng,
      address: p.address || "",
      opening: p.opening || "",
      description: p.description || "",
      item: p.item || "",
      priceTwd: p.price_twd ?? null,
      conditions: p.conditions || "",
      phone: p.phone || "",
      website: p.source_url || "",
      sponsored: !!sponsorActive,
      lastVerified: p.last_verified || p.created_at?.slice(0, 10) || "",
    };
  }

  async function fetchOwnPlaces() {
    let rows = [];
    if (hasBackend()) {
      const url = `${CFG.supabaseUrl}/rest/v1/places?status=eq.approved&select=*`;
      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error("後端讀取失敗 HTTP " + res.status);
      rows = await res.json();
    } else {
      const res = await fetch("data/places.json", { cache: "no-cache" });
      rows = res.ok ? await res.json() : [];
    }
    return rows.map(normalizeOwn).filter((p) => p.lat && p.lng && window.findCategory(p.layer, p.category));
  }

  /** 送出回報；沒有後端時回傳 { ok:false, offline:true } 讓 UI 改用複製文字 */
  async function submitReport(report) {
    if (!hasBackend()) return { ok: false, offline: true };
    const body = Object.assign({}, report, { status: "pending", sponsored: false });
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/places`, {
      method: "POST",
      headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  }

  let chainInfo = null;
  async function fetchChainDiscounts() {
    if (chainInfo) return chainInfo;
    try {
      const res = await fetch("data/chain-discounts.json");
      chainInfo = res.ok ? await res.json() : { chains: [] };
    } catch (e) {
      chainInfo = { chains: [] };
    }
    return chainInfo;
  }

  window.Sources = { fetchOsm, fetchOwnPlaces, submitReport, fetchChainDiscounts, hasBackend, dataInfo };
})();
