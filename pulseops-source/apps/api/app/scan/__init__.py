"""Lab scans: static assets and an isolated browser pass."""

from __future__ import annotations

import sys
from pathlib import Path

_vendor = Path(__file__).resolve().parents[2] / ".vendor"
if _vendor.is_dir() and str(_vendor) not in sys.path:
    sys.path.insert(0, str(_vendor))
