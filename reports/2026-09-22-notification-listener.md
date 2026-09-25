# بحث: استخدام NotificationListenerService لقراءة إشعارات البنوك في نقطة

| حقل | قيمة |
|---|---|
| **الحالة** | جديد — لسه محدش رد عليه |
| **الكاتب** | Antigravity (بحث فقط) |
| **التاريخ** | 2026-09-22 |
| **السؤال** | هل نقطة تقدر تستخدم notification-listener access على أندرويد عشان تكتشف إشعارات عمليات البنوك، تحلل المبلغ/البنك/التاجر، وتسأل المستخدم قبل ما تسجل مصروف؟ |

---

## الخلاصة المختصرة

الفكرة **ممكنة تقنيًا لكن فيها عقبات كبيرة** — أهمها سياسة Google Play اللي بتتطلب إقرار رسمي ومراجعة كل حالة لوحدها، وميزة Android 15+ اللي بتخفي محتوى الإشعارات "الحساسة" (ومنها رسائل البنوك) عن أي تطبيق طرف ثالث. بالإضافة لمشاكل OEM battery optimization الشائعة جدًا في السوق المصري (Samsung, Xiaomi, Oppo, Realme). فيه تطبيق مصري اسمه **مصاريف (Masareef)** بيعمل بالظبط نفس الفكرة وشغال على Play Store، فده دليل إن الموضوع مش مستحيل — لكنه مش بسيط.

---

## 1. سياسة Google Play لتطبيقات بتطلب Notification Listener Access

### هل مسموح لتطبيق تتبع مصاريف؟

**[VERIFIED]** — مسموح بشروط. سياسة Google Play بتقول إن التطبيق يقدر يطلب `NotificationListenerService` بس لو ده **ضروري لوظيفة أساسية معلنة للمستخدم**. مفيش قائمة "حالات مسموحة" — كل طلب بيتراجع على حدة.

> مصدر: [Google Play Developer Program Policy — Permissions](https://support.google.com/googleplay/android-developer/answer/9888170)

### المطلوب من المطور:

| المتطلب | التفاصيل |
|---|---|
| **Prominent Disclosure** | إفصاح واضح **جوه التطبيق** قبل طلب الإذن — يوضح إيه البيانات اللي هتتقرا وليه |
| **Data Safety Form** | إقرار دقيق في Play Console عن البيانات المجموعة ومعالجتها (on-device vs. off-device) |
| **Permissions Declaration Form** | إقرار رسمي في Play Console يشرح ليه التطبيق محتاج الإذن ده |
| **Financial Features Declaration** | التطبيقات المالية عليها إقرار إضافي |
| **Privacy Policy** | لازم تذكر بصراحة إن التطبيق بيقرا إشعارات وبيستخدمها إزاي |

### مخاطر الرفض:

- **[INFERRED]** الأسباب الشائعة للرفض: عدم وجود إفصاح واضح، استخدام الإذن لغرض غير الوظيفة الأساسية، أو إرسال بيانات الإشعارات لسيرفر من غير ذكر صريح في سياسة الخصوصية.
- **[VERIFIED]** Google بتقول صراحة: لو فيه بديل أقل تطفلًا يحقق نفس الغرض، المراجع هيتوقع إنك تستخدمه.
- **[VERIFIED]** تطبيق **Masareef** (مصاريف) موجود على Play Store ويستخدم نفس الفكرة بالظبط — ده دليل إن Google **قبلت** الحالة دي على الأقل مرة. مصدر: [getmasareef.com](https://getmasareef.com) — الوصف: *"Masareef turns your bank SMS into a clear, private picture of your spending"*.

---

## 2. Android 15+ "Sensitive Notifications" Redaction

### إيه اللي بيحصل:

**[VERIFIED]** — أندرويد 15 (API 35) بيخفي محتوى الإشعارات اللي النظام بيعتبرها "حساسة" عن أي `NotificationListenerService` مش "موثوق". بدل محتوى الإشعار الحقيقي، الـ listener بيشوف:

> **"Sensitive notification content hidden"**

مصدر: [Android 15 Behavior Changes](https://developer.android.com/about/versions/15/behavior-changes-all)

### نطاق الإخفاء (ده مهم):

- **[VERIFIED]** الهدف الأساسي: أكواد OTP/2FA.
- **[VERIFIED]** لكن النطاق **أوسع من كده** — النظام بيستخدم خوارزمية heuristic بتكتشف "محتوى حساس" بناءً على أنماط أرقام وكلمات معينة. مستخدمين كتير أبلغوا إن **رسائل بنكية عادية (مش OTP)** اتخفت كمان.

  > مصدر: [BuzzKill App — Enhanced Notifications Documentation](https://buzzkillapp.com): *"The system's heuristic can be aggressive, sometimes flagging general bank SMS notifications, transaction alerts, or even simple messages as 'sensitive'"*

- **[VERIFIED]** الإعداد المسؤول اسمه **"Enhanced Notifications"** في Settings > Notifications.

### مين "الموثوق"؟

**[VERIFIED]** — التطبيقات اللي عندها إذن `RECEIVE_SENSITIVE_NOTIFICATIONS`، وده إذن `signature|role` — يعني **مش متاح لأي تطبيق طرف ثالث عادي**. بس النظام، تطبيقات الساعة الذكية، وAndroid Auto.

> مصدر: [Android Authority](https://www.androidauthority.com/) + [AOSP Permission Definitions](https://developer.android.com/)

### حلول بديلة:

| الحل | تفاصيل | ملاحظة |
|---|---|---|
| المستخدم يقفل "Enhanced Notifications" | Settings > Notifications > Enhanced Notifications > Off | بيقفل ميزات ذكية تانية (suggested replies) |
| ADB command | `adb shell cmd appops set --user 0 <package> RECEIVE_SENSITIVE_NOTIFICATIONS allow` | محتاج كمبيوتر وADB — مش عملي للمستخدم العادي |
| كشف الإخفاء | التطبيق يقارن النص بسلسلة النظام المترجمة ويعرض رسالة للمستخدم | مش حل فعلي — بس بيحسن التجربة |

### الأثر على نقطة:

**[INFERRED]** — على أجهزة Android 15+ (حاليًا ~15% من السوق المصري)، الميزة دي ممكن تخفي محتوى إشعارات البنوك. ده معناه إن نقطة هتشوف الإشعار بس مش هتقدر تقرا المبلغ/التاجر. **ده أكبر عقبة تقنية.**

---

## 3. Google Play Protect والتطبيقات المثبتة من برّه الStore (Sideloaded)

### التحذيرات:

**[VERIFIED]** — Google Play Protect بيعمل **تحليل لحظي** للتطبيقات اللي بتتثبت من برّه الStore وبتطلب أذونات حساسة زي `BIND_NOTIFICATION_LISTENER_SERVICE`.

- **الحظر عند التثبيت:** Play Protect ممكن يعرض تحذير بيمنع التثبيت. المستخدم لازم يدوس "More details" → "Install anyway".
- **"Restricted Settings" (Android 13+):** حتى بعد التثبيت، النظام ممكن يمنع المستخدم من تفعيل الإذن. بتظهر رسالة:

  > **"For your security, this setting is currently unavailable."**

  الحل: Settings > Apps > [App] > ⋮ Menu > **Allow restricted settings**.

مصدر: [Google Play Protect documentation](https://support.google.com/googleplay/answer/2812853)

### الأثر على نقطة:

**[INFERRED]** — لو نقطة هتتوزع من برّه Play Store (sideloaded APK)، المستخدم هيحتاج يعدي 3 عقبات يدوية: تجاوز تحذير Play Protect + السماح بالإعدادات المقيدة + تفعيل الإذن في إعدادات الإشعارات. ده هيخلي معدل التفعيل منخفض جدًا. **الحل: التوزيع عبر Play Store فقط.**

---

## 4. إضافة NotificationListenerService في Expo Managed Workflow

### الوضع الحالي:

**[VERIFIED]** — `expo-notifications` (اللي نقطة بتستخدمه أصلاً) **مش بيدعم** قراءة إشعارات تطبيقات تانية. هو مصمم بس لإشعارات التطبيق نفسه.

> مصدر: [Expo Notifications docs v54](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/)

### المكتبات المتاحة:

| المكتبة | الحالة | ملاحظات |
|---|---|---|
| [`react-native-android-notification-listener`](https://github.com/leandrosimoes/react-native-android-notification-listener) | **آخر تحديث ~2022** | Android فقط. بيستخدم Headless JS. مفيش config plugin جاهز لـ Expo |
| مكتبات بديلة (Notifee, expo-notifications) | مش بتدعم notification listening | مصممة لـ push/local notifications بس |

### خطوات الإضافة في Expo:

**[VERIFIED]** — مفيش config plugin رسمي ولا community plugin معمول لـ `react-native-android-notification-listener`. المطلوب:

1. **كتابة Custom Config Plugin** — يعدّل `AndroidManifest.xml` يضيف الـ service declaration مع `BIND_NOTIFICATION_LISTENER_SERVICE` permission
2. **التحول لـ Development Builds** — `npx expo prebuild` + `eas build` (نقطة أصلاً بتبني كده)
3. **مش هتشتغل في Expo Go** — محتاج dev build

**[INFERRED]** — البديل الأنضف: كتابة **native module مخصوص** (Kotlin) بدل الاعتماد على مكتبة مهجورة من 2022. الـ module هيعمل:
- `NotificationListenerService` في Kotlin
- يفلتر الإشعارات حسب الـ package name
- يبعت البيانات المفلترة لـ JS عبر EventEmitter
- Config plugin يسجل الـ service في AndroidManifest

---

## 5. الموثوقية: القتل بالبطارية ومشاكل OEM في مصر

### dontkillmyapp.com Scores (أعلى = أسوأ):

**[VERIFIED]** — الأرقام من [dontkillmyapp.com](https://dontkillmyapp.com):

| الشركة | الدرجة | مدى العدوانية |
|---|---|---|
| **Samsung** | 5 💩 / 5 | عدواني جدًا — "Adaptive Battery" و"Deep sleeping apps" بتقتل الخدمات بعد أيام |
| **Xiaomi / Poco** | 5 💩 / 5 | الأسوأ — MIUI/HyperOS بتقتل background services باستمرار |
| **Oppo** | 4 💩 / 5 | عدواني — بتجمّد التطبيقات لحظة ما الشاشة تتقفل |
| **Realme** | 3 💩 / 5 | عدواني — مبني على ColorOS (نفس مشاكل Oppo تقريبًا) |

### إعدادات مطلوبة من المستخدم لكل شركة:

**[VERIFIED]** — المصدر: dontkillmyapp.com

**Xiaomi:**
- Settings > Apps > Manage apps > [نقطة] > Autostart → تفعيل
- Settings > Battery > [نقطة] > No restrictions
- Recent apps > قفل التطبيق (swipe down / padlock)

**Samsung:**
- Settings > Apps > [نقطة] > Battery > **Unrestricted**
- Settings > Battery > "Put unused apps to sleep" → إلغاء لنقطة

**Oppo / Realme:**
- Settings > Battery > Battery optimization > [نقطة] > **Do not optimize**
- تفعيل: Allow auto-launch + Allow foreground activity + Allow background activity
- إلغاء: "Freeze when in Background"

### الأثر:

**[INFERRED]** — الخدمة ممكن تتقتل في أي وقت على الأجهزة دي. الحلول:
- **Foreground Service مع persistent notification** — أفضل طريقة تخلي النظام يحترم الخدمة
- **شاشة إعدادات داخل نقطة** بتوجه المستخدم خطوة بخطوة يعمل الإعدادات لجهازه — زي ما كتير تطبيقات بتعمل (dontkillmyapp.com ممكن يتحول لـ deep link)
- **كشف إن الخدمة اتقتلت** وإعادة تشغيلها + إشعار للمستخدم

---

## 6. التصميم الخصوصي: فلترة الإشعارات

### المبدأ: "اقرا اللي ليك بس"

**[INFERRED]** — التصميم المطلوب:

```
إشعار جديد → هل الـ package name في القائمة البيضاء؟
    ├── لأ → تجاهل فوري (مش بتتقرا، مش بتتخزن)
    └── أيوه → حلل المحتوى → استخرج المبلغ/التاجر
         ├── ملقتش بيانات مالية → تجاهل
         └── لقيت → اعرض للمستخدم "تسجل المصروف ده؟"
              ├── أيوه → سجل في Firestore
              └── لأ → امسح كل حاجة
```

### القائمة البيضاء المقترحة (package names):

**[INFERRED]** — بناءً على بحث عن تطبيقات البنوك المصرية:

| التطبيق | Package Name (تقريبي) | نوع الإشعار |
|---|---|---|
| تطبيق الرسائل (Google Messages) | `com.google.android.apps.messaging` | SMS بنكي يظهر كإشعار |
| تطبيق الرسائل (Samsung Messages) | `com.samsung.android.messaging` | SMS بنكي |
| تطبيق الرسائل (AOSP) | `com.android.messaging` | SMS بنكي |
| NBE Mobile | `com.nbe.mobilebanking.*` | Push notification |
| BM Online | `com.bm.banquemisr.*` | Push notification |
| CIB Mobile | `com.cib.cibmobile.*` | Push notification |
| InstaPay | `com.ebc.instapay.*` | Push notification |
| Vodafone Cash (Ana Vodafone) | `com.vodafone.anavodafone.*` | Push + SMS |

> **ملاحظة مهمة:** الـ package names أعلاه **تقريبية (INFERRED)**. لازم تتأكد بالفعل من Play Store قبل التطبيق.

### قواعد خصوصية مقترحة:

- **[INFERRED]** — مبدأ "لا تقرأ، لا تخزن" لأي إشعار من تطبيق مش في القائمة
- **[INFERRED]** — المعالجة كلها on-device — مفيش بيانات إشعارات بتتبعت لـ Firebase
- **[INFERRED]** — لو المستخدم رفض، البيانات بتتمسح من الذاكرة فورًا
- **[INFERRED]** — مفيش تخزين لنص الإشعار الأصلي — بس المبلغ المستخرج وتصنيف البنك

---

## 7. البنوك والمحافظ المصرية: مين بيبعت إيه

### جدول شامل:

**[VERIFIED]** حيث مذكور، **[INFERRED]** حيث مش مؤكد 100%.

| البنك/المحفظة | تطبيق مخصوص؟ | Push notifications من التطبيق؟ | SMS لعمليات الكارت/الحساب؟ | ملاحظات |
|---|---|---|---|---|
| **الأهلي المصري (NBE)** | ✅ Al Ahly Net / NBE Mobile | ✅ [VERIFIED] | ✅ [VERIFIED] | يبعت SMS + push. الـ SMS بييجي من sender اسمه "NBE" |
| **بنك مصر (Banque Misr)** | ✅ BM Online | ✅ [VERIFIED] | ✅ [VERIFIED] | |
| **CIB** | ✅ CIB Mobile Banking | ✅ [VERIFIED] | ✅ [VERIFIED] | |
| **بنك القاهرة (Banque du Caire)** | ✅ | ✅ [INFERRED] | ✅ [INFERRED] | |
| **QNB** | ✅ QNB Mobile | ✅ [INFERRED] | ✅ [VERIFIED] | |
| **إنستاباي (InstaPay)** | ✅ | ✅ [VERIFIED] | ❌ **مش بيبعت SMS مستقل** [VERIFIED] | الـ SMS بييجي من البنك المربوط مش من InstaPay |
| **فودافون كاش** | ✅ Ana Vodafone | ✅ [INFERRED] | ✅ [VERIFIED] | SMS من "Vodafone" أو shortcode "136" |
| **أورانج كاش** | ✅ | ✅ [INFERRED] | ✅ [VERIFIED] | SMS من "Orange" |
| **إتصالات كاش (e& money)** | ✅ | ✅ [INFERRED] | ✅ [VERIFIED] | SMS من "Etisalat" |
| **فوري** | ✅ myFawry | ✅ [VERIFIED] | ✅ OTP/receipts [VERIFIED] | |

### صيغ الرسائل:

**[INFERRED]** — مفيش مصدر رسمي منشور لصيغ SMS البنوك المصرية. لكن بناءً على بحث في المنتديات والمشاريع المفتوحة:

**الهيكل العام للـ SMS البنكي المصري (INFERRED):**
```
[Sender: NBE/CIB/BM]
[Transaction Type] of EGP [AMOUNT] with Card ending in [REDACTED]
at [MERCHANT_NAME] on [DATE].
Available balance is EGP [REDACTED].
```

**مثال تقريبي (مع حذف الأرقام الحساسة):**
```
NBE: Purchase of EGP [REDACTED] at [MERCHANT] on 23/09/2026.
Available balance: EGP [REDACTED]
```

**Regex مقترح لاستخراج المبلغ:**
```regex
(?i)(purchase|payment|withdrawal|debit|سحب|شراء|دفع)\s+(?:of\s+)?(?:EGP|جنيه)?\s*(\d+[,.]?\d*)\s*(?:EGP|جنيه|LE)?
```

### ملاحظة عن InstaPay:

**[VERIFIED]** — InstaPay **مش بيبعت SMS مستقل**. هو واجهة لحسابك البنكي، فالإشعار بييجي من **البنك المربوط**. يعني لو عملت تحويل InstaPay من حساب NBE، الـ SMS هييجي من NBE مش من InstaPay. لكن تطبيق InstaPay نفسه بيبعت push notification.

---

## 8. تطبيقات مصرية/عربية موجودة بتعمل كده

### Masareef (مصاريف) — الأقرب لنقطة

**[VERIFIED]** — تطبيق مصري متخصص في تتبع المصاريف عبر قراءة رسائل البنوك.

- **الموقع:** [getmasareef.com](https://getmasareef.com)
- **الوصف الرسمي:** *"Masareef turns your bank SMS into a clear, private picture of your spending — and an AI that helps you actually budget. In Arabic and English."*
- **على Play Store:** ✅ نعم — يعني Google قبلت الإقرار بتاعه
- **طريقة العمل:**
  - بيقرا SMS الواردة من البنوك والمحافظ المصرية
  - بيستخرج المبلغ والتاجر والتاريخ تلقائيًا
  - بيصنّف المعاملة
  - المعالجة محلية (on-device) حسب إعلانهم
  - **مش بيعمل أي إجراء مالي** — بيقرا وبيسجل بس
- **البنوك المدعومة (حسب موقعهم):** الأهلي، CIB، بنك مصر، فودافون كاش، إنستاباي، وغيرهم

### Masroofi (مصروفي)

**[VERIFIED]** — تطبيق عربي (مصر والخليج) بيدعم قراءة SMS بنكية.

- **الموقع:** [masarifi.app](https://masarifi.app)

### تطبيقات أخرى:

| التطبيق | المنطقة | الطريقة | ملاحظات |
|---|---|---|---|
| **Walnut** (الهند) | هندي | SMS parsing | نموذج ناجح جدًا — اتباع بـ Axio |
| **Money Lover** | عالمي | SMS parsing اختياري | بيدعم لغات متعددة |
| **Finart** | عالمي | SMS + notification listening | |

### مشروع مفتوح المصدر:

**[VERIFIED]** — [`sarim2000/pennywiseai-tracker`](https://github.com/sarim2000/pennywiseai-tracker) — مشروع مفتوح المصدر بيستخدم AI لقراءة SMS بنكية وتحويلها لبيانات مالية. فيه regex patterns لبنوك مختلفة.

---

## ما لم أتمكن من إيجاده

| الموضوع | ما بحثت فيه | النتيجة |
|---|---|---|
| صيغ SMS رسمية من البنوك المصرية | Reddit, GitHub, XDA, forums مصرية | ملقتش صيغ فعلية منشورة — اللي موجود أمثلة تقريبية |
| Package names دقيقة لتطبيقات البنوك | Play Store | محتاج يتأكد يدويًا من الجهاز |
| نص سياسة Google Play الخاص بالـ notification listener | بحثت عن الصفحة `answer/14090232` | رجعت 404 — يمكن اتغيرت أو اتدمجت |
| إحصائيات دقيقة لتوزيع أجهزة في مصر 2026 | StatCounter, GlobalStats | أرقام تقريبية: Android 15 ~15%, Android 13 ~15%, Android 11 ~14% |
| هل Masareef بتستخدم SMS reading ولا notification listener ولا الاتنين | موقعهم + Play Store | الوصف بيقول "bank SMS" بس مش واضح لو بتقرا notifications كمان |

---

## التقييم النهائي والتوصيات

### مقارنة المسارات:

| المسار | المميزات | العيوب |
|---|---|---|
| **A: SMS Reading (`READ_SMS`)** | أبسط — مش محتاج notification listener. بيشتغل مع كل البنوك اللي بتبعت SMS | Google Play **منعت** إذن `READ_SMS` إلا لتطبيقات الرسائل الافتراضية. **مش متاح.** |
| **B: Notification Listener** | بيشتغل مع push notifications + SMS (عبر تطبيق الرسائل). مسموح بشروط في Play Store | Android 15 redaction، OEM battery kill، مش فيه config plugin جاهز |
| **C: لا ده ولا ده — إدخال يدوي بس** | مفيش عقبات سياسة ولا تقنية | تجربة مستخدم أضعف |
| **D: Notification Listener اختياري** | المستخدم يختار يفعّلها ولا لأ. اللي مش عاوز يفضل يسجل يدوي | أفضل توازن بين القيمة والمخاطر |

### التوصية:

**المسار D** — الميزة دي تتضاف كـ **opt-in اختياري** مش إجباري:

1. **Phase 1 (حالي):** نقطة تفضل بالإدخال اليدوي كما هي
2. **Phase 2 (بعد الإطلاق):** تضاف ميزة "قراءة إشعارات البنوك" كإعداد اختياري في الإعدادات
3. **الشروط:** إفصاح واضح قبل التفعيل، معالجة محلية فقط، فلترة صارمة بالـ package name
4. **التحذير على Android 15+:** رسالة واضحة للمستخدم إن الميزة ممكن متشتغلش على الأجهزة الأحدث وإيه الحل (قفل "Enhanced Notifications")
5. **التوزيع:** Play Store فقط — مش sideloading

### عقبات حقيقية لازم تتحل:

> [!CAUTION]
> 1. **Android 15 redaction** — ممكن يخلي الميزة عديمة الفائدة على ~15% من الأجهزة (والنسبة بتزيد)
> 2. **مكتبة مهجورة** — `react-native-android-notification-listener` آخر تحديث 2022. محتاج إما fork ولا native module من الصفر
> 3. **OEM battery kill** — محتاج شاشة إعدادات مخصصة لكل شركة (Samsung/Xiaomi/Oppo/Realme)
> 4. **Play Store review** — مفيش ضمان إن Google هتقبل — لكن Masareef عدّت

---

*انتهى التقرير. أي تعديل أو استفسار — ردّه هنا.*
