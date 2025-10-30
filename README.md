# Virtual Wing Explorer

This repository packages corridor imagery into a lightweight, mobile-friendly viewer so you can explore a facility as if you were walking it in person. It combines a top-down graph of the captured path with a first-person photo browser and a routing assistant.

## Repository layout

```
public/
  index.html         # Single-page app shell
  styles.css         # Responsive styling for desktop and mobile
  app.js             # Map rendering, image viewer, and routing logic
  data/waypoints.json# Auto-generated list of waypoints and adjacency graph
  assets/images/     # Renamed photo set organised as waypoint-XYZ.jpg
scripts/
  update_waypoints.py (placeholder for future automation)
```

## Viewing the map

From the repository root, serve the `public` directory with any static file server. For example using Python:

```bash
python -m http.server --directory public 5173
```

Then open <http://localhost:5173> in a desktop or mobile browser. Tap waypoints on the map to open their first-person photographs and use the route planner to highlight the fastest path between two points.

## Updating the dataset

1. Drop new photos into `public/assets/images` and follow the existing `waypoint-###.jpg` naming convention.
2. Update `public/data/waypoints.json` with the new positions, adjacency, and metadata. The current file was generated as a serpentine placeholder—replace the coordinates with accurate survey data as you refine the map.
3. Reload the web app to see the expanded coverage. The UI automatically ingests the new waypoints without additional code changes.

## Duplicate audit

No duplicate image hashes were detected during the initial import. If you add more captures, re-run your preferred duplicate checker before committing.

## Roadmap ideas

- Replace the placeholder layout generator with a scripted import that reads SLAM or LiDAR outputs.
- Attach compass headings to each waypoint to enable orientation-aware transitions.
- Add annotations for rooms, hazards, or points of interest displayed both on the map and in the viewer.
