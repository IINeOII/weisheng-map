/**
 * 圖層與類別定義
 * overpass: 這個類別要向 OpenStreetMap 查詢的條件（Overpass QL 選擇器，不含 bbox）
 * match:    把查回來的 OSM tags 分到這個類別的判斷式（依陣列順序，先符合先贏）
 */
(function () {
  const has = (t, k, re) => t[k] !== undefined && (re ? re.test(t[k]) : true);
  const CHAIN_RE = /全家|familymart|7-?eleven|統一超商|萊爾富|hi-?life|ok便利|ok mart|okmart/i;

  window.LAYERS = {
    free: {
      id: "free",
      label: "免費資源",
      icon: "heart",
      ads: false, // 設計原則：免費資源圖層永遠無廣告
      categories: [
        {
          id: "food", label: "食物", icon: "soup", color: "#E4572E",
          overpass: [
            'nwr["social_facility"~"^(food_bank|soup_kitchen)$"]',
            'nwr["amenity"="food_sharing"]',
          ],
          match: (t) => has(t, "social_facility", /^(food_bank|soup_kitchen)$/) || t.amenity === "food_sharing",
        },
        {
          id: "water", label: "飲水", icon: "droplet", color: "#1C7ED6",
          overpass: ['nwr["amenity"="drinking_water"]', 'nwr["drinking_water:refill"="yes"]'],
          match: (t) => t.amenity === "drinking_water" || t["drinking_water:refill"] === "yes",
        },
        {
          id: "charge", label: "充電", icon: "plug-zap", color: "#6741D9",
          overpass: ['nwr["amenity"~"^(device_charging_station|power_supply)$"]'],
          match: (t) => has(t, "amenity", /^(device_charging_station|power_supply)$/),
        },
        {
          id: "shelter", label: "安全住所", icon: "house", color: "#C2255C",
          overpass: [
            'nwr["social_facility"="shelter"]',
            'nwr["amenity"="social_facility"]["social_facility:for"~"homeless"]',
          ],
          match: (t) => t.social_facility === "shelter" || has(t, "social_facility:for", /homeless/),
        },
        {
          id: "hygiene", label: "盥洗廁所", icon: "shower-head", color: "#0C8599",
          overpass: ['nwr["amenity"="shower"]', 'nwr["amenity"="toilets"]["access"!~"^(private|customers|no)$"]'],
          match: (t) => t.amenity === "shower" || t.amenity === "toilets",
        },
        {
          id: "jobs", label: "就業培訓", icon: "briefcase-business", color: "#495A6E",
          overpass: [
            'nwr["office"="employment_agency"]',
            'nwr["amenity"="social_facility"]["social_facility:for"~"unemployed"]',
          ],
          match: (t) => t.office === "employment_agency" || has(t, "social_facility:for", /unemployed/),
        },
        {
          id: "social", label: "社福服務", icon: "hand-heart", color: "#9C36B5",
          overpass: ['nwr["amenity"="social_facility"]["social_facility"!~"^(nursing_home|assisted_living|group_home)$"]'],
          match: (t) => t.amenity === "social_facility",
        },
      ],
    },
    cheap: {
      id: "cheap",
      label: "平價好物",
      icon: "badge-percent",
      ads: true,
      categories: [
        {
          id: "sponsored", label: "贊助優惠", icon: "star", color: "#1B2A41",
          overpass: [], // 只來自後端（店家付費刊登，一律標示「贊助」）
          match: () => false,
        },
        {
          id: "meal", label: "平價餐食", icon: "utensils", color: "#E4572E",
          overpass: [], // 群眾回報 / 人工整理
          match: () => false,
        },
        {
          id: "rescue", label: "惜食折扣", icon: "badge-percent", color: "#2B8A3E",
          overpass: [
            'nwr["shop"="convenience"]["brand"~"全家|FamilyMart|7-Eleven|萊爾富|Hi-Life|OK",i]',
            'nwr["shop"="convenience"]["name"~"全家|FamilyMart|7-Eleven|統一超商|萊爾富|Hi-Life|OK",i]',
            'nwr["shop"="supermarket"]["name"~"全聯"]',
          ],
          match: (t) =>
            (t.shop === "convenience" && (CHAIN_RE.test(t.brand || "") || CHAIN_RE.test(t.name || ""))) ||
            (t.shop === "supermarket" && /全聯/.test(t.name || "")),
        },
        {
          id: "stay", label: "平價住宿", icon: "bed-double", color: "#3B5BDB",
          overpass: ['nwr["tourism"="hostel"]'],
          match: (t) => t.tourism === "hostel",
        },
      ],
    },
  };

  /** 依 tags 找出所屬類別；找不到回傳 null */
  window.classifyTags = function (layerId, tags) {
    for (const c of window.LAYERS[layerId].categories) {
      if (c.match(tags)) return c.id;
    }
    return null;
  };

  window.findCategory = function (layerId, catId) {
    return window.LAYERS[layerId].categories.find((c) => c.id === catId) || null;
  };
})();
