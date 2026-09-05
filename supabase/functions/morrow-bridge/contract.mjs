const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROPOSAL_STATES = ['watch', 'rejected', 'qualified'];
const PROPOSAL_DECISIONS = ['wait_for_trigger', 'rejected', 'qualified'];
const PROPOSAL_SETUPS = ['core', 'swing', 'catalyst', 'hedge'];

function finiteNumber(value, label) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function isoTime(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(text).toISOString();
}

/**
 * Canonical evidence bytes are compact UTF-8 JSON. Source order is preserved and
 * every normalized source uses this exact key order: url, title, retrieved_at,
 * source_type. No caller-supplied fields participate in the digest.
 */
export function serializeNormalizedEvidence(evidence) {
  if (!Array.isArray(evidence)) throw new Error('normalized evidence must be an array');
  return JSON.stringify(evidence.map((source) => ({
    url: source.url,
    title: source.title,
    retrieved_at: source.retrieved_at,
    source_type: source.source_type,
  })));
}

export async function computeSourceEvidenceHash(evidence) {
  const bytes = new TextEncoder().encode(serializeNormalizedEvidence(evidence));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function proposalWriteAction(existing, incoming) {
  if (!existing) return 'insert';
  if (existing.state === 'watch' && PROPOSAL_STATES.includes(incoming.state)) return 'update';
  if (existing.state === 'qualified' && incoming.state === 'qualified') return 'update';
  if (
    existing.state === 'rejected'
    && incoming.state === 'rejected'
    && existing.source_evidence_hash === incoming.source_evidence_hash
  ) return 'replay';
  throw new Error(`proposal transition from ${existing.state} to ${incoming.state} is not allowed`);
}

export function buildStateProjection(book, trades, watchlist, proposals, quotes, verifiedAt) {
  if (!book || book.label !== 'Robinhood Savings') throw new Error('Robinhood Savings book is unavailable');
  const rows = Array.isArray(trades) ? trades : [];
  const proposalRows = Array.isArray(proposals) ? proposals : [];
  const quoteBySymbol = Object.fromEntries(
    (Array.isArray(quotes) ? quotes : []).map((row) => [String(row.symbol || '').toUpperCase(), row]),
  );
  return {
    schema: 2,
    readiness: { new_openings_allowed: false, real_trading_allowed: false, blockers: ['reliability_deployment_unverified','sip_entitlement_unverified','champion_freeze_unverified'] },
    verified_at: requiredText(verifiedAt, 'verified_at'),
    authentication_verified: true,
    source: 'money-hub:morrow-bridge',
    book: {
      book_id: book.book_id,
      label: book.label,
      equity: book.equity == null || !Number.isFinite(Number(book.equity)) ? null : Number(book.equity),
      buying_power: book.buying_power == null || !Number.isFinite(Number(book.buying_power)) ? null : Number(book.buying_power),
      cash: book.cash == null || !Number.isFinite(Number(book.cash)) ? null : Number(book.cash),
      securities: book.securities == null || !Number.isFinite(Number(book.securities)) ? null : Number(book.securities),
      realized_pnl: book.realized_pnl == null || !Number.isFinite(Number(book.realized_pnl)) ? null : Number(book.realized_pnl),
      unrealized_pnl: book.unrealized_pnl == null || !Number.isFinite(Number(book.unrealized_pnl)) ? null : Number(book.unrealized_pnl),
    },
    open_paper_positions: Number(book.n_open || rows.filter((row) => row.status === 'open').length),
    closed_paper_positions: Number(book.n_closed || rows.filter((row) => row.status === 'closed').length),
    open_positions: rows.filter((row) => row.status === 'open').map((row) => ({
      id: row.id,
      symbol: String(row.symbol || '').toUpperCase(),
      direction: row.direction,
      qty: Number(row.qty),
      entry_price: Number(row.entry_price),
      target_price: Number(row.target_price),
      stop_price: Number(row.stop_price),
      review_on: row.review_on,
      catalyst: row.catalyst,
      invalidation: row.invalidation,
    })),
    market_board_items: Array.isArray(watchlist) ? watchlist.length : 0,
    market_board: (Array.isArray(watchlist) ? watchlist : []).map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      note: row.note == null ? null : String(row.note),
    })),
    proposal_count: proposalRows.length,
    proposals: proposalRows.map((row) => {
      const symbol = String(row.symbol || '').toUpperCase();
      const quote = quoteBySymbol[symbol] || {};
      return {
        id: row.id,
        proposal_key: row.proposal_key,
        thesis_version: row.thesis_version,
        symbol,
        state: row.state,
        decision: row.decision,
        trigger_direction: row.trigger_direction,
        trigger_price: row.trigger_price == null ? null : Number(row.trigger_price),
        trigger_status: row.trigger_status,
        review_on: row.review_on,
        news_checked_at: row.news_checked_at,
        setup: row.setup,
        horizon: row.horizon,
        benchmark: row.benchmark,
        entry_price: row.entry_price == null ? null : Number(row.entry_price),
        target_price: row.target_price == null ? null : Number(row.target_price),
        stop_price: row.stop_price == null ? null : Number(row.stop_price),
        entry_condition: row.entry_condition,
        thesis: row.thesis,
        bear_case: row.bear_case,
        catalyst: row.catalyst,
        invalidation: row.invalidation,
        evidence: Array.isArray(row.evidence) ? row.evidence : [],
        source_freshness: row.source_freshness,
        last_researched_at: row.last_researched_at,
        trigger_event_id: row.trigger_event_id || null,
        trigger_event_at: row.trigger_event_at || null,
        coverage_gap: row.coverage_gap !== false,
        quote_price: quote.price == null ? null : Number(quote.price),
        quote_fetched_at: quote.fetched_at || null,
        quote_error: quote.error || null,
      };
    }),
  };
}

export function validateScout(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error('symbol is invalid');
  return { symbol, note: requiredText(input?.note, 'note') };
}

export function validateProposal(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error('symbol is invalid');
  const state = String(input?.state || '');
  if (!PROPOSAL_STATES.includes(state)) throw new Error('proposal state is invalid');
  const decision = String(input?.decision || '');
  if (!PROPOSAL_DECISIONS.includes(decision)) throw new Error('proposal decision is invalid');
  const setup = String(input?.setup || '');
  if (!PROPOSAL_SETUPS.includes(setup)) throw new Error('proposal setup is invalid');
  const horizon = input?.horizon === 'long' ? 'long' : input?.horizon === 'short' ? 'short' : '';
  if (!horizon) throw new Error('proposal horizon must be short or long');
  const assetType = String(input?.asset_type || '');
  if (!['equity', 'etf'].includes(assetType)) throw new Error('proposal asset type must be equity or ETF');
  const direction = input?.direction === 'short' ? 'short' : input?.direction === 'long' ? 'long' : '';
  if (!direction) throw new Error('proposal direction must be long or short');
  const triggerDirection = String(input?.trigger_direction || 'none');
  if (!['above', 'below', 'none'].includes(triggerDirection)) throw new Error('trigger direction is invalid');
  const evidence = Array.isArray(input?.evidence) ? input.evidence : [];
  const normalizedEvidence = evidence.map((source) => {
    if (!source || typeof source !== 'object') throw new Error('proposal evidence must contain source objects');
    const url = requiredText(source.url, 'evidence URL');
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('evidence URL must be a valid HTTPS URL');
    }
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
      throw new Error('evidence URL must use HTTPS with a hostname and no credentials');
    }
    return {
      url: parsedUrl.href,
      title: requiredText(source.title, 'evidence title'),
      retrieved_at: isoTime(source.retrieved_at, 'evidence retrieval time'),
      source_type: requiredText(source.source_type, 'evidence source type'),
    };
  });
  if (normalizedEvidence.filter((source) => source.source_type === 'primary').length < 2) {
    throw new Error('proposal requires at least two primary sources');
  }
  const confidence = finiteNumber(input?.confidence, 'confidence');
  if (confidence < 1 || confidence > 100) throw new Error('confidence must be between 1 and 100');
  const sourceFreshness = String(input?.source_freshness || '');
  if (!['fresh', 'stale', 'unknown'].includes(sourceFreshness)) throw new Error('source freshness is invalid');
  const newsCheckedAt = isoTime(input?.news_checked_at, 'news checked time');
  if (!ISO_DATE.test(String(input?.review_on || ''))) throw new Error('review_on must be an ISO date');
  const triggerPrice = triggerDirection === 'none' ? null : finiteNumber(input?.trigger_price, 'trigger price');
  if (triggerPrice !== null && triggerPrice <= 0) throw new Error('trigger price must be positive');
  const observed = finiteNumber(input?.observed_price, 'observed price');
  const entry = finiteNumber(input?.entry_price, 'entry price');
  const target = finiteNumber(input?.target_price, 'target price');
  const stop = finiteNumber(input?.stop_price, 'stop price');
  if (observed <= 0 || entry <= 0 || target <= 0 || stop <= 0) throw new Error('proposal prices must be positive');
  if (direction === 'long' && !(stop < entry && target > entry)) throw new Error('long proposal geometry is invalid');
  if (direction === 'short' && !(target < entry && stop > entry)) throw new Error('short proposal geometry is invalid');
  if (Math.abs(target - entry) / Math.abs(entry - stop) < 1.5) throw new Error('proposal reward-to-risk is below 1.5:1');
  const rejectionReason = input?.rejection_reason == null ? null : String(input.rejection_reason).trim() || null;
  if (state === 'rejected' && (!rejectionReason || decision !== 'rejected')) throw new Error('rejected proposal requires a rejection reason');
  if (state === 'watch' && (decision !== 'wait_for_trigger' || triggerDirection === 'none')) throw new Error('watch proposal requires a trigger');
  if (state === 'qualified' && decision !== 'qualified') throw new Error('qualified proposal decision is invalid');
  return {
    proposal_key: requiredText(input?.proposal_key, 'proposal key'),
    owner_id: 'morrow',
    symbol,
    asset_name: requiredText(input?.asset_name, 'asset name'),
    asset_type: assetType,
    state,
    direction,
    setup,
    horizon,
    benchmark: requiredText(input?.benchmark, 'benchmark'),
    observed_at: isoTime(input?.observed_at, 'observed time'),
    observed_price: observed,
    entry_price: entry,
    target_price: target,
    stop_price: stop,
    entry_condition: requiredText(input?.entry_condition, 'entry condition'),
    trigger_direction: triggerDirection,
    trigger_price: triggerPrice,
    trigger_status: state === 'qualified' ? 'reviewed' : triggerDirection === 'none' ? 'inactive' : 'watching',
    review_on: input.review_on,
    confidence: Math.round(confidence),
    thesis: requiredText(input?.thesis, 'thesis'),
    bull_case: requiredText(input?.bull_case, 'bull case'),
    bear_case: requiredText(input?.bear_case, 'bear case'),
    catalyst: requiredText(input?.catalyst, 'catalyst'),
    invalidation: requiredText(input?.invalidation, 'invalidation'),
    evidence: normalizedEvidence,
    source_freshness: sourceFreshness,
    news_checked_at: newsCheckedAt,
    decision,
    rejection_reason: rejectionReason,
    thesis_version: Math.max(1, Math.trunc(finiteNumber(input?.thesis_version, 'thesis version'))),
    last_researched_at: newsCheckedAt,
  };
}

export function validateProposalExecution(proposal, tradeSymbol, nowMs) {
  if (!proposal || typeof proposal !== 'object') throw new Error('qualified proposal not found');
  if (proposal.state !== 'qualified') throw new Error('proposal is not qualified');
  if (String(proposal.symbol || '').toUpperCase() !== String(tradeSymbol || '').toUpperCase()) {
    throw new Error('trade symbol does not match proposal');
  }
  const checkedAt = Date.parse(String(proposal.news_checked_at || ''));
  const ageMs = Number(nowMs) - checkedAt;
  if (
    proposal.source_freshness !== 'fresh'
    || !Number.isFinite(checkedAt)
    || !Number.isFinite(ageMs)
    || ageMs < -300000
    || ageMs > 21600000
  ) {
    throw new Error('proposal news and source review is stale');
  }
  return proposal;
}

export function validateTrade(input, book, usage) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error('symbol is invalid');
  const direction = input?.direction === 'short' ? 'short' : input?.direction === 'long' ? 'long' : '';
  if (!direction) throw new Error('direction must be long or short');
  const horizon = input?.horizon === 'long' ? 'long' : input?.horizon === 'short' ? 'short' : '';
  if (!horizon) throw new Error('horizon must be short or long');
  const setup = requiredText(input?.setup, 'setup');
  const qty = finiteNumber(input?.qty, 'quantity');
  const entry = finiteNumber(input?.entry_price, 'entry price');
  const target = finiteNumber(input?.target_price, 'target price');
  const stop = finiteNumber(input?.stop_price, 'stop price');
  if (qty <= 0 || entry <= 0 || target <= 0 || stop <= 0) throw new Error('quantity and prices must be positive');
  if (direction === 'long' && !(stop < entry && target > entry)) throw new Error('long target and stop geometry is invalid');
  if (direction === 'short' && !(target < entry && stop > entry)) throw new Error('short target and stop geometry is invalid');
  const reward = Math.abs(target - entry);
  const riskPerShare = Math.abs(entry - stop);
  const rewardRisk = reward / riskPerShare;
  if (rewardRisk < 1.5) throw new Error('reward-to-risk must be at least 1.5:1');
  const equity = finiteNumber(book?.equity, 'book equity');
  const buyingPower = finiteNumber(book?.buying_power, 'buying power');
  const plannedLoss = riskPerShare * qty;
  const cost = entry * qty;
  if (cost > buyingPower) throw new Error('trade cost exceeds buying power');
  if (plannedLoss > equity * 0.005) throw new Error('planned loss exceeds the 0.5% per-trade cap');
  if (Number(usage?.openCount || 0) >= 3) throw new Error('three open positions already exist');
  if (Number(usage?.todayCount || 0) >= 1) throw new Error('only one new trade is allowed per day');
  if (Number(usage?.existingRisk || 0) + plannedLoss > equity * 0.01) throw new Error('total open risk exceeds the 1% cap');
  const confidence = finiteNumber(input?.confidence, 'confidence');
  if (confidence < 1 || confidence > 100) throw new Error('confidence must be between 1 and 100');
  if (!ISO_DATE.test(String(input?.review_on || ''))) throw new Error('review_on must be an ISO date');
  const statedUp = finiteNumber(input?.stated_upside_pct, 'stated upside');
  const statedDown = finiteNumber(input?.stated_downside_pct, 'stated downside');
  if (statedUp <= 0 || statedDown <= 0 || statedUp / statedDown < 1.5) throw new Error('stated reward-to-risk must be at least 1.5:1');
  const maxBookRiskPct = finiteNumber(input?.max_book_risk_pct, 'max book risk');
  if (maxBookRiskPct <= 0 || maxBookRiskPct > 0.5) throw new Error('max book risk must be at most 0.5%');
  return {
    row: {
      symbol, direction, horizon,
      setup,
      qty, entry_price: entry, target_price: target, stop_price: stop,
      confidence: Math.round(confidence),
      stated_upside_pct: finiteNumber(input?.stated_upside_pct, 'stated upside'),
      stated_downside_pct: finiteNumber(input?.stated_downside_pct, 'stated downside'),
      max_book_risk_pct: maxBookRiskPct,
      planned_loss: Math.round(plannedLoss * 100) / 100,
      review_on: input.review_on,
      thesis: requiredText(input?.thesis, 'thesis'),
      catalyst: requiredText(input?.catalyst, 'catalyst'),
      invalidation: requiredText(input?.invalidation, 'invalidation'),
      evidence: requiredText(input?.evidence, 'evidence'),
      is_real: false,
      status: 'open',
    },
    rewardRisk,
    plannedLoss,
    cost,
  };
}

export function validateClose(input) {
  return {
    trade_id: requiredText(input?.trade_id, 'trade id'),
    exit_price: (() => {
      const value = finiteNumber(input?.exit_price, 'exit price');
      if (value <= 0) throw new Error('exit price must be positive');
      return value;
    })(),
    close_note: requiredText(input?.close_note, 'close note'),
  };
}
