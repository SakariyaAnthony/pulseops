"""Lighthouse lab audits.

Each route is audited twice, once with Lighthouse's mobile defaults (4x CPU slowdown, slow 4G) and once with its
desktop preset. Results are synthetic and reproducible. They are stored as lab data and are never mixed with field data.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

from app.config import settings

FORM_FACTORS = ("mobile", "desktop")
TOOLS_DIR = Path(__file__).resolve().parents[2] / "tools" / "lighthouse"
INSTALL_HINT = "Install it once with: cd apps/api/tools/lighthouse && npm install"

LARGE_IMAGE_BYTES = 200 * 1024
HUGE_IMAGE_BYTES = 1024 * 1024
SLOW_API_MS = 500
LONG_TASK_BUDGET_MS = 200
SCRIPT_BYTES_BUDGET = 500 * 1024
SLOW_SERVER_MS = 600


def find_lighthouse() -> list[str]:
    """Command that starts Lighthouse: an env override, the bundled install, or one on PATH."""
    override = settings.lighthouse_bin.strip()
    if override:
        return [override]
    bundled = TOOLS_DIR / "node_modules" / ".bin" / "lighthouse"
    if bundled.exists() and shutil.which("node"):
        return [str(bundled)]
    found = shutil.which("lighthouse")
    if found:
        return [found]
    raise RuntimeError(f"Lighthouse is not installed. {INSTALL_HINT}")


def find_chrome() -> str:
    explicit = settings.chrome_path.strip() or os.environ.get("CHROME_PATH", "")
    if explicit:
        return explicit
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            path = playwright.chromium.executable_path
        if path and Path(path).exists():
            return path
    except Exception:
        pass
    raise RuntimeError("Chromium was not found. Run: playwright install chromium")


def check_ready() -> tuple[list[str], str]:
    return find_lighthouse(), find_chrome()


def _run(command: list[str], chrome: str, url: str, form_factor: str, timeout_ms: int, should_cancel: Callable[[], bool]) -> dict:
    args = [
        *command,
        url,
        "--output=json",
        "--output-path=stdout",
        "--only-categories=performance",
        "--chrome-flags=--headless=new --no-sandbox --disable-gpu",
        f"--max-wait-for-load={max(int(timeout_ms), 5000)}",
        "--quiet",
    ]
    if form_factor == "desktop":
        args.append("--preset=desktop")
    env = {**os.environ, "CHROME_PATH": chrome}
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    deadline = time.monotonic() + max(120, timeout_ms / 1000 * 4)
    try:
        while True:
            try:
                out, err = process.communicate(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                if should_cancel():
                    process.kill()
                    process.communicate()
                    raise RuntimeError("Cancelled")
                if time.monotonic() > deadline:
                    process.kill()
                    process.communicate()
                    raise RuntimeError("Lighthouse timed out")
    finally:
        if process.poll() is None:
            process.kill()
    if process.returncode != 0 or not out.strip():
        message = (err or "").strip().splitlines()
        raise RuntimeError(f"Lighthouse failed: {message[-1][:300] if message else 'no output'}")
    return json.loads(out)


def collect_lighthouse(
    base_url: str,
    routes: list[str],
    timeout_ms: int,
    should_cancel: Callable[[], bool],
    progress: Callable[[str], bool] | None = None,
) -> list[dict]:
    command, chrome = check_ready()
    pages: list[dict] = []
    for route in routes:
        for form_factor in FORM_FACTORS:
            if should_cancel():
                return pages
            if progress is not None and not progress(f"{route} ({form_factor})"):
                return pages
            url = base_url.rstrip("/") + (route if route.startswith("/") else f"/{route}")
            try:
                report = _run(command, chrome, url, form_factor, timeout_ms, should_cancel)
                pages.append(parse_report(report, route, form_factor))
            except Exception as exc:
                if str(exc) == "Cancelled":
                    return pages
                pages.append(failed_page(route, form_factor, str(exc).splitlines()[0][:500]))
    return pages


def failed_page(route: str, form_factor: str, message: str) -> dict:
    return {
        "route": route,
        "viewport_json": {"form_factor": form_factor},
        "metric_source": "lab",
        "form_factor": form_factor,
        "sample_count": 1,
        "status": "failed",
        "error_summary": message,
    }


def _audit(report: dict, key: str) -> dict:
    return (report.get("audits") or {}).get(key) or {}


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _items(audit: dict) -> list[dict]:
    details = audit.get("details") or {}
    items = details.get("items")
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _path(url: str) -> str:
    parsed = urlparse(url)
    return parsed.path or "/"


def _kb(size: float) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.1f} MB"
    return f"{size / 1024:.0f} KB"


def parse_report(report: dict, route: str, form_factor: str) -> dict:
    """Turn one Lighthouse JSON report into a stored page row, including the route diagnosis."""
    score = (report.get("categories") or {}).get("performance", {}).get("score")
    requests = _items(_audit(report, "network-requests"))
    transfer = sum(item.get("transferSize") or 0 for item in requests)
    summary: dict[str, dict] = {}
    for item in requests:
        kind = str(item.get("resourceType") or "Other")
        bucket = summary.setdefault(kind, {"count": 0, "bytes": 0})
        bucket["count"] += 1
        bucket["bytes"] += int(item.get("transferSize") or 0)
    bootup = _items(_audit(report, "bootup-time"))
    script_ms = sum(_number(item.get("scripting")) or 0 for item in bootup) if bootup else None
    long_tasks = _items(_audit(report, "long-tasks"))
    page = {
        "route": route,
        "viewport_json": {"form_factor": form_factor},
        "metric_source": "lab",
        "form_factor": form_factor,
        "sample_count": 1,
        "status": "ok",
        "error_summary": None,
        "perf_score": int(round(score * 100)) if isinstance(score, (int, float)) else None,
        "lcp_ms": _number(_audit(report, "largest-contentful-paint").get("numericValue")),
        "cls": _number(_audit(report, "cumulative-layout-shift").get("numericValue")),
        "inp_ms": None,  # Lighthouse navigation runs do not measure INP. TBT is the lab proxy.
        "tbt_ms": _number(_audit(report, "total-blocking-time").get("numericValue")),
        "fcp_ms": _number(_audit(report, "first-contentful-paint").get("numericValue")),
        "speed_index": _number(_audit(report, "speed-index").get("numericValue")),
        "ttfb_ms": _number(_audit(report, "server-response-time").get("numericValue")),
        "script_ms": script_ms,
        "long_task_count": len(long_tasks),
        "long_task_total_ms": sum(_number(item.get("duration")) or 0 for item in long_tasks),
        "total_transfer_bytes": int(transfer) if requests else None,
        "resource_count": len(requests) if requests else None,
        "resource_summary_json": summary,
        "duration_ms": _number(_audit(report, "interactive").get("numericValue")),
    }
    page["diagnosis_json"] = diagnose(report, page, requests, long_tasks)
    return page


def _lcp_src(report: dict) -> str | None:
    for table in (_audit(report, "largest-contentful-paint-element").get("details") or {}).get("items", []):
        for row in (table or {}).get("items", []) if isinstance(table, dict) else []:
            node = row.get("node") if isinstance(row, dict) else None
            snippet = (node or {}).get("snippet") or ""
            if snippet.lstrip().lower().startswith("<img"):
                match = re.search(r"""src=["']([^"']+)["']""", snippet)
                if match:
                    return match.group(1)
    return None


def diagnose(report: dict, page: dict, requests: list[dict], long_tasks: list[dict]) -> list[dict]:
    """Rule-based suspects, each with the evidence behind it. Rules read Lighthouse audits only."""
    found: list[dict] = []
    lcp = page.get("lcp_ms") or 0

    # Large image that sets LCP.
    images = [item for item in requests if str(item.get("resourceType")) == "Image"]
    src = _lcp_src(report)
    hero = None
    if src:
        wanted = _path(src)
        hero = next((item for item in images if _path(str(item.get("url", ""))) == wanted), None)
    if hero is None and lcp > 2500 and images:
        biggest = max(images, key=lambda item: item.get("transferSize") or 0)
        if (biggest.get("transferSize") or 0) >= HUGE_IMAGE_BYTES:
            hero = biggest
    if hero is not None and (hero.get("transferSize") or 0) >= LARGE_IMAGE_BYTES:
        size = float(hero.get("transferSize") or 0)
        found.append(
            {
                "id": "large_image",
                "severity": "high" if size >= HUGE_IMAGE_BYTES else "medium",
                "title": "Large hero image",
                "evidence": f"{_path(str(hero.get('url')))} is {_kb(size)} and sits at the top of the page.",
                "action": "Inspect image size, priority and responsive variants. Serve WebP or AVIF and set fetchpriority high on the LCP image.",
            }
        )

    # Slow API calls (XHR or fetch).
    slow = []
    for item in requests:
        if str(item.get("resourceType")) not in {"XHR", "Fetch"}:
            continue
        start, end = _number(item.get("networkRequestTime")), _number(item.get("networkEndTime"))
        if start is not None and end is not None and end - start >= SLOW_API_MS:
            slow.append((end - start, item))
    if slow:
        slow.sort(key=lambda pair: -pair[0])
        top = ", ".join(f"{_path(str(item.get('url')))} took {duration:.0f} ms" for duration, item in slow[:3])
        found.append(
            {
                "id": "blocking_api",
                "severity": "high" if slow[0][0] >= 1500 else "medium",
                "title": "Blocking API request",
                "evidence": top + ".",
                "action": "Check whether the main content waits for data it does not need immediately.",
            }
        )

    # Long JavaScript work on the main thread.
    total_long = page.get("long_task_total_ms") or 0
    tbt = page.get("tbt_ms") or 0
    if tbt >= LONG_TASK_BUDGET_MS or total_long >= LONG_TASK_BUDGET_MS:
        longest = max(long_tasks, key=lambda item: item.get("duration") or 0, default=None)
        where = f" The longest ran {longest['duration']:.0f} ms in {_path(str(longest.get('url', '')))}." if longest else ""
        found.append(
            {
                "id": "long_js_task",
                "severity": "high" if tbt >= 600 else "medium",
                "title": "Long JavaScript task",
                "evidence": f"{page.get('long_task_count') or 0} long tasks, total blocking time {tbt:.0f} ms.{where}",
                "action": "Profile expensive computation and main-thread work. Split it up or move it off the main thread.",
            }
        )

    # Render-blocking CSS and JS.
    blocking = _items(_audit(report, "render-blocking-resources")) or _items(_audit(report, "render-blocking-insight"))
    blocking = [item for item in blocking if (_number(item.get("wastedMs")) or 0) > 0]
    if blocking:
        found.append(
            {
                "id": "render_blocking",
                "severity": "medium",
                "title": "Render-blocking resources",
                "evidence": ", ".join(_path(str(item.get("url"))) for item in blocking[:3]) + " block the first paint.",
                "action": "Inline critical CSS and defer the rest. Load non-critical scripts with defer or async.",
            }
        )

    # Layout shift.
    cls = page.get("cls") or 0
    if cls >= 0.1:
        nodes = []
        for audit_key in ("layout-shifts", "unsized-images"):
            for item in _items(_audit(report, audit_key)):
                node = item.get("node") or {}
                label = node.get("nodeLabel") or node.get("selector")
                if label and label not in nodes:
                    nodes.append(label)
        names = f" Elements involved: {', '.join(nodes[:3])}." if nodes else ""
        found.append(
            {
                "id": "layout_shift",
                "severity": "high" if cls >= 0.25 else "medium",
                "title": "Layout shift",
                "evidence": f"CLS is {cls:.3f}.{names}",
                "action": "Reserve space with width and height on images, embeds and late-loading content.",
            }
        )

    # Slow server response.
    ttfb = page.get("ttfb_ms") or 0
    if ttfb >= SLOW_SERVER_MS:
        found.append(
            {
                "id": "slow_server",
                "severity": "high" if ttfb >= 1500 else "medium",
                "title": "Slow server response",
                "evidence": f"The first byte took {ttfb:.0f} ms.",
                "action": "Check server work before the first byte: queries, cold starts, caching and redirects.",
            }
        )

    # Heavy JavaScript.
    script_bytes = sum(item.get("transferSize") or 0 for item in requests if str(item.get("resourceType")) == "Script")
    if script_bytes >= SCRIPT_BYTES_BUDGET:
        found.append(
            {
                "id": "heavy_js",
                "severity": "medium",
                "title": "Heavy JavaScript",
                "evidence": f"Scripts transfer {_kb(script_bytes)} on this page.",
                "action": "Split the bundle by route, drop unused libraries and lazy load below-the-fold code.",
            }
        )

    order = {"high": 0, "medium": 1, "low": 2}
    found.sort(key=lambda item: order[item["severity"]])
    return found[:6]
