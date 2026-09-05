#!/usr/bin/env python3
"""Stable trigger monitor for Morrow proposals and open paper positions.

A price condition may wake a fresh research review. This script never qualifies a
proposal, records a trade, or makes any external mutation.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Optional

MAX_QUOTE_AGE_MINUTES = 15.0


def parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def numeric(value: Any) -> float:
    if value is None:
        return math.nan
    try:
        return float(str(value))
    except ValueError:
        return math.nan


def half_hour_bucket(now: datetime) -> str:
    current = now.astimezone(timezone.utc)
    minute = 30 if current.minute >= 30 else 0
    return current.replace(minute=minute, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%MZ')


def build_monitor_payload(state: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    due: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []

    proposals = state.get('proposals')
    if not isinstance(proposals, list):
        proposals = []
    for proposal in proposals:
        if not isinstance(proposal, dict):
            continue
        if proposal.get('state') != 'watch' or proposal.get('decision') != 'wait_for_trigger':
            continue
        if proposal.get('trigger_status') not in {'watching', 'review_due'}:
            continue
        proposal_id = str(proposal.get('id') or '')
        symbol = str(proposal.get('symbol') or '').upper()
        if not proposal_id or not symbol:
            continue

        reasons: list[str] = []
        if proposal.get('trigger_event_id'):
            reasons.append('durable_price_event')
        review_on = parse_date(proposal.get('review_on'))
        if review_on is not None and review_on <= current.astimezone(ZoneInfo('America/New_York')).date():
            reasons.append('review_date_due')

        direction = proposal.get('trigger_direction')
        trigger = proposal.get('trigger_price')
        quote = proposal.get('quote_price')
        fetched_at = parse_time(proposal.get('quote_fetched_at'))
        quote_error = proposal.get('quote_error')
        quote_age = None if fetched_at is None else (current - fetched_at).total_seconds() / 60
        quote_fresh = (
            not quote_error
            and fetched_at is not None
            and quote_age is not None
            and 0 <= quote_age <= MAX_QUOTE_AGE_MINUTES
        )
        quote_number = numeric(quote)
        trigger_number = numeric(trigger)

        if direction in {'above', 'below'}:
            if not quote_fresh or not math.isfinite(quote_number) or not math.isfinite(trigger_number):
                blocked.append({'proposal_id': proposal_id, 'symbol': symbol, 'reason': 'failed_fetch' if quote_error else 'stale_quote'})
            elif (direction == 'above' and quote_number >= trigger_number) or (
                direction == 'below' and quote_number <= trigger_number
            ):
                reasons.append('price_trigger_met')

        if proposal.get('coverage_gap') is not False:
            blocked.append({'proposal_id': proposal_id, 'symbol': symbol, 'reason': 'missed_interval_or_unknown_coverage'})
        if reasons:
            due.append({'proposal_id': proposal_id, 'symbol': symbol, 'reasons': sorted(set(reasons))})

    due.sort(key=lambda item: (item['symbol'], item['proposal_id']))
    blocked.sort(key=lambda item: (item['symbol'], item['proposal_id']))
    open_count = int(state.get('open_paper_positions') or 0)
    open_review = {'count': open_count, 'bucket': half_hour_bucket(current)} if open_count else None
    return {'blocked': blocked, 'due': due, 'open_position_review': open_review}


def fetch_state() -> dict[str, Any]:
    scripts_dir = Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from morrow_finance_bridge import call_bridge, monitor_projection

    return monitor_projection(call_bridge('state'))


def main() -> int:
    try:
        payload = build_monitor_payload(fetch_state())
        print(json.dumps(payload, sort_keys=True, separators=(',', ':')))
        return 0
    except Exception as exc:
        sys.stderr.write(f'Morrow proposal trigger failed: {type(exc).__name__}: {exc}\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
