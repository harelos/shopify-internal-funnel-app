// Scoped publication of ONE known sandbox HTML file. No app/theme/backend deployment.
const fs=require('node:fs');
const REPO='harelos/shopify-internal-funnel-app';
const BRANCH='preview-novahair-gallery-bootstrap-20260910';
if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF_NAME!==BRANCH)throw Error('Refuse non-sandbox target');
if(fs.existsSync('app/cloudflare-pilot/wrangler.jsonc')||fs.existsSync('shopify.app.toml'))throw Error('Production configuration must be absent');
const old="img-src 'self' https://cdn.shopify.com data:;";
const replacement="img-src 'self' https://cdn.shopify.com https://raw.githubusercontent.com/harelos/shopify-internal-funnel-app/ data:;";
const headers={Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
(async()=>{
 const endpoint='https://api.github.com/repos/'+REPO+'/contents/index.html';
 const get=await fetch(endpoint+'?ref='+encodeURIComponent(BRANCH),{headers});if(!get.ok)throw Error('Read sandbox HTML failed: '+get.status);
 const before=await get.json();const html=Buffer.from(before.content.replace(/\s/g,''),'base64').toString('utf8');
 let commit=process.env.GITHUB_SHA;
 let patched=html;
 if(!html.includes(replacement)){
  if(before.sha!=='db62c7c9c22c20b6b81c51f09a2a84a007a0b425')throw Error('Unexpected HTML blob; refusing automatic edit');
  if(html.split(old).length!==2||!html.includes("connect-src 'none'"))throw Error('Unexpected CSP; refusing automatic edit');
  patched=html.replace(old,replacement);
  const put=await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({message:'preview: allow only public repository images after host redirects',content:Buffer.from(patched).toString('base64'),sha:before.sha,branch:BRANCH})});
  if(!put.ok)throw Error('Write sandbox HTML failed: '+put.status);
  const saved=await put.json();commit=saved.commit.sha;
 }
 fs.writeFileSync('index.html',patched);
 const url='https://raw.githack.com/'+REPO+'/'+commit+'/index.html';
 fs.appendFileSync(process.env.GITHUB_ENV,'GALLERY_PREVIEW_URL='+url+'\n');
 fs.mkdirSync('browser-evidence',{recursive:true});
 fs.writeFileSync('browser-evidence/published-preview.json',JSON.stringify({repository:REPO,branch:BRANCH,commit,url,change:'Allow public repository image redirects only. connect-src, form-action, frame-src remain none.',productionWrites:false,themeUploads:false},null,2));
 console.log('SANDBOX_PREVIEW_URL='+url);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
