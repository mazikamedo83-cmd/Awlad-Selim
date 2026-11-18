# دليل تشغيل السيرفر المركزي على لابتوب المحل وربط تطبيق Android و iOS
**نظام أولاد سليم المتكامل — AWLAD SELIM Enterprise 3.0**

---

## 1. البنية المعتمدة للمنظومة
- **لابتوب المحل هو السيرفر المركزي الرئيسي (Central Server)** وقاعدة البيانات الوحيدة للنظام (يدعم السجلات المحلية المؤمنة JSON Ledger أو PostgreSQL).
- **برنامج سطح المكتب (Windows Electron)** يظل يعمل كإدارة كاملة دون أي تغيير على وظائفه أو بياناته.
- **تطبيق الموبايل الواحد (Android & iOS via Capacitor)** يتصل مباشرة بالسيرفر المركزي على اللابتوب، ويحدد بعد تسجيل الدخول هل الحساب:
  - **عميل (`customer`)**: يرى بياناته وفواتيره وكشف حسابه وطلباته والكتالوج وأسعاره المخصصة فقط.
  - **مندوب (`representative`)**: يرى فقط العملاء المصرح له بالتعامل معهم، وعهدة سيارته، ويصدر فواتير/مسودات وطلبات تحويل أصناف.

---

## 2. تجهيز لابتوب المحل كسيرفر مركزي

### أ. تثبيت الإعدادات تلقائياً (Windows Firewall + التشغيل التلقائي)
1. افتح **PowerShell كمسؤول (Run as Administrator)** داخل مجلد المشروع.
2. نفّذ الأمر:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\scripts\install-windows-server-task.ps1 -Port 3000
   ```
   سيقوم السكربت تلقائياً بـ:
   - فتح منفذ `TCP 3000` في جدار حماية Windows لشبكة المحل (`Private/Domain`).
   - تسجيل مهمة تشغيل تلقائي في Windows Task Scheduler عند فتح الويندوز.
   - عرض روابط الشبكة المحلية مثل: `http://192.168.1.100:3000`.

### ب. التشغيل اليدوي المباشر للسيرفر فقط (بدون فتح واجهة سطح المكتب)
اضغط مرتين على:
`scripts\start-central-server.bat`
أو عبر الطرفية:
```bash
npm run server:start
```

---

## 3. طرق ربط تطبيق الموبايل بسيرفر اللابتوب (نظام الاتصال المتعدد - 4 أوضاع)

### الوضع 1: الشبكة المحلية داخل المحل (`Local Network`)
1. تأكد من ثبات IP اللابتوب من إعدادات الراوتر (DHCP Reservation مثلاً `192.168.1.100`).
2. في تطبيق الموبايل أو شاشة الإدارة **Server & Connection Settings**، اختر **الشبكة المحلية** وأدخل:
   `http://192.168.1.100:3000`
3. اضغط **"اختبار الاتصال"** للتأكد من استجابة السيرفر.

### الوضع 2: الاتصال الخارجي المجاني (`Free Remote Connection — trycloudflare.com`)
1. على لابتوب السيرفر، ثبّت `cloudflared` وشغّل `scripts\start-free-tunnel.bat` (أو الأمر `cloudflared tunnel --url http://127.0.0.1:3000`).
2. انسخ الرابط المؤقت الآمن `https://xxxx.trycloudflare.com` وضعه في وضع **Free Remote Connection** (يعمل مجاناً بدون دومين أو اشتراك).

### الوضع 3: الاتصال الخارجي الاحترافي (`Professional Remote Connection`)
1. **Cloudflare Named Tunnel مع دومين ثابت** أو **Nginx Reverse Proxy SSL** (`scripts\reverse-proxy-nginx.conf` مع `TRUST_PROXY=1`).
2. أدخل الدومين الثابت المشفر مثل `https://erp.yourdomain.com` في وضع **Professional Remote Connection**.

### الوضع 4: السيرفر السحابي الدائم مستقبلاً (`Cloud VPS Connection`)
- عند الرغبة لاحقاً في تشغيل السيرفر على VPS على مدار 24 ساعة، أضف عنوانه المشفر (`https://...`) في وضع **Cloud VPS Connection**، وانقل نفس قاعدة البيانات (النسخة الاحتياطية أو PostgreSQL) يدوياً بموافقة الإدارة دون إنشاء قاعدة منفصلة.

---

## 4. بناء وتثبيت تطبيق Android و iOS (Capacitor)

### المتطلبات:
- لتجهيز ومزامنة كود الويب مع المشاريع الأصلية في أي وقت:
  ```bash
  npm run cap:sync
  ```

### بناء Android (`.apk` / `.aab`):
- **آلياً عبر GitHub Actions**: يبني الـ Workflow الجديد `.github/workflows/mobile-android.yml` ملفات `app-debug.apk` و `app-release-unsigned.apk` ويرفعها في **Artifacts** تلقائياً.
- **محلياً (باستخدام Android Studio + JDK 21)**:
  ```bash
  npm run build
  npx cap sync android
  npx cap open android
  ```
  ثم اختر **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** داخل Android Studio.

### بناء iOS (`.ipa` على macOS + Xcode):
> ملاحظة تقنية: يتطلب تصدير وتوقيع تطبيق iOS جهاز **Mac** مع **Xcode** وحساب **Apple Developer**.
```bash
npm run build
npx cap sync ios
npx cap open ios
```
ثم اختر جهاز البناء أو **Any iOS Device (arm64)** ثم **Product -> Archive** في Xcode لتصدير ملف `.ipa` أو النشر على TestFlight / App Store.

---

## 5. إدارة الصلاحيات والتحكم من برنامج الكمبيوتر
- **تعيين المناديب للعملاء**: من شاشة **العملاء -> إضافة/تعديل عميل -> المناديب المسموح لهم**. لن يرى أي مندوب سوى العملاء المحددين له.
- **عجز مخزون سيارة المندوب**: إذا سجل المندوب فاتورة بكمية غير متوفرة في سيارته، تُحفظ تلقائياً كـ **مسودة**، ويرسل طلب تحويل أصناف مرتبط بها للإدارة. لا يمتلك المندوب صلاحية اعتماد التحويل لنفسه، وبعد تنفيذ الإدارة يستطيع المندوب تأكيد الاستلام ثم اعتماد الفاتورة.
- **صلاحيات الموبايل**: من **الإعدادات -> بوابة الموبايل** يمكن تفعيل/إيقاف تطبيق العملاء وتطبيق المناديب وإخفاء الأسعار عن العملاء.
