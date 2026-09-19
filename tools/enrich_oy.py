"""Turn each Olive Young product's own listing into facts the demo can show and say.

Input:  the crawl (sync-mirror/backend/data/products.sqlite, active=0 rows): full Korean INCI list + Korean usage text.
Output: data/oy_enriched.json keyed by product id, then merged into data/oy_catalog.json and web/data/oy_catalog.json.

Per product (gpt-4o-mini, JSON mode, from the listing only — no invented clinical claims):
  what, key_actives [{inci, ko, position, of, does, axes}] (position looked up in the label list, not taken from the model), how_to_use [steps], when, step, caution, fragrance_free
`axes` is limited to SYNC's 15 read axes, so a pick can be traced: read axis → ingredient (position in list) → product.

Re-run: backend/.venv/bin/python enrich_oy.py   (skips ids already in oy_enriched.json; --force redoes all)
"""
import json, sqlite3, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
BACKEND = HERE.parent / "sync-mirror/backend"
DB = BACKEND / "data/products.sqlite"
OUT = HERE / "data/oy_enriched.json"
CATALOGS = [HERE / "data/oy_catalog.json", HERE / "web/data/oy_catalog.json"]

AXES = ["hydration", "barrier", "redness", "brightness", "pigmentation", "texture", "wrinkles", "elasticity",
        "pores", "oiliness", "congestion", "blemishes", "eye", "dark_circles", "puffiness"]
STEPS = ["cleanse", "toner/pad", "serum", "eye", "moisturizer", "sunscreen", "mask", "exfoliant"]

SYSTEM = f"""You are a cosmetic chemist writing product facts for a skincare shopping assistant.
Use ONLY the product data given (name, category, the full ingredient list in Korean in label order, the Korean usage text).
Do not invent clinical results, percentages or claims that are not in the data. Translate Korean ingredient names to standard English INCI names.
Return JSON with exactly these keys:
"what": one plain-English sentence, max 20 words: what this product is and its format or texture.
"key_actives": 3 to 5 objects {{"ko": the ingredient copied EXACTLY, character for character, from the Korean list, "inci": its English INCI name, "does": what it does, max 8 words, "axes": subset of {AXES}}}.
  Pick the ingredients that actually do the job, preferring ones earlier in the list. Skip water, basic solvents, preservatives, thickeners, and fragrance.
"how_to_use": 2 to 4 short imperative steps in English, based on the Korean usage text plus normal use for this kind of product.
"when": "AM", "PM" or "AM and PM".
"step": one of {STEPS}.
"caution": one short line, or "" if nothing notable (e.g. retinoid: start 2-3 nights a week; acids or retinoids: wear SPF; contains fragrance: patch test if sensitive).
"fragrance_free": true only if the list has no fragrance (향료) and no essential oils."""


def one(row):
    inci = json.loads(row["ingredients_inci"] or "[]")
    user = json.dumps({
        "name": row["name_en"], "brand": row["brand_en"], "category": row["category_path_en"],
        "ingredients_ko_in_label_order": inci, "usage_ko": row["usage"],
    }, ensure_ascii=False)
    from openai import OpenAI
    client = OpenAI()
    r = client.chat.completions.create(
        model="gpt-4o-mini", temperature=0.2, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    )
    d = json.loads(r.choices[0].message.content)
    # keep it honest: the model only names the ingredient; its position is looked up here, in the
    # label list itself (the model's own counting was wrong for 100 of 221 checked). Not found → dropped.
    norm = lambda x: "".join(str(x).split())
    labels = [norm(x) for x in inci]
    acts = []
    for a in d.get("key_actives", [])[:5]:
        ko = norm(a.get("ko", ""))
        if not ko:
            continue
        pos = next((i + 1 for i, x in enumerate(labels) if x == ko), None) \
            or next((i + 1 for i, x in enumerate(labels) if x.startswith(ko) or ko in x), None)
        if not pos:
            continue
        acts.append({"inci": a.get("inci", ""), "ko": inci[pos - 1], "position": pos, "of": len(inci),
                     "does": a.get("does", ""), "axes": [x for x in a.get("axes", []) if x in AXES]})
    acts.sort(key=lambda a: a["position"])
    return row["prdt_no_us"], {
        "what": d.get("what", ""), "key_actives": acts,
        "how_to_use": [s for s in d.get("how_to_use", []) if isinstance(s, str)][:4],
        "when": d.get("when", "AM and PM"), "step": d.get("step") if d.get("step") in STEPS else "",
        "caution": d.get("caution", ""), "fragrance_free": bool(d.get("fragrance_free", False)),
        "source": "Olive Young Global listing (ingredient list + usage), 2026-04-13",
    }


def main():
    for line in (BACKEND / ".env").read_text().splitlines():
        if line.startswith("OPENAI_API_KEY="):
            import os
            os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip()
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM products WHERE active = 0").fetchall()
    done = {} if "--force" in sys.argv or not OUT.exists() else json.loads(OUT.read_text())
    todo = [r for r in rows if r["prdt_no_us"] not in done]
    print(f"{len(todo)} to enrich, {len(done)} already done")
    with ThreadPoolExecutor(8) as ex:
        for fut in [ex.submit(one, r) for r in todo]:
            try:
                pid, d = fut.result()
                done[pid] = d
            except Exception as e:
                print("failed:", e)
    OUT.write_text(json.dumps(done, ensure_ascii=False, indent=1))
    for cat in CATALOGS:
        c = json.loads(cat.read_text())
        for p in c["products"]:
            if p["id"] in done:
                p["enriched"] = done[p["id"]]
        c["_meta"]["enriched"] = "key_actives / how_to_use / when / step / caution from each product's Olive Young ingredient list + usage text (gpt-4o-mini, listing only)."
        cat.write_text(json.dumps(c, ensure_ascii=False, indent=1))
    print(f"enriched {len(done)} → {OUT.name}, merged into {len(CATALOGS)} catalogs")


if __name__ == "__main__":
    main()
