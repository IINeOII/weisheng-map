#!/usr/bin/env python3
"""
從 OpenStreetMap 資料檔（.osm.pbf 或 .osm）抽出「可能有用」的地點，輸出成一行一筆的 JSON（NDJSON）。

這一步只做「粗篩」：保留帶有相關標籤的點和面（面取中心點）。
真正的分類交給 scripts/build-tiles.mjs，用 docs/js/categories.js 判斷，維持單一來源。

用法：
  pip install osmium
  python scripts/extract-osm.py taiwan-latest.osm.pbf build/osm-candidates.ndjson
"""
import json
import sys

import osmium

# 只要帶有其中一個標籤就保留，交給 categories.js 決定是否真的有用
KEYS = ("amenity", "social_facility", "social_facility:for", "office", "shop", "tourism", "drinking_water:refill")
# 只保留顯示需要的欄位，減少檔案大小
KEEP = {
    "name", "name:zh", "brand", "operator", "opening_hours", "phone", "contact:phone", "website", "contact:website",
    "fee", "access", "description", "addr:city", "addr:district", "addr:street", "addr:housenumber", "addr:full",
    "drinking_water", *KEYS,
}


def relevant(tags):
    return any(k in tags for k in KEYS)


def slim(tags):
    return {k: v for k, v in tags if k in KEEP}


class Extractor(osmium.SimpleHandler):
    def __init__(self, out):
        super().__init__()
        self.out = out
        self.count = 0

    def emit(self, kind, oid, lat, lon, tags):
        self.out.write(json.dumps({"type": kind, "id": oid, "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags}, ensure_ascii=False) + "\n")
        self.count += 1

    def node(self, n):
        if relevant(n.tags):
            self.emit("node", n.id, n.location.lat, n.location.lon, slim(n.tags))

    def way(self, w):
        if not relevant(w.tags):
            return
        pts = [(nd.lat, nd.lon) for nd in w.nodes if nd.location.valid()]
        if not pts:
            return
        # 封閉的面（建築物）取節點平均當代表位置；開放的線取中間的節點
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
            lat = sum(p[0] for p in pts) / len(pts)
            lon = sum(p[1] for p in pts) / len(pts)
        else:
            lat, lon = pts[len(pts) // 2]
        self.emit("way", w.id, lat, lon, slim(w.tags))


def main():
    if len(sys.argv) != 3:
        sys.exit("用法：python scripts/extract-osm.py 輸入.osm.pbf 輸出.ndjson")
    src, dst = sys.argv[1], sys.argv[2]
    import os
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with open(dst, "w", encoding="utf-8") as out:
        h = Extractor(out)
        h.apply_file(src, locations=True, idx="flex_mem")
    # 資料檔的時間（Geofabrik 會寫在檔頭），給 App 顯示「資料更新於」
    ts = osmium.io.Reader(src, osmium.osm.osm_entity_bits.NOTHING).header().get("osmosis_replication_timestamp", "")
    with open(dst + ".timestamp", "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"抽出 {h.count} 筆候選地點 → {dst}（資料時間 {ts or '未知'}）")
    if h.count == 0:
        sys.exit("沒有抽到任何地點，資料檔可能有問題")


if __name__ == "__main__":
    main()
