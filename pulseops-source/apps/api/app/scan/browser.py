from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import unquote, urlparse

from app.scan.stats import observation_record

API_TYPES = {"xhr", "fetch"}


def collect_routes(
    base_url: str,
    routes: list[str],
    viewport: dict,
    timeout_ms: int,
    should_cancel: Callable[[], bool],
) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Install Playwright and Chromium: playwright install chromium") from exc

    host = (urlparse(base_url).hostname or "").lower()
    pages: list[dict] = []
    observations: list[dict] = []
    seen_assets: list[dict] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                viewport={"width": int(viewport.get("width", 1280)), "height": int(viewport.get("height", 720))}
            )
            decisions: dict[str, bool] = {}
            context.route("**/*", lambda route: _gate(route, host, decisions))
            page = context.new_page()
            page.add_init_script(_INIT_SCRIPT)
            for route in routes:
                if should_cancel():
                    break
                pages.append(_open_route(page, base_url, route, viewport, timeout_ms, observations, seen_assets))
        finally:
            browser.close()
    return {"pages": pages, "observations": observations, "assets": seen_assets}


def _gate(route, host: str, decisions: dict[str, bool] | None = None) -> None:
    target = (urlparse(route.request.url).hostname or "").lower()
    if is_allowed_host(target, host, decisions if decisions is not None else {}):
        route.continue_()
        return
    route.abort()


def is_allowed_host(target: str, app_host: str, decisions: dict[str, bool]) -> bool:
    """The app's own host and public internet hosts are allowed, so calls to a hosted backend are measured.

    Anything that resolves to a private, loopback or link-local address stays blocked, so a scanned page cannot
    reach other services on this machine or the local network.
    """
    if target in {"", app_host}:
        return True
    if target not in decisions:
        decisions[target] = _is_public_host(target)
    return decisions[target]


def _is_public_host(host: str) -> bool:
    if host == "localhost" or host.endswith((".local", ".localhost", ".internal", ".lan")):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
                return False
        except ValueError:
            return False
    return True


def _open_route(page, base_url: str, route: str, viewport: dict, timeout_ms: int, observations: list[dict], seen_assets: list[dict]) -> dict:
    errors: list[str] = []

    def on_error(message) -> None:
        if len(errors) < 20:
            errors.append(str(message)[:500])

    page.on("pageerror", on_error)
    captured: list[dict] = []

    def on_finished(request) -> None:
        item = _from_request(request, route)
        if item is None:
            return
        captured.append(item)
        if item["resource_type"] in {"image", "media", "font", "stylesheet"}:
            seen_assets.append(item)
        elif item["resource_type"] in API_TYPES or item["failure_type"]:
            observations.append(item)

    page.on("requestfinished", on_finished)
    page.on("requestfailed", on_finished)
    status = "ok"
    summary = None
    metrics = {"lcp_ms": None, "inp_ms": None, "cls": None, "total_transfer_bytes": None, "duration_ms": None}
    try:
        page.goto(f"{base_url}{route}", wait_until="load", timeout=timeout_ms)
        page.wait_for_timeout(min(1500, timeout_ms))
        metrics = page.evaluate(_METRICS_SCRIPT)
    except Exception as exc:
        status = "failed"
        summary = str(exc).splitlines()[0][:500]
        if "timeout" in summary.lower():
            status = "timeout"
    finally:
        page.remove_listener("pageerror", on_error)
        page.remove_listener("requestfinished", on_finished)
        page.remove_listener("requestfailed", on_finished)
    if errors and summary is None:
        summary = "; ".join(errors)
    return {
        "route": route,
        "viewport_json": viewport,
        "metric_source": "lab",
        "lcp_ms": _number(metrics.get("lcp_ms")),
        "inp_ms": None,
        "cls": _number(metrics.get("cls")),
        "total_transfer_bytes": _int(metrics.get("total_transfer_bytes")),
        "duration_ms": _number(metrics.get("duration_ms")),
        "sample_count": 1,
        "status": status,
        "error_summary": summary,
        "requests": captured,
    }


def _from_request(request, route: str) -> dict | None:
    parsed = urlparse(request.url)
    if parsed.scheme not in {"http", "https"}:
        return None
    failure = None
    status_code = None
    transfer = None
    try:
        response = request.response()
    except Exception:
        response = None
    if response is not None:
        status_code = response.status
        try:
            sizes = request.sizes()
            body = sizes.get("responseBodySize")
            transfer = body if isinstance(body, int) and body >= 0 else None
        except Exception:
            transfer = None
    else:
        failure = "failed"
        message = ""
        try:
            message = (request.failure or {}).get("errorText", "") if isinstance(request.failure, dict) else str(request.failure or "")
        except Exception:
            message = ""
        if "timed" in message.lower() or "timeout" in message.lower():
            failure = "timeout"
    timing = getattr(request, "timing", None) or {}
    duration = None
    start = timing.get("requestStart", -1)
    end = timing.get("responseEnd", -1)
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and start >= 0 and end >= start:
        duration = end - start
    path = unquote(parsed.path or "/")
    return observation_record(
        route=route,
        method=request.method or "GET",
        url_path=path,
        status_code=status_code,
        duration_ms=duration,
        transfer_bytes=transfer,
        failure_type=failure if failure else ("http_error" if status_code and status_code >= 400 else None),
        resource_type=getattr(request, "resource_type", None),
    )


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _int(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return None
    return int(value)


_INIT_SCRIPT = """
window.__pulseopsLab = { lcp: null, cls: 0 };
try {
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) window.__pulseopsLab.lcp = last.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__pulseopsLab.cls += entry.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
} catch (error) {}
"""

_METRICS_SCRIPT = """
() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const resources = performance.getEntriesByType("resource");
  const transfer = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
  const lab = window.__pulseopsLab || {};
  return {
    lcp_ms: typeof lab.lcp === "number" ? lab.lcp : null,
    cls: typeof lab.cls === "number" ? lab.cls : null,
    total_transfer_bytes: transfer || null,
    duration_ms: nav && nav.duration > 0 ? nav.duration : null,
  };
}
"""
