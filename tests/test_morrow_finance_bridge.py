import importlib.util
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'morrow_finance_bridge.py'


def load_module():
    spec = importlib.util.spec_from_file_location('morrow_finance_bridge', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


class Handler(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        type(self).calls.append({'authorization': self.headers.get('authorization'), 'body': body})
        payload = {
            'ok': True,
            'operation': body['operation'],
            'mutation_calls': 0,
            'state': {
                'schema': 1,
                'verified_at': '2026-08-28T17:00:00Z',
                'authentication_verified': True,
                'source': 'money-hub:morrow-bridge',
                'book': {
                    'book_id': 'book-1', 'label': 'Robinhood Savings', 'equity': 10000,
                    'buying_power': 9000, 'cash': 9000, 'securities': 1000,
                    'realized_pnl': 0, 'unrealized_pnl': 0,
                },
                'open_paper_positions': 0,
                'closed_paper_positions': 0,
                'open_positions': [],
                'market_board_items': 2,
                'market_board': [{'symbol': 'SPY', 'note': None}, {'symbol': 'QQQ', 'note': None}],
                'proposal_count': 1,
                'proposals': [{'thesis_version': 3,
                    'id': 'proposal-1', 'proposal_key': 'run:SPY:v1', 'symbol': 'SPY',
                    'state': 'watch', 'decision': 'wait_for_trigger',
                    'trigger_direction': 'above', 'trigger_price': 101,
                    'trigger_status': 'watching', 'review_on': '2026-08-29',
                    'news_checked_at': '2026-08-28T16:30:00Z',
                    'setup': 'swing', 'horizon': 'short', 'benchmark': 'SPY',
                    'entry_price': 101, 'target_price': 110, 'stop_price': 97,
                    'entry_condition': 'Reclaim $101 after fresh review.',
                    'thesis': 'Breadth improves.', 'bear_case': 'Inflation reaccelerates.',
                    'catalyst': 'Current inflation release.', 'invalidation': 'Close below $97.',
                    'evidence': [{'url': 'https://example.com/release', 'source_type': 'primary'}],
                    'source_freshness': 'fresh', 'last_researched_at': '2026-08-28T16:30:00Z',
                    'quote_price': 100.5, 'quote_fetched_at': '2026-08-28T16:59:00Z',
                    'quote_error': None,
                }],
            },
        }
        if body['operation'] != 'state':
            payload['mutation_calls'] = 1
            payload['receipt'] = {
                'id': 'proposal-1', 'proposal_key': 'run:SPY:v1',
                'symbol': 'SPY', 'verified': True,
            }
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_):
        pass


class MorrowFinanceBridgeTests(unittest.TestCase):
    def setUp(self):
        Handler.calls = []
        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.module = load_module()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_refresh_writes_monitor_compatible_projection_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / 'paper-state.json'
            receipt_path = Path(tmp) / 'receipt.json'
            result = self.module.refresh_state(
                endpoint=f'http://127.0.0.1:{self.server.server_port}',
                state_path=state_path,
                receipt_path=receipt_path,
                key_loader=lambda: 'test-secret-key-that-is-long-enough',
            )
            state = json.loads(state_path.read_text())
            receipt = json.loads(receipt_path.read_text())
            self.assertTrue(result['ok'])
            self.assertTrue(state['authentication_verified'])
            self.assertEqual(state['open_paper_positions'], 0)
            self.assertEqual(state['open_positions'], [])
            self.assertEqual(state['market_board_items'], 2)
            self.assertEqual([item['symbol'] for item in state['market_board']], ['SPY', 'QQQ'])
            self.assertEqual(state['proposal_count'], 1)
            self.assertEqual(state['proposals'][0]['proposal_key'], 'run:SPY:v1')
            self.assertEqual(state['proposals'][0]['thesis_version'], 3)
            self.assertEqual(state['proposals'][0]['bear_case'], 'Inflation reaccelerates.')
            self.assertEqual(state['capital_book']['book'], 'Robinhood Savings')
            self.assertEqual(state['mutations'], 0)
            self.assertEqual(receipt['operation'], 'state')
            self.assertEqual(Handler.calls[0]['authorization'], 'Bearer test-secret-key-that-is-long-enough')
            self.assertNotIn('test-secret-key', state_path.read_text())
            self.assertNotIn('test-secret-key', receipt_path.read_text())

    def test_record_proposal_uses_proposal_wrapper_and_verified_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / 'paper-state.json'
            receipt_path = Path(tmp) / 'receipt.json'
            result = self.module.mutate(
                'record_proposal',
                {'proposal_key': 'run:SPY:v1', 'symbol': 'SPY'},
                state_path=state_path,
                receipt_path=receipt_path,
                endpoint=f'http://127.0.0.1:{self.server.server_port}',
                key_loader=lambda: 'test-secret-key-that-is-long-enough',
            )
            self.assertTrue(result['verified'])
            self.assertEqual(Handler.calls[0]['body']['proposal']['proposal_key'], 'run:SPY:v1')
            self.assertNotIn('close', Handler.calls[0]['body'])

    def test_bad_payload_is_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = Path(tmp) / 'payload.json'
            payload.write_text('[]')
            with self.assertRaisesRegex(ValueError, 'object'):
                self.module.load_payload(payload)
            self.assertEqual(Handler.calls, [])


if __name__ == '__main__':
    unittest.main()
