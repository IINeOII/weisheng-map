/**
 * 圖層與類別定義（唯一來源）
 * match(tags)：判斷一筆 OpenStreetMap 資料屬不屬於這個類別。
 *   - 建置資料時（scripts/build-tiles.mjs）用它從台灣全島資料中挑出地點
 *   - 覆蓋率報告也用同一套判斷，所以數字和 App 顯示的一致
 * 同一圖層內依陣列順序判斷，先符合先贏。
 */
(function () {
  const has = (t, k, re) => t[k] !== undefined && (re ? re.test(t[k]) : true);
  const CHAIN_RE = /全家|familymart|7-?eleven|統一超商|萊爾富|hi-?life|ok便利|ok mart|okmart/i;
  // 不對外開放的地點，一律不放進免費資源（例如私人廁所、員工專用）
  const closed = (t) => /^(private|no|customers|permit)$/.test(t.access || "");
  // 長照、安養等機構屬於社福設施，但不是一般人可以走進去求助的地方
  const CARE_HOME = /^(nursing_home|assisted_living|group_home|hospice)$/;

  window.LAYERS = {
    free: {
      id: "free",
      label: "免費資源",
      icon: "heart",
      ads: false, // 設計原則：免費資源圖層永遠無廣告
      exclude: closed,
      categories: [
        {
          id: "food", label: "食物", icon: "soup", color: "#E4572E",
          match: (t) => has(t, "social_facility", /^(food_bank|soup_kitchen)$/) || t.amenity === "food_sharing",
        },
        {
          id: "water", label: "飲水", icon: "droplet", color: "#1C7ED6",
          match: (t) => (t.amenity === "drinking_water" && t.drinking_water !== "no") || t["drinking_water:refill"] === "yes",
        },
        {
          id: "charge", label: "充電", icon: "plug-zap", color: "#6741D9",
          match: (t) => has(t, "amenity", /^(device_charging_station|power_supply)$/),
        },
        {
          id: "shelter", label: "安全住所", icon: "house", color: "#C2255C",
          match: (t) => t.social_facility === "shelter" || (t.amenity === "social_facility" && has(t, "social_facility:for", /homeless/)),
        },
        {
          id: "hygiene", label: "盥洗廁所", icon: "shower-head", color: "#0C8599",
          match: (t) => t.amenity === "shower" || t.amenity === "toilets",
        },
        {
          id: "jobs", label: "就業培訓", icon: "briefcase-business", color: "#495A6E",
          match: (t) => t.office === "employment_agency" || (t.amenity === "social_facility" && has(t, "social_facility:for", /unemployed/)),
        },
        {
          id: "social", label: "社福服務", icon: "hand-heart", color: "#9C36B5",
          match: (t) => t.amenity === "social_facility" && !CARE_HOME.test(t.social_facility || ""),
        },
      ],
    },
    cheap: {
      id: "cheap",
      label: "平價好物",
      icon: "badge-percent",
      ads: true,
      exclude: (t) => t.access === "private",
      categories: [
        {
          id: "sponsored", label: "贊助優惠", icon: "star", color: "#1B2A41",
          match: () => false, // 只來自後端（店家付費刊登，一律標示「贊助」）
        },
        {
          id: "meal", label: "平價餐食", icon: "utensils", color: "#E4572E",
          match: () => false, // 群眾回報、人工整理
        },
        {
          id: "rescue", label: "惜食折扣", icon: "badge-percent", color: "#2B8A3E",
          match: (t) =>
            (t.shop === "convenience" && (CHAIN_RE.test(t.brand || "") || CHAIN_RE.test(t.name || ""))) ||
            (t.shop === "supermarket" && /全聯/.test(t.name || t.brand || "")),
        },
        {
          id: "stay", label: "平價住宿", icon: "bed-double", color: "#3B5BDB",
          match: (t) => t.tourism === "hostel",
        },
      ],
    },
  };

  /** 依 tags 找出所屬類別；找不到或不開放回傳 null */
  window.classifyTags = function (layerId, tags) {
    const layer = window.LAYERS[layerId];
    if (layer.exclude && layer.exclude(tags)) return null;
    for (const c of layer.categories) {
      if (c.match(tags)) return c.id;
    }
    return null;
  };

  window.findCategory = function (layerId, catId) {
    return window.LAYERS[layerId].categories.find((c) => c.id === catId) || null;
  };
})();
