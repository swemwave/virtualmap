"""Utility to regenerate the waypoint graph.

This script is a scaffold for future automation. Populate the TODO sections with
logic that reads measured coordinates (CSV, CAD, LiDAR, etc.) and emits an
updated ``public/data/waypoints.json`` file that keeps the structure used by the
web application.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

DATA_FILE = Path(__file__).resolve().parents[1] / "public" / "data" / "waypoints.json"


@dataclass
class Waypoint:
  """Represents a waypoint and its metadata."""

  id: str
  name: str
  zone: str
  corridor: str
  position: dict[str, float]
  image: str
  neighbors: list[str]
  notes: str

  def to_json(self) -> dict:
    return asdict(self)


@dataclass
class DataSet:
  """Container for serialising the JSON payload."""

  meta: dict
  nodes: list[Waypoint]

  def to_json(self) -> dict:
    return {
        "meta": self.meta,
        "nodes": [node.to_json() for node in self.nodes],
    }


def load_waypoints(path: Path) -> DataSet:
  payload = json.loads(path.read_text())
  nodes = [Waypoint(**node) for node in payload["nodes"]]
  return DataSet(meta=payload.get("meta", {}), nodes=nodes)


def save_waypoints(dataset: DataSet, path: Path) -> None:
  path.write_text(json.dumps(dataset.to_json(), indent=2))


def cli(argv: Iterable[str] | None = None) -> int:
  parser = argparse.ArgumentParser(description="Waypoint management helper")
  parser.add_argument(
      "--touch",
      action="store_true",
      help="Write the dataset back to disk to normalise formatting.",
  )
  args = parser.parse_args(argv)

  dataset = load_waypoints(DATA_FILE)
  if args.touch:
    save_waypoints(dataset, DATA_FILE)
    print(f"Normalised {DATA_FILE.relative_to(Path.cwd())}")
    return 0

  print("Loaded waypoints:")
  for node in dataset.nodes[:5]:
    print(f"  {node.id}: {node.name} -> {node.neighbors}")
  print("…")
  print("Edit this script to apply custom coordinate transforms or deduplicate assets.")
  return 0


if __name__ == "__main__":  # pragma: no cover
  raise SystemExit(cli())
