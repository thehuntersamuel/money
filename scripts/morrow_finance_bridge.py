#!/usr/bin/env python3
"""Authenticated, bounded bridge for Morrow's paper-only Finance operations."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

ENDPOINT = "https://fglbxoafbebsryjeqcbu.supabase.co/functions/v1/morrow-bridge"
KEY_PATH = Path("/Users/maddox/.hermes/secrets/morrow-bridge-key")
DEFAULT_STATE = Path("/Users/maddox/Projects/Hunter/maddox-command/capital/morrow/paper-state.json")
DEFAULT_RECEIPTS = Path("/Users/maddox/Projects/Hunter/maddox-command/capital/morrow/bridge-receipts")


def load_key() -> str:
    try:
        mode = KEY_PATH.stat().st_mode & 0o777
        if mode != 0o600:
            raise RuntimeError("Morrow Finance bridge credential permissions are unsafe")
        key = KEY_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Morrow Finance bridge credential is unavailable") from exc
    if len(key) < 32:
        raise RuntimeError("Morrow Finance bridge credential is unavailable")
    return key


def load_payload(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("payload must be a JSON object")
    return value


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, raw = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    temp = Path(raw)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def call_bridge(
    operation: str,
    payload: dict[str, Any] | None = None,
    *,
    endpoint: str = ENDPOINT,
    key_loader: Callable[[], str] = load_key,
) -> dict[str, Any]:
    key = key_loader()
    body = {"operation": operation, **(payload or {})}
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Finance bridge HTTP {exc.code}: {detail}") from exc
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise RuntimeError("Finance bridge returned an invalid response")
    return value


def monitor_projection(response: dict[str, Any]) -> dict[str, Any]:
    state = response.get("state")
    if not isinstance(state, dict) or state.get("authentication_verified") is not True:
        raise RuntimeError("Finance bridge state is not authenticated")
    book = state.get("book")
    if not isinstance(book, dict) or book.get("label") != "Robinhood Savings":
        raise RuntimeError("Finance bridge returned the wrong paper book")
    return {
        "verified_at": state.get("verified_at"),
        "authentication_verified": True,
        "verification_method": "money-hub authenticated Morrow bridge",
        "source": state.get("source"),
        "source_artifact": "money-hub:morrow-bridge",
        "mutations": int(response.get("mutation_calls") or 0),
        "capital_book": {
            "book": book.get("label"),
            "book_id": book.get("book_id"),
            "book_equity": book.get("equity"),
            "buying_power": book.get("buying_power"),
            "cash_uninvested": book.get("cash"),
            "cash_invested": book.get("securities"),
            "currency": "USD",
        },
        "open_paper_positions": int(state.get("open_paper_positions") or 0),
        "closed_paper_positions": int(state.get("closed_paper_positions") or 0),
        "open_position_count": int(state.get("open_paper_positions") or 0),
        "closed_position_count": int(state.get("closed_paper_positions") or 0),
        "open_positions": [
            {
                key: item.get(key)
                for key in (
                    "id", "symbol", "direction", "qty", "entry_price",
                    "target_price", "stop_price", "review_on", "catalyst",
                    "invalidation",
                )
            }
            for item in (state.get("open_positions") or [])
            if isinstance(item, dict) and item.get("id") and item.get("symbol")
        ],
        "market_board_items": int(state.get("market_board_items") or 0),
        "market_board": [
            {"symbol": str(item.get("symbol") or ""), "note": item.get("note")}
            for item in (state.get("market_board") or [])
            if isinstance(item, dict) and item.get("symbol")
        ],
        "proposal_count": int(state.get("proposal_count") or 0),
        "proposals": [
            {
                key: item.get(key)
                for key in (
                    "id", "proposal_key", "symbol", "state", "decision",
                    "trigger_direction", "trigger_price", "trigger_status",
                    "review_on", "news_checked_at", "quote_price",
                    "quote_fetched_at", "quote_error", "setup", "horizon",
                    "benchmark", "entry_price", "target_price", "stop_price",
                    "entry_condition", "thesis", "bear_case", "catalyst",
                    "invalidation", "evidence", "source_freshness",
                    "last_researched_at", "trigger_event_id", "trigger_event_at", "coverage_gap",
                )
            }
            for item in (state.get("proposals") or [])
            if isinstance(item, dict) and item.get("id") and item.get("symbol")
        ],
        "realized_pnl": book.get("realized_pnl"),
        "open_pnl": book.get("unrealized_pnl"),
        "status": "fresh_verified_bridge",
        "readiness": state.get("readiness") or {"new_openings_allowed": False},
        "blockers": (state.get("readiness") or {}).get("blockers") or ["readiness_unverified"],
    }


def refresh_state(
    *,
    endpoint: str = ENDPOINT,
    state_path: Path = DEFAULT_STATE,
    receipt_path: Path,
    key_loader: Callable[[], str] = load_key,
) -> dict[str, Any]:
    response = call_bridge("state", endpoint=endpoint, key_loader=key_loader)
    projection = monitor_projection(response)
    receipt = {
        "ok": True,
        "operation": "state",
        "verified_at": projection["verified_at"],
        "source": projection["source"],
        "mutation_calls": 0,
        "open_paper_positions": projection["open_paper_positions"],
        "closed_paper_positions": projection["closed_paper_positions"],
        "market_board_items": projection["market_board_items"],
    }
    atomic_json(state_path, projection)
    atomic_json(receipt_path, receipt)
    return receipt


def mutate(
    operation: str,
    payload: dict[str, Any],
    *,
    state_path: Path,
    receipt_path: Path,
    endpoint: str = ENDPOINT,
    key_loader: Callable[[], str] = load_key,
) -> dict[str, Any]:
    field = {
        "add_scout": "scout",
        "record_proposal": "proposal",
        "place_trade": "trade",
        "close_trade": "close",
    }.get(operation)
    if field is None:
        raise ValueError(f"unsupported mutation operation: {operation}")
    response = call_bridge(operation, {field: payload}, endpoint=endpoint, key_loader=key_loader)
    projection = monitor_projection(response)
    receipt = response.get("receipt")
    if not isinstance(receipt, dict) or receipt.get("verified") is not True:
        raise RuntimeError("Finance bridge mutation lacked verified read-back")
    atomic_json(state_path, projection)
    atomic_json(receipt_path, {"ok": True, "operation": operation, "receipt": receipt, "state_verified_at": projection["verified_at"]})
    return receipt


def receipt_path(operation: str) -> Path:
    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d-%H%M%S")
    return DEFAULT_RECEIPTS / f"{stamp}-{operation}.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["state", "add-scout", "record-proposal", "place-trade", "close-trade"])
    parser.add_argument("--payload", type=Path)
    parser.add_argument("--state-path", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--receipt-path", type=Path)
    args = parser.parse_args()
    operation = args.operation.replace("-", "_")
    target_receipt = args.receipt_path or receipt_path(operation)
    if operation == "state":
        result = refresh_state(state_path=args.state_path, receipt_path=target_receipt)
    else:
        if args.payload is None:
            parser.error("--payload is required for mutations")
        result = mutate(operation, load_payload(args.payload), state_path=args.state_path, receipt_path=target_receipt)
    print(json.dumps({"ok": True, "operation": operation, "receipt_path": str(target_receipt), "result": result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
