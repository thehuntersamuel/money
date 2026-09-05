"""Build a synthetic, network-disabled UI preview from the current index source."""
import hashlib,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=(root/'index.html').read_text()
# Retain the same DOM/CSS/renderers. Remove live setup and suppress all connections.
html=re.sub(r'<script\b[^>]*\bsrc=[^>]+>.*?</script>','',source,flags=re.S)
html=html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; script-src \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data:; frame-src \'none\'; form-action \'none\'; object-src \'none\'">')
a=html.index('var SB_URL =');b=html.index('/* ---------- helpers',a)
html=html[:a]+'''var SB_URL='https://example.invalid',SB_KEY='',FN='https://example.invalid';
var sb=new Proxy({}, {get(){throw new Error('Synthetic preview: backend disabled');}});
'''+html[b:]
fixture=json.loads((root/'tests/fixtures/ui_preview.json').read_text())
fixture['proposalQueueStatus']={'complete':True}
fixture['research']={'available':True,'rows':[],'truncated':False}
fixture['integrationHealth']={'available':True,'rows':[]}
setup='D='+json.dumps(fixture)+';\n'+'''$("login").style.display="none";$("app").style.display="";$("nav").style.display="";$("signout").style.display="none";showTab("trade");wireDrawer();renderTrade();
["proposal-search","proposal-state"].forEach(id=>$(id).addEventListener("input",()=>renderProposals(D.books.find(b=>b.book_id===D.book))));
'''
assert html.count('\nboot();')==1
html=html.replace('\nboot();','\n'+setup)
html=html.replace('<body>','<body><div style="padding:8px;text-align:center;font-size:13px">SYNTHETIC PREVIEW · Backend disabled · '+hashlib.sha256(source.encode()).hexdigest()[:12]+'</div>')
out=root/'verification/preview';out.mkdir(exist_ok=True)
(out/'morrow-preview.html').write_text(html)
(out/'morrow-mobile-preview.html').write_text('<!doctype html><html><head><title>Morrow mobile preview</title></head><body style="margin:0;background:#252525"><iframe title="390px mobile preview" src="morrow-preview.html?revision='+hashlib.sha256(source.encode()).hexdigest()[:12]+'#trade" style="display:block;width:390px;height:844px;border:0;margin:12px auto"></iframe></body></html>')
print('Built synthetic desktop and 390px iframe previews; all backend connections blocked.')
