> **الحالة:** جديد — لسه محدش رد عليه (بحث بس، **مفيش كود ولا تعديل قواعد** — طلب مؤمن 2026-11-02)
> **مين كتبه:** Claude Code (اللوب) — البحث `rnd-researcher`، القواعد على الورق اتراجعت من `security-reviewer` (تحت)
> **التاريخ:** 2026-11-03
> **السؤال:** "مشاركة للقراية" بربط حسابين بكود جوه التطبيق — إزاي التانيين بيعملوها، والمخاطر، وشكل القواعد على الورق،
> وإجابة السؤالين المفتوحين في TIMELINE 2026-09-25 (الدعوة إزاي، والديون تتشارك ولا لأ).

## اللي اتقرا (بمصدر)
- **YNAB Together:** دعوة **بالإيميل**، صالحة **14 يوم**، والمنضم صلاحيته **تعديل كامل** — support.ynab.com/en_us/ynab-together-B1nS78Cki.md
- **Honeydue:** دعوة بالإيميل والشريك يسجّل بنفسه — support.honeydue.com (…/3179655).
- **Wallet (BudgetBakers):** دعوة بالإيميل وصلاحية **لكل محفظة** (Admin / Track and read / **Read only** / No access) — أقرب نموذج لينا
  (ملخص بحث، support.budgetbakers.com …/7149394922002).
- **Monarch:** دعوة بالإيميل والعضو بيشوف كل حاجة (ملخص بحث — الصفحة رجّعت 403).
- **قواعد Firestore** (firebase.google.com/docs/firestore/security/…): حد `get()`/`exists()` **10 لكل طلب** (20 للـbatch/transaction)،
  وبتتحاسب قراية حتى لو القاعدة رفضت؛ القواعد **مش فلاتر** (الاستعلام كله يا مفيش)؛ `get` منفصل عن `list`؛ **مفيش rate limit**.
- **مش متأكد:** شكل كود Splitwise/Spendee، كود واتساب (8 أرقام ~60 ثانية — من طرف تالت)، هل listener المشاهد بيتقفل فورًا
  بعد الإلغاء، وتكلفة `exists()` في الاستعلامات الكبيرة.
- **الخلاصة:** **كل التطبيقات المالية بتدعو بالإيميل**، ومحدش فيها كود قصير؛ الكود القصير نمط ربط أجهزة. يعني فكرة الكود عندنا
  **طريق مختلف ومحتاج حماية زيادة** — والحماية الحقيقية **موافقة صاحب الحساب على الشخص بالاسم والإيميل**، مش طول الكود.

## من الريبو (اتشاف بالعين — **أهم قيد في التصميم**)
**نوتات عمليات الدين فيها اسم الشخص:** `DataContext.tsx:1582` ("قرض لـ…" / "استلاف من…")، `:1693` (السداد)، `:1890` (الزيادة).
والقواعد **مبتخبيش حقل** — المشاهد اللي يقدر يقرا العمليات بيقرا المستند كله بالنوت. **والعملية مفيهاش ربط بالدين** (الربط
متخزّن في الدين: `transactionId`)، فالقواعد **مش قادرة تستثني** عمليات الدين. يعني "الديون برّه المشاركة" **لوحده مش كفاية**:
الأسامي هتتسرّب من العمليات. الحلول (سؤال 3 تحت):
- (أ) **النوت ميتكتبش فيها الاسم** من دلوقتي (`"سداد دين"` من غير الاسم — الاسم في الدين نفسه والعملية مربوطة بيه)، + **migration** للعمليات القديمة
  (تشيل الاسم من النوت) قبل ما المشاركة تشتغل. أنضف، بس بيلمس فلوس (عملية الدين) ← money-reviewer + silent-failure.
- (ب) العملية تشيل `debtId`، والقاعدة ترفض قراية المشاهد لأي عملية فيها `debtId` — **مش هينفع**: القواعد مش فلاتر، فاستعلام العمليات كله
  هيترفض للمشاهد. لازم المشاهد يستعلم بـ`where('debtId','==',null)` — هش.
- (ج) نسخة "عامة" منفصلة (`users/{owner}/shared/...`) بيكتبها التطبيق من غير الأسامي — بتكرّر البيانات وبتتأخر عن الأصل.

## التصميم المقترح (على الورق)
**الدعوة (كود + موافقة بالاسم):**
1. صاحب الحساب يدوس "شارك حسابي" ← كود **8 رموز** (أبجدية 32 من غير 0/O/1/I، مثلاً `K7M2-QX9P` = 40 بت)، صالح **10 دقايق**، مرة واحدة.
2. المشاهد يكتب الكود في تطبيقه ← بيتكتب **طلب** فيه اسمه وإيميله (المأكّد — من 2026-09-27: المشاركة ممنوعة لحساب مش مأكّد).
3. صاحب الحساب يشوف: **"فلان (الإيميل) بيطلب يشوف محافظك وعملياتك — تعرفه؟ وافق / ارفض"**. من غير موافقة **مفيش أي وصول**،
   فتخمين الكود أو "ابعتلي الكود" أقصاه طلب قدام صاحبه يرفضه.
4. وافق ← `viewers/{uid}` بيتكتب، والكود بيتمسح.

**اللي بيتشارك:** المحافظ، الفئات، العمليات (بعد حل الأسامي)، والتقارير (محسوبة عند المشاهد من نفس البيانات).
**اللي مبيتشاركش:** الديون، الاشتراكات، الجمعية، الدخل الثابت، الميزانيات، الشخبطة، الرأي، `users/{uid}`.
**الإلغاء:** صاحب الحساب يمسح `viewers/{uid}`، والمشاهد يقدر يشيل نفسه. **سجل "مين شاف إيه" مش ممكن** من غير سيرفر. "فوري" لازم
يتثبت باختبار محاكي على listener مفتوح قبل ما نقوله للمستخدم.

**القواعد على الورق (مش في `firestore.rules`):**
```
match /invites/{code} {
  allow get: if request.auth != null;                  // التخمين بيوصل لطلب بس، مش لبيانات
  allow list, update: if false;
  allow create: if request.auth.uid == request.resource.data.ownerUid
    && request.resource.data.expiresAt is timestamp
    && request.resource.data.expiresAt <= request.time + duration.value(10, 'm')
    && request.resource.data.keys().hasOnly(['ownerUid', 'expiresAt']);
  allow delete: if request.auth.uid == resource.data.ownerUid;
}
match /users/{owner}/accessRequests/{viewer} {
  allow create: if request.auth.uid == viewer && viewer != owner
    && request.auth.token.email_verified == true
    && request.resource.data.code is string
    && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.ownerUid == owner
    && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.expiresAt > request.time
    && request.resource.data.email == request.auth.token.email
    && request.resource.data.keys().hasOnly(['code', 'email', 'name', 'at']);
  allow read, delete: if request.auth.uid == owner;
}
match /users/{owner}/viewers/{viewer} {
  allow create, delete: if request.auth.uid == owner
    && exists(/databases/$(database)/documents/users/$(owner)/accessRequests/$(viewer));   // موافقة على طلب موجود بس
  allow delete: if request.auth.uid == viewer;                                              // المشاهد يشيل نفسه
  allow get: if request.auth.uid in [owner, viewer];
}
// تحت wallets / categories / transactions — زيادة على قاعدة صاحب الحساب الموجودة:
allow get, list: if request.auth.uid == owner
  || exists(/databases/$(database)/documents/users/$(owner)/viewers/$(request.auth.uid));
// الكتابة لصاحب الحساب بس، زي دلوقتي. الباقي: صاحب الحساب بس (من غير تغيير).
```

## إجابة السؤالين المفتوحين (2026-09-25)
- **الدعوة إزاي؟** **كود قصير العمر + موافقة صاحب الحساب بالاسم والإيميل.** الإيميل لوحده (زي التانيين) محتاج إرسال إيميلات (سيرفر)؛
  الكود بيشتغل من غير سيرفر، والموافقة بتسد ثغرته.
- **الديون تتشارك؟** **لأ** — فيها أسامي ناس ماوافقوش. **بس** ده محتاج حل الأسامي في نوتات العمليات (سؤال 3) قبل أي تنفيذ.

## أسئلة لمؤمن
1. **كود + موافقة بالاسم** (الترشيح) ولا دعوة بالإيميل زي التطبيقات التانية (محتاجة سيرفر يبعت)؟
2. **مدة الكود:** 10 دقايق (الترشيح) — كفاية إن التاني يكتبه وهو قاعد جنبك أو على التليفون.
3. **الأسامي في نوتات العمليات:** **الترشيح (أ):** النوت تتكتب من غير اسم الشخص من دلوقتي + migration للقديم. بيغيّر شكل العمليات في
   الأرشيف والتصدير ("سداد دين" بدل "سداد دين لـأحمد") — الاسم يفضل في كشف الشخص. ده يتعمل **قبل** المشاركة، وينفع لوحده (خصوصية التصدير والكاش).
4. **إمتى:** مرحلة 2 مع الويب (قرار 2026-10-27) — التصميم ده جاهز لما نوصلها.

## مراجعة `security-reviewer` على القواعد الورقية (2026-11-03)
**الأساس سليم:** الـOR بين القواعد شغال، ومفيش cascade من `users/{userId}` (المشاهد مبيقراش الديون ولا مستند المستخدم)، والمشاهد
مبيقدرش يكتب، و`email_verified` من توكن موقّع. **بس فيه 3 BLOCKER و6 SHOULD-FIX — كلهم على الورق، واتصلحوا في النسخة تحت:**
- **B1 — صاحب الحساب مكانش يقدر يلغي:** `delete` على `viewers` كان مربوط بوجود الطلب، والطلب بيتمسح بعد الموافقة. ومفيش `list`
  لشاشة "مين بيشوف حسابي". ← `delete` لصاحب الحساب أو المشاهد من غير شرط، و`list` لصاحب الحساب.
- **B2 — اسم حر في الطلب:** المهاجم يكتب "بنك مصر" أو اسم قريب ليك وانت توافق على الاسم. ← **الاسم اتشال**؛ الشاشة بتعرض الإيميل
  (من التوكن) بس.
- **B3 — التسريب أوسع من الديون:** نفس المشكلة في نوت الاشتراك (`DataContext.tsx` "اشتراك: …")، والجمعية، والدخل الثابت — والنوت
  اللي المستخدم بيكتبها بإيده ("سلفة لأحمد") مفيش قاعدة تفلترها. وأسامي المحافظ (البنوك) والتسوية بتتشارك بحكم التصميم.
  ← سؤال 3 اتوسّع (تحت).
- **S1** `get` على الدعوة لأي حد ← لازم إيميل مأكّد، والكود **10 رموز (50 بت)**، وصيغته بتتفحص، وTTL على `expiresAt` (التخمين مش
  عملي على حساب، بس بيكلّف فواتير). **S2** الكود بيدخل في مسار `get()` ← يتفحص بـ`matches` قبل ما يتبني المسار. **S3** الطلب
  بيفضل للأبد والكود بيتعاد ← الطلب بوقته (`at == request.time`)، والموافقة خلال ساعة، والطلب والدعوة يتمسحوا في نفس الـbatch.
  **S4 الإلغاء مش فوري مضمون:** `exists()` بتتقيّم وقت فتح الـlistener، فالمفتوح ممكن يكمّل لحد ما الاتصال يتجدد ← **متقولش
  "فوري"** في الواجهة، وصلاحية بتنتهي لوحدها (`until`، مثلاً 30 يوم وتتجدد)، واختبار محاكي بـlistener مفتوح. **S5** المشاهد يقدر
  يشوف طلبه ويلغيه. **S6** المشاهد يعرف `ownerUid` منين؟ ← بيتخزّن في الطلب/الموافقة؛ و`DataContext` النهارده ثابت على `auth.uid`
  — عرض حساب تاني **تغيير معماري** لوحده.

## القواعد الورقية بعد المراجعة
```
match /invites/{code} {
  allow get: if request.auth != null && request.auth.token.email_verified == true;
  allow list, update: if false;
  allow create: if request.auth.uid == request.resource.data.ownerUid
    && request.auth.token.email_verified == true
    && code.matches('[A-HJ-NP-Z2-9]{10}')
    && request.resource.data.expiresAt is timestamp
    && request.resource.data.expiresAt > request.time
    && request.resource.data.expiresAt <= request.time + duration.value(10, 'm')
    && request.resource.data.keys().hasOnly(['ownerUid', 'expiresAt']);
  allow delete: if request.auth.uid == resource.data.ownerUid;
}
match /users/{owner}/accessRequests/{viewer} {
  allow create: if request.auth.uid == viewer && viewer != owner
    && request.auth.token.email_verified == true
    && request.resource.data.code is string && request.resource.data.code.matches('[A-HJ-NP-Z2-9]{10}')
    && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.ownerUid == owner
    && get(/databases/$(database)/documents/invites/$(request.resource.data.code)).data.expiresAt > request.time
    && request.resource.data.email == request.auth.token.email
    && request.resource.data.at == request.time
    && request.resource.data.keys().hasOnly(['code', 'email', 'at']);          // من غير اسم (B2)
  allow read, delete: if request.auth.uid == owner;
  allow get, delete: if request.auth.uid == viewer;                             // S5
}
match /users/{owner}/viewers/{viewer} {
  allow create: if request.auth.uid == owner
    && exists(/databases/$(database)/documents/users/$(owner)/accessRequests/$(viewer))
    && get(/databases/$(database)/documents/users/$(owner)/accessRequests/$(viewer)).data.at > request.time - duration.value(1, 'h')
    && request.resource.data.keys().hasOnly(['email', 'at', 'until'])
    && request.resource.data.at == request.time
    && request.resource.data.until <= request.time + duration.value(30, 'd');   // S4: بينتهي لوحده
  allow delete: if request.auth.uid == owner || request.auth.uid == viewer;     // B1
  allow get: if request.auth.uid in [owner, viewer];
  allow list: if request.auth.uid == owner;                                     // B1: "مين بيشوف حسابي"
}
// تحت wallets / categories / transactions (جوه match /users/{userId} — يبقى userId مش owner):
allow get, list: if request.auth.uid == userId
  || (exists(/databases/$(database)/documents/users/$(userId)/viewers/$(request.auth.uid))
      && get(/databases/$(database)/documents/users/$(userId)/viewers/$(request.auth.uid)).data.until > request.time);
```

## سؤال 3 بعد المراجعة (أوسع)
**الأسامي في النوتات — الترشيح:** كل نوت **مولّدة** (دين، اشتراك، جمعية، دخل ثابت) تتكتب من غير اسم الكيان، والاسم يتعرض من الكيان
المربوط (`subscriptionId`/`gamiyaId`/`incomeId` موجودين في العملية، والدين بالـ`transactionId`) + migration لكل الأنواع.
**والنوت اللي المستخدم بيكتبها بإيده** مفيش طريقة تفلترها: يا إما (أ) شاشة الموافقة تقول صريح "هيشوف ملاحظاتك على العمليات كمان"،
يا إما (ب) النوتات تتنقل لمجموعة لوحدها لصاحب الحساب بس (تغيير نموذج بيانات — type-design-analyzer + database-reviewer).
**الترشيح: (أ)** — أبسط، والمستخدم هو اللي كاتبها وبيختار يشارك.
