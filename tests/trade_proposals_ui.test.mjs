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

assert.match(html, /id="morrow-proposals"/, 'Trade needs a visible Morrow proposal section');
assert.match(html, /function renderProposals\(/, 'proposal rows need their own renderer');
assert.match(html, /Current source review/, 'proposal cards must show research freshness');
assert.match(html, /Strongest bear/, 'proposal cards must show the strongest bear case');
assert.match(html, /Why rejected/, 'proposal cards must explain rejection');
assert.match(html, /Entry condition/, 'proposal cards must expose the price condition without treating it as authorization');
assert.match(html, /Price can trigger a fresh review, but never a paper trade by itself\./, 'the UI must state the trigger boundary');

const context = { URL };
vm.createContext(context);
vm.runInContext(`${extractFunction('safeProposalUrl')}; this.safeProposalUrl = safeProposalUrl;`, context);
assert.equal(context.safeProposalUrl('https://investor.example.com/release'), 'https://investor.example.com/release');
assert.equal(context.safeProposalUrl('http://investor.example.com/release'), null);
assert.equal(context.safeProposalUrl('javascript:alert(1)'), null);
assert.equal(context.safeProposalUrl('https://user:pass@investor.example.com/private'), null);
assert.equal(context.safeProposalUrl('not a URL'), null);

console.log('trade proposal UI contract and URL safety passed');
assert.match(html,/proposals: loadProposalQueue/, 'queue uses paginated reads');
