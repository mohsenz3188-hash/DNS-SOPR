# DNS Panel

پنل مدیریت DNS به سبک پنل‌های X-UI — مدیریت زون‌ها (دامنه‌ها) و رکوردهای DNS
(A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, PTR, SOA) با داشبورد آماری، فعال/غیرفعال
کردن رکوردها، خروجی Zone File و ابزار بررسی زنده DNS.

A lightweight DNS management panel in the style of X-UI panels: manage zones
(domains) and DNS records from a web dashboard, with a one-line installer for
Linux servers.

---

## 🚀 نصب تک‌خطی روی سرور لینوکس (مثل X-UI)

> مخزن گیت‌هاب: [mohsenz3188-hash/DNS-SOPR](https://github.com/mohsenz3188-hash/DNS-SOPR)
> (عمومی — شاخه `main`)

```bash
curl -sSL https://raw.githubusercontent.com/mohsenz3188-hash/DNS-SOPR/main/install.sh | bash
```

بعد از نصب، پنل روی پورت **2053** در دسترس است:

```
http://YOUR-SERVER-IP:2053
```

### اسکریپت نصب چه کار می‌کند؟

1. ابزارهای پایه (`curl`, `git`) را نصب می‌کند.
2. اگر Node.js نسخه ۱۸ یا بالاتر نباشد، Node.js 20 LTS را نصب می‌کند.
3. مخزن را کلون می‌کند و فایل‌های پنل را در `/opt/dns-panel` می‌گذارد.
4. یک کاربر سیستمی به نام `dns-panel` می‌سازد.
5. سرویس systemd به نام `dns-panel` را نصب، فعال و اجرا می‌کند.
6. اگر فایروال `ufw` فعال باشد، پورت 2053 را باز می‌کند.

اسکریپت **idempotent** است: اجرای دوباره آن فقط کد را به‌روز می‌کند و سرویس را
ری‌استارت می‌کند؛ داده‌های ذخیره‌شده در `/opt/dns-panel/data/db.json` پاک
نمی‌شوند.

### گزینه‌های اسکریپت نصب

| متغیر محیطی | پیش‌فرض | توضیح |
|---|---|---|
| `REPO_URL` | `https://github.com/mohsenz3188-hash/DNS-SOPR.git` | آدرس گیت مخزن |
| `BRANCH` | `main` | شاخه‌ای که نصب می‌شود |
| `PORT` | `2053` | پورت پنل |

مثال:

```bash
curl -sSL https://raw.githubusercontent.com/mohsenz3188-hash/DNS-SOPR/main/install.sh | PORT=8080 bash
```

### مدیریت سرویس

```bash
systemctl status dns-panel     # وضعیت
systemctl restart dns-panel    # ری‌استارت
journalctl -u dns-panel -f     # مشاهده زنده لاگ
```

### نصب دستی (بدون اسکریپت)

```bash
git clone https://github.com/mohsenz3188-hash/DNS-SOPR.git
cd DNS-SOPR
sudo cp -r standalone /opt/dns-panel-standalone
sudo cp dns-panel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dns-panel
```

### پیش‌نیازها

- سرور لینوکس (Ubuntu / Debian / RHEL / CentOS / AlmaLinux)
- دسترسی root یا sudo
- Node.js نسخه ۱۸+ (اسکریپت نصب در صورت نیاز خودش نصب می‌کند)
- نسخه مستقل سرور (`standalone/`) **هیچ وابستگی npm ندارد** و فقط با
  کتابخانه‌های داخلی Node.js کار می‌کند.

---

## ساختار پروژه

```
DNS-SOPR/
├── install.sh            # اسکریپت نصب تک‌خطی سرور
├── README.md             # همین فایل
├── dns-panel.service     # یونیت systemd
├── standalone/           # نسخه مستقل قابل نصب روی سرور
│   ├── server.js         # سرور پنل (فقط Node.js، بدون وابستگی)
│   └── package.json
├── client/               # رابط کاربری نسخه وب (React + TypeScript)
├── server/               # اکشن‌های سمت سرور نسخه وب
└── drizzle/              # مایگریشن‌های دیتابیس نسخه وب
```

## امکانات

- داشبورد آماری: تعداد زون‌ها، رکوردها، رکوردهای فعال/غیرفعال و توزیع نوع رکورد
- مدیریت کامل زون‌ها (دامنه‌ها): ساخت، ویرایش، حذف
- مدیریت رکوردهای DNS با TTL و Priority (برای MX و SRV)
- فعال/غیرفعال کردن هر رکورد با یک کلیک (مثل اینباندهای X-UI)
- جستجو و فیلتر رکوردها بر اساس دامنه و نوع
- خروجی استاندارد **Zone File** (فرمت BIND) برای هر دامنه
- بررسی زنده DNS هر دامنه از DNS عمومی گوگل (DNS-over-HTTPS)
- رابط فارسی راست‌چین با حالت تیره/روشن

## API نسخه مستقل

| متد | مسیر | توضیح |
|---|---|---|
| GET | `/api/panel` | همه زون‌ها، رکوردها و آمار |
| POST | `/api/zones` | ساخت زون |
| PUT / DELETE | `/api/zones/:id` | ویرایش / حذف زون |
| POST | `/api/records` | ساخت رکورد |
| PUT / DELETE | `/api/records/:id` | ویرایش / حذف رکورد |
| POST | `/api/records/:id/toggle` | فعال/غیرفعال کردن رکورد |

## License

MIT
