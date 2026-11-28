# جرد الحدود لـ9.5-6

- **الحالة:** جديد — لسه محدش رد عليه
- **كتبه:** وكيل sonnet (قراية بس)، 2026-11-28، فرع claude/9.5-6
- **السؤال:** أنهي حدود ديكور على كروت ينفع تتشال ويتعتمد على درجة السطح
- **حدود:** grep على app/ وcomponents/ بس، مفيش موبايل

## ملاحظات منهج
- الجرد بالسطر المطابق للـgrep (130 سطر، مش 112؛ الفرق أسطر متعددة العرض وأسطر `borderRightWidth`). سطر فيه عرضين (مثلاً `borderWidth:1` + `borderRightWidth:4`) اتحسب مرة واحدة.
- الأسطر اللي `borderColor` فيها جاي inline من `selectionStyle`/`quietSelectionStyle` (اللون بيتحدد وقت العرض) اتصنّفت C (حالة اختيار).
- الأزرار الـoutline المحايدة (إطار `borderStrong`/`controlEdge` من غير حالة) اتصنّفت E مش A: مش كروت، والإطار فيها عمدًا (controlEdge ≥ 3:1 حسب تعليقات `lib/selection.ts`).
- خلفية الـsheet (`sheetStyle`) هي `c.nav`: غامق #0E131A، فاتح #FFFDF7 (= نفس surface الفاتح).
- كروت فيها `cardElevation` ومن غير حدود موجودة أصلاً (SubscriptionsView:432، IncomesView:499، user-guide cardShadow) وده برّه الجرد.

## العدد لكل فئة
- **A (كارت ديكور، مرشح للشيل):** 8
- **B (خانة إدخال):** 28
- **C (حالة بتشيل معنى):** 57
- **D (فاصل):** 10
- **E (غير محسوم / غيره):** 25
- **المجموع:** 128 صف (130 سطر grep؛ ConfirmProvider:196 وNoticeProvider:198 كمل نفس الستايل اللي قبله)

## الجدول (مجمّع بالملف)

| file:line | style | اللون | العنصر | فئة | ملاحظة |
|---|---|---|---|---|---|
| app/(auth)/index.tsx:230 | borderWidth 1 | borderStrong | googleBtn (surface2) | E | زرار outline، مش كارت |
| app/(auth)/index.tsx:234 | borderWidth 1 | borderStrong | input | B | |
| app/(tabs)/debts.tsx:647 | borderTopWidth 1 | border | expandedArea (فاصل جوه كارت الدين) | D | |
| app/(tabs)/debts.tsx:658 | borderWidth 1.5 | controlEdge | moreBtn «⋯» (surface2) | E | إطار تحكم a11y |
| app/(tabs)/debts.tsx:671 | borderWidth 1.5 | accent | contactBtn (surface2) | C | تمييز accent |
| app/(tabs)/debts.tsx:680 | borderWidth 1 | borderStrong | input | B | |
| app/(tabs)/index.tsx:284 | borderWidth 1.5 | textSecondary | نقطة حالة فاضية (hollow dot) | C | |
| app/(tabs)/index.tsx:543 | borderRightWidth 3 (+borderWidth 0) | transparent | banner (شريط جانبي) | C | اللون inline حسب النوع |
| app/(tabs)/index.tsx:558 | borderRightWidth 3 | accentText | سطر «مستنيين ردك» | C | شريط accent |
| app/(tabs)/reports.tsx:491 | borderWidth 1.5 | controlEdge | dateBtn (surface2) | B | خانة تاريخ |
| app/(tabs)/reports.tsx:506 | borderWidth 1.5 | inline | chip | C | |
| app/(tabs)/reports.tsx:524 | borderBottomWidth hairline | surface2 | trendTrack (خط أساس الرسم) | E | خط رسم بياني، مش فاصل قايمة |
| app/(tabs)/settings.tsx:297 | borderTopWidth hairline | border | rowDivider | D | |
| app/(tabs)/_layout.tsx:182 | borderWidth 1.5 | transparent/inline | iconPill (التاب المختار) | C | |
| app/archive.tsx:370 | borderWidth 1.5 | controlEdge | dateBtn (surface2) | B | |
| app/archive.tsx:382 | borderWidth 1.5 | accent | fullExportBtn | C | |
| app/dev-seed.tsx:220 | borderWidth 1 | border | card (surface، padding xxl) | A | على container bg (سطر 217). غامق #151B24 مقابل #0A0E14، فاتح #FFFDF7 مقابل #F5EFE0: بيختلف. مفيش cardElevation هنا. شاشة dev بس |
| app/dev-seed.tsx:227 | borderWidth 1 | dangerBorder | btnDanger | C | |
| app/modal.tsx:698 | borderWidth 1.5 | inline | typeBtn | C | |
| app/modal.tsx:702 | borderWidth 1 | borderStrong | input | B | |
| app/modal.tsx:704 | borderWidth 1.5 | inline | chip | C | |
| app/modal.tsx:705 | borderWidth 1 | borderStrong | dateBtn | B | |
| app/modal.tsx:710 | borderWidth 1 | warnBorder | noWallets (surface) | C | تحذير |
| app/person-ledger.tsx:262 | borderTopWidth hairline | border | listDivider | D | |
| app/person-ledger.tsx:274 | borderWidth 1 | border | debtBlock (surface، سطر 216) | A | container bg (سطر 253). نفس فرق الألوان زي dev-seed: بيختلف. مفيش cardElevation |
| app/person-ledger.tsx:280 | borderWidth 1 | borderStrong | secondaryBtn | E | زرار outline |
| app/settings-screens/categories.tsx:367 | borderBottomWidth 1 | border | catRow | D | |
| app/settings-screens/categories.tsx:372 | borderWidth 1 | borderStrong | addInput | B | |
| app/settings-screens/delete-account.tsx:227 | borderWidth 1 | dangerBorder | card (surface) | C | خطر، معنى |
| app/settings-screens/delete-account.tsx:232 | borderWidth 1 | border | input | B | |
| app/settings-screens/delete-account.tsx:235 | borderWidth 1.5 | accent | secondaryBtn | C | |
| app/settings-screens/delete-account.tsx:239 | borderWidth 1.5 | danger | dangerBtn | C | |
| app/settings-screens/feedback.tsx:132 | borderWidth 1.5 | inline | chip | C | |
| app/settings-screens/feedback.tsx:133 | borderWidth 1 | borderStrong | textArea | B | |
| app/settings-screens/feedback.tsx:138 | borderWidth 1 | borderStrong | cancelBtn | E | زرار outline |
| app/settings-screens/lock.tsx:158 | borderWidth 1.5 | inline | typeBtn | C | |
| app/settings-screens/lock.tsx:159 | borderWidth 1.5 | inline | graceBtn | C | |
| app/settings-screens/notifications.tsx:285 | borderWidth 1.5 | inline | graceBtn | C | |
| app/settings-screens/notifications.tsx:286 | borderWidth 1.5 | borderStrong | timeBtn | E | زرار اختيار وقت بإطار ثابت، مش حالة |
| app/settings-screens/notifications.tsx:290 | borderWidth 1.5 | accent | alarmBtn | C | |
| app/settings-screens/wallets.tsx:538 | borderWidth 1 | borderStrong | smallInput | B | |
| app/settings-screens/wallets.tsx:543 | borderWidth 1 | borderStrong | addInput | B | |
| app/user-guide.tsx:253 | borderWidth 1 (غامق بس) | border | card (surface، جوه cardShadow سطر 251) | A | الفاتح اتشال أصلاً (`c.shadow ? null : {...}`)؛ الغامق لسه عليه إطار. surface #151B24 مقابل bg #0A0E14: بيختلف |
| app/user-guide.tsx:257 | borderTopWidth 1 | border | cardBody (فاصل جوه الكارت) | D | |
| components/ActionSheet.tsx:102 | borderTopWidth hairline | border | itemDanger | D | |
| components/ArchivedList.tsx:45 | borderTopWidth 1 | border | row | D | |
| components/ArchivedSettlement.tsx:252 | borderWidth 1 | border | card (surface2، سطر 191) | A | مباشرة على sheet (nav): غامق #1C2530 مقابل #0E131A، فاتح #F0E8D4 مقابل #FFFDF7: بيختلف |
| components/ArchivedSettlement.tsx:257 | borderWidth 1.5 | inline | chip | C | |
| components/ArchiveSheet.tsx:120 | borderWidth 1 | border | itemCard (surface2، سطر 68) | A | مباشرة على sheet (nav): نفس الفرق اللي فوق |
| components/ArchiveSheet.tsx:124 | borderWidth 1.5 | inline | chip | C | |
| components/AttentionSheet.tsx:189 | borderRightWidth 3 | accentText | line (surface) | C | شريط accent |
| components/AttentionSheet.tsx:194 | borderRightWidth 3 | inline | singleRow (surface) | C | |
| components/AttentionSheet.tsx:204 | borderRightWidth 3 | inline | row (surface) | C | |
| components/AttentionSheet.tsx:214 | borderWidth 1 | borderStrong | زرار | E | outline |
| components/BrokenTransactions.tsx:212 | borderWidth 1 | dangerBorder | section (surface) | C | خطر |
| components/BrokenTransactions.tsx:214 | borderTopWidth 1 | border | row | D | |
| components/BrokenTransactions.tsx:228 | borderWidth 1 | borderStrong | زرار | E | outline |
| components/BudgetView.tsx:271 | borderWidth 1.5 | controlEdge | input | B | |
| components/Button.tsx:63 | borderWidth 1 | look.border | Button (كل الأنواع) | E | الإطار حسب النوع (variant)، مش كارت |
| components/CalendarPickerModal.tsx:209 | borderWidth 1 | borderStrong | card (surface) | E | حوار عايم على overlay مش على bg الشاشة؛ مش واضح الفرق قدام الـscrim من غير تجربة موبايل |
| components/CategoryIcon.tsx:27 | borderWidth 1 | selectedBorder / borderStrong | دايرة الأيقونة | C | selected أو دايرة surface2 بلا tint (الفرع التاني ديكور صغير) |
| components/CategoryIconPicker.tsx:223 | borderWidth 1 | borderStrong | suggestBtn | E | زرار outline |
| components/CategoryIconPicker.tsx:229 | borderWidth 1.5 | inline | cell | C | |
| components/CategoryIconPicker.tsx:237 | borderWidth 1.5 | borderStrong | emojiInput | B | |
| components/CategoryIconPicker.tsx:246 | borderWidth 1 | borderStrong | زرار | E | outline |
| components/ChargeHomeCards.tsx:480 | borderWidth 1 + borderRightWidth 4 | border / accent | card «اتخصم؟» (surface) | E | جوه PendingSheet (sheet=nav): الفاتح nav = surface (#FFFDF7) يعني من غير إطار مفيش فصل خالص، والغامق فرق خفيف (#151B24 مقابل #0E131A). الشريط accent (4) حالة C |
| components/ChargeHomeCards.tsx:491 | borderWidth 1 | borderStrong | notice «سجلنا لوحدنا» (surface، سطر 198) | A | على bg الرئيسية: بيختلف. تنبيه: نسخة `error` بتغيّر اللون inline لـdangerBorder (سطر 198) فالإطار فيها حالة |
| components/ChargeModePicker.tsx:43 | borderWidth 1.5 | inline | card اختيار (selectionStyle، سطر 31) | C | |
| components/ConfirmProvider.tsx:195 | borderWidth 1 + borderRightWidth 4 | borderStrong / accent | card حوار (nav) | E | حوار على scrim |
| components/ConfirmProvider.tsx:209 | borderWidth 1.5 | danger | dangerBtn | C | |
| components/ConfirmProvider.tsx:212 | borderWidth 1 | borderStrong | cancelBtn | E | outline |
| components/ContactPickerModal.tsx:152 | borderWidth 1 | borderStrong | closeBtn (surface2) | E | outline |
| components/ContactPickerModal.tsx:155 | borderWidth 1 | borderStrong | input | B | |
| components/ContactPickerModal.tsx:158 | borderBottomWidth 1 | border | contactRow | D | |
| components/ContactPickerModal.tsx:164 | borderWidth 1.5 | accent | createBtn | C | |
| components/DataLoadErrorBanner.tsx:105 | borderBottomWidth 1 | dangerBorder | wrap (surface) | C | خطر |
| components/DataLoadErrorBanner.tsx:113 | borderWidth 1 | dangerBorder | زرار إعادة | C | |
| components/DebtEntryModals.tsx:725 | borderWidth 1.5 | accent | contactBtn (surface2) | C | |
| components/DebtEntryModals.tsx:728 | borderWidth 1 | borderStrong | input | B | |
| components/DebtEntryModals.tsx:731 | borderWidth 1.5 | inline | chip | C | |
| components/DebtEntryModals.tsx:732 | borderWidth 1.5 | inline | typeBtn | C | |
| components/DebtEntryModals.tsx:735 | borderWidth 1.5 | inline | leftoverOption | C | |
| components/DebtEntryModals.tsx:738 | borderWidth 1 | borderStrong | dateBtn | B | |
| components/DebtReminderFields.tsx:96 | borderWidth 1 | borderStrong | dateBtn | B | |
| components/DebtReminderFields.tsx:101 | borderWidth 1.5 | inline | chip | C | |
| components/FirstRunSetup.tsx:291 | borderWidth 1 | border + selectionStyle inline | row (surface) | C | سطر 208 بيطبّق selectionStyle: الإطار مؤشر الاختيار |
| components/FirstRunSetup.tsx:297 | borderWidth 1 | border | balanceInput | B | |
| components/FirstRunSetup.tsx:302 | borderWidth 1 | border | chip | C | |
| components/FirstRunSetup.tsx:309 | borderWidth 1 | border | addInput | B | |
| components/FoldedSection.tsx:84 | borderWidth 1 | border | framed (من غير خلفية) | E | الإطار هو الحاوية الوحيدة (بلا bg)؛ التعليق في الكود بيقول إنه باقي عن قصد (9c2a5ab) |
| components/FoldedSection.tsx:87 | borderWidth 1 | border | headAlone (controlBg) | E | رأس قسم بخلفية controlBg: الفاتح = surface، غامق #1C2530؛ نفس سبب 84 |
| components/GamiyaView.tsx:409 | borderTopWidth 1 | border | expandedArea | D | |
| components/GamiyaView.tsx:414 | borderWidth 1 | dangerBorder | deleteBtn | C | |
| components/GamiyaView.tsx:416 | borderWidth 1.5 | controlEdge | editBtn (surface2) | E | إطار تحكم |
| components/GamiyaView.tsx:417 | borderWidth 1.5 | danger | deleteBtnFlex | C | |
| components/GamiyaView.tsx:425 | borderWidth 1 | borderStrong | input | B | |
| components/GamiyaView.tsx:428 | borderWidth 1.5 | inline | chip | C | |
| components/GamiyaView.tsx:429 | borderWidth 1 | borderStrong | dateBtn | B | |
| components/IncomeHomeCards.tsx:254 | borderWidth 1 + borderRightWidth 4 | border / accent | card «نزل؟» (surface) | E | نفس ChargeHomeCards:480 (جوه PendingSheet) |
| components/IncomeHomeCards.tsx:265 | borderWidth 1 | borderStrong | notice (surface، سطر 77) | A | على bg الرئيسية: بيختلف. نسخة `error` inline لـdangerBorder (سطر 77) |
| components/IncomesView.tsx:501 | borderWidth 1 | borderStrong | cardPaused (surface2) | C | حالة «موقوف» |
| components/IncomesView.tsx:511 | borderWidth 1 | borderStrong | editBtn | E | outline |
| components/IncomesView.tsx:513 | borderWidth 1 | dangerBorder | stopBtn | C | |
| components/IncomesView.tsx:527 | borderWidth 1 | borderStrong | input | B | |
| components/IncomesView.tsx:530 | borderWidth 1.5 | inline | chip | C | |
| components/IncomesView.tsx:532 | borderWidth 1.5 | inline | typeBtn | C | |
| components/IncomesView.tsx:533 | borderWidth 1.5 | inline | modeCard | C | |
| components/ListEmptyState.tsx:64 | borderWidth 1 | border | box (surface2) | A | على bg شاشة المحافظ (wallets.tsx:526/426): غامق #1C2530 مقابل #0A0E14، فاتح #F0E8D4 مقابل #F5EFE0 (فرق خفيف جداً). شاشة الفئات (categories.tsx:277) ما اتفحصش الـcontainer بتاعها |
| components/LockScreen.tsx:332 | borderWidth 1 | inline | dot (نقطة PIN) | C | |
| components/LockScreen.tsx:343 | borderWidth 1 | borderStrong | input | B | |
| components/NoticeProvider.tsx:197 | borderWidth 1 + borderRightWidth 4 | borderStrong / accent | card حوار (nav) | E | زي ConfirmProvider |
| components/OnboardingScreen.tsx:116 | borderWidth 1 | borderStrong | backBtn | E | outline |
| components/PendingSheet.tsx:137 | borderRightWidth 4 | accentText | سطر (شريط) | C | |
| components/PendingSheet.tsx:152 | borderWidth 1 | borderStrong | زرار | E | outline |
| components/PeriodChips.tsx:112 | borderWidth 1.5 | transparent/inline | chip (controlBg) | C | |
| components/SegmentedControl.tsx:75 | borderWidth 1.5 | transparent/inline | segment | C | |
| components/SegmentedControl.tsx:79 | borderWidth 1.5 | selectedBorder | indicator | C | |
| components/SetLockModal.tsx:205 | borderWidth 1 | borderStrong | input | B | |
| components/SetLockModal.tsx:207 | borderWidth 1.5 | inline | typeBtn | C | |
| components/ShakhbataView.tsx:362 | borderWidth 1.5 | controlEdge | incomeInput | B | |
| components/ShakhbataView.tsx:368 | borderWidth 1.5 | controlEdge | percentInput | B | |
| components/ShakhbataView.tsx:389 | borderWidth 1.5 | inline | catBtn | C | |
| components/SubscriptionsView.tsx:212 | borderWidth 1 (شرطي) | warnBorder | card لما `soon` | C | حالة «قرب معاده» |
| components/SubscriptionsView.tsx:439 | borderWidth 1.5 | controlEdge | moreBtn (surface2) | E | إطار تحكم |
| components/SubscriptionsView.tsx:447 | borderWidth 1 | borderStrong | input | B | |
| components/SubscriptionsView.tsx:450 | borderWidth 1.5 | inline | chip | C | |
| components/SubscriptionsView.tsx:452 | borderWidth 1.5 | inline | typeBtn | C | |
| components/SubscriptionsView.tsx:453 | borderWidth 1 | borderStrong | dateBtn | B | |
