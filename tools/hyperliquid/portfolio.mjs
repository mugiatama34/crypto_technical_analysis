import fs from 'fs';
const dir=process.argv[2];const N=+process.argv[3]||250;
const cand=JSON.parse(fs.readFileSync(dir+'/cand.json'));
const post=async b=>{for(let i=0;i<5;i++){try{const r=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(30000)});if(r.status===429){await new Promise(s=>setTimeout(s,5000*(i+1)));continue;}return await r.json();}catch(e){await new Promise(s=>setTimeout(s,3000));}}return null;};
const out={};const f=dir+'/portfolio.json';if(fs.existsSync(f))Object.assign(out,JSON.parse(fs.readFileSync(f)));
for(const c of cand.slice(0,N)){if(out[c.a])continue;const p=await post({type:'portfolio',user:c.a});if(p){const at=p.find(x=>x[0]==='allTime')?.[1];out[c.a]=at?{av:at.accountValueHistory,pnl:at.pnlHistory}:null;}
 await new Promise(s=>setTimeout(s,300)); if(Object.keys(out).length%25===0){fs.writeFileSync(f,JSON.stringify(out));console.log(Object.keys(out).length);}}
fs.writeFileSync(f,JSON.stringify(out));console.log('ok',Object.keys(out).length);
