/**
 * 資料來源
 * 1. OpenStreetMap（Overpass API）— 即時查詢目前畫面範圍
 * 2. 自有資料 — Supabase（有設定時）或 data/places.json：群眾回報、人工整理、贊助店家
 */
(function () {
  const CFG = window.APP_CONFIG;
  const GRID = 0.02; // 查詢範圍對齊的格子大小（度），讓相近的畫面可以共用快取

  const memCache = new Map();

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 空間滿或被停用就算了 */ }
  }

  /** 把畫面範圍向外對齊到格子 */
  function snapBounds(b) {
    const f = (v) => Math.floor(v / GRID) * GRID;
    const c = (v) => Math.ceil(v / GRID) * GRID;
    return {
      s: +f(b.getSouth()).toFixed(4), w: +f(b.getWest()).toFixed(4),
      n: +c(b.getNorth()).toFixed(4), e: +c(b.getEast()).toFixed(4),
    };
  }

  function buildQuery(layerId, bb) {
    const bbox = `(${bb.s},${bb.w},${bb.n},${bb.e})`;
    const parts = [];
    for (const c of window.LAYERS[layerId].categories) {
      for (const sel of c.overpass) parts.push(sel + bbox + ";");
    }
    if (!parts.length) return null;
    return `[out:json][timeout:25];(${parts.join("")});out center tags 2000;`;
  }

  async function postOverpass(query) {
    let lastErr;
    for (const url of CFG.overpassEndpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        const res = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Overpass 無法連線");
  }

  /** OSM 元素 → 統一的地點格式 */
  function normalizeOsm(layerId, el) {
    const t = el.tags || {};
    const cat = window.classifyTags(layerId, t);
    if (!cat) return null;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;
    const addr = [t["addr:city"], t["addr:district"], t["addr:street"], t["addr:housenumber"]].filter(Boolean).join("");
    return {
      id: `osm:${el.type}/${el.id}`,
      source: "osm",
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      layer: layerId,
      category: cat,
      name: t["name:zh"] || t.name || t.brand || t.operator || "",
      lat, lng,
      address: addr || t["addr:full"] || "",
      opening: t.opening_hours || "",
      phone: t.phone || t["contact:phone"] || "",
      website: t.website || t["contact:website"] || "",
      fee: t.fee || "",
      access: t.access || "",
      description: t.description || "",
      tags: t,
    };
  }

  /**
   * 查詢某圖層在畫面範圍內的 OSM 地點
   * 回傳 { places, fromCache }
   */
  async function fetchOsm(layerId, bounds) {
    const bb = snapBounds(bounds);
    const key = `osm:${layerId}:${bb.s},${bb.w},${bb.n},${bb.e}`;
    if (memCache.has(key)) return { places: memCache.get(key), fromCache: true };
    const stored = storageGet(key);
    if (stored && Date.now() - stored.t < CFG.cacheTtlMs) {
      memCache.set(key, stored.p);
      return { places: stored.p, fromCache: true };
    }
    const q = buildQuery(layerId, bb);
    if (!q) return { places: [], fromCache: true };
    try {
      const json = await postOverpass(q);
      const places = (json.elements || []).map((el) => normalizeOsm(layerId, el)).filter(Boolean);
      // 不存 tags 原文以節省空間
      const slim = places.map(({ tags, ...rest }) => rest);
      memCache.set(key, slim);
      storageSet(key, { t: Date.now(), p: slim });
      return { places: slim, fromCache: false };
    } catch (e) {
      // 連線失敗時退而使用過期快取（離線也能看到上次的資料）
      if (stored) return { places: stored.p, fromCache: true, stale: true };
      throw e;
    }
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

  window.Sources = { fetchOsm, fetchOwnPlaces, submitReport, fetchChainDiscounts, hasBackend, snapBounds };
})();
