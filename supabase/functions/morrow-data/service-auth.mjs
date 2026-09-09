// Existing Render service-role JWT fingerprint, verified against project REST.
// No credential is stored here. Gateway JWT verification must remain enabled.
// Changing this binding requires explicit deployment approval; rollback removes it.
export const RENDER_SERVICE_KEY_SHA256 = '985cce11d5c1921d9d82dbc5fa95043becafdfca0e40dca61ffa70adb894df54';
const PROJECT = 'fglbxoafbebsryjeqcbu';
async function digest(value) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function authorizeIngestion(header, currentSecret, pinnedHash=RENDER_SERVICE_KEY_SHA256) {
 if(typeof currentSecret!=='string'||!currentSecret||typeof header!=='string'||!header.startsWith('Bearer '))return false;
 const token=header.slice(7);
 if(!token||token.length>8192||/\s/.test(token))return false;
 const actual=await digest(token);
 if(actual===await digest(currentSecret))return true;
 if(!/^[a-f0-9]{64}$/.test(pinnedHash)||actual!==pinnedHash)return false;
 // Claims alone never authorize: the exact token must match the approved pin.
 try {
  const parts=token.split('.');if(parts.length!==3)return false;
  const raw=parts[1].replace(/-/g,'+').replace(/_/g,'/');
  const claims=JSON.parse(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'=')));
  return claims.role==='service_role'&&claims.ref===PROJECT;
 }catch{return false;}
}
