# دليل تشغيل وبناء تطبيق Windows لنظام AWLAD SELIM

## 1. مسار حفظ البيانات والنسخ الاحتياطي
- يحفظ تطبيق Windows بيانات التشغيل المحلية (`database.json` و`audit_logs.json` و`sessions.json` و`idempotency.json` و`migration_logs.json` ومفتاح الجلسات `.jwt_secret`) داخل:
  `%APPDATA%\AWLAD SELIM\data`
- تُحفظ النسخ الاحتياطية التلقائية التي يأخذها البرنامج قبل أي نقل أو ترحيل داخل:
  `%APPDATA%\AWLAD SELIM\backups`
- عند التحديث أو إعادة التثبيت أو إلغاء التثبيت، **لا يقوم المثبت بحذف مجلد `%APPDATA%\AWLAD SELIM`** نهائيًا (`deleteAppDataOnUninstall: false`).
- إذا كانت هناك بيانات سابقة داخل `server/data` ولم يكن هناك `database.json` في `%APPDATA%\AWLAD SELIM\data`، يقوم البرنامج تلقائيًا بأخذ نسخة احتياطية كاملة أولًا ثم نقل البيانات والتحقق من تطابق بصمة `SHA-256` وعدد السجلات قبل تشغيل الواجهة.
- إذا كان `%APPDATA%\AWLAD SELIM\data\database.json` موجودًا بالفعل، **لا يتم استبداله أبدًا** بأي ملف قديم أو فارغ.

## 2. إعداد PostgreSQL (اختياري أو على جهاز Windows 10)
- يقرأ التطبيق إعدادات الاتصال تلقائيًا من ملف:
  `%APPDATA%\AWLAD SELIM\.env`
  (أو من ملف `.env` في مجلد التطبيق).
- متغيرات البيئة المطلوبة عند ربط PostgreSQL المحلي:
  - `DATABASE_URL` أو (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`)
  - `JWT_SECRET` (يفضل سلسلة عشوائية قوية لا تقل عن 32 حرفًا)
  - `PORT=3000`
- في حال عدم إعداد PostgreSQL، يعمل البرنامج بأمان على قاعدة السجلات المحلية المؤمنة (`JSON Ledger`) والعمل دون إنترنت بالكامل.

## 3. ربط أجهزة المندوبين وتطبيق العملاء (الشبكة المحلية والاتصال الخارجي)
- يستمع الخادم المدمج داخل Electron تلقائيًا على `0.0.0.0:3000`.
- عند تشغيل الخادم المستقل via `scripts\start-central-server.bat`، يتحقق السكربت أولاً من `/api/health` على المنفذ `3000` لتفادي تشغيل نسختين متعارضتين إذا كان برنامج سطح المكتب مفتوحًا.
- يمكنك معرفة عناوين الشبكة المحلية وإعداد أوضاع الاتصال الأربعة (**Local Network** / **Free Remote Quick Tunnel** / **Pro Remote Named Tunnel** / **Cloud VPS**) وتوليد روابط الربط ورمز QR من **الإعدادات ← Server & Connection Settings** (للمسؤولين فقط).
- **للاتصال الخارجي المجاني بدون دومين**: شغّل `scripts\start-free-tunnel.bat` على لابتوب السيرفر بعد تثبيت `cloudflared` (يعتمد على `scripts\tunnel-supervisor.mjs` لالتقاط رابط `trycloudflare.com` وتحديثه تلقائياً في السيرفر وتعميمه للأجهزة؛ مع ملاحظة أن رابط Quick Tunnel مؤقت ويتغير عند إعادة التشغيل).
- **للاتصال الخارجي الاحترافي بدومين ثابت (Named Tunnel)**: ضع `CLOUDFLARE_TUNNEL_TOKEN` في `%APPDATA%\AWLAD SELIM\.env` أو `.env` (لا يُحفظ في قاعدة البيانات)، ثم شغّل `scripts\start-pro-tunnel.bat`.
- **لتسجيل التشغيل التلقائي للنفق عند إقلاع الويندوز**:
  `powershell -ExecutionPolicy Bypass -File scripts\install-windows-tunnel-task.ps1 -Mode quick -Port 3000`
  (أو `-Mode named` للنفق الاحترافي).
- في جدار حماية Windows (Windows Defender Firewall)، اسمح للبرنامج أو للمنفذ `TCP 3000` داخل الشبكة الخاصة (Private Network) حتى تتصل أجهزة المندوبين والعملاء عبر `http://<IP-الجهاز>:3000`.

## 4. أوامر البناء والتشغيل
- تشغيل الفحوصات الـ 22 للخادم وقاعدة البيانات:
  `node server/tests/runAllTests.mjs`
- التحقق من مسار `%APPDATA%\AWLAD SELIM\data` وبقاء البيانات بعد إعادة التشغيل:
  `node server/tests/verifyElectronBootstrap.mjs`
- تشغيل واجهة Electron محليًا بعد بناء الواجهة:
  `npm run electron:start`
- بناء نسخة مجلد قابلة للتشغيل على Windows:
  `npm run electron:pack`
- بناء ملف التثبيت `Setup.exe` (بمعالج تثبيت كامل على Windows):
  `npm run electron:dist`
  (المخرج في `dist-electron\AWLAD-SELIM-Setup-3.0.0.exe`).
- بناء نسخة `.exe` مستقلة ذاتية التشغيل (تُبنى على Windows أو Linux بدون Wine):
  `npm run electron:portable`

