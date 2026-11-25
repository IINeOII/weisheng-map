/**
 * 資料管線測試：OSM 原始資料 → 抽取（extract-osm.py）→ 分類切格（build-tiles.mjs）
 * 分類規則只寫在 docs/js/categories.js，這裡確認邊界情況被正確收錄或排除。
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTiles, cellKey } from "../scripts/build-tiles.mjs";

test.describe("資料管線", () => {
  test.skip(({ isMobile }) => isMobile, "和畫面尺寸無關，只跑一次");

  const el = (id, tags, lat = 25.0478, lon = 121.517) => ({ type: "node", id, lat, lon, tags });
  const classify = async (els) => {
    const files = await buildTiles(els);
    const out = {};
    for (const [rel, list] of files) if (/^(free|cheap)\//.test(rel)) for (const r of list) out[r.i] = `${rel.split("/")[0]}:${r.c}`;
    return out;
  };

  test("該收的收、該排除的排除", async () => {
    const got = await classify([
      el(1, { amenity: "drinking_water" }),
      el(2, { amenity: "drinking_water", drinking_water: "no" }),
      el(3, { amenity: "toilets" }),
      el(4, { amenity: "toilets", access: "customers" }),
      el(5, { amenity: "toilets", access: "private" }),
      el(6, { amenity: "social_facility", social_facility: "soup_kitchen" }),
      el(7, { amenity: "social_facility", social_facility: "nursing_home" }),
      el(8, { amenity: "social_facility", social_facility: "outreach" }),
      el(9, { shop: "convenience", name: "7-ELEVEN 測試門市" }),
      el(10, { shop: "convenience", name: "路口雜貨店" }),
      el(11, { shop: "supermarket", brand: "全聯福利中心" }),
      el(12, { tourism: "hostel" }),
      el(13, { amenity: "bench" }),
      el(14, { cafe: "yes", "drinking_water:refill": "yes" }),
    ]);
    expect(got).toEqual({
      n1: "free:water", n3: "free:hygiene", n6: "free:food", n8: "free:social", n14: "free:water",
      n9: "cheap:rescue", n11: "cheap:rescue", n12: "cheap:stay",
    });
  });

  test("地點依座標放進正確的格子，索引記錄數量", async () => {
    const files = await buildTiles([el(1, { amenity: "drinking_water" }, 25.05, 121.51), el(2, { amenity: "drinking_water" }, 22.6, 120.3)]);
    const index = files.get("index.json");
    expect(index.cells.free).toEqual({ [cellKey(25.05, 121.51)]: 1, [cellKey(22.6, 120.3)]: 1 });
    expect(files.get("coverage.json").counts["台北車站"].free.water).toBe(1);
    expect(files.get("coverage.json").counts["高雄"].free.water).toBe(1);
  });

  test("從 OSM 檔案到格子檔的完整流程（需要 pip install osmium）", async () => {
    let hasOsmium = true;
    try { execFileSync("python3", ["-c", "import osmium"]); } catch { hasOsmium = false; }
    test.skip(!hasOsmium && !process.env.CI, "本機沒有安裝 pyosmium");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-"));
    execFileSync("python3", ["scripts/extract-osm.py", "tests/fixtures/sample.osm", path.join(dir, "c.ndjson")]);
    execFileSync("node", ["scripts/build-tiles.mjs", path.join(dir, "c.ndjson"), path.join(dir, "out")]);
    const free = JSON.parse(fs.readFileSync(path.join(dir, "out/free", cellKey(25.048, 121.516) + ".json"), "utf8"));
    expect(free.map((r) => r.i).sort()).toEqual(["n1", "n2", "n3", "n5", "w4"]);
    const shelter = free.find((r) => r.i === "w4");
    expect(shelter.a).toBeCloseTo(25.049, 3); // 面取中心點
    expect(fs.readFileSync(path.join(dir, "out/LICENSE.txt"), "utf8")).toContain("ODbL");
  });
});
