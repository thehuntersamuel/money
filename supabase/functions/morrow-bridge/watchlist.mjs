export async function ensureResearchWatchlist(db,symbol){
 if(typeof symbol!=='string'||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))throw Error('invalid research symbol');
 // Preserve an existing scout's note. Retry repairs a partial proposal+watchlist write.
 const saved=await db.from('watchlist').upsert({symbol},{onConflict:'symbol',ignoreDuplicates:true});
 if(saved.error)throw Error('research saved; watchlist sync failed; retry the same proposal');
 const verified=await db.from('watchlist').select('symbol').eq('symbol',symbol).single();
 if(verified.error||verified.data?.symbol!==symbol)throw Error('watchlist readback failed; retry the same proposal');
 return {symbol,verified:true};
}
