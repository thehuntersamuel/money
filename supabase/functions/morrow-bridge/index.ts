import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildStateProjection,
  computeSourceEvidenceHash,
  proposalWriteAction,
  validateScout,
  validateTrade,
  validateClose,
  validateProposal,
} from './contract.mjs';

import { validateResearch, researchSummary } from './research.mjs';

const EXPECTED_KEY_SHA256 = '3eb826f454f490f7c3e0a941d5f87c60c67b45bc2c16724d2717999cc4abca74';
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function reply(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function newYorkDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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
          .select('id,proposal_key,symbol,state,decision,trigger_direction,trigger_price,trigger_status,review_on,news_checked_at,setup,horizon,benchmark,entry_price,target_price,stop_price,entry_condition,thesis,bear_case,catalyst,invalidation,evidence,source_freshness,last_researched_at,thesis_version')
          .eq('book_id', book.book_id).in('state', ['watch','qualified','opened']).order('id', { ascending: true }).limit(501),
      ]);
      if (tradeResult.error) throw tradeResult.error;
      if (boardResult.error) throw boardResult.error;
      if (proposalResult.error) throw proposalResult.error;
      const proposals = proposalResult.data || [];
      if (proposals.length > 500) throw new Error('Active proposal coverage exceeds monitor capacity; state unavailable');
      const eventResult = await db.from('morrow_current_trigger_events')
        .select('id,proposal_id,thesis_version,observed_at').eq('book_id', book.book_id).order('proposal_id', {ascending:true}).limit(501);
      if (eventResult.error) throw eventResult.error;
      if ((eventResult.data || []).length > 500) throw new Error('Trigger event coverage exceeds monitor capacity');
      for (const p of proposals) {
        const event = (eventResult.data || []).find(e => e.proposal_id === p.id && e.thesis_version === p.thesis_version);
        p.trigger_event_id = event?.id || null;
        p.trigger_event_at = event?.observed_at || null;
        p.coverage_gap = true; // Streaming coverage is not yet certified.
      }
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

    if (operation === 'data_read') {
      const dataset=String(body.dataset||'');
      if(!['alpaca_sip','tiingo_eod','sec_submissions'].includes(dataset))return reply(400,{error:'unsupported dataset'});
      const providerPrefix=dataset==='alpaca_sip'?'ALPACA':dataset==='tiingo_eod'?'TIINGO':null;
      if(providerPrefix&&(Deno.env.get(providerPrefix+'_LICENSE_APPROVED')!=='true'||Deno.env.get(providerPrefix+'_DISPLAY_APPROVED')!=='true'))return reply(200,{ok:true,operation,dataset,snapshot:null,observations:[],status:'data_unavailable',reason:'current_provider_use_not_approved',mutation_calls:0});
      const {data,error}=await db.from('morrow_data_snapshots').select('id,provider,dataset,received_at,display_allowed,payload').eq('dataset',dataset).eq('display_allowed',true).order('received_at',{ascending:false}).limit(1);
      if(error)return reply(503,{error:'data projection unavailable'});
      let observations=[];
      if(dataset==='alpaca_sip'){
        const symbols=body.symbols;
        if(symbols!=null&&(!Array.isArray(symbols)||symbols.length>30||symbols.some(s=>typeof s!=='string'||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s))))return reply(400,{error:'invalid bounded symbols'});
        let q=db.from('morrow_market_observations').select('source_id,symbol,provider,feed,event_at,received_at,session,bid,ask,last,gap,is_test').eq('is_test',false).order('event_at',{ascending:false}).limit(100);
        if(symbols?.length)q=q.in('symbol',symbols);
        const observed=await q;if(observed.error)return reply(503,{error:'observation projection unavailable'});observations=observed.data||[];
      }
      return reply(200,{ok:true,operation,dataset,snapshot:data?.[0]||null,observations,observation_limit:100,status:observations.length?'observations_available_check_timestamp':data?.length?'snapshot_available_check_timestamp':'data_unavailable',mutation_calls:0});
    }
    if (operation === 'research_state') {
      const limit = 100;
      const before = body.before == null ? null : String(body.before);
      if (before && (!/^[0-9a-f-]{36}$/.test(before))) return reply(400, {error:'invalid research cursor'});
      let query = db.from('morrow_research_records').select('id,book_id,kind,idempotency_key,created_at,payload,server_sha256').eq('book_id',book.book_id).order('id',{ascending:false}).limit(limit+1);
      if (before) query=query.lt('id',before);
      const {data,error}=await query;
      if(error) return reply(503,{error:'research projection unavailable'});
      const rows=(data||[]).slice(0,limit);
      const recent=[...rows].sort((a,b)=>b.created_at.localeCompare(a.created_at));
      return reply(200,{ok:true,operation,records:rows,summary:researchSummary(recent,{truncated:(data||[]).length>limit||!!before}),next_cursor:(data||[]).length>limit?rows[rows.length-1].id:null,mutation_calls:0});
    }
    if (operation === 'record_research') {
      const record=validateResearch(body.record);
      const {data,error}=await db.rpc('append_morrow_research',{p_book_id:book.book_id,p_kind:record.kind,p_key:record.idempotency_key,p_payload:record.payload});
      if(error) return reply(409,{error:'research record rejected; verify references and idempotency'});
      const saved=Array.isArray(data)?data[0]:data;
      if(!saved?.id) throw new Error('research write receipt missing');
      const {data:verified,error:verifyError}=await db.from('morrow_research_records').select('id,book_id,kind,idempotency_key,server_sha256').eq('id',saved.id).eq('book_id',book.book_id).single();
      if(verifyError||!verified||verified.server_sha256!==saved.server_sha256)throw new Error('research independent readback failed');
      return reply(200,{ok:true,operation,receipt:{...verified,verified:true,at:now},mutation_calls:1});
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
        .select('id,state,source_evidence_hash,thesis_version')
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
          .update(proposal).eq('id', existing.id).eq('state', existing.state).eq('thesis_version',existing.thesis_version).select('id').single();
        if (updateError || !updated) throw updateError || new Error('proposal state changed during update');
        proposalId = updated.id;
      }
      if (!proposalId) throw new Error('proposal write did not produce an id');
      const { data: verified, error: verifyError } = await db.from('trade_proposals')
        .select('id,proposal_key,symbol,state,decision,news_checked_at,source_evidence_hash,thesis_version')
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
          thesis_version: verified.thesis_version,
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
      return reply(409, { error: 'New Morrow openings blocked: readiness, SIP entitlement and champion freeze are not verified' });
      /* Retained for reviewed reactivation after readiness gates pass. */
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
      const { data: rpcRows, error: rpcError } = await db.rpc('close_morrow_paper_trade', {
        p_book_id: book.book_id,
        p_trade_id: close.trade_id,
        p_exit_price: close.exit_price,
        p_close_note: close.close_note,
      });
      if (rpcError) {
        if (String(rpcError.message || '').includes('open paper trade not found')) {
          return reply(404, { error: 'open paper trade not found' });
        }
        throw rpcError;
      }
      const closed = Array.isArray(rpcRows) && rpcRows.length === 1 ? rpcRows[0] : null;
      if (
        !closed
        || closed.trade_id !== close.trade_id
        || closed.status !== 'closed'
        || closed.is_real !== false
        || closed.book_id !== book.book_id
        || Number(closed.exit_price) !== close.exit_price
        || closed.close_note !== close.close_note
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(closed.closed_on || ''))
        || !Number.isFinite(Date.parse(String(closed.updated_at || '')))
        || (closed.proposal_state !== null && closed.proposal_state !== 'closed')
        || (closed.proposal_id !== null && closed.proposal_decision !== 'closed')
      ) throw new Error('atomic close read-back failed');
      return reply(200, {
        ok: true, operation,
        receipt: {
          id: closed.trade_id,
          proposal_id: closed.proposal_id,
          proposal_state: closed.proposal_state,
          proposal_decision: closed.proposal_decision,
          symbol: closed.symbol,
          status: closed.status,
          exit_price: Number(closed.exit_price),
          close_note: closed.close_note,
          closed_on: closed.closed_on,
          updated_at: closed.updated_at,
          verified: true,
          at: now,
        },
        state: await currentState(), mutation_calls: 1,
      });
    }

    return reply(400, { error: 'unsupported operation' });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : String(error) });
  }
});
