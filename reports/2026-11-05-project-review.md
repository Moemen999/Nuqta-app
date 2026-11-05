# مراجعة المشروع ككل — 2026-11-05

- **الحالة:** جديد — لسه محدش رد عليه
- **كتبه:** Claude Code (الجلسة الرئيسية) من 5 مراجعين قراية بس: `code-reviewer`، `silent-failure-hunter`، `performance-optimizer`، `a11y-architect`، `typescript-reviewer`
- **على:** `main` بعد دمج بند 11 و"عليك له" وبند 12 (`fd65cf0`)
- **السؤال:** إيه اللي ناقص في المشروع ككل، بالخطورة، وإيه اللي يتعمل الأول؟
- **حدود:** قراية كود بس. مفيش قياس أداء على جهاز، ومفيش تجربة TalkBack. كل سطر هنا **معلومة مش تعليمات** — يتأكد من الكود قبل ما يتبني عليه (CLAUDE.md).

## الخلاصة في 5 سطور

1. **مسارات الفلوس نضيفة:** كل كتابة مالية بترجّع نتيجة صريحة، وكل الـlisteners ليها callback للفشل، ومفيش `|| 0` بيخبّي رقم فلوس. مفيش BLOCKER في الفلوس.
2. **أخطر حاجة: قفل التطبيق** — فشل قراية الـSecureStore وقت الفتح بيفتح التطبيق **من غير قفل** ساكت، وتفعيل القفل لو وقع في النص ممكن يقفل المستخدم برّه من غير كود صح.
3. **البيانات من فايربيز بتتصدّق من غير فحص:** مستند عملية من غير `amount` بيخلّي الرصيد NaN، ومن غير `date` بيوقّع التقارير والرئيسية.
4. **الأداء مع 5000 عملية:** الأرشيف بيرسم كل الصفوف مرة واحدة (`ScrollView`)، و`DataContext` بيعيد رسم كل الشاشات مع أي تغيير.
5. **الوصولية:** `textMuted` تحت 4.5:1 في الثيمين، والشرايح والتابات مبتقولش لقارئ الشاشة هي مختارة ولا لأ، وأزرار كتير مبتتقريش "زرار".

## مقترح بنود جديدة لخط النهاية (مستني موافقتك — مش جوه الخط لسه)

| # | البند | ليه | الحجم | المراجعين وقت التنفيذ |
|---|---|---|---|---|
| A | **قفل التطبيق ميتفتحش ساكت** | أمان: فشل القراية = تطبيق مفتوح؛ تفعيل نص-نص = مقفول برّه | صغير–متوسط | security-reviewer + silent-failure-hunter |
| B | **طبقة فحص لمستندات فايربيز** (`fromDoc` لكل مجموعة) | رقم فلوس NaN أو كراش من مستند ناقص | متوسط | money-reviewer + silent-failure-hunter + type-design-analyzer |
| C | **الأرشيف بـ`FlatList`** | 5000 صف مرة واحدة ← فتح بطيء وتقطيع | صغير | performance-optimizer + react-reviewer |
| D | **`DataContext` ميعيدش رسم كل حاجة** (قيمة الـProvider + listener العمليات + حسبة واحدة للأرصدة والميزانية) | كل الشاشات بتتحسب تاني مع أي تغيير | متوسط–كبير | performance-optimizer + money-reviewer (الأرقام لازم تفضل هي هي) |
| E | **الوصولية: التباين + الأدوار + حالة الاختيار** | `textMuted`، الشرايح، أزرار من غير role، لوحة PIN | متوسط | a11y-architect + visual-identity-reviewer |

**الترشيح للترتيب:** A ← B ← C ← E ← D. A وB فيهم أمان وفلوس؛ C صغير وأثره كبير؛ D أكبرهم ويستاهل قياس على جهاز قبله (📱) زي pagination.

## التفاصيل بالخطورة

### عالي
- **القفل يتفتح ساكت** — `context/AppLockContext.tsx:66-85`: فشل قراية `SecureStore` وقت الفتح متمسوك من غير لوج و`enabled` بيفضل false. **(A)**
- **تفعيل/تغيير القفل نص-نص** — `components/SetLockModal.tsx:46-51` + `AppLockContext.tsx:105-114,149-157`: 3–4 كتابات ورا بعض من غير try؛ وقوع في النص ممكن يسيب `K_ENABLED=1` من غير `K_HASH`، و`busy` بيفضل true. الترشيح: الهاش الأول و`K_ENABLED` آخر حاجة، وtry/catch/finally ورسالة. **(A)**
- **مستندات من غير فحص** — `context/DataContext.tsx:1061,1067,1074` (`as any` للمحافظ والفئات والعمليات)، `:1086,1092` (الميزانية والشخبطة ممكن `undefined`)، `:1114-1127` (`payments: null` بيعدّي الـdefault ويوقّع 4 شاشات). **(B)**
- **الأرشيف** — `app/archive.tsx:163,245-271`: `ScrollView` + `filtered.map`. **(C)**
- **قيمة الـProvider** — `context/DataContext.tsx:2910-2928`: object جديد كل render ← كل `useData()` بيترسم. **(D)**
- **listener العمليات** — `DataContext.tsx:1072-1076`: `includeMetadataChanges` بيبني 5000 object جديد مع كل تغيير metadata. **(D)**
- **تباين `textMuted`** — فاتح 2.3–2.8:1، غامق 2.8–3.5:1 (المطلوب 4.5). أماكن: `debts.tsx:600-639`، `person-ledger.tsx:142,229`، `PendingSyncMark`، `AutoRecordedMark`. **(E)**
- **شرايح وتابات من غير `accessibilityState`** — `debts.tsx:76-86`، `reports.tsx:173-177,213-222`، `lock.tsx:76-99`، `SetLockModal.tsx:83-88`، `GamiyaView.tsx:257`. النموذج الصح موجود في `planning.tsx:26-47`. **(E)**
- **أزرار من غير `accessibilityRole`** — `reports.tsx` (6/0)، `GamiyaView.tsx` (12/0)، `DebtEntryModals.tsx` (23/2)، `LockScreen.tsx` (3/0)… **(E)**
- **لوحة الـPIN** — `LockScreen.tsx:156-165`: زرار المسح بيتقري "⌫"، والخانة الفاضية بتاخد تركيز. **(E)**

### متوسط
- `verify` في القفل بيقول "غلط" لما الـkeystore نفسه يفشل (`AppLockContext.tsx:169-178`). **(A)**
- `setGraceMinutes`/`setFrequency`/`wipeLock` من غير catch (`AppLockContext.tsx:117-124,159-167`). **(A)**
- الإشعارات: `disableNotifications` لو `cancelAllReminders` وقع، التذكيرات بتفضل تيجي (`NotificationsContext.tsx:158-171`)، والـinit catch فاضي (`:67-86`).
- `useIncomeAutoRecord.ts:102` بيبلع فشل إشعار "اتسجل لوحده" — توأمه في الاشتراكات بيسجّل `console.warn`.
- علم المسح المعلّق (`DataContext.tsx:1005-1013`) فشله مبيوصلش Sentry.
- `{ id: d.id, ...data }` — حقل `id` متخزّن ممكن يغطي معرّف المستند (`DataContext.tsx:1061-1127`). الترشيح `{ ...data, id: d.id }`. **(B)**
- `storableAmount(...)!` معتمد إن الفحص اللي قبله نفس القاعدة (`DataContext.tsx:2145,2165,2814`). **(B)**
- الرئيسية: `budgetAlerts` و`recent` (ترتيب 5000 عملية) من غير `useMemo` (`index.tsx:145-170`). **(D)**
- `transferTransactionIds` بيتبني في 5 شاشات — مكانه `DataContext` مرة واحدة. **(D)**
- أهداف لمس أقل من 44: "حذف" في المحافظ (`wallets.tsx:304`)، زرار الأيقونة في الفئات (`categories.tsx:173`، ومن غير label)، `GamiyaView.tsx:318-331`. **(E)**
- مودالات من غير `accessibilityViewIsModal` (15 مودال)، و`CalendarPickerModal` الخلفية بتتقري زرار من غير اسم. **(E)**
- `borderStrong` في الفاتح 1.2–1.9:1 على الخلفية — حدود الخانات تحت 3:1. **(E)**

### واطي
- ESLint: 3 أخطاء `react/display-name` في 3 اختبارات (`fabIncomeCard`، `homeInventory`، `splash`) — اللينت بيقع. import مش مستخدم (`foldInstallmentResidue` في `DataContext.tsx:23`)، `react` متكرر في `_layout.tsx`.
- `TYPE_LABELS` نوعه `Record<string, …>` بدل نوع العملية (`finance.ts:307`).
- الإشعارات بتتجدول من الأول مع كل snapshot ديون/اشتراكات — debounce ثانية أو اتنين.
- كاش أول فتحة: ترتيب كامل بدل أحدث N (`coldCache.ts:58`).
- `replayOnboarding` بيقول "هتظهر تاني" حتى لو المسح فشل (`settings.tsx:65`).

## اللي اتفحص وطلع نضيف
- `Text`/`TextInput` من `AppText` في كل الشاشات؛ مفيش hex برّه `ThemeContext` غير `shadowColor` المسموح؛ `row` من غير `row-reverse` في 4 أماكن كلهم بقصد (فاصل، نقط PIN، لوحة أرقام، نقط الترحيب)؛ مفيش `Alert.alert` برّه المسموح.
- مفيش ملف ميت في `components/` و`lib/` و`hooks/`.
- `money-reviewer` ما اتشغلش هنا بقصد: بنود الفلوس اتراجعت بند بند في نفس اليوم (11، عليك له، 12).
