# صفحات الخصوصية ومسح الحساب + مسودة Data safety وإعلان الميزات المالية (9.5-1)

- **الحالة:** جديد — لسه محدش رد عليه
- **كتبه:** Claude Code (جلسة سحابية)، 2026-11-26
- **السؤال:** إيه اللي محتاجينه في Play Console عشان الخصوصية: لينك سياسة، لينك مسح حساب، Data safety، والميزات المالية؟
- **حدود:** الصفحات اتكتبت واتراجعت على الكود، **ما اتنشرتش** (النشر محتاج `firebase login` — مؤمن). استمارات Play Console نفسها ما اتشافتش؛ أسامي الخانات من الذاكرة وملخصات نتايج البحث، فتتراجع على الاستمارة وقت الملء.

## 1) الصفحات

| الملف | الرابط بعد النشر | بيتحط فين في Play Console |
|---|---|---|
| `hosting/public/privacy.html` | `https://nuqta-711f2.web.app/privacy` | App content ← Privacy policy، وصفحة المتجر |
| `hosting/public/delete-account.html` | `https://nuqta-711f2.web.app/delete-account` | Data safety ← Data deletion ← «Delete account URL» |
| `hosting/public/index.html`، `404.html`، `style.css` | الجذر | — |

- عربي RTL بنفس ألوان التطبيق في الثيمين، وتحت كل صفحة ملخص إنجليزي (المراجع في Google غالبًا بيقرا إنجليزي).
- صفحة المسح فيها اللي Google بتطلبه بالاسم: اسم التطبيق، اسم المطوّر، الخطوات، **طريق من غير التطبيق** (إيميل من نفس العنوان المسجّل، خلال 30 يوم)، إيه اللي بيتمسح، وإيه اللي بيفضل وقد إيه.
- `firebase.json` فيه `hosting` دلوقتي (`cleanUrls`، وهيدرين أمان). النشر بـ`--only firestore:rules` مبيتأثرش.
- **حارسين:** `scripts/hosting-check.js` بيتنادى لوحده قبل نشر الاستضافة (`predeploy`) وبيرفض لو فيه خانة فاضية؛ و`lib/__tests__/hostingPages.test.ts` بيقع لو اسم صف «مسح الحساب» أو جملة «امسح حسابي» أو قايمة المجموعات اللي بتتمسح (`ACCOUNT_COLLECTIONS`) أو أذونات `app.json` اتغيّرت والصفحة ما اتحدّثتش.

### خطوات النشر (مؤمن)
1. املا `{{DEVELOPER_NAME}}` (نفس الاسم اللي هيظهر في المتجر بالظبط) و`{{CONTACT_EMAIL}}` (إيميل تواصل عام — هيبقى ظاهر في المتجر كمان) في `privacy.html` و`delete-account.html`.
   ⚠️ الريبو عام: لو عملت كوميت بيهم هيبقوا في التاريخ. ده مقبول لو ده إيميل المطوّر العام اللي هيتحط في المتجر أصلاً — قرارك.
2. `node scripts/hosting-check.js` ← لازم يقول ✓.
3. `npx firebase login` ثم `npx firebase deploy --only hosting`.
4. **قبل ما تقدّم:** `node scripts/rules-published-check.js` (بعد الدخول) — مسح الرأي بيفشل لو قواعد `feedback` مش منشورة؛ واتأكد من كونسول Firestore إن **PITR والنسخ الاحتياطية مقفولين** (لو مفتوحين، جملة «بيتمسحوا على طول» محتاجة سطر عن مدة النسخ)؛ وخطة Sentry (مدة الحفظ 30 يوم في Developer، 90 في Team).
5. افتح الرابطين من موبايل **من غير تسجيل دخول** واتأكد إنهم بيفتحوا (Google بترفض رابط محتاج دخول أو PDF).

### فاضل (مش جوه 9.5-1)
- **باگ محتمل (MEDIUM، من `security-reviewer`، ما اتثبتش باختبار):** بعد مسح الحساب، `NotificationsContext` لسه `enabled` في الذاكرة، فلما `DataContext` يفضّي القوايم الجدولة بتشتغل تاني وترجّع التذكير اليومي — وفي الفتحة الجاية `enabled` false فمحدش بيلغيه. وكمان `nuqta_notifs_daily_minute` مش في `multiRemove` (`delete-account.tsx:63`). **قبل التصليح: المشكّك + اختبار.** لحد ما يتصلح، صفحة المسح **مبتقولش** إن التذكيرات بتتمسح.
- `WRITE_CONTACTS` بييجي من plugin `expo-contacts` والتطبيق مبيستخدموش ← `android.blockedPermissions` (بناء + `app.json`).
- `redactText` مبيشيلش الإيميلات تحديدًا (`lib/sentryScrub.ts`) — الصفحة مبقتش بتوعد بده.
- **لينك سياسة الخصوصية جوه التطبيق** (Google بتطلبه في التطبيق نفسه كمان، مش المتجر بس): صف في «عن التطبيق» بيفتح `/privacy`. تغيير شاشة ← بند لوحده مع `visual-identity-reviewer` + `a11y-architect`.

## 2) مسودة Data safety

مبنية على الكود (اتراجعت بوكيل `security-reviewer` — شوف آخر التقرير).

**الأسئلة العامة**
| السؤال | الإجابة | السبب |
|---|---|---|
| بتجمع أو بتشارك بيانات من الأنواع المطلوبة؟ | **أيوه** | |
| كل البيانات متشفّرة وهي بتتنقل؟ | **أيوه** | Firestore وAuth وSentry كلهم HTTPS |
| المستخدم يقدر يطلب مسح بياناته؟ | **أيوه** | جوه التطبيق + صفحة المسح |
| حساب الدخول: | **تسجيل بإيميل وباسورد + جوجل** | |
| رابط مسح الحساب | `https://nuqta-711f2.web.app/delete-account` | |

**«مشاركة» = لا في كل الأنواع:** Firebase وSentry مقدّمي خدمة بيشتغلوا لحسابنا، وGoogle بتستثني ده من «Shared».

| الفئة ← النوع | اتجمع؟ | إجباري/اختياري | الغرض | ملاحظة |
|---|---|---|---|---|
| Personal info ← **Email address** | أيوه | إجباري | App functionality، Account management | |
| Personal info ← **Name** | أيوه | إجباري | Account management | الاسم مطلوب في التسجيل (`app/(auth)/index.tsx:97`) |
| Personal info ← **User IDs** | أيوه | إجباري | App functionality، Account management | معرّف Firebase بيتحفظ مع الرأي (`uid`) |
| Financial info ← **Other financial info** | أيوه | إجباري | App functionality | المحافظ والعمليات والديون… اللي المستخدم بيكتبها. **مش** «User payment info» (مفيش كروت) ولا «Purchase history» ولا «Credit score» |
| **Contacts** | أيوه | **اختياري** | App functionality | اسم + رقم + معرّف جهة الاتصال للشخص اللي اتختار بس، بيتحفظ مع الدين. القايمة نفسها بتتقري على الجهاز ومبتترفعش — والقراية على الجهاز بس مش «جمع» |
| App activity ← **Other user-generated content** | أيوه | اختياري | App functionality | نص الرأي، والملاحظات على العمليات |
| App info and performance ← **Crash logs** | أيوه | إجباري | Analytics | Sentry، بعد التنضيف |
| App info and performance ← **Diagnostics** | أيوه | إجباري | Analytics | نوع الجهاز ونسخة النظام (Sentry + الرأي) |
| **Device or other IDs** | أيوه | إجباري | Analytics | sentry-android بيحط معرّف تثبيت عشوائي في `user.id`/`device.id` (مش مربوط بالحساب). **يتأكد من حدث حقيقي في Sentry** |
| Financial info ← Purchase history | **اختياري تعلنه للأمان** | إجباري | App functionality | المصاريف اللي المستخدم بيسجّلها؛ الوكيل اقترح تتعلن احتياطيًا — قرار مؤمن |

**مش بنجمع:** Location، Phone number بتاع المستخدم نفسه، Photos/Videos، Audio، Files، Calendar، Messages، Web browsing، Installed apps، Health.

## 3) إعلان الميزات المالية (Financial features)

- **إجباري لكل تطبيق** على أي مسار (حتى الاختبار المغلق)، من App content ← Financial features.
- الاختيارات متجمّعة تحت عناوين زي Banking and loans (قروض شخصية، وسيط قروض، Payday، بنوك، خط ائتمان، مراقبة ائتمان، نصيحة مالية، تأمين…) و**Other**، وفي الآخر «My app doesn't provide any financial features».
- **«نقطة» مبتقدّمش أي منتج مالي:** مبتحرّكش فلوس، مبتقرضش، مبتوصلش بحساب بنكي، ومبتدّيش نصيحة. الديون والجمعية **دفتر** المستخدم بيكتب فيه بإيده.
- **التوصية:** «My app doesn't provide any financial features». **بس فيه خطر:** سياسة Financial Services بتعرّف المنتجات المالية إنها «المتعلقة بإدارة أو استثمار الفلوس»، و«إدارة» ممكن تتقري على تطبيق ميزانية. لو الاستمارة فيها خيار صريح لتتبع المصاريف/الميزانية — اختاره. لو مفيش، الخيار البديل **Other** بوصف: *"Personal expense tracker. Users manually record their own spending, budgets and personal debts. The app does not move money, lend, connect to bank accounts, or give financial advice."*
- في وصف المتجر قول نفس الجملة دي بالظبط — عشان الإعلان والوصف ميتعارضوش (فيه بلاغ رفض «الإعلان مش دقيق» في منتدى Google).
- **ده قرار مؤمن وقت الملء**؛ الصياغة الدقيقة للاستمارة ما اتشافتش.

## 4) المراجعات
- **`arabic-copy-reviewer`:** مفيش HIGH؛ 2 MEDIUM (زرار التصدير بيفتح الأرشيف، «زرار امسح حسابي») + LOW اتطبقوا كلهم ماعدا اللي مالوش تغيير.
- **`security-reviewer` (opus، صحة الادعاءات):** اتصلّح في الصفحات: تقارير Sentry فيها معرّف تثبيت ومعلومات جهاز أكتر (مش «الموديل والنظام» بس) والوعد المطلق «مفيش إيميل/IP» اتشال؛ بيانات Auth اللي فايربيز بتحفظها + اختيار أول تجهيز؛ الرأي فيه معرّف الحساب والوقت؛ جلسة الدخول على الجهاز؛ التذكير على شاشة القفل؛ وصول المطوّر من الكونسول؛ «على طول» = من جوه التطبيق (الإيميل 30 يوم)؛ خط Google Fonts اتشال (كان بيبعت IP الزوّار لجوجل من صفحة الخصوصية نفسها). اتأكد صح: مفيش إعلانات ولا analytics ولا push tokens ولا fetch؛ القفل hash في SecureStore؛ الطابور متشفّر وبيتمسح؛ المسح بيغطي كل المجموعات العشرة + الرأي + `users/{uid}` + حساب الدخول.
- **المشكّك** (قاعدة 2026-11-17) ما اتشغّلش على باگ التذكيرات — مش هيتصلّح في الجلسة دي.

## المصادر
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Financial Services policy: https://support.google.com/googleplay/android-developer/answer/9876821
- بلاغ «الإعلان مش دقيق»: https://support.google.com/googleplay/android-developer/thread/322937464
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469 · حذف الحساب: https://support.google.com/googleplay/android-developer/answer/13327111 · سياسة الخصوصية: https://support.google.com/googleplay/android-developer/answer/9859455
- (صفحات support.google.com اتقريت من ملخصات البحث بس — الدومين ممنوع من البيئة.)
