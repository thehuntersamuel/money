// Persist only already-authorized, normalized Tiingo results. No extra provider call.
// A saved sample is not a claim of continuous coverage or a model execution receipt.
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function persistQueryReceipt(db, input, result, config, now = () => new Date().toISOString()) {
  const sourceNews = input.action === 'source' && input.dataset === 'tiingo_news';
  const dataset = sourceNews || (input.provider === 'tiingo' && input.action === 'news') ? 'tiingo_news'
    : input.provider === 'tiingo' && input.action === 'history' ? 'tiingo_eod' : null;
  if (!dataset || result.status !== 'ok') return {status:'not_applicable',mutation_calls:0};
  if (!config.tiingoLicensed || !config.tiingoArchiveApproved || !config.tiingoDisplayAllowed
      || (dataset === 'tiingo_news' && !config.tiingoNewsApproved)) return {status:'not_approved',mutation_calls:0};
  const payload = sourceNews ? result.payload : result.data;
  const retrievedAt = result.provenance?.retrieved_at || result.retrieved_at;
  let mutations = 0;
  try {
    if (!Array.isArray(payload) || !Number.isFinite(Date.parse(retrievedAt))) throw Error('invalid normalized snapshot');
    const url = new URL(sourceNews ? result.provenance.url : result.source);
    if (url.protocol !== 'https:' || url.hostname !== 'api.tiingo.com' || url.username || url.password) throw Error('invalid source');
    url.search = ''; url.hash = '';
    const normalized = canonical(payload);
    const bytes = new TextEncoder().encode(normalized);
    if (bytes.length > 4000000) throw Error('snapshot budget exceeded');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b=>b.toString(16).padStart(2,'0')).join('');
    const scope = {mode:'on_demand_research',symbols:input.symbol ? [input.symbol] : input.symbols || [],
      news_scope:dataset === 'tiingo_news' ? (input.symbols?.length ? 'ticker' : 'broad') : null,
      start:input.start || null,end:input.end || null};
    const provenance = {url:url.href,retrieved_at:retrievedAt,content_sha256:hash,scope,
      coverage:result.coverage || 'requested_sample_only',quality:result.quality || null};
    const saved = await db.from('morrow_data_snapshots').insert({provider:'tiingo',dataset,
      received_at:now(),display_allowed:true,payload,provenance}).select('id').single();
    mutations++;
    if (saved.error || !saved.data?.id) throw Error('snapshot write failed');
    const verified = await db.from('morrow_data_snapshots').select('id,received_at,payload,provenance')
      .eq('id',saved.data.id).single();
    if (verified.error || verified.data?.id !== saved.data.id || verified.data?.provenance?.content_sha256 !== hash
        || canonical(verified.data.payload) !== normalized) throw Error('snapshot readback failed');
    const health = await db.from('morrow_integration_health').insert({dataset,checked_at:now(),status:'ok',
      detail:'on_demand_snapshot_saved',coverage:String(result.coverage || 'requested_sample_only').slice(0,200),
      metrics:{snapshot_id:saved.data.id,record_count:payload.length,scope}});
    mutations++;
    if (health.error) return {status:'snapshot_saved_health_failed',snapshot_id:saved.data.id,mutation_calls:mutations};
    return {status:'saved',verified:true,snapshot_id:saved.data.id,received_at:verified.data.received_at,
      retrieved_at:retrievedAt,scope,mutation_calls:mutations};
  } catch {
    // Usable provider data remains usable; never claim that a failed save succeeded.
    return {status:'persistence_failed',reason:'research_snapshot_write_or_readback_failed',mutation_calls:mutations};
  }
}
