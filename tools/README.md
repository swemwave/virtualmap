# Panorama ingestion toolkit

The `panorama_ingest.py` helper builds a `panorama-map.json` file from a folder of
360° images. It uses the [open_clip](https://github.com/mlfoundations/open_clip) vision
language model to label panoramas as hallways, classroom doors, intersections, or lounge
spaces, and can optionally rename the source files.

```bash
pip install open_clip_torch pillow torch
python tools/panorama_ingest.py captured/ --rename --output data/panorama-map.json
```

Run the helper from the repository root (or provide absolute paths) so relative
locations resolve correctly. The `input` argument accepts both relative and
absolute directories.

If the script reports that the input folder cannot be found, double-check the
spelling and location of the directory. You can also supply an absolute path,
such as `"C:\\Users\\you\\Documents\\my-new-captures"` on Windows or
`"/Users/you/Documents/my-new-captures"` on macOS/Linux.

By default the script links panoramas sequentially. Update the generated JSON afterwards
to refine connections, adjust floor-plan coordinates, and expand metadata. The output is
compatible with the GitHub Pages viewer included in this repository.
