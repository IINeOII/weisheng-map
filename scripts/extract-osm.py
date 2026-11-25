#!/usr/bin/env python3
"""
從 OpenStreetMap 資料檔（.osm.pbf 或 .osm）抽出「可能有用」的地點，輸出成一行一筆的 JSON（NDJSON）。

這一步只做「粗篩」：保留帶有相關標籤的點和面（面取中心點）。
真正的分類交給 scripts/build-tiles.mjs，用 docs/js/categories.js 判斷，維持單一來源。

用法：
  pip install osmium
  python scripts/extract-osm.py taiwan-latest.osm.pbf build/osm-candidates.ndjson [build/osm-lookup.ndjson]

第三個參數（可省略）：另外輸出「有門牌或機構名稱」的地點對照表，
讓政府開放資料裡只有地址、沒有座標的據點可以找到位置（scripts/import-gov.mjs）。
"""
import json
import re
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


# 對照表只收可能出現在政府資料裡的機構名稱，以及有門牌的地點
LOOKUP_NAME = re.compile(r"公所|社會福利|社福|服務中心|服務處|服務站|服務臺|協會|基金會|慈善|之家|居$|浴|澡堂|工作站|教會|救世軍|食物銀行|實物銀行")


def lookup_entry(tags):
    name = tags.get("name:zh") or tags.get("name") or ""
    street, number = tags.get("addr:street", ""), tags.get("addr:housenumber", "")
    addr = street + number if street and number else (tags.get("addr:full") or "")
    if not addr and not LOOKUP_NAME.search(name):
        return None
    entry = {"name": name} if LOOKUP_NAME.search(name) else {}
    if addr:
        entry["addr"] = addr
    if tags.get("addr:city"):
        entry["city"] = tags.get("addr:city")
    # 鄉鎮市區：不同區常有同名道路（例如每個區都有中正路），比對地址時一定要對上
    district = tags.get("addr:district") or tags.get("addr:suburb") or tags.get("addr:town") or ""
    if district:
        entry["district"] = district
    return entry


def relevant(tags):
    return any(k in tags for k in KEYS)


def slim(tags):
    return {k: v for k, v in tags if k in KEEP}


class Extractor(osmium.SimpleHandler):
    def __init__(self, out, lookup=None):
        super().__init__()
        self.out = out
        self.lookup = lookup
        self.count = 0
        self.lookup_count = 0

    def emit(self, kind, oid, lat, lon, tags):
        self.out.write(json.dumps({"type": kind, "id": oid, "lat": round(lat, 6), "lon": round(lon, 6), "tags": tags}, ensure_ascii=False) + "\n")
        self.count += 1

    def emit_lookup(self, kind, oid, lat, lon, tags):
        if self.lookup is None:
            return
        entry = lookup_entry(tags)
        if entry:
            entry.update({"type": kind, "id": oid, "lat": round(lat, 6), "lon": round(lon, 6)})
            self.lookup.write(json.dumps(entry, ensure_ascii=False) + "\n")
            self.lookup_count += 1

    def node(self, n):
        if relevant(n.tags):
            self.emit("node", n.id, n.location.lat, n.location.lon, slim(n.tags))
        if self.lookup is not None and n.location.valid():
            self.emit_lookup("node", n.id, n.location.lat, n.location.lon, n.tags)

    def way(self, w):
        want = relevant(w.tags)
        if not want and (self.lookup is None or not lookup_entry(w.tags)):
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
        if want:
            self.emit("way", w.id, lat, lon, slim(w.tags))
        self.emit_lookup("way", w.id, lat, lon, w.tags)


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit("用法：python scripts/extract-osm.py 輸入.osm.pbf 輸出.ndjson [對照表.ndjson]")
    src, dst = sys.argv[1], sys.argv[2]
    lookup_path = sys.argv[3] if len(sys.argv) == 4 else None
    import os
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    lookup = open(lookup_path, "w", encoding="utf-8") if lookup_path else None
    try:
        with open(dst, "w", encoding="utf-8") as out:
            h = Extractor(out, lookup)
            h.apply_file(src, locations=True, idx="flex_mem")
    finally:
        if lookup:
            lookup.close()
    if lookup_path:
        print(f"地址與機構名稱對照表 {h.lookup_count} 筆 → {lookup_path}")
    # 資料檔的時間（Geofabrik 會寫在檔頭），給 App 顯示「資料更新於」
    ts = osmium.io.Reader(src, osmium.osm.osm_entity_bits.NOTHING).header().get("osmosis_replication_timestamp", "")
    with open(dst + ".timestamp", "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"抽出 {h.count} 筆候選地點 → {dst}（資料時間 {ts or '未知'}）")
    if h.count == 0:
        sys.exit("沒有抽到任何地點，資料檔可能有問題")


if __name__ == "__main__":
    main()
