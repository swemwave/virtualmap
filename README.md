# StanGrad Virtual Map

An interactive first-person viewer for 360° panoramas captured on the 2nd floor near the
MB Wing at SAIT. The site is designed for GitHub Pages hosting and includes a data-driven
navigation graph, floor-plan overlay, and tooling to auto-classify new imagery.

## Features

- **Panorama viewer** powered by [Pannellum](https://pannellum.org/) for fast equirectangular rendering.
- **Navigation graph** with connection buttons, filters, and floor-plan markers.
- **Data-driven content** sourced from `data/panorama-map.json`, making it easy to update without touching HTML.
- **Batch ingestion** script using open-source vision-language models to sort, rename, and annotate images.

## Repository layout

```
index.html                # Entry point for GitHub Pages
assets/css/style.css      # Tailored interface styling
assets/js/app.js          # Panorama viewer + navigation logic
assets/images/            # Floor-plan artwork
data/panorama-map.json    # Sample graph describing four linked panoramas
tools/panorama_ingest.py  # AI-assisted ingestion utility
```

## Running locally

You can test the site locally with any static file server. Python's built-in server works
well:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Deploying to GitHub Pages

1. Push the repository to GitHub.
2. In the repository settings, enable **Pages** and select the `main` branch with `/ (root)`
   as the folder.
3. Wait for the deployment to finish, then access the published URL.

## Updating `panorama-map.json`

Each node in `data/panorama-map.json` requires:

- `id`: Unique identifier (usually the file stem).
- `title`: Friendly label shown in the UI.
- `type`: One of `hallway`, `classroom`, or `intersection` (custom values are allowed).
- `image`: Relative path to the panorama file.
- `connections`: Array of node IDs that can be reached from this location.
- Optional metadata such as `description`, `features`, and `position` for floor-plan markers.

Add as many nodes as needed. The viewer automatically lists them and draws floor-plan
markers when `position` coordinates are supplied (values between `0` and `1`).

## AI-assisted batch ingestion

The `tools/panorama_ingest.py` script accelerates data entry by classifying panoramas and
producing a fresh JSON document. It relies on the `open_clip_torch` and `torch` packages.

```bash
pip install open_clip_torch pillow torch
python tools/panorama_ingest.py my-new-captures/ --rename --output data/panorama-map.json
```

Review the generated JSON afterwards to fine-tune metadata, adjust connections, and add
floor-plan coordinates.

## Floor plan artwork

Replace `assets/images/floorplan-placeholder.svg` with an accurate diagram to align markers
with real-world positions. The JSON file stores width and height metadata so you can supply
CAD exports or scanned drawings at any resolution.
