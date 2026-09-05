import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildStateProjection,
  computeSourceEvidenceHash,
  proposalWriteAction,
  validateScout,
  validateTrade,
  validateClose,
  validateProposal,
} from './contract.mjs';

const EXPECTED_KEY_SHA256 = '3eb826f454f490f7c3e0a941d5f87c60c67b45bc2c16724d2717999cc4abca74';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function reply(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authorized(request: Request) {
  const header = request.headers.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : '';
  return key.length >= 32 && (await sha256(key)) === EXPECTED_KEY_SHA256;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'POST required' });
  if (!(await authorized(request))) return reply(401, { error: 'unauthorized' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) return reply(503, { error: 'service configuration unavailable' });
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await request.json().catch(() => ({}));
    const operation = String(body.operation || 'state');
    const now = new Date().toISOString();

    const { data: books, error: bookError } = await db.from('v_paper_books').select('*').eq('label', 'Robinhood Savings').limit(1);
    if (bookError) throw bookError;
    const book = books?.[0];
    if (!book) return reply(409, { error: 'Robinhood Savings book unavailable' });

    async function currentState() {
      const [tradeResult, boardResult, proposalResult] = await Promise.all([
        db.from('v_trades').select('id,status,book_id,symbol,direction,qty,entry_price,target_price,stop_price,review_on,catalyst,invalidation').eq('book_id', book.book_id),
        db.from('watchlist').select('symbol,note').order('symbol', { ascending: true }),
        db.from('trade_proposals')
          .select('id,proposal_key,symbol,state,decision,trigger_direction,trigger_price,trigger_status,review_on,news_checked_at,setup,horizon,benchmark,entry_price,target_price,stop_price,entry_condition,thesis,bear_case,catalyst,invalidation,evidence,source_freshness,last_researched_at')
          .eq('book_id', book.book_id).order('updated_at', { ascending: false }).limit(50),
      ]);
      if (tradeResult.error) throw tradeResult.error;
      if (boardResult.error) throw boardResult.error;
      if (proposalResult.error) throw proposalResult.error;
      const proposals = proposalResult.data || [];
      const symbols = [...new Set(proposals.map((row) => row.symbol).filter(Boolean))];
      const quoteResult = symbols.length
        ? await db.from('quotes').select('symbol,price,fetched_at,error').in('symbol', symbols)
        : { data: [], error: null };
      if (quoteResult.error) throw quoteResult.error;
      return buildStateProjection(
        book,
        tradeResult.data || [],
        boardResult.data || [],
        proposals,
        quoteResult.data || [],
        new Date().toISOString(),
      );
    }

    if (operation === 'state') return reply(200, { ok: true, operation, state: await currentState(), mutation_calls: 0 });

    if (operation === 'add_scout') {
      const scout = validateScout(body.scout || {});
      const { error } = await db.from('watchlist').upsert(scout, { onConflict: 'symbol' });
      if (error) throw error;
      const { data: verified, error: verifyError } = await db.from('watchlist').select('symbol,note').eq('symbol', scout.symbol).single();
      if (verifyError || !verified) throw verifyError || new Error('scout read-back failed');
      return reply(200, { ok: true, operation, receipt: { symbol: verified.symbol, verified: true, at: now }, state: await currentState(), mutation_calls: 1 });
    }

    if (operation === 'record_proposal') {
      const proposal = {
        ...validateProposal(body.proposal || {}),
        book_id: book.book_id,
        source_evidence_hash: '',
        updated_at: now,
      };
      const computedEvidenceHash = await computeSourceEvidenceHash(proposal.evidence);
      if (body.proposal && Object.prototype.hasOwnProperty.call(body.proposal, 'source_evidence_hash')) {
        const suppliedEvidenceHash = String(body.proposal.source_evidence_hash || '').trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(suppliedEvidenceHash) || suppliedEvidenceHash !== computedEvidenceHash) {
          throw new Error('source evidence hash does not match normalized evidence');
        }
      }
      proposal.source_evidence_hash = computedEvidenceHash;
      const { data: existing, error: existingError } = await db.from('trade_proposals')
        .select('id,state,source_evidence_hash')
        .eq('book_id', book.book_id).eq('proposal_key', proposal.proposal_key).maybeSingle();
      if (existingError) throw existingError;
      const writeAction = proposalWriteAction(existing, proposal);
      let proposalId = existing?.id;
      if (writeAction === 'insert') {
        const { data: inserted, error: insertError } = await db.from('trade_proposals')
          .insert(proposal).select('id').single();
        if (insertError || !inserted) throw insertError || new Error('proposal insert failed');
        proposalId = inserted.id;
      } else if (writeAction === 'update') {
        if (!existing) throw new Error('proposal update requires an existing row');
        const { data: updated, error: updateError } = await db.from('trade_proposals')
          .update(proposal).eq('id', existing.id).eq('state', existing.state).select('id').single();
        if (updateError || !updated) throw updateError || new Error('proposal state changed during update');
        proposalId = updated.id;
      }
      if (!proposalId) throw new Error('proposal write did not produce an id');
      const { data: verified, error: verifyError } = await db.from('trade_proposals')
        .select('id,proposal_key,symbol,state,decision,news_checked_at,source_evidence_hash')
        .eq('id', proposalId).single();
      if (
        verifyError
        || !verified
        || verified.id !== proposalId
        || verified.state !== proposal.state
        || verified.source_evidence_hash !== computedEvidenceHash
      ) {
        throw verifyError || new Error('proposal read-back failed');
      }
      return reply(200, {
        ok: true,
        operation,
        receipt: {
          id: verified.id,
          proposal_key: verified.proposal_key,
          symbol: verified.symbol,
          state: verified.state,
          decision: verified.decision,
          news_checked_at: verified.news_checked_at,
          source_evidence_hash: verified.source_evidence_hash,
          verified: true,
          at: now,
        },
        state: await currentState(),
        mutation_calls: 1,
      });
    }

    if (operation === 'place_trade') {
      const proposalId = String(body.trade?.proposal_id || '');
      if (!proposalId) return reply(409, { error: 'proposal_id is required for Morrow paper execution' });
      const checked = validateTrade(body.trade || {}, book, { openCount: 0, todayCount: 0, existingRisk: 0 });
      const { data: rpcRows, error: rpcError } = await db.rpc('place_morrow_paper_trade', {
        p_book_id: book.book_id,
        p_proposal_id: proposalId,
        p_trade: checked.row,
      });
      if (rpcError) throw rpcError;
      const placed = Array.isArray(rpcRows) && rpcRows.length === 1 ? rpcRows[0] : null;
      if (
        !placed
        || placed.trade_id == null
        || placed.proposal_id !== proposalId
        || placed.symbol !== checked.row.symbol
        || placed.status !== 'open'
        || placed.is_real !== false
        || placed.book_id !== book.book_id
        || placed.proposal_state !== 'opened'
        || !/^[a-f0-9]{64}$/.test(String(placed.source_evidence_hash || ''))
      ) throw new Error('atomic trade read-back failed');
      return reply(200, {
        ok: true, operation,
        receipt: {
          id: placed.trade_id,
          proposal_id: placed.proposal_id,
          symbol: placed.symbol,
          status: placed.status,
          source_evidence_hash: placed.source_evidence_hash,
          verified: true,
          at: now,
        },
        state: await currentState(), mutation_calls: 1,
      });
    }

    if (operation === 'close_trade') {
      const close = validateClose(body.close || {});
      const { data: existing, error: existingError } = await db.from('trades')
        .select('id,symbol,status,is_real,book_id').eq('id', close.trade_id).eq('book_id', book.book_id)
        .eq('is_real', false).eq('status', 'open').single();
      if (existingError || !existing) return reply(404, { error: 'open paper trade not found' });
      const patch = { status: 'closed', exit_price: close.exit_price, closed_on: now.slice(0, 10), close_note: close.close_note, updated_at: now };
      const { data: closed, error } = await db.from('trades').update(patch).eq('id', existing.id)
        .select('id,symbol,status,is_real,exit_price,closed_on').single();
      if (error) throw error;
      if (!closed || closed.status !== 'closed' || closed.is_real !== false) throw new Error('close read-back failed');
      return reply(200, {
        ok: true, operation,
        receipt: { id: closed.id, symbol: closed.symbol, status: closed.status, verified: true, at: now },
        state: await currentState(), mutation_calls: 1,
      });
    }

    return reply(400, { error: 'unsupported operation' });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : String(error) });
  }
});
