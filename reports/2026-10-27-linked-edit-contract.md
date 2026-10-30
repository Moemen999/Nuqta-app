# عقد تعديل العملية المربوطة — إيه اللي يتنقل وإيه لأ

> **الحالة:** اتقرا — اتبنى عليه `lib/linkedEdit.ts` و`updateDebtLinkedTransaction` (فرع `feat/archive-edit-old-tx`)
> **مين كتبه:** Claude Code (spec-miner، قراية بس)، اتحفظ من Claude Code
> **التاريخ:** 2026-10-27
> **السؤال:** لو تعديل عملية مربوطة هيتنقل للسجل اللي ولّدها، إيه الحقول المنسوخة في كل نوع ربط، مين بيقراها، وإيه الثوابت اللي ممكن تتكسر؟

اتقرا على `0f04f5b`. أرقام السطور وقتها — الكود اتحرك بعدها.

## الملخص

| الربط | يتنقل (نسخة من اللي اتحرك) | ممنوع يتنقل (جدول) | ربط النوع |
|---|---|---|---|
| أصل الدين | `totalAmount`، `initialWalletId`، `date` + إعادة عدّ الأقساط + `pinInstallmentAmount` | `installmentAmount` (متثبّت) | owed_to_me=expense / i_owe=income |
| دفعة دين | `amount`، `walletId`، `date`، `categoryId` (i_owe) + العدد + التثبيت | — | owed_to_me=income / i_owe=expense |
| زيادة دين | `amount`، `walletId`، `date` + العدد + التثبيت | — | owed_to_me=expense / i_owe=income |
| اشتراك | — (`history[].amount/date` بيقراهم حارس "اتسجل النهاردة" بس، `markSubscriptionPaid`؛ نقلهم كان هيكسره، وأصلاً ممكن يختلفوا عن العملية من قبل كده) | `amount`، `walletId`، `categoryId`، `nextDueDate`، `periodKey`، مفاتيح `closed` | expense |
| جمعية | — | `months[].amount`، `dueDate`، `g.walletId`، `status` | isPayoutMonth=income / غيره expense |
| دخل ثابت | — (`closed[key]` فيه `txId`/`skipped`/`at` بس) | `amount`، `walletId`، مفاتيح `closed` | income |
| تسوية | — (علامة على العملية، مالهاش سجل) | — | withdraw |

## اللي لازم يتعرف قبل التصميم

1. **حارس الدفع الزيادة في الشاشة بس** (`DebtEntryModals.tsx` وقت الإضافة) — التعديل كان بيتجاوزه. اتحل: المودال بيسأل لو التعديل زوّد الزيادة.
2. **`payment.walletId`/`increase.walletId` بيغذّوا حارس المحفظة المؤرشفة** جوه ذرة المسح وفي الشاشة — نسخة قديمة = الحارس بيفحص محفظة غلط. اتحل بالنقل.
3. **المودال كان بيسمح بتغيير النوع** لأي عملية مربوطة، وده بيعكس اتجاه الدين وشهر الاستلام. اتحل: النوع مقفول لأي ربط.
4. **التزامن:** `stageReconcile` بيكتب مصفوفة الدفعات من حالة الرياكت — نفس السباق اللي `addDebtPayment` اتحولت ذرية عشانه. اتحل: التعديل ذري (`runTransaction`) ومحتاج نت.
5. **المعاد (`dueDate`)** مبيتعادش حسابه في التعديل (استنتاج — مفيش كود بيعمله).

## القرّاء الأساسيين (للمراجعة)

- `totalAmount`/`payments[].amount`/`increases[].amount` ← `debtGrandTotal`/`debtPaid` ← المتبقي، الزيادة، العدد، الشاشات (`debts.tsx`، `person-ledger.tsx`، `reports.tsx`)، التذكيرات.
- `walletId` على الدفعات والزيادات ← `walletReferences` (`lib/archiving.ts`)، حراس المسح على المؤرشفة.
- التحويلات (سلفة/جمعية) بتتعرف **بالمعرّف** مش بالنوع (`transferTransactionIds`، `lib/spending.ts`) — التعديل مبيغيّرش المعرّف.

## الاختبارات اللي كانت بتغطي

تعديل عملية مربوطة: اختبار واحد بس (`autoCharge.emulator` "تعديل العملية ← المبلغ الجديد يفضل") ومبيفحصش `history`. الباقي حذف وإضافة: `reconcile`، `installments`، `pinInstallmentAmount`، `overpay`، `debtEntryDelete`، `debtConcurrency`، `settlement`، `duplication`، `recurringIncome` (كلهم `*.emulator.test.tsx`).
