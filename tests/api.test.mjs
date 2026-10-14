import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function freePort() {
  const s=net.createServer();
  await new Promise(r=>s.listen(0,'127.0.0.1',r));
  const port=s.address().port;
  await new Promise(r=>s.close(r));
  return port;
}
let child, url, dir;
test.before(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'netscope-test-'));
  const port=await freePort();
  url=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',REPORT_DIR:dir,TRUST_PROXY:'0'},stdio:['ignore','pipe','pipe']});
  for(let i=0;i<70;i++) {
    try { const r=await fetch(url+'/api/health'); if (r.ok) return; } catch {}
    await new Promise(r=>setTimeout(r,80));
  }
  throw new Error('Server did not start');
});
test.after(async()=>{child?.kill(); if(dir) await rm(dir,{recursive:true,force:true});});

test('serves RTL UI and API metadata',async()=>{
  const r=await fetch(url+'/');
  assert.equal(r.status,200);
  assert.match(await r.text(),/lang="fa" dir="rtl"/);
  const c=await (await fetch(url+'/api/config')).json();
  assert.equal(c.version,'2.0.0');
  assert.equal(c.ip,'127.0.0.x');
});
test('ping returns 204 with no-store',async()=>{
  const r=await fetch(url+'/api/ping',{method:'HEAD'});
  assert.equal(r.status,204);
  assert.match(r.headers.get('cache-control'),/no-store/);
});
test('download transfers exact bytes, disallows invalid size',async()=>{
  const r=await fetch(url+'/api/download?bytes=1048576');
  assert.equal(r.status,200);
  assert.equal((await r.arrayBuffer()).byteLength,1048576);
  const bad=await fetch(url+'/api/download?bytes=999999999');
  assert.equal(bad.status,400);
});
test('upload counts actual bytes and limits transfer',async()=>{
  const content=new Uint8Array(256*1024);
  const r=await fetch(url+'/api/upload',{method:'POST',body:content,headers:{'content-type':'application/octet-stream'}});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.bytes,content.byteLength);
  const big=await fetch(url+'/api/upload',{method:'POST',body:new Uint8Array(9*1024*1024)});
  assert.equal(big.status,413);
});
test('shares anonymous reports and validates inputs',async()=>{
  const report={tests:[{mode:'on',startedAt:new Date().toISOString(),ping:28,jitter:3,download:42,upload:9,loadedPing:65,failureRate:0,ipMasked:'1.2.3.4',platform:'Chrome'}]};
  const r=await fetch(url+'/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
  assert.equal(r.status,201);
  const created=await r.json();
  assert.match(created.id,/^[a-f0-9]{28}$/);
  const get=await fetch(url+'/api/reports/'+created.id);
  assert.equal(get.status,200);
  const stored=await get.json();
  assert.equal(stored.tests[0].ipMasked,'پنهان');
  const page=await fetch(url+created.url);
  assert.equal(page.status,200);
  const invalid=await fetch(url+'/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tests:[{mode:'invalid'}]})});
  assert.equal(invalid.status,422);
});
test('rejects cross-origin report submission',async()=>{
  const r=await fetch(url+'/api/reports',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});
  assert.equal(r.status,403);
});
