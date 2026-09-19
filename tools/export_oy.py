"""Export the Olive Young Global crawl (2026-04-13, 89 rows, active=0) into a demo catalogue.

Source: sync-mirror/backend/data/products.sqlite  ->  demo/data/oy_catalog.json (+ .csv, img/)
Re-run: python3 export_oy.py [--no-images]
"""
import csv, html, json, re, sqlite3, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
DB = HERE.parent / "sync-mirror/backend/data/products.sqlite"
OUT = HERE / "data"
IMG = OUT / "img"
CDN = "https://cdn-image.oliveyoung.com/{path}?RS=400x0"  # bare path 403s; the RS param is required
PDP = "https://global.oliveyoung.com/product/detail?prdtNo={no}"

# routine slot from the Olive Young category leaf
SLOT = {
    "Cleansing Balms&Oils": "cleanse_1", "Makeup Remover": "cleanse_1",
    "Cleansing Foams": "cleanse_2", "Exfoliators": "exfoliate",
    "Pads": "pad", "Face Mist": "mist",
    "Essence & Serum": "serum", "Spot Care": "spot",
    "Cream": "cream", "Sunscreen": "sunscreen",
    "Sheet Masks": "mask", "Facial Masks": "mask", "Patches": "spot",
}
AM_PM = {"cleanse_1": ["PM"], "sunscreen": ["AM"], "mask": ["PM"], "exfoliate": ["PM"]}


def clean_name(name: str, brand: str) -> str:
    n = html.unescape(name).replace("’", "'")
    n = re.sub(r"★[^★]*★\s*", "", n)                     # ★2025 Awards★
    n = re.sub(r"^\s*\[[^\]]*\]\s*", "", n)               # [DOUBLE] / [Choonsik EDITION]
    n = re.sub(r"\s*\((?:\+|&#43;)[^)]*\)", "", n)        # (+Refill 50ml ...)
    n = re.sub(r"\s*\((?:[^)]*(?:Pack|Types?|sheet)[^)]*)\)", "", n, flags=re.I)  # (Twin pack) (2 Types)
    n = re.sub(r"\s*[–-]\s*[A-Z][\w ]*(\s*/\s*[\w ]+)+$", "", n)  # – Heartleaf / Aqua / ... variants
    n = re.sub(r"\s*(Limited|Special|Refill|Duo|Double|Triple|Twin)?\s*(Set|Pack|Edition)\b.*$", "", n, flags=re.I)
    n = re.sub(r"(\s*\d+(\.\d+)?\s*(m[lL]|P|g|ea)\b(\s*[*x×+]\s*\d+(\.\d+)?\s*(ea|P|m[lL])?)*)+\s*$", "", n)  # trailing volume / count
    b = brand.replace("’", "'")
    if n.lower().startswith(b.lower()):
        n = n[len(b):]
    return n.strip(" -·(")


def main(download=True):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM products WHERE active = 0 ORDER BY brand_en, name_en").fetchall()
    OUT.mkdir(exist_ok=True)
    IMG.mkdir(exist_ok=True)
    items = []
    for r in rows:
        leaf = html.unescape(r["category_path_en"] or "").split(">")[-1].strip()
        slot = SLOT.get(leaf, "other")
        inci = json.loads(r["ingredients_inci"] or "[]")
        name_full = html.unescape(r["name_en"])
        item = {
            "id": r["prdt_no_us"],
            "goods_no_kr": r["goods_no_kr"],
            "brand": html.unescape(r["brand_en"]),
            "brand_kr": r["brand_kr"],
            "name": clean_name(r["name_en"], html.unescape(r["brand_en"])),
            "name_full": name_full,
            "is_set": bool(re.search(r"Set|Pack|\(\+|\*\d|Duo", name_full)),
            "category": leaf,
            "slot": slot,
            "am_pm": AM_PM.get(slot, ["AM", "PM"]),
            "volume": r["volume_info"],             # the `volume` column holds the price by mistake
            "price_usd": round(r["price_usd"], 2),
            "concerns": json.loads(r["concerns"] or "[]"),
            "skin_types": json.loads(r["skin_types"] or "[]"),
            "featured_ingredients": json.loads(r["featured_ingredients"] or "[]"),
            "ingredient_count": r["ingredient_count"] or len(inci),
            "ingredients_top5_kr": inci[:5],
            "usage_kr": r["usage"],
            "url": PDP.format(no=r["prdt_no_us"]),
            "image_remote": CDN.format(path=r["image_path"]),
            "image": f"img/{r['prdt_no_us']}.jpg",
            "crawled_at": r["crawled_at"][:10],
        }
        if download and not (IMG / f"{item['id']}.jpg").exists():
            try:
                req = urllib.request.Request(item["image_remote"], headers={"User-Agent": "Mozilla/5.0"})
                (IMG / f"{item['id']}.jpg").write_bytes(urllib.request.urlopen(req, timeout=20).read())
            except Exception as e:
                print("image failed", item["id"], e)
                item["image"] = item["image_remote"]
        items.append(item)

    meta = {
        "source": "Olive Young Global (global.oliveyoung.com), crawled 2026-04-13",
        "count": len(items),
        "currency": "USD",
        "caveats": [
            "Prices are the 2026-04-13 snapshot, not live.",
            "concerns / skin_types / featured_ingredients are heuristic tags from the crawl, not Olive Young's own.",
            "Many rows are promo sets (is_set); price covers the whole set.",
            "Shipping rule for the $60-incl-shipping demo is NOT in the crawl; set it in the demo config.",
        ],
    }
    (OUT / "oy_catalog.json").write_text(json.dumps({"_meta": meta, "products": items}, ensure_ascii=False, indent=1))
    cols = ["id", "brand", "name", "category", "slot", "price_usd", "volume", "is_set", "concerns", "skin_types", "url"]
    with open(OUT / "oy_catalog.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for it in items:
            w.writerow([";".join(it[c]) if isinstance(it[c], list) else it[c] for c in cols])
    print(f"{len(items)} products -> {OUT}")


if __name__ == "__main__":
    main(download="--no-images" not in sys.argv)
