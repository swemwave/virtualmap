"""Spread floor plan nodes apart while preserving corridor links."""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Iterable

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "panorama-map.json"


def load_dataset(path: Path) -> dict:
  return json.loads(path.read_text())


def save_dataset(payload: dict, path: Path) -> None:
  path.write_text(json.dumps(payload, indent=2))


def build_edges(nodes: list[dict]) -> set[tuple[str, str]]:
  edges: set[tuple[str, str]] = set()
  for node in nodes:
    for target in node.get("connections", []):
      if not isinstance(target, str):
        continue
      pair = tuple(sorted((node["id"], target)))
      edges.add(pair)
  return edges


def run_layout(nodes: list[dict], *, iterations: int, margin: float) -> None:
  width = height = 1 - 2 * margin
  if width <= 0 or height <= 0:
    raise SystemExit("Margin too large; layout area collapsed.")

  positions: dict[str, list[float]] = {}
  rng = random.Random(42)
  for node in nodes:
    pos = node.get("position") or {}
    jitter_x = (rng.random() - 0.5) * width * 0.05
    jitter_y = (rng.random() - 0.5) * height * 0.05
    positions[node["id"]] = [
        (float(pos.get("x", 0.5)) - 0.5) * width + jitter_x,
        (float(pos.get("y", 0.5)) - 0.5) * height + jitter_y,
    ]

  edges = build_edges(nodes)
  k = math.sqrt((width * height) / max(len(nodes), 1))
  temperature = max(width, height) / 10
  gravity = k * 0.1

  for _ in range(iterations):
    disp: dict[str, list[float]] = {node_id: [0.0, 0.0] for node_id in positions}

    # Repulsion between every pair (Fruchterman-Reingold)
    node_items = list(positions.items())
    for index, (source_id, source_pos) in enumerate(node_items):
      for target_id, target_pos in node_items[index + 1 :]:
        dx = source_pos[0] - target_pos[0]
        dy = source_pos[1] - target_pos[1]
        dist_sq = dx * dx + dy * dy + 1e-9
        dist = math.sqrt(dist_sq)
        force = (k * k) / dist
        fx = (dx / dist) * force
        fy = (dy / dist) * force
        disp[source_id][0] += fx
        disp[source_id][1] += fy
        disp[target_id][0] -= fx
        disp[target_id][1] -= fy

    # Attraction along corridor edges
    for source_id, target_id in edges:
      source_pos = positions[source_id]
      target_pos = positions[target_id]
      dx = source_pos[0] - target_pos[0]
      dy = source_pos[1] - target_pos[1]
      dist = math.sqrt(dx * dx + dy * dy) + 1e-9
      force = (dist * dist) / k
      fx = (dx / dist) * force
      fy = (dy / dist) * force
      disp[source_id][0] -= fx
      disp[source_id][1] -= fy
      disp[target_id][0] += fx
      disp[target_id][1] += fy

    for node_id, pos in positions.items():
      disp[node_id][0] -= gravity * pos[0]
      disp[node_id][1] -= gravity * pos[1]

    half_width = width / 2
    half_height = height / 2
    for node_id, (dx, dy) in disp.items():
      disp_len = math.sqrt(dx * dx + dy * dy)
      if disp_len > 0:
        limit = min(disp_len, temperature)
        positions[node_id][0] += (dx / disp_len) * limit
        positions[node_id][1] += (dy / disp_len) * limit
      positions[node_id][0] = min(half_width, max(-half_width, positions[node_id][0]))
      positions[node_id][1] = min(half_height, max(-half_height, positions[node_id][1]))

    temperature *= 0.95
    if temperature < 1e-4:
      break

  epsilon = min(width, height) * 1e-3
  for node in nodes:
    pos = positions[node["id"]]
    pos[0] += (rng.random() - 0.5) * epsilon
    pos[1] += (rng.random() - 0.5) * epsilon
    norm_x = (pos[0] / width) + 0.5
    norm_y = (pos[1] / height) + 0.5
    node["position"] = {
        "x": round(margin + norm_x * width, 5),
        "y": round(margin + norm_y * height, 5),
    }


def cli(argv: Iterable[str] | None = None) -> int:
  parser = argparse.ArgumentParser(description="Relax the floor plan layout for panorama nodes.")
  parser.add_argument("--iterations", type=int, default=750, help="Number of relaxation steps to run.")
  parser.add_argument("--margin", type=float, default=0.2, help="Reserved border space around the layout (0-0.5).")
  parser.add_argument("--dry-run", action="store_true", help="Compute the layout but do not write the dataset back to disk.")
  args = parser.parse_args(argv)

  payload = load_dataset(DATA_FILE)
  nodes = payload.get("nodes")
  if not isinstance(nodes, list):
    raise SystemExit("The dataset does not contain a 'nodes' array.")

  run_layout(nodes, iterations=args.iterations, margin=args.margin)

  if args.dry_run:
    print("Layout computed. Dry run requested; not writing output.")
    return 0

  save_dataset(payload, DATA_FILE)
  print(f"Relaxed layout written to {DATA_FILE.relative_to(Path.cwd())}")
  return 0


if __name__ == "__main__":  # pragma: no cover
  raise SystemExit(cli())
