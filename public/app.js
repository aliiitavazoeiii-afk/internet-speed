/* NetScope: all measurements run in the user's browser against this site's server. */
const $ = id => document.getElementById(id);
const numeric = value => Number.isFinite(value) ? Number(value.toFixed(2)) : null;
const fmt = (n, digits = 1) => n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n).toLocaleString('en-US', {maximumFractionDigits:digits});
const STORAGE_KEY = 'netscope-tests-mobile-v2';
const state = {mode:'on', tests:{on:null, off:null}, running:false, abort:null, config:null, viewingShared:false};
let toastTimer = null;
let sharingUrl = '';

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3900);
}
function save() { if (state.viewingShared) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tests)); } catch { /* private mode */ } }
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const mode of ['on','off']) {
      if (v[mode] && v[mode].mode === mode && Number.isFinite(v[mode].download)) state.tests[mode] = v[mode];
    }
    $('ispInput').value = v.on?.isp || v.off?.isp || '';
    $('vpnNodeInput').value = v.on?.vpnServer || ''; 
  } catch { /* ignore stale storage */ }
}
function detectPlatform() {
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'دستگاه ناشناس';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'مرورگر';
  return `${os} · ${browser}`;
}
function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return 'نامشخص';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip.split('.').slice(0,3).join('.') + '.x';
  if (/^(?:\d{1,3}\.){3}x$/.test(ip)) return ip;
  if (ip.includes(':')) return 'IPv6 (پنهان)';
  return 'نامشخص';
}
async function fetchConfig() {
  try {
    const res = await fetch('/api/config?z=' + Date.now(), {cache:'no-store', signal:AbortSignal.timeout(7000)});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    state.config = c;
    await detectMode(c);
    $('ipValue').textContent = c.ip || 'نامشخص';
    $('serverValue').textContent = c.node || 'سرور اصلی';
    $('serverDot').className = 'status-dot online';
    $('serverStatus').textContent = 'سرور تست آنلاین';
    return c;
  } catch {
    state.config = null;
    $('ipValue').textContent = 'عدم دسترسی';
    $('serverValue').textContent = 'در دسترس نیست';
    $('serverDot').className = 'status-dot offline';
    $('serverStatus').textContent = 'عدم دسترسی به سرور';
    return null;
  }
}
async function detectMode(c) {
  const country = c.countryCode;
  if (!country) { $('modeTitle').textContent='موقعیت اتصال نامشخص'; $('modePill').textContent='نامشخص';$('startBtn').disabled=true; return; }
  const mode = country === 'IR' ? 'off' : 'on';
  state.mode = mode;
  $('modeTitle').textContent=mode === 'on'?'اتصال با IP خارجی':'اتصال با IP ایران';
  $('modePill').textContent=mode === 'on'?'VPN احتمالی روشن':'اتصال مستقیم احتمالی';
  $('startBtn').disabled=false;
  // Remove stale comparisons made on the same apparent country when appropriate.
  $('startLabel').textContent = state.tests[mode] ? 'تست مجدد' : 'شروع تست سرعت';
  refresh();
  updateNextStep();
}
function updateNextStep() {
 const completed = !!(state.tests.on && state.tests.off);
 $('nextStep').hidden = !((state.tests.on || state.tests.off) && !completed && !state.viewingShared);
 if (!$('nextStep').hidden) {
   const next = state.tests.on ? 'خاموش' : 'روشن';
   $('nextText').textContent=`حالا VPN را ${next} کنید و دوباره تست بگیرید`;
 }
}
function displayDevice() {
  $('platformValue').textContent = detectPlatform();
  const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effective = net?.effectiveType;
  $('networkValue').textContent = net?.type ? String(net.type) : effective ? `${effective} (تخمینی)` : 'اطلاعات مرورگر موجود نیست';
  const nav = performance.getEntriesByType('navigation')?.[0];
  const dns = nav && nav.domainLookupEnd > nav.domainLookupStart ? nav.domainLookupEnd-nav.domainLookupStart : null;
  const tls = nav && nav.secureConnectionStart > 0 && nav.connectEnd > nav.secureConnectionStart ? nav.connectEnd-nav.secureConnectionStart : null;
  $('dnsValue').textContent = dns === null ? 'قابل اندازه‌گیری نیست' : `${fmt(dns)} ms`;
  $('tlsValue').textContent = tls === null ? 'قابل اندازه‌گیری نیست' : `${fmt(tls)} ms`;
  $('protocolValue').textContent = nav?.nextHopProtocol || 'نامشخص';
}
function setMode(mode) {
  if (state.running || state.viewingShared) return;
  state.mode = mode;
  document.querySelectorAll('.mode-option').forEach(el => {
    const selected = el.dataset.mode === mode;
    el.classList.toggle('selected', selected);
    el.setAttribute('aria-pressed', String(selected));
  });
  showMetrics(state.tests[mode]);
  setGauge(null, 0, state.tests[mode] ? 'نتیجهٔ تست قبلی' : 'آماده برای شروع', state.tests[mode] ? 'برای اجرای دوباره شروع کن' : 'برای شروع دکمهٔ زیر رو بزن');
}
function setGauge(rate, percent, label, sub) {
  $('speedNumber').textContent = fmt(rate, 1);
  $('gaugeLabel').textContent = label;
  $('speedMessage').textContent = sub || '';
  const visual = Math.max(0, Math.min(100, percent || 0));
  $('gaugeTrack').setAttribute('stroke-dasharray', `${visual} 100`);
  $('progressBar').style.width = `${visual}%`;
}
function setStep(name, progress) {
  const labels = {ping:'پینگ و جیتر', download:'سرعت دانلود', upload:'سرعت آپلود', final:'تحلیل داده‌ها'};
  document.querySelectorAll('[data-step]').forEach((el, idx) => {
    const order = ['ping','download','upload','final'];
    const current = order.indexOf(name);
    el.classList.toggle('active', idx === current);
    el.classList.toggle('done', idx < current);
  });
  $('gaugeLabel').textContent = labels[name] || name;
  $('progressBar').style.width = `${progress}%`;
}
function showMetrics(t) {
  $('mDownload').textContent = fmt(t?.download);
  $('mUpload').textContent = fmt(t?.upload);
  $('mPing').textContent = fmt(t?.ping);
  $('mJitter').textContent = fmt(t?.jitter);
  $('mLoaded').textContent = fmt(t?.loadedPing);
  $('mFailure').textContent = fmt(t?.failureRate);
  $('metricsCaption').textContent = t ? `${t.mode === 'on' ? 'VPN روشن' : 'VPN خاموش'} · ${new Date(t.startedAt).toLocaleString('fa-IR')}` : 'اعداد پس از انجام آزمایش نمایش داده می‌شوند';
}
function showComparison() {
  const a = state.tests.on;
  const b = state.tests.off;
  for (const [mode, t] of [['on',a],['off',b]]) {
    $(mode + 'Status').textContent = t ? 'تست انجام شد' : 'هنوز تست نشده';
    $(mode + 'Status').classList.toggle('done', Boolean(t));
    $(mode + 'Main').textContent = fmt(t?.download);
    $(mode + 'Sub').textContent = t ? `${fmt(t.ping)} ms پینگ · ${fmt(t.upload)} Mbps آپلود` : 'Mbps · سرعت دانلود';
  }
  $('comparisonDetails').hidden = !(a && b);
  if (a && b) {
    for (const [key,field,unit] of [['Down','download','Mbps'],['Up','upload','Mbps'],['Ping','ping','ms'],['Jitter','jitter','ms']]) {
      $('c'+key+'On').textContent = fmt(a[field]) + ' '+unit;
      $('c'+key+'Off').textContent = fmt(b[field]) + ' '+unit;
    }
    $('comparisonHint').textContent = a.ipMasked === b.ipMasked ? 'توجه: آدرس IP نمایش‌داده‌شده در دو آزمایش مشابه است. ممکن است VPN مسیر این سایت را عوض نکرده باشد، یا IP خروجی یکسان باشد. نتیجه را با احتیاط تفسیر کن.' : 'هر دو تست ثبت شده‌اند. تفاوت مسیر، ساعت تست و بار سرور می‌تواند نتیجه را تغییر دهد؛ برای اطمینان دو بار آزمایش را تکرار کن.';
  } else {
    $('comparisonHint').textContent = 'برای پیدا کردن منبع کندی، هر دو تست را با فاصلهٔ زمانی کوتاه، روی یک شبکه و همین سرور انجام بده.';
  }
}
function analyze() {
  const on = state.tests.on, off = state.tests.off;
  const t = state.tests[state.mode] || on || off;
  if (!t) return null;
  const unstable = x => (x?.failureRate ?? 0) > 12 || (x?.jitter ?? 0) > 45;
  const loaded = x => x?.loadedPing && x?.ping && x.loadedPing > x.ping + 100 && x.loadedPing > x.ping * 2;
  if (on && off) {
    if (on.ipMasked && on.ipMasked === off.ipMasked) return {
      title:'مسیر VPN در این آزمایش تأیید نشد',
      text:'آی‌پی مشاهده‌شده در دو حالت مشابه است. ممکن است سایت از VPN عبور نکرده باشد (Split tunneling) یا خروجی یکسان باشد؛ بنابراین مقایسه به‌تنهایی برای مقصر دانستن VPN کافی نیست.',
      action:'در تنظیمات VPN بررسی کن که مرورگر از تونل عبور می‌کند. بعد دو بار آزمایش را با همان اینترنت تکرار کن.', level:'احتیاط بالا'
    };
    const downRatio = off.download > 0 ? on.download / off.download : null;
    const upRatio = off.upload > 0 && on.upload != null ? on.upload / off.upload : null;
    const pingGap = on.ping != null && off.ping != null ? on.ping - off.ping : 0;
    if ((off.download >= 8 && downRatio !== null && downRatio < .55) || (off.upload >= 2 && upRatio !== null && upRatio < .4)) return {
      title:'کندی احتمالاً در مسیر VPN است',
      text:`با VPN خاموش، سرعت دانلود ${fmt(off.download)} Mbps و با VPN روشن ${fmt(on.download)} Mbps اندازه‌گیری شد. این افت می‌تواند از شلوغی سرور VPN، کیفیت مسیر تا سرور، محدودیت پروتکل یا مسیر خروجی باشد؛ نه لزوماً خود اینترنت.`,
      action:'روی همان اینترنت، سرور یا پروتکل VPN دیگری را تست کن؛ اگر فقط یک سرور کند است، مسیر یا ظرفیت آن را بررسی کن.', level:'احتمال متوسط'
    };
    if (off.download < 5 && on.download < 5) return {
      title:'کندی در هر دو حالت دیده می‌شود',
      text:'هر دو مسیر سرعت پایینی دارند. اتصال اینترنت، شبکه محلی، مسیر اپراتور تا سرور تست یا ظرفیت خود سرور تست می‌توانند عامل باشند؛ با این یک سرور نمی‌شود ISP را قطعی مقصر دانست.',
      action:'روی Wi-Fi و دیتای موبایل یا یک مقصد تست دیگر هم امتحان کن؛ کیفیت اتصال مستقیم را اول بررسی کن.', level:'احتمال متوسط'
    };
    if (pingGap > 90 && (on.ping || 0) > (off.ping || 1) * 1.8) return {
      title:'VPN تأخیر زیادی به اتصال اضافه می‌کند',
      text:`میانگین پینگ با VPN حدود ${fmt(pingGap)} میلی‌ثانیه بیشتر شده است. این مورد می‌تواند روی بازی، تماس و ارتباط تعاملی تأثیر محسوس بگذارد.`,
      action:'یک سرور VPN نزدیک‌تر یا مسیری با RTT کمتر امتحان کن و نتیجه را تکرار کن.', level:'احتمال متوسط'
    };
    if (unstable(on) || unstable(off) || loaded(on) || loaded(off)) return {
      title:'سرعت تنها مشکل اصلی نیست؛ پایداری را بررسی کن',
      text:'در یکی از آزمایش‌ها نوسان پینگ، خطای درخواست یا افزایش تأخیر زیر دانلود زیاد است. حتی با سرعت مناسب، این حالت باعث گیرکردن تماس یا بازی می‌شود.',
      action:'دانلودهای هم‌زمان را متوقف کن، از کابل یا Wi-Fi بهتر استفاده کن و در صورت تداوم، صف‌بندی مودم یا ظرفیت سرور را بررسی کن.', level:'احتمال متوسط'
    };
    return {
      title:'تفاوت بحرانی بین دو مسیر دیده نشد',
      text:'اعداد VPN روشن و خاموش در این تست تفاوت بسیار شدیدی ندارند. اگر فقط بعضی اپلیکیشن‌ها کندند، ممکن است مشکل از مسیر آن سرویس، DNS، محدودیت مقصد یا زمان شلوغی باشد.',
      action:'در ساعت شلوغی هم دو تست بگیر و اگر مشکل فقط در سرویس مشخصی است، همان مقصد را جداگانه بررسی کن.', level:'احتمال متوسط'
    };
  }
  if (t.failureRate >= 20 || t.jitter >= 60) return {
    title:'نشانه‌هایی از اتصال ناپایدار دیده شد',
    text:'درخواست‌های HTTP با خطا یا نوسان زیاد مواجه شده‌اند. این معیار «پکت‌لاس واقعی ICMP/UDP» نیست و علت دقیق بدون تست بیشتر معلوم نمی‌شود.',
    action:'تست را دوباره تکرار کن و حتماً وضعیت مقابل VPN را هم بگیر تا مشخص شود این ناپایداری در هر دو مسیر هست یا نه.', level:'تحلیل مقدماتی'
  };
  if (loaded(t)) return {
    title:'افزایش تأخیر هنگام دانلود',
    text:'هنگام اشغال پهنای باند، پینگ به‌شدت بیشتر شده است. این وضعیت می‌تواند نشانه صف‌شدن ترافیک در مسیر یا سرور باشد.',
    action:'با VPN خاموش هم تست بگیر و در صورت تکرار، تنظیمات مدیریت ترافیک مودم و ترافیک هم‌زمان را بررسی کن.', level:'تحلیل مقدماتی'
  };
  return {
    title:'تست اولیه انجام شد؛ برای تشخیص، تست دوم لازم است',
    text:`دانلود ${fmt(t.download)} Mbps، آپلود ${fmt(t.upload)} Mbps و پینگ ${fmt(t.ping)} ms ثبت شد. از یک مسیر به‌تنهایی نمی‌شود فهمید مشکل حتماً اینترنت است یا VPN.`,
    action:`حالا VPN را ${t.mode === 'on' ? 'خاموش' : 'روشن'} کن، سایت را دوباره باز کن و تست دوم را اجرا کن.`, level:'تحلیل مقدماتی'
  };
}
function showDiagnosis() {
  const d = analyze();
  $('diagnosis').hidden = !d;
  if (!d) return;
  $('diagnosisTitle').textContent = d.title;
  $('diagnosisText').textContent = d.text;
  $('diagnosisAction').textContent = d.action;
  $('confidenceBadge').textContent = d.level;
}
function refresh() { showMetrics(state.tests[state.mode]); showComparison(); showDiagnosis(); }

async function fetchWithDeadline(url, opts, timeoutMs, parentSignal) {
  const own = new AbortController();
  const abort = () => own.abort();
  if (parentSignal?.aborted) own.abort();
  else parentSignal?.addEventListener('abort', abort, {once:true});
  const timeout = setTimeout(abort, timeoutMs);
  try { return await fetch(url, {...opts, signal:own.signal}); }
  finally { clearTimeout(timeout); parentSignal?.removeEventListener('abort', abort); }
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
});
async function pingOnce(signal, timeout=2500) {
  const start = performance.now();
  const res = await fetchWithDeadline('/api/ping?r=' + Math.random().toString(36).slice(2), {method:'HEAD', cache:'no-store'}, timeout, signal);
  if (!res.ok) throw new Error('ping_' + res.status);
  return performance.now() - start;
}
function computePing(values, fails, count) {
  const avg = values.length ? values.reduce((a,b)=>a+b,0) / values.length : null;
  const diffs = values.slice(1).map((v,i) => Math.abs(v - values[i]));
  return {ping:numeric(avg), jitter:numeric(diffs.length ? diffs.reduce((a,b)=>a+b,0)/diffs.length : null), failureRate:numeric(fails / count * 100)};
}
async function pingBatch(signal) {
  const values = [];
  let fails=0;
  for (let i=0;i<12;i++) {
    if (signal.aborted) throw new DOMException('Aborted','AbortError');
    try { const ms = await pingOnce(signal); if (i>=2) values.push(ms); }
    catch(e) { if (signal.aborted) throw e; if (i>=2) fails++; }
    setGauge(null, Math.floor(i/12*18)+2, `پینگ · ${i+1}/12`, 'اندازه‌گیری تأخیر و نوسان');
    if (i<11) await sleep(75, signal);
  }
  if (!values.length) throw new Error('پاسخی از سرور تست دریافت نشد. ممکن است اتصال ناپایدار یا دسترسی به سرور مسدود باشد.');
  return computePing(values, fails, 10);
}
async function downloadTest(signal) {
  const totalLanes = 2;
  const bytesPerLane = 24*1024*1024;
  const timeoutMs = 7000;
  let bytes = 0;
  let finished = false;
  const started = performance.now();
  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, timeoutMs);
  let lastUI = 0;
  const reader = async lane => {
    let streamReader = null;
    try {
      const res = await fetch(`/api/download?bytes=${bytesPerLane}&r=${lane}-${Date.now()}`, {cache:'no-store',signal:local.signal});
      if (!res.ok || !res.body) throw new Error('دانلود شروع نشد');
      streamReader = res.body.getReader();
      while(true) {
        const part = await streamReader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        const now = performance.now();
        if (now - lastUI > 180) {
          const mbps = (bytes*8)/(Math.max(now-started,1)*1000);
          setGauge(mbps, 23 + Math.min(38, (now-started)/timeoutMs*38), 'در حال دانلود', 'دریافت داده از سرور تست');
          lastUI = now;
        }
      }
    } catch (err) { if (signal.aborted) throw err; }
    finally { try { await streamReader?.cancel(); } catch { /* aborted */ } }
  };
  const loaded = [];
  const probe = (async () => {
    await sleep(140, signal).catch(()=>{});
    for (let i=0;i<14 && !finished && !signal.aborted;i++) {
      try { loaded.push(await pingOnce(local.signal, 1500)); } catch { /* under congestion */ }
      await sleep(120, signal).catch(()=>{});
    }
  })();
  let transferEnded = performance.now();
  try { await Promise.allSettled(Array.from({length:totalLanes},(_,i)=>reader(i))); transferEnded = performance.now(); }
  finally { finished = true; clearTimeout(timer); local.abort(); signal.removeEventListener('abort',abort); }
  await probe.catch(()=>{});
  if (signal.aborted) throw new DOMException('Aborted','AbortError');
  const seconds = Math.max((transferEnded - started)/1000, .001);
  if (bytes < 32768) throw new Error('آزمون دانلود دادهٔ کافی دریافت نکرد؛ محدودیت اتصال یا سرور را بررسی کن.');
  return {download:numeric((bytes * 8 / seconds)/1e6), loadedPing:numeric(loaded.length >= 2 ? loaded.reduce((a,b)=>a+b,0)/loaded.length : null), downloadBytes:bytes};
}
function randomBody(bytes) {
  const data = new Uint8Array(bytes);
  // Secure random bytes prevent transparent compression of the test payload.
  for (let i=0; i<bytes; i+=65536) {
    const slice = data.subarray(i,Math.min(i+65536,bytes));
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(slice);
    else for (let j=0;j<slice.length;j++) slice[j]=Math.floor(Math.random()*256);
  }
  return data;
}
async function sendUpload(bytes, signal, timeoutMs=9000) {
  const payload = randomBody(bytes);
  const start = performance.now();
  const res = await fetchWithDeadline('/api/upload', {method:'POST', cache:'no-store',body:payload,
    headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-transform'}}, timeoutMs, signal);
  if (!res.ok) throw new Error('upload_failed_' + res.status);
  const data = await res.json();
  if (data.bytes !== bytes) throw new Error('upload_incomplete');
  return {bytes, ms:performance.now() - start};
}
async function uploadTest(signal) {
  setGauge(null,66,'بررسی سرعت آپلود','ارسال دادهٔ واقعی به سرور');
  const warm = await sendUpload(256*1024,signal,9000);
  let mbps = warm.bytes*8/(warm.ms*1000);
  setGauge(mbps,72,'آماده‌سازی آپلود','نمونهٔ اولیه تکمیل شد');
  if (warm.ms > 4000) return {upload:numeric(mbps),uploadBytes:warm.bytes,uploadShort:true};
  const started = performance.now();
  let doneBytes = 0;
  const results = await Promise.allSettled([0,1].map(async () => {
    const result = await sendUpload(4*1024*1024,signal,9500);
    doneBytes += result.bytes;
    setGauge(doneBytes*8/((performance.now()-started)*1000),84,'در حال آپلود','سنجش ارسال هم‌زمان');
    return result;
  }));
  if (signal.aborted) throw new DOMException('Aborted','AbortError');
  if (doneBytes > 0) mbps = doneBytes * 8 / (Math.max(performance.now()-started,1)*1000);
  return {upload:numeric(mbps), uploadBytes:doneBytes || warm.bytes,uploadShort:doneBytes === 0 || results.some(r=>r.status === 'rejected')};
}

async function runTest() {
  if (state.running || state.viewingShared) return;
  const checked = await fetchConfig();
  if (!checked?.countryCode) return notify('ابتدا اتصال را بررسی کنید.');
  state.running = true;
  const modeAtStart = state.mode;
  if (!state.config?.countryCode) { state.running=false; notify('موقعیت IP مشخص نشد؛ تست خودکار ممکن نیست.'); return; }
  state.abort = new AbortController();
  const signal = state.abort.signal;
  const btn = $('startBtn');
  btn.classList.add('is-running');
  $('startLabel').textContent = 'لغو تست';
  $('diagnosis').hidden = true;
  $('sharingMessage').textContent = '';
  try {
    const config = await fetchConfig();
    if (!config) throw new Error('به سرور تست دسترسی وجود ندارد. اتصال و آدرس سایت را بررسی کن.');
    setStep('ping',3);
    const p = await pingBatch(signal);
    if (signal.aborted) throw new DOMException('Aborted','AbortError');
    $('mPing').textContent = fmt(p.ping); $('mJitter').textContent = fmt(p.jitter); $('mFailure').textContent = fmt(p.failureRate);
    setStep('download',23);
    const d = await downloadTest(signal);
    $('mDownload').textContent = fmt(d.download); $('mLoaded').textContent = fmt(d.loadedPing);
    setStep('upload',66);
    const u = await uploadTest(signal);
    $('mUpload').textContent = fmt(u.upload);
    setStep('final',96);
    const test = {mode:modeAtStart, startedAt:new Date().toISOString(), ipMasked:maskIp(config.ip),
      platform:detectPlatform(), node:config.node, isp:$('ispInput').value.trim().slice(0,50),
      vpnServer:$('vpnNodeInput').value.trim().slice(0,50), ...p,...d,...u};
    state.tests[modeAtStart] = test;
    save(); refresh();
    updateNextStep();
    setGauge(test.download,100,'تست با موفقیت انجام شد','نتیجهٔ سرعت دانلود (Mbps)');
    $('metricsCaption').textContent = `${modeAtStart === 'on'?'VPN روشن':'VPN خاموش'} · تست تکمیل شد`;
    if (state.tests.on && state.tests.off) notify('مقایسهٔ دو اتصال آماده است.');
  } catch(err) {
    if (signal.aborted) { notify('تست متوقف شد و نتیجهٔ نیمه‌کاره ثبت نشد.'); }
    else { notify('خطا: '+(err?.message||'آزمون ناموفق بود')); }
    setGauge(null,0,'آماده برای تست دوباره','برای شروع مجدد دکمهٔ زیر رو بزن');
    refresh();
  } finally {
    state.running = false;
    state.abort = null;
    btn.classList.remove('is-running');
    $('startLabel').textContent = 'شروع تست کامل';
    document.querySelectorAll('[data-step]').forEach(el=>el.classList.remove('active','done'));
  }
}
function summaryText() {
  const d = analyze();
  const lines = ['NetScope - گزارش تشخیص سرعت اینترنت و VPN'];
  for (const mode of ['on','off']) {
    const t = state.tests[mode]; if (!t) continue;
    lines.push('', mode==='on'?'VPN روشن:':'VPN خاموش:',
      `زمان: ${new Date(t.startedAt).toLocaleString('fa-IR')}`,
      `دانلود: ${fmt(t.download)} Mbps | آپلود: ${fmt(t.upload)} Mbps`,
      `پینگ: ${fmt(t.ping)} ms | جیتر: ${fmt(t.jitter)} ms`,
      `پینگ زیر فشار: ${fmt(t.loadedPing)} ms | خطای HTTP: ${fmt(t.failureRate)}%`,
      `IP ناشناس‌شده: ${t.ipMasked} | دستگاه: ${t.platform}`,
      `اپراتور: ${t.isp || 'ثبت نشده'} | سرور VPN: ${t.vpnServer || 'ثبت نشده'}`);
  }
  if (d) lines.push('', 'نتیجهٔ احتمالی: '+d.title, d.text, 'پیشنهاد: '+d.action);
  lines.push('', 'توجه: پینگ HTTP است، خطای درخواست معادل packet loss نیست و این آزمون علت را قطعی اثبات نمی‌کند.');
  return lines.join('\n');
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch {
    try {
      const elem = document.createElement('textarea'); elem.value = txt;
      elem.style.position='fixed'; elem.style.opacity='0';document.body.append(elem);elem.select();
      const success = document.execCommand('copy');elem.remove();return success;
    } catch {return false;}
  }
}
async function shareReport() {
  if (!state.tests.on && !state.tests.off) return notify('اول یک تست انجام بده.');
  const btn=$('shareBtn'); btn.disabled=true;
  $('sharingMessage').textContent = 'در حال ثبت گزارش...';
  try {
    const res=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tests:Object.values(state.tests).filter(Boolean)})});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    sharingUrl = `${location.origin}${data.url}`;
    const copied=await copyText(sharingUrl);
    $('sharingMessage').textContent = `لینک گزارش (اعتبار ۷ روز): ${sharingUrl} ${copied?'· کپی شد':''}`;
    notify(copied?'لینک گزارش در کلیپ‌بورد کپی شد.':'گزارش ساخته شد؛ لینک را از پایین کپی کن.');
  } catch { $('sharingMessage').textContent='امکان ساخت لینک نیست. از گزینهٔ «کپی خلاصه» استفاده کن.'; }
  finally {btn.disabled=false;}
}
async function openSharedReport() {
  const match=/^\/r\/([a-f0-9]{28})$/.exec(location.pathname); if (!match) return;
  try {
    const res=await fetch('/api/reports/'+match[1]);
    if (!res.ok) throw new Error('not_found');
    const report=await res.json();
    state.viewingShared=true;
    state.tests={on:null,off:null};
    for (const t of report.tests) state.tests[t.mode]=t;
    state.mode=state.tests.on?'on':'off';
    document.querySelectorAll('.mode-option').forEach(b=>{
      b.disabled=true; b.classList.toggle('selected',b.dataset.mode===state.mode);
      b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));
    });
    $('startBtn').disabled=true;
    $('ispInput').value = state.tests.on?.isp || state.tests.off?.isp || '';
    $('vpnNodeInput').value = state.tests.on?.vpnServer || '';
    $('ispInput').disabled = $('vpnNodeInput').disabled = true;
    $('startLabel').textContent='گزارش اشتراکی (فقط خواندنی)';
    $('gaugeLabel').textContent='گزارش ذخیره‌شده';
    $('speedMessage').textContent='برای تست جدید به صفحهٔ اصلی برو';
    refresh();
    setGauge(state.tests[state.mode]?.download,100,'گزارش اشتراکی','ثبت‌شده در '+new Date(report.createdAt).toLocaleDateString('fa-IR'));
    $('shareBtn').hidden=true;
    $('comparisonHint').textContent += ' · گزارش ارسالی توسط مرورگر قابل‌اعتبارسنجی مستقل نیست.';
    notify('گزارش اشتراکی باز شد.');
  } catch { notify('گزارش پیدا نشد یا منقضی شده است.'); }
}
function wireEvents() {
  document.querySelectorAll('.mode-option').forEach(el=>el.addEventListener('click',()=>setMode(el.dataset.mode)));
  $('startBtn').addEventListener('click',()=>{if(state.running) state.abort?.abort();else runTest();});
  $('retryBtn').addEventListener('click', async()=>{ await fetchConfig(); updateNextStep(); if(state.config?.countryCode) runTest(); });
  $('copyBtn').addEventListener('click',async()=>notify(await copyText(summaryText())?'خلاصه در کلیپ‌بورد کپی شد.':'کپی خودکار ممکن نبود.'));
  $('jsonBtn').addEventListener('click',()=>{
    const json=JSON.stringify({version:1,tests:Object.values(state.tests).filter(Boolean)},null,2);
    const blob=new Blob([json],{type:'application/json'});
    const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download='netscope-report.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(href),1500);
  });
  $('shareBtn').addEventListener('click',shareReport);
  $('printBtn').addEventListener('click',()=>window.print());
}
async function init() {
  load(); displayDevice(); wireEvents();refresh();
  await fetchConfig(); updateNextStep();
  window.addEventListener('pageshow', async () => { if (!state.running && !state.viewingShared) { await fetchConfig(); updateNextStep(); } });
  if (location.pathname.startsWith('/r/')) await openSharedReport();
}
init();
