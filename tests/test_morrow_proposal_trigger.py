import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'morrow_proposal_trigger.py'


def load_module():
    spec = importlib.util.spec_from_file_location('morrow_proposal_trigger', MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError('could not load Morrow proposal trigger module')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MorrowProposalTriggerTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.now = datetime(2026, 8, 31, 14, 17, tzinfo=timezone.utc)

    def state(self, **proposal_changes):
        proposal = {
            'id': 'proposal-1', 'proposal_key': 'run:NVDA:v1', 'symbol': 'NVDA',
            'state': 'watch', 'decision': 'wait_for_trigger',
            'trigger_direction': 'above', 'trigger_price': 220,
            'trigger_status': 'watching', 'review_on': '2026-09-01',
            'news_checked_at': '2026-08-31T13:45:00Z',
            'quote_price': 219, 'quote_fetched_at': '2026-08-31T14:15:00Z',
            'quote_error': None, 'coverage_gap': False,
        }
        proposal.update(proposal_changes)
        return {'open_paper_positions': 0, 'proposals': [proposal]}

    def test_price_below_trigger_is_stable_no_action(self):
        result = self.module.build_monitor_payload(self.state(), self.now)
        self.assertEqual(result, {'blocked': [], 'due': [], 'open_position_review': None})

    def test_price_crossing_only_wakes_fresh_full_review(self):
        result = self.module.build_monitor_payload(self.state(quote_price=220.25), self.now)
        self.assertEqual(result['due'], [{
            'proposal_id': 'proposal-1', 'symbol': 'NVDA',
            'reasons': ['price_trigger_met'],
        }])
        self.assertNotIn('quote_price', result['due'][0])
        self.assertNotIn('qualified', result['due'][0])

    def test_review_date_wakes_research_even_without_price_trigger(self):
        result = self.module.build_monitor_payload(self.state(review_on='2026-08-31'), self.now)
        self.assertEqual(result['due'][0]['reasons'], ['review_date_due'])

    def test_stale_quote_blocks_price_trigger_instead_of_guessing(self):
        result = self.module.build_monitor_payload(
            self.state(quote_price=225, quote_fetched_at='2026-08-31T13:00:00Z'),
            self.now,
        )
        self.assertEqual(result['due'], [])
        self.assertEqual(result['blocked'], [{
            'proposal_id': 'proposal-1', 'symbol': 'NVDA', 'reason': 'stale_quote',
        }])

    def test_transient_crossing_remains_due_after_price_recedes(self):
        state = self.state(quote_price=219, trigger_event_id='event-1')
        result = self.module.build_monitor_payload(state, self.now)
        self.assertEqual(result['due'][0]['reasons'], ['durable_price_event'])
        self.assertEqual(self.module.build_monitor_payload(state, self.now), result)

    def test_fetch_failure_and_unknown_coverage_are_not_no_crossing(self):
        result = self.module.build_monitor_payload(self.state(quote_error='fetch failed', coverage_gap=None), self.now)
        self.assertEqual({x['reason'] for x in result['blocked']}, {'failed_fetch', 'missed_interval_or_unknown_coverage'})

    def test_review_date_uses_new_york_not_utc(self):
        now = datetime(2026, 9, 1, 1, 0, tzinfo=timezone.utc)
        result = self.module.build_monitor_payload(self.state(review_on='2026-09-01'), now)
        self.assertEqual(result['due'], [])

    def test_open_positions_change_monitor_hash_once_per_half_hour(self):
        state = {'open_paper_positions': 1, 'proposals': []}
        first = self.module.build_monitor_payload(state, self.now)
        second = self.module.build_monitor_payload(
            state, datetime(2026, 8, 31, 14, 32, tzinfo=timezone.utc),
        )
        self.assertEqual(first['open_position_review'], {'count': 1, 'bucket': '2026-08-31T14:00Z'})
        self.assertEqual(second['open_position_review'], {'count': 1, 'bucket': '2026-08-31T14:30Z'})


if __name__ == '__main__':
    unittest.main()
