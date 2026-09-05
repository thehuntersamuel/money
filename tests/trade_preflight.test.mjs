import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing from index.html`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const context = { MAX_BOOK_RISK: 2 };
vm.createContext(context);
vm.runInContext(`${extractFunction('calculateTradePreflight')}; this.calculateTradePreflight = calculateTradePreflight;`, context);
const calculate = context.calculateTradePreflight;

const book = { equity: 10000, stake: 10000, buying_power: 5000 };

{
  const result = calculate({ direction: 'long', qty: 10, entry: 100, target: 115, stop: 95, riskPct: 1 }, book, null);
  assert.equal(result.ready, true);
  assert.equal(result.entry, 100);
  assert.equal(result.impliedUpsidePct, 15);
  assert.equal(result.impliedDownsidePct, 5);
  assert.equal(result.rewardRisk, 3);
  assert.equal(result.riskLimit, 100);
  assert.equal(result.riskPerShare, 5);
  assert.equal(result.maxQtyByRisk, 20);
  assert.equal(result.maxQtyByBuyingPower, 50);
  assert.equal(result.maxQty, 20);
  assert.equal(result.plannedLoss, 50);
  assert.equal(result.riskUsedPct, 0.5);
  assert.equal(result.capitalCommitted, 1000);
  assert.equal(result.deploymentPct, 10);
  assert.equal(result.remainingBuyingPower, 4000);
}

{
  const result = calculate({ direction: 'long', qty: '', entry: '', target: 115, stop: 95, riskPct: 1 }, book, { price: 100 });
  assert.equal(result.ready, true);
  assert.equal(result.entry, 100);
  assert.equal(result.maxQty, 20);
  assert.equal(result.plannedLoss, null);
  assert.equal(result.capitalCommitted, null);
}

{
  const result = calculate({ direction: 'short', qty: 4, entry: 100, target: 85, stop: 105, riskPct: 1 }, book, null);
  assert.equal(result.ready, true);
  assert.equal(result.rewardRisk, 3);
  assert.equal(result.plannedLoss, 20);
  assert.equal(result.maxQty, 20);
}

{
  const result = calculate({ direction: 'long', qty: 30, entry: 100, target: 115, stop: 95, riskPct: 1 }, book, null);
  assert.equal(result.overRisk, true);
  assert.equal(result.overBuyingPower, false);
  assert.equal(result.withinLimits, false);
}

{
  const result = calculate({ direction: 'long', qty: 60, entry: 100, target: 115, stop: 95, riskPct: 1 }, book, null);
  assert.equal(result.overRisk, true);
  assert.equal(result.overBuyingPower, true);
  assert.equal(result.withinLimits, false);
}

{
  const result = calculate({ direction: 'long', qty: 10, entry: 100, target: 95, stop: 105, riskPct: 1 }, book, null);
  assert.equal(result.ready, false);
  assert.match(result.reason, /long/i);
}

{
  const result = calculate({ direction: 'long', qty: 10, entry: 100, target: 115, stop: 100, riskPct: 1 }, book, null);
  assert.equal(result.ready, false);
  assert.match(result.reason, /stop/i);
}

{
  const result = calculate({ direction: 'long', qty: 10, entry: 100, target: 115, stop: 95, riskPct: 2.01 }, book, null);
  assert.equal(result.ready, false);
  assert.match(result.reason, /2%/i);
}

{
  const result = calculate(
    { direction: 'long', qty: 10, entry: 100, target: 115, stop: 95, riskPct: 1 },
    { equity: 10000, buying_power: 'not available' },
    null,
  );
  assert.equal(result.ready, false);
  assert.match(result.reason, /buying power/i);
}

{
  const result = calculate({ direction: 'long', qty: 'nope', entry: 100, target: 115, stop: 95, riskPct: 1 }, book, null);
  assert.equal(result.ready, false);
  assert.match(result.reason, /quantity/i);
}

assert.match(html, /id="trade-preflight"/, 'the ticket needs a visible preflight region');
assert.match(html, /function renderTradePreflight\(/, 'the ticket needs a preflight renderer');
assert.match(html, /tradePreflightInputs/, 'the preflight must update from ticket inputs');

console.log('trade preflight contract: 10 calculation cases and UI wiring passed');
