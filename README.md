# internet-speed — NetScope Mobile

> نسخه موبایلی آزمایش سرعت اینترنت و VPN با مقایسه دو حالت، شامل دانلود، آپلود، پینگ، جیتر و تحلیل نتایج.

# NetScope Mobile v2

وب‌اپ تست سرعت اختصاصی موبایل با تشخیص خودکار اتصال احتمالی VPN از کشور IP.

## اجرا

```bash
unzip -o vpn-diagnostics.zip -d /opt
cd /opt/vpn-diagnostics
docker compose up -d --build
curl -s http://127.0.0.1:8097/api/health
```

پس از نصب، HTTPS و دامنه را در reverse proxy متصل کنید. پورت 8097 فقط روی loopback میزبان منتشر شده است. اگر Caddy داخل Docker باشد، باید شبکه مشترک تنظیم شود.

## عملکرد

- آدرس IP از سوی سرور دریافت و کشور آن با ipwho.is بررسی می‌شود؛ کشور IR به معنی «احتمالاً بدون VPN» و سایر کشورها به معنی «احتمالاً با VPN» طبقه‌بندی می‌شوند. این دسته‌بندی قطعی نیست.
- IP عمومی برای GeoIP به سرویس ipwho.is ارسال می‌شود؛ سایت فقط IP ماسک‌شده نمایش می‌دهد. GeoIP می‌تواند خطا کند یا خارج از دسترس باشد؛ در این حالت تست برای جلوگیری از دسته‌بندی اشتباه غیرفعال می‌ماند.
- تست‌ها در مرورگر باقی می‌مانند و پس از تغییر VPN دوباره موقعیت IP بررسی می‌شود.
- HTTP RTT، نوسان پینگ، نرخ خطای درخواست، دانلود/آپلود و پینگ هنگام دانلود اندازه‌گیری می‌شوند؛ این‌ها معادل تست پروتکل VPN یا ICMP Packet Loss نیستند.
- تست باید بدون VPN هم قابل دسترس باشد و ترجیحاً در سروری مستقل از سرویس VPN اجرا شود. یک مقصد تست برای تشخیص قطعی علت کافی نیست.
- امکان ساخت لینک گزارش هفت‌روزه اختیاری است.

## تست

```bash
npm test
```

فونت رابط Vazirmatn و فونت آفلاین Noto Sans Arabic به‌عنوان fallback است.
## استقرار از مخزن GitHub

```bash
cd /opt
git clone https://github.com/aliiitavazoeiii-afk/internet-speed.git
cd internet-speed
docker compose up -d --build
curl -fsS http://127.0.0.1:8097/api/health
```

**نکته:** تا زمانی که سورس برنامه (`server.mjs`, `public/`, `Dockerfile`, `compose.yaml`) در مخزن قرار نگیرد، دستور Docker کار نخواهد کرد. Repo ابتدا فقط فایل راهنما دارد.
