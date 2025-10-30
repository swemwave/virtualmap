#!/usr/bin/env python3
"""Panorama ingestion helper for StanGrad virtual map.

This script groups panoramic JPG images, predicts a semantic label using an
open-source vision-language model, and generates a navigation JSON file that the
web viewer can consume. Use it to batch-process newly captured imagery before
committing to GitHub.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Dict, Iterable, List, Optional

try:
    import torch
    import open_clip
    from PIL import Image
except ImportError as exc:  # pragma: no cover - optional dependency bootstrap
    raise SystemExit(
        "Missing dependencies. Install them with `pip install open_clip_torch pillow torch`"
    ) from exc

LOGGER = logging.getLogger("panorama_ingest")
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}

PROMPT_SETS: Dict[str, List[str]] = {
    "hallway": [
        "a panoramic photo of an academic building hallway",
        "university corridor with lockers",
        "indoor hallway with long linear perspective",
    ],
    "classroom": [
        "entrance of a college classroom door",
        "classroom door with signage",
        "doorway to lecture room",
    ],
    "intersection": [
        "intersection of two hallways",
        "crossroads corridor inside a building",
        "panorama of hallway junction",
    ],
    "lounge": [
        "student lounge area with seating",
        "common area with couches and tables",
        "collaboration space inside campus building",
    ],
}

FEATURE_TEMPLATES: Dict[str, List[str]] = {
    "hallway": ["hallway", "wayfinding"],
    "classroom": ["classroom", "door", "signage"],
    "intersection": ["intersection", "branching"],
    "lounge": ["lounge", "seating", "windows"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Folder containing panoramic JPGs")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/panorama-map.generated.json"),
        help="Destination JSON file (default: data/panorama-map.generated.json)",
    )
    parser.add_argument(
        "--floorplan",
        type=Path,
        default=Path("assets/images/floorplan-placeholder.svg"),
        help="Path to the floorplan image to embed in metadata",
    )
    parser.add_argument(
        "--rename",
        action="store_true",
        help="Rename images to include ordered index and predicted label",
    )
    parser.add_argument(
        "--link-mode",
        choices=["none", "sequential"],
        default="sequential",
        help="How to create default graph connections (default: sequential)",
    )
    parser.add_argument(
        "--device",
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="Torch device identifier (default: auto-detect)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    return parser.parse_args()


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="[%(levelname)s] %(message)s")


def collect_images(folder: Path) -> List[Path]:
    if not folder.exists():
        raise FileNotFoundError(f"Input folder {folder} does not exist")
    images = sorted(
        [path for path in folder.iterdir() if path.suffix.lower() in SUPPORTED_EXTENSIONS]
    )
    if not images:
        raise FileNotFoundError(f"No supported images found in {folder}")
    LOGGER.info("Found %d panoramas", len(images))
    return images


def load_model(device: str):
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k"
    )
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model.to(device)
    model.eval()
    text_features = {}
    with torch.no_grad():
        for label, prompts in PROMPT_SETS.items():
            tokenized = tokenizer(prompts)
            text_feat = model.encode_text(tokenized.to(device))
            text_feat /= text_feat.norm(dim=-1, keepdim=True)
            text_features[label] = text_feat.mean(dim=0, keepdim=True)
    return model, preprocess, text_features


def predict_label(
    image_path: Path,
    model,
    preprocess,
    text_features: Dict[str, torch.Tensor],
    device: str,
) -> str:
    image = preprocess(Image.open(image_path).convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        image_features = model.encode_image(image)
        image_features /= image_features.norm(dim=-1, keepdim=True)
    best_label: Optional[str] = None
    best_score = -float("inf")
    for label, text_feat in text_features.items():
        score = torch.matmul(image_features, text_feat.T).item()
        if score > best_score:
            best_score = score
            best_label = label
    if best_label is None:
        raise RuntimeError(f"Unable to classify image {image_path}")
    LOGGER.debug("%s classified as %s (%.3f)", image_path.name, best_label, best_score)
    return best_label


def build_nodes(
    images: Iterable[Path],
    predictions: Dict[Path, str],
    rename: bool,
    output_folder: Path,
) -> List[Dict]:
    nodes: List[Dict] = []
    output_folder.mkdir(parents=True, exist_ok=True)

    for index, path in enumerate(images, start=1):
        label = predictions[path]
        stem = path.stem
        if rename:
            new_name = f"{index:03d}_{label}_{stem}{path.suffix.lower()}"
            target = path.with_name(new_name)
            if target != path:
                path.rename(target)
                LOGGER.debug("Renamed %s -> %s", path.name, target.name)
                path = target
            stem = path.stem
        relative_path = os.path.relpath(path, Path.cwd())
        relative_path = Path(relative_path).as_posix()
        nodes.append(
            {
                "id": stem,
                "title": f"{label.title()} {index:03d}",
                "type": label,
                "description": f"Auto-labelled as {label} using CLIP similarity prompts.",
                "image": relative_path,
                "connections": [],
                "features": FEATURE_TEMPLATES.get(label, [label]),
            }
        )
    return nodes


def link_nodes(nodes: List[Dict], mode: str) -> None:
    if mode == "none":
        return
    if mode == "sequential":
        for idx, node in enumerate(nodes):
            neighbors = []
            if idx > 0:
                neighbors.append(nodes[idx - 1]["id"])
            if idx < len(nodes) - 1:
                neighbors.append(nodes[idx + 1]["id"])
            node["connections"] = neighbors
    else:  # pragma: no cover - defensive
        raise ValueError(f"Unsupported link mode: {mode}")


def assemble_payload(nodes: List[Dict], floorplan: Path) -> Dict:
    return {
        "meta": {
            "title": "StanGrad 2nd Floor",
            "description": "Automatically generated map data. Review and edit as needed.",
            "floorplan": {
                "image": Path(os.path.relpath(floorplan, Path.cwd())).as_posix(),
                "width": 1200,
                "height": 800,
            },
        },
        "nodes": nodes,
    }


def main() -> None:
    args = parse_args()
    configure_logging(args.verbose)
    images = collect_images(args.input)
    model, preprocess, text_features = load_model(args.device)
    predictions: Dict[Path, str] = {}
    for image_path in images:
        predictions[image_path] = predict_label(image_path, model, preprocess, text_features, args.device)
    nodes = build_nodes(images, predictions, args.rename, args.output.parent)
    link_nodes(nodes, args.link_mode)
    payload = assemble_payload(nodes, args.floorplan)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2)
        fp.write("\n")
    LOGGER.info("Wrote %s with %d nodes", args.output, len(nodes))


if __name__ == "__main__":
    main()
