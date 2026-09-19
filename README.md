# SYNC — your K-wellness companion

SYNC reads your skin from the camera, picks the few K-beauty products that answer what it read — inside your budget — runs the daily routine with you, and on the next read shows what actually moved.

Everything here was built on **19 September 2026** for a pitch competition.

**Live:** [try the demo](https://sync-demo-black.vercel.app) · [the deck](https://sync-kwellness-deck.vercel.app) · [the film](https://sync-demo-film.vercel.app)

> The hosted demo runs without the read service, so the skin read is a labelled sample (**SAMPLE · NOT MEASURED**) and the voice is the browser's own. Everything else — the picks and their evidence, the daily routine, the read-to-read change, the chat — behaves exactly as it does with the service attached.

---

## What's in here

```
web/      the demo app — read, picks, daily routine, chat companion
deck/     the 16-slide deck as one standalone page
film/     the landing page for the demo film (the .mp4 itself is hosted, not in git)
tools/    the scripts that built the product catalogue
serve.sh  runs the demo and the read service together
```

### `web/` — the demo

| file | what it holds |
|---|---|
| `index.html` | the page: hero, the read, the picks, the day, the chat |
| `app.js` | picks and their evidence, budget, the companion, chat |
| `mirror.js` | full-screen reading screen: scan, region walk-through, spoken briefing |
| `daily.js` | the daily routine, the memory, read-to-read change, the demo check-in |
| `style.css` | everything visual |
| `data/` | `oy_catalog.json` (89 products with ingredient facts) and their images |
| `assets/` | the companion, the sample face |

Run it locally:

```sh
python3 -m http.server 4173 --directory web    # then open http://localhost:4173 in Chrome
```

No build step. Chrome, because the voice input uses its speech recognition. Hosted copy: **https://sync-demo-black.vercel.app**

### The read service (not in this repo)

The live skin read, the spoken voice and the chat answers call a local service on `http://localhost:8000` — OpenAI vision for the read, ElevenLabs for the voice, OpenAI for chat. It holds API keys, so it is **not** published here.

Without it the demo still runs end to end: the read falls back to a labelled sample (**SAMPLE · NOT MEASURED**), the voice to the browser's own, the briefing to templates, the chat to keywords. Picks, evidence, routine and deltas are identical either way.

Point the page at a service elsewhere: `http://localhost:4173/?api=http://<host>:<port>`

### `tools/`

- `export_oy.py` — turns the Olive Young Global crawl (89 products, 13 April 2026) into `web/data/oy_catalog.json`: names, prices, volumes, links, packshots.
- `enrich_oy.py` — reads each product's own Korean ingredient list and usage text and writes back: what it is, its key actives **with their position on the label**, how and when to use it, cautions. The model names the ingredient; the position is looked up in the label list by code, because the model's own counting was wrong 100 times out of 221.

Both expect the crawl database from the mirror project and an OpenAI key; they are here as the record of how the catalogue was made.

---

## What is real, and what is not

- **Products are real.** 89 from Olive Young Global, crawled 13 April 2026: name, USD price, volume, full ingredient list, usage text, product link, packshot. Prices are that day's snapshot. 62 of the 89 are promotional sets, and the price covers the set.
- **The ingredient evidence is checkable.** Each pick names an ingredient and where it sits on that product's label ("Niacinamide · #3 of 47"). 206 of 207 spot-checked positions were exact.
- **The read is a description, not a diagnosis.** It reports what the camera can see in that light. No medical claims.
- **The two-week re-scan is simulated** and labelled wherever it appears. Its arithmetic follows how much of the routine was ticked off; it is not a prediction.
- **Nothing is sold.** The bag is a demo bag; every product links out to its Olive Young page.
- **Nothing leaves the machine except the read.** Frames go to the read service; your name, ticked-off days and reads stay in that browser's local storage. "Clear this browser's history" removes them.

---

Concept, design and build: Sohyun Yim.
