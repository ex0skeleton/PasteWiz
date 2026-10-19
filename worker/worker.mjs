// Deploy this file as a Cloudflare module Worker. All credentials live in Worker secrets.
const LIMIT=650_000;
const enc=new TextEncoder();
function encode(text){let out='';for(const b of enc.encode(text))out+=String.fromCharCode(b);return btoa(out);}
function decode(text){return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
class Failure extends Error{constructor(status,message){super(message);this.status=status;}}
function validDocument(data){return data&&data.schema===1&&data.notes&&typeof data.notes==='object'&&!Array.isArray(data.notes);}
async function equal(a,b){const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');
  const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const cors=origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'3600'}:{};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...cors}});
  if(origin&&!allowed.includes(origin))return reply(403,{error:'Origin not allowed. Check ALLOWED_ORIGINS in Cloudflare.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  try{
   if(new URL(request.url).pathname!=='/api/notes')throw new Failure(404,'Use /api/notes through PasteWiz.');
   if(!['GITHUB_TOKEN','WORKSPACE_KEY','GITHUB_OWNER','GITHUB_REPO','ALLOWED_ORIGINS'].every(k=>env[k]))throw new Failure(503,'Worker setup is incomplete. Check variables and secrets.');
   if(env.WORKSPACE_KEY.length<32)throw new Failure(503,'WORKSPACE_KEY must have at least 32 random characters.');
   const supplied=request.headers.get('Authorization')||'';
   if(!await equal(supplied,`Bearer ${env.WORKSPACE_KEY}`))throw new Failure(401,'Workspace key missing or incorrect. Open your private bookmark link.');
   const branch=env.GITHUB_BRANCH||'main';
   const path=(env.GITHUB_PATH||'pastes.json').split('/').map(encodeURIComponent).join('/');
   const url=`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path}`;
   const headers={'Authorization':`Bearer ${env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PasteWiz-Worker','Content-Type':'application/json'};
   async function github(method,body){let r;try{r=await fetch(url+(method==='GET'?`?ref=${encodeURIComponent(branch)}`:''),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{throw new Failure(502,'Could not reach GitHub. Your draft stays on this device.');}return r;}
   async function read(){const r=await github('GET');if(!r.ok)throw new Failure(502,r.status===404?'Data file not found. Check repository, branch and pastes.json.':r.status===401?'GitHub token expired or invalid. Replace the Worker secret.':r.status===403?'GitHub denied access or rate limit reached. Check token permission or retry later.':'GitHub could not read the data file.');const file=await r.json();let data;try{data=JSON.parse(decode(file.content));}catch{throw new Failure(502,'pastes.json is invalid or too large. Restore a valid JSON file.');}if(!validDocument(data))throw new Failure(502,'pastes.json must contain schema: 1 and notes: {}.');return {data,sha:file.sha};}
   if(request.method==='GET'){const {data}=await read();return reply(200,data);}
   if(request.method!=='POST')throw new Failure(405,'Method not supported.');
   if(Number(request.headers.get('Content-Length')||0)>LIMIT)throw new Failure(413,'Text is too large.');
   const reader=request.body?.getReader();if(!reader)throw new Failure(400,'Missing edit.');let size=0,chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();throw new Failure(413,'Text is too large.');}chunks.push(value);}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
   let edit;try{edit=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Failure(400,'Invalid edit JSON.');}
   const {id,baseVersion,mutationId,note}=edit;
   if(typeof id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(id)||!Number.isSafeInteger(baseVersion)||baseVersion<0||typeof mutationId!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(mutationId)||!note||typeof note.title!=='string'||note.title.length>100||typeof note.text!=='string'||enc.encode(note.text).length>450000||typeof note.deleted!=='boolean')throw new Failure(400,'Invalid note or text exceeds 450 KB.');
   for(let attempt=0;attempt<4;attempt++){
    const {data,sha}=await read();const previous=data.notes[id];
    if(previous?.mutationId===mutationId)return reply(200,{note:previous});
    if((previous?.version||0)!==baseVersion)return reply(409,{error:'This tab changed on another device.',remote:previous||null});
    const saved={title:note.title,text:note.text,deleted:note.deleted,createdAt:previous?.createdAt||Date.now(),updatedAt:Date.now(),version:baseVersion+1,mutationId};
    data.notes[id]=saved;const text=JSON.stringify(data,null,2);
    if(enc.encode(text).length>LIMIT)throw new Failure(413,'Workspace is full (650 KB including history markers). Remove old text or start a new data file.');
    const r=await github('PUT',{message:`PasteWiz: ${saved.deleted?'delete':'save'} text tab`,content:encode(text),sha,branch});
    if(r.ok)return reply(200,{note:saved});
    if(r.status===409||r.status===422)continue;
    throw new Failure(502,r.status===403?'GitHub write denied. Give the token Contents: Read and write.':'GitHub save failed. Check token and branch protection.');
   }
   throw new Failure(503,'Another save is in progress. Try again shortly.');
  }catch(e){return reply(e instanceof Failure?e.status:500,{error:e instanceof Failure?e.message:'Unexpected server error. Your local draft has been kept.'});}
 }
};
