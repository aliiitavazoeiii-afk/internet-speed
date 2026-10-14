import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import net from 'node:net';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(ROOT, 'public');
const REPORTS = process.env.REPORT_DIR || path.join(ROOT, 'data', 'reports');
const PORT = Number(process.env.PORT || 8097);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // Only when the service is private behind trusted reverse proxy
const MAX_DOWNLOAD = 32 * 1024 * 1024;
const MAX_UPLOAD = 8 * 1024 * 1024;
const REPORT_TTL = 7 * 24 * 3600_000;
const MAX_REPORTS = 10000;
const buckets = new Map();
const active = new Map();
const CHUNK = crypto.randomBytes(128 * 1024);
const allowedOrigins = new Set((process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
const nodeLabel = (process.env.NODE_LABEL || 'سرور اصلی تست').slice(0, 80);

const headerBase = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, no-transform',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'cross-origin'
};
function sendJson(res, status, obj, extra = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { ...headerBase, 'Content-Type':'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(obj));
}
function clientIp(req) {
  let ip = req.socket.remoteAddress || 'unknown';
  if (TRUST_PROXY) {
    // The published port MUST only be reachable through a trusted reverse proxy.
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (net.isIP(forwarded)) ip = forwarded;
  }
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
const geoCache = new Map();
async function locateIp(ip) {
  if (!net.isIP(ip) || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1') return {countryCode:null};
  const item = geoCache.get(ip);
  if (item && item.until > Date.now()) return item.data;
  let data = {countryCode:null};
  try {
    // Country-of-IP is a heuristic, not VPN proof. External GeoIP provider receives the public IP.
    const resp = await fetch('https://ipwho.is/' + encodeURIComponent(ip), {signal:AbortSignal.timeout(3500)});
    if (resp.ok) {
      const json = await resp.json();
      if (json.success && /^[A-Z]{2}$/.test(json.country_code || ''))
        data={countryCode:json.country_code, isp:String(json.connection?.isp||'').slice(0,80)};
    }
  } catch {}
  if (geoCache.size > 10000) geoCache.clear();
  geoCache.set(ip,{data,until:Date.now()+15*60*1000});
  return data;
}
function anonymizeIp(ip) {
  if (net.isIP(ip) === 4) return ip.split('.').slice(0, 3).join('.') + '.x';
  if (net.isIP(ip) === 6) return ip.split(':').slice(0, 4).join(':') + ':…';
  return 'نامشخص';
}
function rateLimit(ip, kind, max, ms = 60000) {
  const k = kind + ':' + ip;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now >= b.until) b = { until: now + ms, n: 0 };
  b.n++;
  buckets.set(k, b);
  return b.n <= max;
}
function concurrency(ip, kind, limit, res) {
  const key = `${kind}:${ip}`;
  const globalKey = `global:${kind}`;
  const globalLimit = kind === 'download' ? 24 : 16;
  const n = active.get(key) || 0;
  const total = active.get(globalKey) || 0;
  if (n >= limit || total >= globalLimit) return false;
  active.set(key, n + 1);
  active.set(globalKey, total + 1);
  let released = false;
  function release() {
    if (released) return;
    released = true;
    for (const k of [key, globalKey]) {
      const left = (active.get(k) || 1) - 1;
      if (left <= 0) active.delete(k); else active.set(k, left);
    }
  }
  res.once('close', release);
  res.once('finish', release);
  return true;
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}
async function readBody(req, max) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error('too_large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser tools; rate limits still apply
  try {
    const host = req.headers.host;
    const parsed = new URL(origin);
    return parsed.host === host || allowedOrigins.has(origin);
  } catch { return false; }
}
async function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
  try {
    const f = await readFile(path.join(STATIC, file));
    res.writeHead(200, { ...headerBase, 'Content-Type':types[ext] || 'application/octet-stream', 'X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; connect-src 'self' " + [...allowedOrigins].join(' ') + "; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    res.end(f);
  } catch { sendJson(res, 404, { error: 'not_found' }); }
}
function validReport(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.tests) || payload.tests.length < 1 || payload.tests.length > 2) return false;
  return payload.tests.every(t => {
    if (!t || !['on', 'off'].includes(t.mode) || typeof t.startedAt !== 'string' || !Number.isFinite(Date.parse(t.startedAt))) return false;
    if (Math.abs(Date.now() - Date.parse(t.startedAt)) > 24 * 3600_000) return false;
    for (const k of ['ping','jitter','failureRate','loadedPing','download','upload']) {
      if (t[k] !== null && t[k] !== undefined && (typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k] < 0 || t[k] > 1_000_000)) return false;
    }
    return true;
  });
}
async function pruneReports() {
  try {
    const files = (await readdir(REPORTS)).filter(f => /^[a-f0-9]{28}\.json$/.test(f));
    if (files.length < MAX_REPORTS) return;
    // On overflow, reject future report creation; an admin should monitor storage.
  } catch { /* fresh directory */ }
}
await mkdir(REPORTS, { recursive: true });
await pruneReports();

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  let url;
  try { url = new URL(req.url, 'http://local.test'); }
  catch { return sendJson(res, 400, {error:'bad_url'}); }
  const route = url.pathname;
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headerBase); return res.end();
  }
  if (route === '/api/health' && req.method === 'GET') return sendJson(res, 200, {ok:true});
  if (route === '/api/config' && req.method === 'GET') {
    const geo = await locateIp(ip);
    return sendJson(res, 200, {node:nodeLabel, ip:anonymizeIp(ip), countryCode:geo.countryCode,
      isp:geo.isp || null, time:new Date().toISOString(), limits:{downloadMiB:32,uploadMiB:8},version:'2.0.0'});
  }
  if (route === '/api/ping' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!rateLimit(ip, 'ping', 240)) return sendJson(res, 429, {error:'rate_limited'});
    res.writeHead(204, {...headerBase, 'Timing-Allow-Origin':'*', 'Server-Timing':'app;dur=0'});
    return res.end();
  }
  if (route === '/api/download' && req.method === 'GET') {
    if (!rateLimit(ip, 'download', 36) || !concurrency(ip, 'download', 3, res)) return sendJson(res, 429, {error:'rate_limited'});
    const size = Number(url.searchParams.get('bytes'));
    if (!Number.isSafeInteger(size) || size < 1024 || size > MAX_DOWNLOAD) return sendJson(res, 400, {error:'invalid_bytes'});
    res.writeHead(200, {...headerBase, 'Content-Type':'application/octet-stream', 'Content-Length':size,
      'Content-Encoding':'identity', 'X-Accel-Buffering':'no', 'Timing-Allow-Origin':'*'});
    let remaining = size;
    const write = () => {
      while (remaining > 0 && !res.destroyed) {
        const n = Math.min(CHUNK.length, remaining);
        remaining -= n;
        if (!res.write(CHUNK.subarray(0, n))) { res.once('drain', write); return; }
      }
      if (!res.destroyed && remaining === 0) res.end();
    };
    return write();
  }
  if (route === '/api/upload' && req.method === 'POST') {
    if (!checkOrigin(req)) return sendJson(res, 403, {error:'origin_not_allowed'});
    if (!rateLimit(ip, 'upload', 24) || !concurrency(ip, 'upload', 3, res)) return sendJson(res, 429, {error:'rate_limited'});
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD) return sendJson(res, 413, {error:'too_large'});
    let bytes = 0;
    const started = performance.now();
    try {
      for await (const part of req) {
        bytes += part.length;
        if (bytes > MAX_UPLOAD) return sendJson(res, 413, {error:'too_large'});
      }
      return sendJson(res, 200, {bytes, serverMs: Math.round(performance.now() - started)});
    } catch { if (!res.headersSent) sendJson(res, 400, {error:'stream_failed'}); }
    return;
  }
  if (route === '/api/reports' && req.method === 'POST') {
    if (!checkOrigin(req)) return sendJson(res, 403, {error:'origin_not_allowed'});
    if (!rateLimit(ip, 'report', 12, 3600_000)) return sendJson(res, 429, {error:'rate_limited'});
    try {
      const json = await readBody(req, 12000);
      const body = JSON.parse(json);
      if (!validReport(body)) return sendJson(res, 422, {error:'invalid_report'});
      const files = await readdir(REPORTS);
      if (files.length >= MAX_REPORTS) return sendJson(res, 503, {error:'storage_full'});
      const id = crypto.randomBytes(14).toString('hex');
      // Never save the full public IP or user-agent. Reports expire after 7 days.
      const tests = body.tests.map(t => ({
        mode:t.mode, startedAt:t.startedAt, ping:t.ping ?? null, jitter:t.jitter ?? null,
        failureRate:t.failureRate ?? null, loadedPing:t.loadedPing ?? null, download:t.download ?? null,
        upload:t.upload ?? null, ipMasked: typeof t.ipMasked === 'string' && /^(?:\d{1,3}\.){3}x$/.test(t.ipMasked) ? t.ipMasked : (t.ipMasked === 'IPv6 (پنهان)' ? t.ipMasked : 'پنهان'),
        platform:typeof t.platform === 'string' ? t.platform.slice(0, 80) : 'نامشخص',
        isp:typeof t.isp === 'string' ? t.isp.slice(0, 50) : '',
        vpnServer:typeof t.vpnServer === 'string' ? t.vpnServer.slice(0, 50) : '',
        node:nodeLabel,
      }));
      const report = {id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+REPORT_TTL).toISOString(), tests};
      await writeFile(path.join(REPORTS, id + '.json'), JSON.stringify(report), {flag:'wx', mode:0o600});
      return sendJson(res, 201, {id, url:'/r/' + id, expiresAt:report.expiresAt});
    } catch (e) { return sendJson(res, e.message === 'too_large'?413:400, {error:'invalid_payload'}); }
  }
  const match = /^\/api\/reports\/([a-f0-9]{28})$/.exec(route);
  if (match && req.method === 'GET') {
    if (!rateLimit(ip, 'getreport', 60)) return sendJson(res, 429, {error:'rate_limited'});
    try {
      const f = path.join(REPORTS, match[1] + '.json');
      const report = JSON.parse(await readFile(f, 'utf8'));
      if (Date.now() > Date.parse(report.expiresAt)) {
        await unlink(f).catch(()=>{}); return sendJson(res, 404, {error:'expired'});
      }
      return sendJson(res, 200, report);
    } catch { return sendJson(res, 404, {error:'not_found'}); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, {error:'method_not_allowed'});
  if (route === '/' || /^\/r\/[a-f0-9]{28}$/.test(route)) return serveFile(res,'index.html');
  const assets = {'/app.js':'app.js', '/style.css':'style.css', '/favicon.svg':'favicon.svg', '/noto-arabic.woff2':'noto-arabic.woff2'};
  if (assets[route]) return serveFile(res, assets[route]);
  return sendJson(res, 404, {error:'not_found'});
});

server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 6000;
server.listen(PORT, HOST, () => console.log(`VPN Diagnostics listening on http://${HOST}:${PORT}`));

// Expired report cleanup each hour. Note that idle process could be restarted before next cleanup.
const cleanup = setInterval(async () => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
  try {
    for (const file of await readdir(REPORTS)) {
      if (!/^[a-f0-9]{28}\.json$/.test(file)) continue;
      try {
        const report = JSON.parse(await readFile(path.join(REPORTS,file),'utf8'));
        if (Date.parse(report.expiresAt) < now) await unlink(path.join(REPORTS,file));
      } catch { /* ignore corrupt files */ }
    }
  } catch { /* ignore */ }
}, 3600000);
cleanup.unref();
