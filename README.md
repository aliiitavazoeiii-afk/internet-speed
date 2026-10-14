# internet-speed — NetScope Mobile

سایت تست سرعت مخصوص موبایل برای کاربران سرویس VPN؛ فارسی و راست‌چین.

## نصب روی سرور Ubuntu با Docker

```bash
sudo apt-get update
sudo apt-get install -y git
sudo mkdir -p /opt
if [ -d /opt/internet-speed/.git ]; then
  sudo git -C /opt/internet-speed pull --ff-only
else
  sudo git clone https://github.com/aliiitavazoeiii-afk/internet-speed.git /opt/internet-speed
fi
cd /opt/internet-speed
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS http://127.0.0.1:8097/api/health
```

نیازمند Docker با افزونه Docker Compose است. آدرس داخلی سرویس: `http://127.0.0.1:8097`. پورت تنها روی loopback میزبان منتشر می‌شود؛ برای دسترسی عمومی باید دامنه و HTTPS با Caddy/Nginx متصل شود.

### Caddy روی خود هاست

```caddyfile
speed.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8097
}
```

آدرس `speed.example.com` را با دامنه واقعی عوض کنید. اگر Caddy داخل کانتینر باشد، `127.0.0.1` به کانتینر Caddy اشاره دارد، نه میزبان؛ باید شبکه مشترک Docker یا مسیریابی مناسب تنظیم شود.

### بروزرسانی

```bash
cd /opt/internet-speed
sudo git pull --ff-only
sudo docker compose up -d --build
```

## آزمایش‌ها

- تشخیص احتمالی VPN روشن/خاموش از کشور IP: ایران = اتصال مستقیم احتمالی، خارجی = اتصال VPN احتمالی. این تشخیص قطعی نیست (Proxy، شبکه شرکتی، Split tunneling و خطای GeoIP).
- دو آزمایش روی همان موبایل: VPN روشن و خاموش؛ مشاهده نتیجه و مقایسه نهایی.
- سرعت دانلود و آپلود، HTTP RTT (پینگ وب)، جیتر، خطای درخواست و تأخیر زیر فشار.
- نتیجه‌های دو حالت در مرورگر ذخیره می‌شوند و با تغییر شبکه مجدداً IP بررسی می‌شود.
- لینک اشتراک‌گذاری اختیاری گزارش با اعتبار ۷ روز.

نکته: این تست فقط کیفیت مسیر تا *سرور همین تست* را بررسی می‌کند؛ نتیجه برای تشخیص قطعی مشکل اپراتور یا VPN کافی نیست. سرور تست را مستقل از سرور VPN نگه دارید و آن را طوری در دسترس قرار دهید که کاربران بدون VPN نیز بتوانند وارد شوند.

## تست توسعه

```bash
npm test
```

### فونت و حریم خصوصی

رابط از Vazirmatn (در صورت دسترسی به Google Fonts) و فونت فارسی محلی Noto Sans Arabic در حالت آفلاین استفاده می‌کند. IP برای شناسایی کشور به سرویس `ipwho.is` ارسال می‌شود؛ فقط IP ماسک‌شده در رابط نمایش داده می‌شود. گزارش اشتراکی به صورت تصادفی و بدون IP کامل ثبت می‌شود.
