import { useNotice } from '@/components/NoticeProvider';
import { useAuth } from '@/context/AuthContext';
import { figuresFresh } from '@/lib/staleFigures';
import { transfersStatusFrom, type TransfersStatus } from '@/lib/spending';
import { debtFromDoc, finiteOr, gamiyaFromDoc, incomeFromDoc, numberField, splitTransactions, subscriptionFromDoc, walletFromDoc, withId, type BrokenTransaction } from '@/lib/fromDoc';
import { dueDateAfterIncreaseRemoval, reopenedDueMessage } from '@/lib/reopenDue';
import { buildColdSnapshot, COLD_CACHE_PREFIX, COLD_CACHE_WRITE_DELAY_MS, coldCacheKey, parseColdSnapshot, type ColdSnapshot } from '@/lib/coldCache';
import type { FullExportInput } from '@/lib/fullExport';
import { feedbackFromDoc } from '@/lib/fullExport';
import { db } from '@/firebaseConfig';
import {
  cascadeDeleteBlock, debtTransactionIds, gamiyaTransactionIds, settlementNote, subscriptionTransactionIds, walletDeleteBlock,
  type ArchiveBlock, type CascadeDeleteBlock, type CascadeKind,
} from '@/lib/archiving';
import { reportAtomicFailure, type AtomicOp } from '@/lib/atomicFailure';
import { buildFeedbackDoc, type FeedbackType } from '@/lib/feedback';
import { debtLinkedEditPlan, debtRoleOf, installmentEditMessage, storableAmount, type LinkedEditNext } from '@/lib/linkedEdit';
import {
  gamiyaEntryProblem, invalidEntry, subscriptionEntryProblem, validReminderDays, type EntrySaveResult,
} from '@/lib/entryValidation';
import {
  addDays, addMonths, debtGrandTotal, debtPaid, debtRemaining,
  installmentChangeMessage, installmentCountAfterPayment, installmentCountFor, installmentIncreaseMessage, isDateStr, pinInstallmentAmount, reopenedDueDate,
  foldInstallmentResidue, stampResidue, transactionDeleteDebtPlan, debtLinkWarning, increaseLeftoverChoice, residueForIncrease, sameLeftoverSeen, type LeftoverMode, type LeftoverSeen, installmentResidueIgnored, installmentResidueKnown, storableCount, toMoneyAmount, installmentValue, planInstallmentCountEdit, planInstallments, PIASTRE_EPS, roundMoney, suggestedInstallmentPayment, todayStr,
} from '@/lib/finance';
import {
  addDoc, arrayRemove, collection, deleteDoc, deleteField, doc, FieldPath, getDocFromServer, getDocsFromServer, limit, onSnapshot, query, where,
  runTransaction, serverTimestamp,
  setDoc, updateDoc, waitForPendingWrites, writeBatch,
  type DocumentReference, type FirestoreError, type Transaction as FirestoreTransaction, type WriteBatch,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { WRITE_ERROR_RESET_MS, WRITE_ERROR_TITLE, namedLabel, writeErrorBody } from '@/lib/writeError';
import {
  incomeHasRecords, incomePeriodLabel, incomeRescheduleStart, incomeScheduleKeysChange, incomeTxDate, incomeTxId,
  type IncomeClosed, type IncomeDraft, type IncomeMode, type IncomeStatus, type RecurringIncome,
} from '@/lib/recurringIncome';
import type { ListenerName } from '@/lib/listenerErrors';
import {
  chargeDateLabel, chargeModePatch, gamiyaOpenCharges, gamiyaTxId, subscriptionAdvance, subscriptionManualKey, subscriptionNextCycle, subscriptionOpenCharges, subscriptionResumeDate,
  subscriptionTxId, type ChargeClosed, type ChargeMode,
} from '@/lib/autoCharge';
import {
  SETUP_LATE_DONE_MESSAGE, SETUP_OTHER_MESSAGE, createdBeforeSetupFeature, setupDoneKey, setupFingerprint, validateSetupChoice,
  type SetupChoice, type SetupOutcome, type SetupStatus,
} from '@/lib/firstRunSetup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hapticError } from '@/lib/haptics';

/**
 * `archived` و`archivedAt` اختياريين عن قصد: المحافظ والفئات الموجودة من قبل
 * مالهاش الحقلين دول خالص، وقواعد Firestore بتتحقق من المستند بعد الدمج —
 * فلو خليناهم إجباريين كل محفظة قديمة كانت هتبقى غير قابلة للتعديل.
 * `archivedAt` نص ISO زي `createdAt` في كل حتة تانية في التطبيق.
 */
export type Wallet = {
  id: string; name: string; openingBalance: number; lowAlert: number;
  archived?: boolean; archivedAt?: string;
  /** رصيد البداية المتخزّن مش رقم محدود — اتحسب صفر وبانر الرئيسية بيقول (`walletFromDoc`، بند B). مش بيتكتب */
  openingInvalid?: boolean;
};
export type Category = {
  id: string; name: string; bucket?: 'needs' | 'wants' | 'future' | ''; icon?: string;
  archived?: boolean; archivedAt?: string;
};
export type Transaction = {
  id: string;
  type: 'expense' | 'income' | 'withdraw';
  amount: number;
  walletId: string;
  toWalletId?: string;
  categoryId?: string;
  note?: string;
  date: string;
  createdAt?: string;
  /**
   * تحويل تسوية: بيرجّع رصيد محفظة مؤرشفة لصفر بعد تعديل أو حذف عملية قديمة
   * عليها. عملية سحب عادية في كل حاجة تانية — بتظهر في التاريخ، وبتتحسب في
   * الأرصدة، ومش داخلة في أي إجمالي مصروف أو إيراد (التحويلات كلها كده).
   */
  isSettlement?: boolean;
  archivedWalletId?: string;
  /** عملية من دخل ثابت (`recordIncomePeriods`) — معرّفها `income_{id}_{الفترة}` */
  incomeId?: string;
  /** عملية من اشتراك/جمعية بمعرّف ثابت (`sub_{id}_{المعاد}` / `gamiya_{id}_{الشهر}`) */
  subscriptionId?: string;
  gamiyaId?: string;
  periodKey?: string;
  /** اتسجلت لوحدها (دخل ثابت/اشتراك/جمعية "تلقائي") — بتبان بعلامة في التاريخ */
  autoRecorded?: boolean;
};

/** تسوية واحدة: الفرق ده يروح/ييجي من المحفظة الشغالة دي */
export type Settlement = {
  archivedWalletId: string;
  archivedWalletName: string;
  targetWalletId: string;
  /** موجب = المؤرشفة هتزيد فالزيادة تخرج منها. سالب = العكس */
  delta: number;
};
/**
 * نتيجة العمليات اللي **بتقرا من السيرفر** (تسديد اشتراك/شهر جمعية). دي العمليات
 * الوحيدة اللي محتاجة اتصال فعلي، وبترجع إجابة **قاطعة** عشان المستخدم يعرف
 * فورًا حصل إيه لفلوسه من غير ما يفضل يتفرج على الكارت ويستنى:
 * - `done`: اتسجلت (أو كانت متسجلة قبل كده)
 * - `no-connection`: مفيش اتصال، فمبدأناش أصلاً — **مفيش أي خصم اتسجل**
 * - `failed`: بدأنا وفشلت. العملية الذرية إما تتم كلها أو مفيش —
 *   يعني برضه **مفيش أي خصم اتسجل**، والمستخدم يقدر يعيد بأمان
 * القرار المقصود هنا: نستنى فايربيز توصل لإجابة (أقصاها ~10 ثواني، مقيسة) بدل ما
 * نفك الزرار بدري بكلام مطاطي. في فلوس، الغموض أغلى من الاستنى.
 */
/**
 * بتتترمي من جوه العملية الذرية عشان تلغيها كلها لما المحفظة مابقتش صالحة.
 * الرمي هو الطريقة الوحيدة لإلغاء `runTransaction` — والنتيجة إن مفيش أي
 * كتابة بتحصل، لا العملية ولا تحديث السجل.
 */
class WalletMissingError extends Error { name = 'WalletMissingError'; }
class SubscriptionStoppedError extends Error { name = 'SubscriptionStoppedError'; }
/** D1: الباقي اللي المستخدم اختار له اتغيّر على السيرفر (جهاز تاني) — مفيش كتابة خالص */
class LeftoverChangedError extends Error { name = 'LeftoverChangedError'; }
/** المبلغ اللي اتعرض في التأكيد مش هو اللي على السيرفر (اتعدّل من جهاز تاني) — مفيش كتابة خالص */
class AmountChangedError extends Error { name = 'AmountChangedError'; }
/** الرقمين للّوج في نسخ التطوير بس (silent-failure-hunter): رفض من غير تعديل حقيقي يبان */
const amountChanged = (seen: number | undefined, actual: number) => Object.assign(new AmountChangedError(), { seen, actual });
/** `[seen, actual]` في التطوير، ولا حاجة في الإنتاج (مفيش رقم فلوس بيخرج — CLAUDE.md: Sentry) */
const amountsForDevLog = (e: AmountChangedError & { seen?: number; actual?: number }) => (__DEV__ ? [e.seen, e.actual] : []);

/**
 * التأكيد بيعرض المبلغ نص ثابت ("اتخصم 100 ج.م؟")، والذرة بتقرا المبلغ من السيرفر. لو جهاز
 * تاني عدّله والتأكيد مفتوح، "تأكيد" كان بيسجل الجديد (120) والمستخدم وافق على 100. فالشاشة
 * بتبعت اللي اتشاف، والذرة بترفض بنتيجة صريحة لو اختلف (زي D1 في زيادة الدين).
 * `undefined` = مفيش مبلغ اتشاف (نداء من غير شاشة) ← مفيش مقارنة.
 */
function seenAmountDiffers(seen: number | undefined, actual: number): boolean {
  return seen !== undefined && roundMoney(seen) !== roundMoney(actual);
}

/**
 * الدين نفسه مش موجود على السيرفر وإحنا جوه العملية الذرية — يا إما اتمسح من
 * جهاز تاني، يا إما لسه ما وصلش (وده اللي `waitForOurWritesToLand` بيمنعه).
 * الرمي بيلغي العملية كلها، فمفيش عملية يتيمة بتتكتب لدين مش موجود.
 */
class DebtMissingError extends Error { name = 'DebtMissingError'; }

const LINK_SOURCES: ListenerName[] = ['transactions', 'debts', 'subscriptions', 'gamiyas', 'incomes'];

/**
 * نتيجة تعديل عملية مربوطة بدين. `gone` = العملية أو الدين أو الربط بينهم
 * اتغيّروا من جهاز تاني — "جرب تاني" مش هتنفع، لازم تقفل وتفتح من جديد.
 */
export type TxEditOutcome = PayOutcome | 'gone';
export type TxEditResult = { outcome: TxEditOutcome; note?: string | null };

/** العملية اتمسحت، أو اتفكّت من الدين، من جهاز تاني وإحنا بنعدّلها */
class LinkedTxMissingError extends Error { name = 'LinkedTxMissingError'; }

/**
 * مسح دفعة/زيادة عمليتها المالية خرجت من محفظة مؤرشفة. المسح مبيعملش تسوية،
 * فكان هيسيب رصيد المؤرشفة مش صفر ومحدش شايفه. الشاشة بتمنع ده قبل التأكيد،
 * والفحص ده جوه الذرة للي اتأرشف من جهاز تاني بين الدوسة والمسح.
 */
class WalletArchivedError extends Error { name = 'WalletArchivedError'; }

/** الدخل الثابت اتمسح من جهاز تاني وإحنا جوه الذرة */
class IncomeMissingError extends Error { name = 'IncomeMissingError'; }

/** الاشتراك/الجمعية اتمسح من جهاز تاني قبل التسجيل */
class ChargeMissingError extends Error { name = 'ChargeMissingError'; }

/** الدخل اتسجل منه حاجة (من جهاز تاني) بين الدوسة والمسح */
class IncomeHasRecordsError extends Error { name = 'IncomeHasRecordsError'; }

/** اللي تعديل الجمعية يقدر يغيّره — المبالغ والشهور مش منهم (بند 15) */
export type GamiyaEdit = Partial<Pick<Gamiya, 'name' | 'walletId' | 'reminderDaysBefore' | 'chargeMode'>>;

/** نتيجة `deleteWallet`/`archiveWallet` — `blocked` بنفس نوع حظر الشاشة، فالرسالة واحدة */
export type WalletWriteResult = { outcome: 'done' } | { outcome: 'blocked'; block: ArchiveBlock };

/** المحفظة موجودة ومؤرشفة — الممسوحة مش هنا: ملهاش رصيد يتحسب أصلاً */
async function walletArchived(t: FirestoreTransaction, walletRef: DocumentReference) {
  const snap = await t.get(walletRef);
  return snap.exists() && (snap.data() as any)?.archived === true;
}

/**
 * هل المحفظة دي لسه تنفع نخصم منها؟
 *
 * بتتقري من **جوه** العملية الذرية مش من حالة الرياكت: الاشتراك ممكن يكون
 * مربوط بمحفظة اتمسحت أو اتأرشفت من جهاز تاني، والنسخة اللي عندنا لسه ما
 * عرفتش. تمن الفحص قراية واحدة زيادة لكل تسديد، ومقابلها إننا مننشئش عملية
 * مربوطة بمحفظة مش موجودة — عملية زي دي بتختفي من كل رصيد ومحدش بيلاحظها.
 */
async function walletUsable(t: FirestoreTransaction, walletRef: DocumentReference) {
  const snap = await t.get(walletRef);
  if (!snap.exists()) return false;
  return (snap.data() as any)?.archived !== true;
}

/** نتيجة إرسال الرأي — الفرق بين "وصل" و"في الطابور" مهم للمستخدم */
export type FeedbackOutcome = 'sent' | 'pending' | 'failed';

export type PayOutcome = 'done' | 'no-connection' | 'failed' | 'wallet-missing';

/**
 * نتيجة مسح دين/اشتراك/جمعية بعملياته. `blocked` = ما اتمسحش حاجة خالص،
 * والرسالة جاهزة للشاشة (`cascadeDeleteBlock`): عملية منهم على محفظة
 * مؤرشفة، أو بيانات المحافظ/العمليات ما وصلتش فمش هنقدر نتأكد.
 */
export type CascadeDeleteResult = { outcome: 'done' } | ({ outcome: 'blocked' } & CascadeDeleteBlock);

/** الرسايل في مكان واحد عشان شاشة الاشتراكات وشاشة الجمعية يقولوا نفس الكلام */
export const PAY_OUTCOME_ALERT: Record<Exclude<PayOutcome, 'done'>, { title: string; body: string }> = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتسجلش أي خصم. العملية دي لازم تتأكد من السيرفر عشان الخصم ميتسجلش مرتين — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتسجلش',
    body: 'العملية ما تمّتش ومفيش أي خصم اتسجل. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة المربوطة بيه اتمسحت أو اتأرشفت، فما اتسجلش أي خصم. عدّل الاشتراك واختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * نفس الرسالة بس بتسمّي السجل اللي المستخدم واقف عليه. "عدّل واختار محفظة"
 * لوحدها بتسيبه يدوّر: هو واقف على كارت الجمعية، والكلام بيقوله يعدّل إيه؟
 */
export const PAY_OUTCOME_ALERT_GAMIYA: typeof PAY_OUTCOME_ALERT = {
  ...PAY_OUTCOME_ALERT,
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة المربوطة بيه اتمسحت أو اتأرشفت، فما اتسجلش أي خصم. عدّل الجمعية واختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * نفس الرسايل بس للدين: المحفظة هنا بتتختار في مودال الدفعة نفسه، فالكلام
 * لازم يوجّه على المودال اللي المستخدم واقف فيه مش على تعديل السجل.
 */
export const PAY_OUTCOME_ALERT_DEBT: typeof PAY_OUTCOME_ALERT = {
  ...PAY_OUTCOME_ALERT,
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة اللي اخترتها اتمسحت أو اتأرشفت، فما اتسجلش أي خصم. اختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * `amount-changed`: المبلغ اللي في التأكيد اتعدّل من جهاز تاني قبل "تأكيد". نفس قالب رسالة "الدين اتغيّر" في زيادة الدين
 * (`LEFTOVER_CHANGED_ALERT`): إيه اللي حصل، وإن مفيش فلوس اتحركت، وتعمل إيه.
 */
export const AMOUNT_CHANGED_ALERT = {
  subscription: {
    title: 'المبلغ اتغيّر',
    body: 'مبلغ الاشتراك اتعدّل من جهاز تاني، فما اتسجلش أي خصم. شوف المبلغ الجديد وأكّد تاني لو موافق عليه.',
  },
  gamiya: {
    title: 'المبلغ اتغيّر',
    body: 'مبلغ الشهر ده اتعدّل من جهاز تاني، فمفيش فلوس اتحركت. شوف المبلغ الجديد وأكّد من أول وجديد.',
  },
} as const;

/**
 * تعديل عملية مربوطة بدين (`updateDebtLinkedTransaction`). مش "خصم": المستخدم
 * بيعدّل حاجة موجودة، فاللي محتاج يعرفه إن **ولا العملية ولا الدين** اتغيّروا.
 */
export const TX_EDIT_OUTCOME_ALERT: Record<Exclude<TxEditOutcome, 'done'>, { title: string; body: string }> = {
  gone: {
    title: 'العملية اتغيّرت',
    body: 'العملية دي أو الدين بتاعها اتغيّروا من جهاز تاني، فمفيش حاجة اتحفظت. شوفها في الرئيسية أو الأرشيف وافتحها تاني لو لسه موجودة.',
  },
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'التعديل ما اتحفظش. العملية دي مربوطة بدين، فلازم تتأكد من السيرفر عشان الدين والرصيد يفضلوا متطابقين — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتحفظش',
    body: 'مفيش حاجة اتغيّرت، لا في العملية ولا في الدين. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة اللي اخترتها اتمسحت أو اتأرشفت، فمفيش حاجة اتغيّرت. اختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * تسجيل الدخل الثابت. مش `PAY_OUTCOME_ALERT`: هناك الكلام عن "خصم"، وهنا
 * فلوس داخلة — اللي المستخدم محتاج يعرفه إن مفيش حاجة اتضافت لرصيده.
 */
export const INCOME_RECORD_ALERT: typeof PAY_OUTCOME_ALERT = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتسجلش حاجة. التسجيل لازم يتأكد من السيرفر عشان الدخل ميتسجلش مرتين — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتسجلش',
    body: 'مفيش حاجة اتضافت لرصيدك. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة المربوطة بالدخل ده اتمسحت أو اتأرشفت، فما اتسجلش حاجة. عدّل الدخل واختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * مسح دخل ثابت. مش بيلمس رصيد، فالكلام عن إن الدخل لسه موجود. `has-records`
 * معناه إن جهاز تاني سجّل منه حاجة بين الدوسة والمسح — ساعتها بيتوقف بس.
 */
export type IncomeDeleteOutcome = 'done' | 'no-connection' | 'failed' | 'has-records';
export const INCOME_DELETE_ALERT: Record<Exclude<IncomeDeleteOutcome, 'done'>, { title: string; body: string }> = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتمسحش. المسح لازم يتأكد من السيرفر إن الدخل ده ما اتسجلش منه حاجة — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتمسحش',
    body: 'الدخل لسه زي ما هو. اتأكد إن النت شغال وجرب تاني.',
  },
  'has-records': {
    title: 'ما ينفعش يتمسح',
    body: 'اتسجل منه حاجة قبل كده، فبيفضل عشان تاريخه ما يضيعش. تقدر توقّفه بدل ما تمسحه.',
  },
};

/**
 * مسح دفعة أو زيادة من تاريخ الدين. مش `PAY_OUTCOME_ALERT`: هناك الكلام عن
 * "خصم ما اتسجلش"، وهنا المستخدم بيمسح — اللي محتاج يعرفه إن السجل لسه
 * زي ما هو ورصيد المحفظة ما اتلمسش. `wallet-missing` هنا معناه إن المحفظة
 * المربوطة اتأرشفت من جهاز تاني بين الدوسة والمسح (`WalletArchivedError`).
 */
export const DEBT_ENTRY_DELETE_ALERT: typeof PAY_OUTCOME_ALERT = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتمسحش حاجة، والرصيد زي ما هو. المسح لازم يتأكد من السيرفر عشان العدد والمحفظة يتظبطوا صح — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتمسحتش',
    body: 'السجل لسه زي ما هو والرصيد ما اتلمسش. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': {
    title: 'المحفظة دي مؤرشفة',
    body: 'المحفظة المربوطة بيها اتأرشفت، فما اتمسحش حاجة والرصيد زي ما هو. رجّع المحفظة الأول من الإعدادات ← المحافظ، وبعدين امسح.',
  },
};

/**
 * نتيجة دفعة الدين: النتيجة القاطعة زي أي عملية بتقرا من السيرفر، ومعاها
 * جملة تغيّر الأقساط لو العدد اتحرك (`note`) — الاتنين لازم يرجعوا مع بعض
 * عشان الشاشة تعرف تقول "اتسجلت" و"الأقساط بقت 7" في نفس اللحظة. و`settledNow` = الدفعة
 * دي هي اللي سددت الدين، محسوبة جوه الذرة على الدين اللي اتقرا من السيرفر.
 */
export type DebtPayResult = { outcome: PayOutcome; note?: string | null; settledNow?: boolean };
/**
 * الزيادة (D1، 2026-10-30): `leftover-changed` = اللي المستخدم اختاره للباقي ("يتضاف على آخر
 * قسط" / "قسط منفصل") مابقاش هو الباقي على السيرفر — ما اتسجلش حاجة، والشيت بتسأل تاني.
 * نوع لوحده مش جوه `PayOutcome`: باقي شاشات الدفع مالهاش الحالة دي
 */
/** `dueNote`: "المعاد الجاي بقى …" لما الزيادة فتحت دين أقساط متسدد (بند 12) */
export type DebtIncreaseDeleteOut = { dueRestored?: string | null; entryGone?: boolean };
export type DebtIncreaseResult = { outcome: PayOutcome | 'leftover-changed'; note?: string | null; dueNote?: string | null };
export const LEFTOVER_CHANGED_ALERT = {
  title: 'الدين اتغيّر',
  body: 'الدين اتغيّر من جهاز تاني، فمفيش أي زيادة اتسجلت ولا فلوس اتحركت. شوف الباقي الجديد واختار تاني.',
};

/** أقصى انتظار لتأكيد السيرفر على الرأي قبل ما نقول إنه في الطابور */
const FEEDBACK_ACK_MS = 8000;

export type Budgets = Record<string, number>;
export type ShakhbataIncome = Record<string, number>;
export type ShakhbataPercents = { needs: number; wants: number; future: number };

export type DebtPayment = { id: string; date: string; amount: number; walletId: string; categoryId?: string; transactionId?: string };
export type DebtEntry = {
  id: string; date: string; amount: number; walletId?: string; transactionId?: string;
  /** زيادة فتحت دين أقساط متسدد (بند 12): المعاد قبلها، واللي هي حطّته — مسحها بيرجّع القديم (`lib/reopenDue.ts`) */
  reopenedFrom?: string; reopenedTo?: string;
};
export type Debt = {
  id: string;
  direction: 'owed_to_me' | 'i_owe';
  personName: string;
  personPhone?: string;
  personContactId?: string;
  totalAmount: number;
  date: string;
  isInstallment: boolean;
  /** إجمالي عدد الأقساط زي ما هو معروض ("القسط 3 من 6") */
  installmentCount?: number;
  /**
   * قيمة القسط الواحد، متخزّنة مش محسوبة.
   *
   * لو محسوبة (`الإجمالي ÷ العدد`) كانت هترقص مع كل تعديل للعدد، والمستخدم
   * مستنّي العكس: القسط ثابت والعدد هو اللي يتغيّر. غايب في الديون القديمة
   * اللي اتعملت قبل الميزة — `installmentValue` بترجع للحسبة القديمة وقتها.
   */
  installmentAmount?: number;
  /**
   * فرق تقريب القسط (2026-09-30). القسط مقرّب للقرش، فـ"العدد × القسط" بيفرق
   * عن المبلغ اللي اتقسّم: 1000 على 12 = 83.33 × 12 = 999.96، و`amount` = 0.04
   * هي اللي القسط الأخير بيشيلها (83.37).
   *
   * بيتكتب **مع** القسط في نفس الكتابة بس (الإنشاء، تعديل العدد، تثبيت دين
   * قديم)، و`forInstallment` هو القسط اللي اتحسب عليه: لو القسط اتغيّر من غيره
   * (نسخة قديمة من التطبيق عدّلت العدد) الفرق بيتجاهل. `amount` بالإشارة زي ما
   * هو (سالب = القسط الأخير أصغر)، والقراية بتاخد الموجب بس (`installmentResidueOf`).
   * `over` = عدد الأقساط الكاملة في الخطة (`over × القسط + amount` = المبلغ اللي
   * اتقسّم): بيه بنعرف الفرق تقريب ولا كسر حقيقي (≤ نص قرش لكل قسط)، والزيادة
   * ومسحها بيحركوه (`foldInstallmentResidue`، 2026-09-30). بعد تعديل العدد بإيد
   * المستخدم ده الأقساط الفاضلة **وقت التعديل**؛ والدفعات مبتنقّصوش (الخطة هي هي).
   * ممكن يبقى 0 أو أقل لو زيادة كبيرة قبل التعديل اتمسحت — كسر حقيقي، بيتقري 0.
   * غايب = مش معروف (دين قبل الحقل ده) ← قاعدة العدد القديمة.
   *
   * `increasesTotal` (2026-10-30، بند 8 D2، قرار مؤمن): مجموع `increases` وقت ما
   * الفرق اتكتب. النسخ القديمة مبتعرفش الفرق وبتكتب patch، فالفرق كان بيفضل
   * على الخطة القديمة بعد زيادة منها؛ مجموع الزيادات هو اللي بيحرّك الخطة، فلو
   * مش مطابق للحالي ← الفرق بيتجاهل (القاعدة القديمة). غايب = بيتجاهل كمان
   * (الفرق ما اتبناش في أي بناء من غيره). اختياري هنا عشان القراية بس —
   * الكتابة دايمًا بـ`stampResidue`.
   */
  installmentResidue?: { amount: number; forInstallment: number; over: number; increasesTotal?: number; lastAbsorbs?: true };
  note?: string;
  createdAt: string;
  payments: DebtPayment[];
  increases: DebtEntry[];
  initialWalletId?: string;
  initialTransactionId?: string;
  /**
   * معاد استحقاق الدين (أو القسط الجاي منه). اختياري عن قصد: أغلب الديون بين
   * الناس مالهاش معاد محدد، ولو خلّيناه مطلوب كنا هنكسر الديون الموجودة
   * والحالة الطبيعية "بالأجل من غير معاد".
   */
  dueDate?: string;
  /** التذكير قبل المعاد بكام يوم. غايب = مفيش تذكير على الدين ده */
  reminderDaysBefore?: number;
};

/**
 * الحقول اللي ينفع تتعدّل بعد ما الدين يتسجّل — بيانات الشخص والملاحظة بس.
 *
 * `totalAmount` مش هنا عن قصد: المبلغ الأساسي ولّد Transaction حقيقي
 * (`initialTransactionId`) وعدّل رصيد محفظة. لو عدّلناه من غير ما نعدّل
 * العملية اللي معاه، الرصيد بيبقى مش مطابق للعمليات — والمستخدم بيشوف
 * فلوس مش موجودة. الزيادة بتتسجل بـ addDebtIncrease (وبتولّد عمليتها)،
 * والتصحيح الكامل بيبقى مسح الدين وتسجيله تاني.
 */
export type DebtMetadata = {
  personName?: string;
  personPhone?: string;
  personContactId?: string;
  note?: string;
  /** نص فاضي = شيل المعاد (وبالتالي التذكير) */
  dueDate?: string;
  /** null = شيل التذكير وسيب المعاد */
  reminderDaysBefore?: number | null;
};

export type SubscriptionPayment = {
  id: string; date: string; amount: number; transactionId?: string;
  /** معاد الفترة اللي الدفعة دي قفلتها — الدفعات القديمة مالهاش */
  periodKey?: string;
  auto?: boolean;
};
export type Subscription = {
  id: string;
  name: string;
  amount: number;
  walletId: string;
  categoryId?: string;
  frequency: 'monthly' | 'yearly' | 'custom';
  customDays?: number;
  nextDueDate: string;
  reminderDaysBefore: number;
  active: boolean;
  createdAt: string;
  history: SubscriptionPayment[];
  /** مش موجود = "بتأكيد" (`lib/autoCharge.ts`) */
  chargeMode?: ChargeMode;
  /** "تلقائي" بيسجل الفترات اللي معادها من اليوم ده بس */
  chargeAutoSince?: string;
  /** الفترات المقفولة بمفتاح المعاد — في نفس ذرة العملية */
  closed?: Record<string, ChargeClosed>;
};

export type GamiyaMonth = {
  id: string;
  monthIndex: number;
  dueDate: string;
  isPayoutMonth: boolean;
  amount: number;
  status: 'pending' | 'done';
  transactionId?: string;
  /** اتسجل لوحده */
  auto?: boolean;
  /** عمليته اتمسحت ← بيسأل، وعمره ما يتسجل لوحده تاني */
  reopened?: boolean;
};
export type Gamiya = {
  id: string;
  name: string;
  monthlyAmount: number;
  totalMonths: number;
  payoutMonthIndex: number;
  payoutAmount: number;
  walletId: string;
  startDate: string;
  reminderDaysBefore: number;
  months: GamiyaMonth[];
  createdAt: string;
  chargeMode?: ChargeMode;
  chargeAutoSince?: string;
};

type DataContextType = {
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  /** عمليات مستندها بايظ (مبلغ/تاريخ/نوع) — **برّه `transactions` وبرّه كل حسبة**، بتتعرض في الأرشيف (بند B) */
  brokenTransactions: BrokenTransaction[];
  budgets: Budgets;
  shakhbataIncome: ShakhbataIncome;
  shakhbataPercents: ShakhbataPercents;
  debts: Debt[];
  subscriptions: Subscription[];
  gamiyas: Gamiya[];
  incomes: RecurringIncome[];
  /** عدد الكتابات اللي اتبعتت ولسه ما جاش تأكيد من السيرفر بيها */
  pendingWrites: number;
  /** العمليات اللي اتحفظت على الموبايل ولسه بترفع (من metadata بتاعة فايربيز) */
  pendingTxIds: Set<string>;
  /** إحنا متصلين بسيرفر فايربيز دلوقتي ولا شغالين من الكاش (من `metadata.fromCache`) */
  serverReachable: boolean;
  /**
   * الأرقام اللي على الشاشة (الأرصدة) متزامنة مع السيرفر: آخر snapshot من المحافظ
   * **ومن** العمليات جه من السيرفر مش من الكاش. أضيق من `serverReachable` (اللي
   * أي واحد منهم بيقلبه): رجوع النت ≠ الأرقام اتحدّثت. لبانر "الأرقام ممكن تكون
   * قديمة" بس — مبيدخلش في أي حساب.
   */
  figuresFromServer: boolean;
  /**
   * آخر أرقام اتشافت قبل كده (كاش أول فتحة باردة، `lib/coldCache.ts`) — **للعرض بس**، ومش `null` غير طول ما
   * مفيش ولا محفظة ولا أرقام من السيرفر لسه. **ممنوع** يدخل أي حساب أو كتابة أو حراسة: دول من `wallets`/`transactions`.
   */
  coldSnapshot: ColdSnapshot | null;
  /** المحافظ/العمليات اللي لسه مرمتش أول snapshot — مسح السجل بعملياته بيستناهم */
  figuresPending: ListenerName[];
  /**
   * الـlisteners اللي فايربيز رفضتها وقفلتها (غالبًا `permission-denied`).
   * القايمة بتاعتها بتفضل على آخر قيمة وصلت — ممكن تكون فاضية وهي مش فاضية —
   * فالشاشة لازم تقول كده بدل ما تعرض فاضي ساكت (`DataLoadErrorBanner`).
   */
  loadErrors: ListenerName[];
  /**
   * العمليات والسجلات اللي ممكن تكون مربوطة بيها (ديون، اشتراكات، جمعيات، دخل)
   * وصلوا كلهم ومفيش منهم مرفوض. قبلها مودال العملية مبيعرفش هي مربوطة ولا لأ
   */
  linkSourcesReady: boolean;
  /**
   * الديون والجمعية وصلوا (بند 11، قرار مؤمن 2026-11-05): من غيرهم `transferTransactionIds` فاضية والسلفة وقسط
   * الجمعية بيتعدّوا مصروف. `loading` ← الشاشة مبتعرضش رقم المصروف خالص؛ `failed` ← بتعرضه بسطر إنه ممكن يكون فيه سلف
   */
  transfersStatus: TransfersStatus;
  /** التصدير الكامل: كل المجموعات من السيرفر مرة واحدة (مش من حالة الـlisteners) — كامل يا إما رسالة صريحة */
  readAllFromServer: () => Promise<{ outcome: 'done'; data: FullExportInput } | { outcome: 'no-connection' | 'failed' }>;
  /**
   * مسح الحساب — الخطوة 1: كل بيانات المستخدم من السيرفر (المجموعات العشرة ثم `users/{uid}`). **مش** حساب الدخول نفسه
   * (ده في `AuthContext` بعده). بيتعاد بأمان: لو وقف في النص، مرة تانية بتمسح الباقي. `remaining` = اللي لسه فاضل لو
   * مكملش — الشاشة مبتقولش "اتمسح" غير على `done`.
   */
  deleteAllMyData: () => Promise<DeleteDataResult>;
  /** مسح الحساب بدأ ومخلصش (العلامة على الجهاز) — التسجيل التلقائي والدفع واقفين لحد ما يخلص */
  deletionPending: boolean;
  /** بيفتح الـlisteners من الأول (زرار "جرّب تاني") */
  retryLoad: () => void;
  /** الحساب متجهّز ولا لأ — `needed` معناها السيرفر أكّد إنه جديد (شاشة "نبدأ بإيه؟") */
  setupStatus: SetupStatus;
  /** بيحفظ اختيارات التجهيز كلها مرة واحدة وبيستنى السيرفر — شوف `completeSetup` */
  completeSetup: (choice: SetupChoice) => Promise<SetupOutcome>;
  addWallet: (name: string) => Promise<void>;
  updateWallet: (id: string, data: Partial<Wallet>) => Promise<void>;
  deleteWallet: (id: string) => Promise<WalletWriteResult>;
  archiveWallet: (id: string, reassign: {
    subscriptions?: Record<string, string>; gamiyas?: Record<string, string>; incomes?: Record<string, string>;
  }) => Promise<WalletWriteResult>;
  restoreWallet: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  archiveCategory: (id: string, reassign: Record<string, string>) => Promise<void>;
  submitFeedback: (type: FeedbackType, text: string) => Promise<FeedbackOutcome>;
  restoreCategory: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<string>;
  updateTransaction: (id: string, tx: Partial<Transaction>, settlements?: Settlement[]) => Promise<void>;
  /** تعديل عملية مربوطة بدين — العملية والدين في ذرة واحدة (`lib/linkedEdit.ts`) */
  updateDebtLinkedTransaction: (
    txId: string, tx: Partial<Transaction> & LinkedEditNext, expected: Pick<Transaction, 'amount' | 'walletId' | 'type'>,
    settlements?: Settlement[],
  ) => Promise<TxEditResult>;
  deleteTransaction: (id: string, settlements?: Settlement[]) => Promise<void>;
  transactionLinkWarning: (id: string) => string | null;
  setBudget: (categoryId: string, limit: number) => Promise<void>;
  setMonthlyIncome: (month: string, income: number) => Promise<void>;
  setShakhbataPercents: (p: ShakhbataPercents) => Promise<void>;
  addDebt: (data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
    dueDate?: string; reminderDaysBefore?: number;
  }) => Promise<void>;
  updateDebt: (id: string, data: DebtMetadata) => Promise<void>;
  deleteDebt: (id: string) => Promise<CascadeDeleteResult>;
  addDebtPayment: (debtId: string, amount: number, walletId: string, date: string, categoryId?: string) => Promise<DebtPayResult>;
  setInstallmentCount: (debtId: string, nextTotal: number) => Promise<boolean>;
  deleteDebtPayment: (debtId: string, paymentId: string) => Promise<PayOutcome>;
  addDebtIncrease: (debtId: string, amount: number, date: string, walletId?: string, leftover?: LeftoverSeen) => Promise<DebtIncreaseResult>;
  /**
   * `out.dueRestored`: المعاد اللي رجع فعلاً من الذرة (بند 12) — الشاشة بتقارنه باللي التأكيد وعد بيه.
   * `out.entryGone`: الزيادة كانت اتمسحت قبل كده (جهاز تاني) — مفيش حاجة تتقارن
   */
  deleteDebtIncrease: (debtId: string, entryId: string, out?: DebtIncreaseDeleteOut) => Promise<PayOutcome>;
  addSubscription: (data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }) => Promise<EntrySaveResult>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<EntrySaveResult>;
  deleteSubscription: (id: string) => Promise<CascadeDeleteResult>;
  markSubscriptionPaid: (id: string, date: string, seenAmount?: number) => Promise<PayOutcome | 'already-paid-today' | 'stopped' | 'amount-changed'>;
  /** وقّف/رجّع الاشتراك (2026-11-02). الرجوع بيرفض لو المحفظة مش شغالة */
  setSubscriptionActive: (id: string, active: boolean) => Promise<PayOutcome | 'missing'>;
  addGamiya: (data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }) => Promise<EntrySaveResult>;
  updateGamiya: (id: string, data: GamiyaEdit) => Promise<EntrySaveResult>;
  deleteGamiya: (id: string) => Promise<CascadeDeleteResult>;
  markGamiyaMonthDone: (gamiyaId: string, monthId: string, seenAmount?: number) => Promise<PayOutcome | 'amount-changed'>;
  /** تسجيل فترات اشتراك/جمعية (كارت "اتخصم؟" أو التلقائي) — ذري، ومفيش فترة بتتسجل مرتين */
  recordCharges: (kind: ChargeKind, id: string, entries: { key: string; amount: number }[], opts?: { auto?: boolean }) => Promise<IncomeRecordResult>;
  /** "ما اتخصمش" — الفترة بتتقفل من غير عملية */
  skipSubscriptionCharge: (id: string, key: string) => Promise<PayOutcome>;
  addIncome: (draft: IncomeDraft & { mode: IncomeMode }) => Promise<void>;
  updateIncome: (id: string, patch: Partial<IncomeDraft & { mode: IncomeMode }>) => Promise<void>;
  setIncomeStatus: (id: string, status: IncomeStatus) => Promise<void>;
  recordIncomePeriods: (incomeId: string, entries: { key: string; amount: number }[], opts?: { auto?: boolean }) => Promise<IncomeRecordResult>;
  skipIncomePeriod: (incomeId: string, key: string) => Promise<void>;
  deleteIncome: (incomeId: string) => Promise<IncomeDeleteOutcome>;
};

/**
 * نتيجة تسجيل الدخل: قاطعة زي أي عملية ذرية، ومعاها الفترات اللي اتسجلت
 * فعلاً — اللي كانت مقفولة قبل كده (جهاز تاني سبقنا) مش بتتحسب، فالرسالة
 * مبتقولش "سجلنا" عن حاجة ما اتسجلتش دلوقتي.
 */
/** `stopped` = الاشتراك اتوقف (من جهاز تاني) ففترة مطلوبة مابقتش مفتوحة — مش "اتسجلت قبل كده" */
export type IncomeRecordResult = { outcome: PayOutcome; recorded: string[]; stopped?: boolean };
export type ChargeKind = 'subscription' | 'gamiya';

const DataContext = createContext<DataContextType | undefined>(undefined);

const DEFAULT_PERCENTS: ShakhbataPercents = { needs: 50, wants: 30, future: 20 };
/**
 * أقصى انتظار للكتابات اللي لسه بترفع قبل أي عملية بتقرا من السيرفر. فايربيز
 * بتعلن انقطاع الاتصال خلال ~10 ثواني، فالسقف ده شبكة أمان لو الإشارة اتأخرت
 */
const PENDING_WAIT_TIMEOUT_MS = 15000;

/** حد فايرستور لعدد العمليات في الدفعة الواحدة */
const BATCH_LIMIT = 500;

/** سقف الانتظار لسؤال السيرفر "الحساب ده جديد؟" قبل ما نقول `unknown` */
const SETUP_CHECK_TIMEOUT_MS = 8000;
/** بنعيد السؤال كل الوقت ده طول ما الحالة `unknown` (مفيش نت) */
const SETUP_RECHECK_MS = 20000;
/** سقف لحفظ التجهيز — runTransaction نفسها بترفض أوفلاين بعد ~10 ثواني */
const SETUP_SAVE_TIMEOUT_MS = 20000;
/** سقف قراية التصدير الكامل (10 مجموعات من السيرفر) — أوفلاين getDocsFromServer بيرفض، بس منعتمدش على ده */
const EXPORT_READ_TIMEOUT_MS = 20000;
/** كل المجموعات اللي تحت `users/{uid}` — نفس العشرة اللي ليها listeners. مجموعة جديدة لازم تتضاف هنا (اختبار المحاكي بيتأكد إن مفيش حاجة فاضلة) */
/**
 * نتيجة مسح البيانات. `deleted` = اللي **اتأكد** إنه اتمسح؛ `uncertain` = دفعة عدّت السقف الزمني ومش عارفين وصلت ولا لأ
 * (السقف مبيلغيش الكتابة) — الشاشة مبتجزمش في الحالة دي. الصفر بيتقال "مفيش حاجة اتمسحت" (silent-failure + money).
 */
export type DeleteDataResult = { outcome: 'done' } | { outcome: 'no-connection' | 'failed'; deleted: number; uncertain: boolean };
/** علامة على الجهاز إن مسح الحساب بدأ ومخلصش — بتفضل بعد قفل التطبيق (money-reviewer) */
export const deletePendingKey = (uid: string) => `nuqta-delete-pending:${uid}`;
/** لفّات التأكد بعد المسح: لو حاجة اتكتبت في النص (تسجيل تلقائي) بتتمسح وبنقرا تاني */
const ACCOUNT_DELETE_VERIFY_ROUNDS = 3;
export const ACCOUNT_COLLECTIONS = ['wallets', 'categories', 'transactions', 'budgets', 'shakhbata_income', 'shakhbata_settings', 'debts', 'subscriptions', 'gamiyas', 'incomes'] as const;
/** حد الـbatch في فايرستور 500 — 400 بهامش */
const ACCOUNT_DELETE_BATCH = 400;

/** بيرفض بعد وقت محدد — عشان سؤال السيرفر ميعلّقش الشاشة أوفلاين */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([p, cap]).finally(() => { if (t) clearTimeout(t); });
}

/**
 * الحساب ده محتاج شاشة "نبدأ بإيه؟"؟ **من السيرفر بس** — مفيش قرار على تخمين.
 *
 * `needed` لو: `users/{uid}` مفيهوش `seeded` **ومفيش** ولا محفظة ولا فئة.
 * الشرط التاني عشان الحسابات القديمة جدًا (قبل `seeded`) اللي عندها بيانات
 * متشوفش الشاشة — ودي بيتكتب لها `seeded` على طول.
 * أي فشل (مفيش نت، سقف الوقت) ← `unknown`: التطبيق بيفتح عادي والسؤال بيتعاد.
 */
async function detectSetup(uid: string): Promise<'done' | 'needed' | 'unknown'> {
  try {
    const userRef = doc(db, 'users', uid);
    const user = await withTimeout(getDocFromServer(userRef), SETUP_CHECK_TIMEOUT_MS);
    if (user.exists() && user.data()?.seeded) return 'done';
    const [w, c] = await withTimeout(Promise.all([
      getDocsFromServer(query(collection(db, 'users', uid, 'wallets'), limit(1))),
      getDocsFromServer(query(collection(db, 'users', uid, 'categories'), limit(1))),
    ]), SETUP_CHECK_TIMEOUT_MS);
    if (!w.empty || !c.empty) {
      // حساب قديم جدًا من غير seeded: نكتبه عشان الأجهزة الجاية متسألش تاني
      // (silent-failure-hunter). من غير انتظار — لو فشل هنسأل تاني وخلاص
      setDoc(userRef, { seeded: true }, { merge: true }).catch(() => {});
      return 'done';
    }
    return 'needed';
  } catch (e) {
    console.warn('[setup] مقدرناش نتأكد الحساب جديد ولا لأ', (e as { code?: string })?.code ?? (e as Error)?.message);
    return 'unknown';
  }
}

/** مقارنة رخيصة عشان منعملش Set جديدة (ورسمة جديدة) كل ما ييجي snapshot بنفس المحتوى */
function sameIds(prev: Set<string>, next: string[]) {
  return prev.size === next.length && next.every(id => prev.has(id));
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const creationTime = user?.metadata?.creationTime;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  // آخر محافظ وصلت — حارس آخر محفظة شغالة (بند 13) بيقرا منه مش من الـclosure:
  // الشاشة بتنادي المسح/الأرشفة من زرار Alert اتعمل في render قديم، فالـclosure
  // كان هيشوف محافظ قديمة (money-reviewer + silent-failure-hunter)
  const latestWallets = useRef(wallets);
  latestWallets.current = wallets;
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [brokenTransactions, setBrokenTransactions] = useState<BrokenTransaction[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});
  const [shakhbataIncome, setShakhbataIncome] = useState<ShakhbataIncome>({});
  const [shakhbataPercents, setShakhbataPercentsState] = useState<ShakhbataPercents>(DEFAULT_PERCENTS);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [gamiyas, setGamiyas] = useState<Gamiya[]>([]);
  const [incomes, setIncomes] = useState<RecurringIncome[]>([]);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [pendingTxIds, setPendingTxIds] = useState<Set<string>>(new Set());
  const pendingCount = useRef(0);
  const errorShown = useRef(false);
  const notice = useNotice();
  // بنبدأ بـ false لحد ما أول snapshot ييجي من السيرفر فعلاً: أول ثانية من فتح
  // التطبيق بنعتبر نفسنا مش متصلين. ده بيمنع إن حد يفتح التطبيق وهو من غير نت
  // ويدوس "سدّد" فيقع في نفس مصيدة الزرار المقفول
  const [serverReachable, setServerReachable] = useState(false);
  const serverReachableRef = useRef(false);
  // آخر fromCache لكل listener من اللي الأرصدة مبنية عليهم. `null` = لسه مرماش
  // snapshot (مجموعة فاضية ممكن متبعتش خالص) — فمبيمنعش "اتحدّثت"
  const figuresCache = useRef<{ wallets: boolean | null; transactions: boolean | null }>({ wallets: null, transactions: null });
  const [figuresFromServer, setFiguresFromServer] = useState(false);
  const [figuresPending, setFiguresPending] = useState<ListenerName[]>(['wallets', 'transactions']);
  function pendingFigures(): ListenerName[] {
    return (['wallets', 'transactions'] as const).filter(n => figuresCache.current[n] === null);
  }
  function noteFigures(name: 'wallets' | 'transactions', fromCache: boolean) {
    figuresCache.current[name] = fromCache;
    const { wallets: w, transactions: t } = figuresCache.current;
    const fresh = figuresFresh(w, t);
    setFiguresFromServer(prev => (prev === fresh ? prev : fresh));
    const pending = pendingFigures();
    setFiguresPending(prev => (prev.length === pending.length ? prev : pending));
  }
  const [loadErrors, setLoadErrors] = useState<ListenerName[]>([]);
  /**
   * مسح الحساب شغال (أو بدأ ومخلصش — علامة على الجهاز). طول ما هو true: التسجيل التلقائي والدفع والتجهيز بيرجعوا بدري
   * (money-reviewer + security-reviewer: عملية تلقائية كانت ممكن تتكتب بعد قراية المسح وتفضل يتيمة، وشاشة "نبدأ بإيه؟"
   * كانت ممكن تزرع محافظ على حساب بيتمسح). مبيرجعش false غير بحساب تاني.
   */
  const deletingRef = useRef(false);
  /** نفس العلامة كحالة للشاشات (صف "مسح الحساب" بيقول "ما خلصش") — جولة 2 SHOULD-FIX 1 */
  const [deletionPending, setDeletionPending] = useState(false);
  // كاش أول فتحة باردة — اللي اتقرا من الجهاز للحساب ده (التصميم: reports/2026-11-02-cold-cache-design.md)
  const [storedCold, setStoredCold] = useState<ColdSnapshot | null>(null);
  // الـlisteners اللي وصل منها snapshot واحد على الأقل (حتى لو فاضي) — من غيرها
  // "مفيش ديون" و"الديون لسه ما وصلتش" شكلهم واحد (بند 14: عملية دين اتعدّلت
  // قبل ما الديون توصل كانت هتروح للمسار العادي وتسيب الدين على الرقم القديم)
  const [delivered, setDelivered] = useState<Set<ListenerName>>(() => new Set());
  const deliveredUid = useRef<string | null | undefined>(undefined);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('checking');
  // بيتزوّد مع "جرّب تاني" فالـeffect بتاع الـlisteners يفتحهم من الأول
  const [listenRetry, setListenRetry] = useState(0);
  const offlineWaiters = useRef(new Set<() => void>());

  /**
   * fromCache معناها إن العميل مش متزامن مع السيرفر دلوقتي — ودي أصدق إجابة على
   * سؤال "أقدر أوصل فايرستور؟" لأنها جاية من فايربيز نفسها.
   * بنقراها من أكتر من listener عن قصد: الـ listener بتاع مجموعة **فاضية**
   * مبيرميش أي snapshot أصلاً لحد ما يوصلها مستند، فلو اعتمدنا على العمليات
   * لوحدها، المستخدم الجديد (اللي لسه مامعموش أي عملية) هيفضل "مش متصل" للأبد.
   */
  function noteConnection(fromCache: boolean) {
    const reachable = !fromCache;
    if (serverReachableRef.current === reachable) return;
    serverReachableRef.current = reachable;
    setServerReachable(reachable);
    if (!reachable) {
      offlineWaiters.current.forEach(notify => notify());
      offlineWaiters.current.clear();
    }
  }

  /**
   * وعد بيتحل لما الاتصال يقع وإحنا في نص عملية محتاجة سيرفر — بنسابق بيه
   * العملية عشان الزرار يتفك بدل ما يفضل "..." لحد ما فايربيز تستسلم
   */
  function whenConnectionLost() {
    let notify: () => void = () => {};
    const promise = new Promise<'lost-connection'>(resolve => {
      notify = () => resolve('lost-connection');
    });
    offlineWaiters.current.add(notify);
    return { promise, cancel: () => offlineWaiters.current.delete(notify) };
  }

  /**
   * أي كتابة في فايربيز بترجع Promise مبيتحلش غير لما السيرفر يأكد استلامها.
   * بس فايربيز بتطبّق الكتابة في الكاش المحلي على طول والـ onSnapshot بيرد بيها
   * فورًا، يعني الواجهة عندها كل اللي محتاجاه من غير ما تستنى السيرفر. لو
   * استنيناه: أول ما النت يبوظ المستخدم يفضل قاعد قدام "..." من غير نهاية،
   * يفتكر إن الحفظ فشل، ويحفظ تاني — فتتسجل عمليتين على نفس الفلوس.
   * فبدل ما ننتظر، بنسجّل الكتابة هنا: بنعدّها في "لسه بترفع"، وبنمسك أي خطأ
   * عشان يوصل للمستخدم بدل ما يضيع في اللوج كـ unhandled rejection.
   */
  function track<T>(p: Promise<T>, label?: string): Promise<T | void> {
    return countPending(p).catch(e => reportWriteError(e, label));
  }

  /**
   * بيعد الكتابة في "لسه بترفع" بس بيسيب الخطأ يعدي لللي نداه. بيستخدمها الكود
   * اللي هيتصرف في الخطأ بنفسه (العمليات الذرية بترجّع نتيجة قاطعة للشاشة)،
   * عشان المستخدم ميشوفش تنبيهين على نفس الحاجة
   */
  /**
   * فشل العملية الذرية بيرجع للشاشة كـ`PayOutcome` وهي اللي بتعرضه، فمش
   * بنستخدم تنبيه `track` العام معاه. بس السطر ده لازم يتكتب برضه: الشاشة
   * بتقول للمستخدم "ما اتسجلش" من غير السبب، واللوج هو المكان الوحيد اللي
   * السبب الحقيقي بيفضل فيه.
   *
   * بنكتب اسم العملية بس — مفيش أسامي ولا مبالغ. الـconsole بيتحوّل
   * breadcrumbs في Sentry، وقسم Sentry في CLAUDE.md بيقول مفيش ولا رقم من
   * فلوس المستخدم يخرج (و`sentryScrub` بيشيل الـbreadcrumbs دي أصلاً).
   *
   * وعشان كده الـconsole لوحده مكانش بيوصل Sentry خالص: `reportAtomicFailure`
   * بيبعت حدث باسم العملية وكود الخطأ بس (مش الرسالة ولا الكائن).
   */
  function noteAtomicFailure(op: AtomicOp, e: unknown) {
    console.warn('عملية ذرية فشلت', op, e);
    reportAtomicFailure(op, e);
  }

  function countPending<T>(p: Promise<T>): Promise<T> {
    pendingCount.current += 1;
    setPendingWrites(pendingCount.current);
    return p.finally(() => {
      pendingCount.current -= 1;
      setPendingWrites(pendingCount.current);
    });
  }

  /**
   * لما كتابة تترفض (قواعد الأمان مثلاً) فايربيز بتشيل الكتابة من الكاش المحلي،
   * يعني العملية بتختفي من قدام المستخدم من غير أي سبب واضح — ودي فلوس، لازم
   * يعرف. تنبيه واحد بس في المرة، عشان لو كتابات كتير فشلت مع بعض (زي حذف دين
   * بكل عملياته) ميتقفلش عليه عشرين تنبيه ورا بعض.
   */
  function reportWriteError(e: any, label?: string) {
    console.warn('كتابة فشلت في فايربيز', label ?? '', e);
    if (errorShown.current) return;
    errorShown.current = true;
    /**
     * `notice` مش `confirm` — عن قصد (silent-failure-hunter، 2026-11-02): `confirm` بيلغي أي
     * شباك والتطبيق مقفول، ورسالة فشل كتابة اتلغت = فلوس اختفت من غير سبب. `notice` بيصف
     * الرسايل ومبيرميش حاجة.
     *
     * القفل (رسالة واحدة لدفعة فشل، زي حذف دين بكل عملياته) بيتفك بـ"تمام" — فالمستخدم اللي
     * قفل الرسالة وجرّب تاني وفشل يشوف رسالة جديدة (money-reviewer + silent-failure-hunter
     * جولة 2: بالمؤقّت لوحده الفشل التاني كان بيتبلع). والمؤقّت احتياطي: لو الرسالة مستنية
     * ورا رسايل تانية، الفشل الجديد بعد `WRITE_ERROR_RESET_MS` بيتصف وراها مش بيضيع.
     */
    const backstop = setTimeout(() => { errorShown.current = false; }, WRITE_ERROR_RESET_MS);
    hapticError();
    notice(WRITE_ERROR_TITLE, writeErrorBody(label), () => {
      clearTimeout(backstop);
      errorShown.current = false;
    });
  }

  /**
   * بنعمل id للمستند من عندنا بدل ما نستنى addDoc ترجع بيه من السيرفر، فالكود
   * اللي محتاج الـ id (زي ربط عملية بدين) بياخده على طول والكتابة تكمل ورا.
   */
  function addDocNoWait(path: string, data: any, label?: string): string {
    const ref = doc(collection(db, 'users', uid!, path));
    track(setDoc(ref, data), label);
    return ref.id;
  }

  useEffect(() => {
    if (!uid) {
      setWallets([]); setCategories([]); setTransactions([]); setBrokenTransactions([]); setBudgets({}); setShakhbataIncome({});
      setShakhbataPercentsState(DEFAULT_PERCENTS);
      setDebts([]); setSubscriptions([]); setGamiyas([]); setIncomes([]);
      setDelivered(new Set());
      setPendingTxIds(new Set());
      setServerReachable(false);
      serverReachableRef.current = false;
      figuresCache.current = { wallets: null, transactions: null };
      setFiguresFromServer(false);
      setFiguresPending(['wallets', 'transactions']);
      deletingRef.current = false;
      setDeletionPending(false);
      return;
    }

  }, [uid]);

  /**
   * كاش أول فتحة باردة (`lib/coldCache.ts`). **القراية:** أول ما الحساب يبان. فشل أو حاجة مش مفهومة ← `null`
   * (الشاشة الفاضية العادية، اللي بانرها بيقول إن السبب النت) — الكاش رفاهية، والتطبيق شغال من غيره.
   * **المسح:** الحساب اتغيّر من A لأي حاجة تانية (خروج أو حساب تاني) ← كاش A بيتمسح، عشان اللي يمسك
   * الموبايل بعد الخروج ميلاقيش أرصدة حد تاني (الحساب التاني مبيقراهوش أصلاً — المفتاح بالـuid).
   */
  const coldUid = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = coldUid.current;
    coldUid.current = uid;
    setStoredCold(null);
    if (prev && prev !== uid) {
      AsyncStorage.removeItem(coldCacheKey(prev)).catch(e => console.warn('[coldCache] remove failed', e instanceof Error ? e.name : 'unknown'));
    }
    if (!uid) return;
    let cancelled = false;
    // كنس: أي كاش لحساب تاني فاضل على الجهاز (التطبيق اتقفل بين الخروج والمسح، أو المسح فشل) بيتمسح
    // هنا (silent-failure-hunter + security-reviewer) — المسح اللي فوق لوحده مبيغطيش الفتحة الجاية
    AsyncStorage.getAllKeys()
      .then(keys => keys.filter(k => k.startsWith(COLD_CACHE_PREFIX) && k !== coldCacheKey(uid)))
      .then(stale => (stale.length ? AsyncStorage.multiRemove(stale) : undefined))
      .catch(e => console.warn('[coldCache] sweep failed', e instanceof Error ? e.name : 'unknown'));
    AsyncStorage.getItem(coldCacheKey(uid))
      .then(raw => { if (!cancelled) setStoredCold(parseColdSnapshot(raw, uid, Date.now())); })
      .catch(e => console.warn('[coldCache] read failed', e instanceof Error ? e.name : 'unknown'));
    return () => { cancelled = true; };
  }, [uid]);

  /**
   * **الكتابة:** بس لما الأرقام نفسها جاية من السيرفر (`figuresFromServer`) **والاتنين وصلوا** (`figuresPending` فاضي —
   * `figuresFresh` بيقبل العمليات `null`، فمن غيره كان ممكن يتكتب رصيد افتتاحي بس)، **والفئات والديون وصلوا**
   * (من غيرهم صف الدين بيتحفظ "مصروف")، ومفيش listener منهم رفض. بعد ثانيتين من آخر تغيير (money-reviewer +
   * silent-failure-hunter). مفيش محفظة شغالة ← الكاش بيتمسح بدل ما يتكتب فاضي (كان هيخبّي "مفيش ولا محفظة").
   * **حساب A → حساب B على طول (من غير `null`) مش متغطّي هنا عن قصد:** التطبيق مبيعرضش الدخول غير بعد الخروج،
   * فالـuid دايمًا بيعدّي على `undefined` والحالة بتتصفّر (security-reviewer SHOULD-FIX 3 — متروك بالسبب ده).
   */
  useEffect(() => {
    if (!uid || !figuresFromServer || figuresPending.length > 0) return;
    if (!delivered.has('categories') || !delivered.has('debts')) return;
    if ((['wallets', 'transactions', 'categories', 'debts'] as const).some(n => loadErrors.includes(n))) return;
    const timer = setTimeout(() => {
      const debtTxIds = new Set(debts.flatMap(d => debtTransactionIds(d)));
      const snap = buildColdSnapshot({ uid, wallets, categories, transactions, debtTransactionIds: debtTxIds, now: Date.now() });
      const write = snap.wallets.length > 0
        ? AsyncStorage.setItem(coldCacheKey(uid), JSON.stringify(snap))
        : AsyncStorage.removeItem(coldCacheKey(uid));
      write.catch(e => console.warn('[coldCache] write failed', e instanceof Error ? e.name : 'unknown'));
    }, COLD_CACHE_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [uid, figuresFromServer, figuresPending, delivered, loadErrors, wallets, categories, transactions, debts]);
  // للعرض بس، وبس طول ما مفيش ولا محفظة **ولا عملية** حقيقية ولا أرقام من السيرفر — أول snapshot حقيقي من أي
  // واحد فيهم بيخفيه (مفيش رصيد من الكاش جنب عمليات حقيقية — money-reviewer). كاش من غير محافظ ← مبيتعرضش
  const coldSnapshot = !figuresFromServer && wallets.length === 0 && transactions.length === 0 && storedCold && storedCold.wallets.length > 0
    ? storedCold : null;

  /**
   * الحساب محتاج تجهيز؟ (شاشة "نبدأ بإيه؟"). اللي اتأكد مرة بيتفكر على الجهاز
   * فمبيتسألش السيرفر تاني. `unknown` بيتعاد كل 20 ثانية لحد ما النت يرجع —
   * عشان حساب جديد فتح أول مرة من غير نت ميفضلش من غير محافظ ساكت.
   */
  useEffect(() => {
    if (!uid) { setSetupStatus('checking'); return; }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setSetupStatus('checking');
    const run = async () => {
      try {
        // مسح الحساب بدأ ومخلصش ← مفيش "نبدأ بإيه؟" (كانت هتزرع محافظ على حساب بيتمسح) ومفيش تسجيل تلقائي
        // قراية العلامة فشلت ← محاولة تانية مش بلع ساكت (silent-failure-hunter: من غيرها التسجيل التلقائي كان بيشتغل على
        // حساب نص-ممسوح والبانر مبيظهرش). الفشلين ← لوج ونكمّل عادي (الأغلبية الساحقة مالهاش مسح معلّق)
        let pending: string | null = null;
        try { pending = await AsyncStorage.getItem(deletePendingKey(uid)); }
        catch (e) {
          console.warn('[delete-account] pending read failed, retrying', e instanceof Error ? e.name : 'unknown');
          try { pending = await AsyncStorage.getItem(deletePendingKey(uid)); }
          catch (e2) { console.warn('[delete-account] pending read failed twice', e2 instanceof Error ? e2.name : 'unknown'); }
        }
        if (pending === '1') { deletingRef.current = true; if (!cancelled) { setDeletionPending(true); setSetupStatus('done'); } return; }
        if ((await AsyncStorage.getItem(setupDoneKey(uid))) === '1') { if (!cancelled) setSetupStatus('done'); return; }
      } catch {
        // لو القراية وقعت نسأل السيرفر عادي
      }
      // حساب اتعمل قبل ما الشاشة تبقى موجودة ← قديم بالتعريف، فوري ومن غير نت
      // (من غير الـ8 ثواني). الجديد بعد التاريخ بيعدّي على السيرفر زي الأول
      if (createdBeforeSetupFeature(creationTime)) {
        AsyncStorage.setItem(setupDoneKey(uid), '1').catch(() => {});
        if (!cancelled) setSetupStatus('done');
        return;
      }
      const status = await detectSetup(uid);
      if (cancelled) return;
      if (status === 'done') AsyncStorage.setItem(setupDoneKey(uid), '1').catch(() => {});
      setSetupStatus(status);
      if (status === 'unknown') retry = setTimeout(run, SETUP_RECHECK_MS);
    };
    run();
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [uid, creationTime]);

  // الـlisteners في effect لوحده عشان "جرّب تاني" يفتحهم من الأول من غير ما
  // يعيد التحقق من التجهيز (شوف setupStatus)
  useEffect(() => {
    if (!uid) { setLoadErrors([]); return; }
    // حساب اتبدّل بحساب من غير ما يعدّي على null: `delivered` بتاع الأول كان هيخلّي التاني `ready` قبل ما ديونه توصل
    // (silent-failure-hunter جولة 1، بند 11). على "جرّب تاني" لأ — اللي وصل لسه وصل
    if (deliveredUid.current !== uid) { deliveredUid.current = uid; setDelivered(new Set()); }

    /**
     * فايربيز بتقفل الـlistener نهائي لما يترفض — من غير الـcallback ده كان
     * بيموت ساكت والقايمة تفضل فاضية. البيانات اللي وصلت قبل كده بتفضل زي ما
     * هي (مبنمسحهاش)، والشاشة بتقول إنها ما وصلتش. في اللوج اسم المجموعة
     * والكود بس — مفيش بيانات مستخدم.
     */
    const failed = (name: ListenerName) => (e: FirestoreError) => {
      console.warn('قراية فشلت من فايربيز', name, e?.code);
      setLoadErrors(prev => (prev.includes(name) ? prev : [...prev, name]));
    };
    /**
     * الاسم بيتشال من `loadErrors` **لما snapshot يوصل فعلاً** — مش لما
     * "جرّب تاني" يتداس. لو اتشال مع الضغطة، البانر كان هيختفي والقايمة لسه
     * فاضية لحد ما السيرفر يرد (silent-failure-hunter). بيرجّع نفس الـstate لو
     * الاسم مش موجود، فمفيش render زيادة مع كل snapshot عادي.
     */
    const loaded = (name: ListenerName) => {
      setLoadErrors(prev => (prev.includes(name) ? prev.filter(n => n !== name) : prev));
      setDelivered(prev => (prev.has(name) ? prev : new Set(prev).add(name)));
    };

    const unsubWallets = onSnapshot(collection(db, 'users', uid, 'wallets'), { includeMetadataChanges: true }, (snap) => {
      loaded('wallets');
      // المعرّف من المسار آخر حاجة — حقل `id` جوه المستند ميغطيهوش (بند B)
      setWallets(snap.docs.map(d => walletFromDoc<Wallet>(d.id, d.data())));
      noteConnection(snap.metadata.fromCache);
      noteFigures('wallets', snap.metadata.fromCache);
    }, failed('wallets'));
    const unsubCategories = onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
      loaded('categories');
      setCategories(snap.docs.map(d => withId<Category>(d.id, d.data())));
    }, failed('categories'));
    // includeMetadataChanges عشان نعرف مين لسه بيرفع ومين وصل: من غيرها فايربيز
    // مبتبعتش snapshot تاني لما السيرفر يأكد كتابة محتواها ما اتغيرش، فالعلامة
    // كانت هتفضل ظاهرة على العملية بعد ما ترفع فعلاً
    const unsubTx = onSnapshot(collection(db, 'users', uid, 'transactions'), { includeMetadataChanges: true }, (snap) => {
      loaded('transactions');
      // المستند البايظ (مبلغ/تاريخ/نوع) برّه الحسابات ومتعلّم — مش صفر ومش متشال ساكت (قرار مؤمن، بند B)
      const split = splitTransactions<Transaction>(snap.docs);
      setTransactions(split.transactions);
      // نفس المصفوفة لو مفيش تغيير — الـlistener ده بيرد مع كل تغيير metadata (silent-failure-hunter + money-reviewer NIT)
      setBrokenTransactions(prev => (JSON.stringify(prev) === JSON.stringify(split.broken) ? prev : split.broken));
      const stillUploading = snap.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.id);
      setPendingTxIds(prev => (sameIds(prev, stillUploading) ? prev : new Set(stillUploading)));

      // fromCache معناها إن العميل مش متزامن مع السيرفر دلوقتي — ودي أصدق إجابة
      // على سؤال "هل أقدر أوصل فايرستور؟" لأنها جاية من فايربيز نفسها
      noteConnection(snap.metadata.fromCache);
      noteFigures('transactions', snap.metadata.fromCache);
    }, failed('transactions'));
    const unsubBudgets = onSnapshot(collection(db, 'users', uid, 'budgets'), (snap) => {
      loaded('budgets');
      const b: Budgets = {};
      // رقم محدود بس (بند B): `undefined`/نص كان بيدخل حسبة "قربت تخلص" NaN
      snap.docs.forEach(d => { const v = numberField(d.data(), 'limit', 'budgets'); if (v !== undefined) b[d.id] = v; });
      setBudgets(b);
    }, failed('budgets'));
    const unsubShakhbata = onSnapshot(collection(db, 'users', uid, 'shakhbata_income'), (snap) => {
      loaded('shakhbata_income');
      const s: ShakhbataIncome = {};
      snap.docs.forEach(d => { const v = numberField(d.data(), 'income', 'shakhbata_income'); if (v !== undefined) s[d.id] = v; });
      setShakhbataIncome(s);
    }, failed('shakhbata_income'));
    const unsubPercents = onSnapshot(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), (snap) => {
      loaded('shakhbata_settings');
      if (snap.exists()) {
        const data = snap.data();
        // `??` كان بيعدّي نص ("50") وNaN — المجموع كان بيتلزق نص (بند B)
        setShakhbataPercentsState({
          needs: finiteOr(data.needs, DEFAULT_PERCENTS.needs, ['shakhbata_settings', 'needs']),
          wants: finiteOr(data.wants, DEFAULT_PERCENTS.wants, ['shakhbata_settings', 'wants']),
          future: finiteOr(data.future, DEFAULT_PERCENTS.future, ['shakhbata_settings', 'future']),
        });
      } else {
        setShakhbataPercentsState(DEFAULT_PERCENTS);
      }
    }, failed('shakhbata_settings'));
    const unsubDebts = onSnapshot(collection(db, 'users', uid, 'debts'), (snap) => {
      loaded('debts');
      // `payments` و`increases` الاتنين بقيمة افتراضية: النوع `Debt` بيقول إنهم
      // مصفوفات مش اختياريين، ومستند قديم من غير الحقلين كان بيخلي النوع
      // يكدب — وأربع شاشات بتعمل `d.payments.forEach/.map/.length` من غير
      // حراسة (`person-ledger`, `reports`, `debts` في مكانين)
      // `payments: null` كان بيغطي الافتراضي بالـspread ويوقّع 4 شاشات (بند B)
      setDebts(snap.docs.map(d => debtFromDoc<Debt>(d.id, d.data())));
    }, failed('debts'));
    const unsubSubs = onSnapshot(collection(db, 'users', uid, 'subscriptions'), (snap) => {
      loaded('subscriptions');
      setSubscriptions(snap.docs.map(d => subscriptionFromDoc<Subscription>(d.id, d.data())));
    }, failed('subscriptions'));
    const unsubGamiyas = onSnapshot(collection(db, 'users', uid, 'gamiyas'), (snap) => {
      loaded('gamiyas');
      setGamiyas(snap.docs.map(d => gamiyaFromDoc<Gamiya>(d.id, d.data())));
    }, failed('gamiyas'));

    const unsubIncomes = onSnapshot(collection(db, 'users', uid, 'incomes'), (snap) => {
      loaded('incomes');
      setIncomes(snap.docs.map(d => incomeFromDoc<RecurringIncome>(d.id, d.data())));
    }, failed('incomes'));

    return () => {
      unsubWallets(); unsubCategories(); unsubTx(); unsubBudgets(); unsubShakhbata(); unsubPercents();
      unsubDebts(); unsubSubs(); unsubGamiyas(); unsubIncomes();
    };
  }, [uid, listenRetry]);

  async function addWallet(name: string) {
    if (!uid) return;
    addDocNoWait('wallets', { name, openingBalance: 0, lowAlert: 0 }, namedLabel('المحفظة', name));
  }
  async function updateWallet(id: string, data: Partial<Wallet>) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'wallets', id), data));
  }
  async function deleteWallet(id: string): Promise<WalletWriteResult> {
    if (!uid) return { outcome: 'done' };
    // بند 13: آخر محفظة شغالة مبتتمسحش — نفس حظر الشاشة (`walletDeleteBlock`) هنا
    // كمان، فالمتصل اللي نسي الفحص بيترفض بدل ما المستخدم يفضل من غير محفظة.
    // **حد:** من المحافظ اللي وصلت النسخة دي — جهازين كل واحد بيمسح واحدة من آخر
    // اتنين لسه ممكن يوصلوا لصفر (محتاج مستند عدّاد أو قاعدة، والقواعد برّه الجولة)
    const block = walletDeleteBlock(id, latestWallets.current);
    if (block) return { outcome: 'blocked', block };
    track(deleteDoc(doc(db, 'users', uid, 'wallets', id)));
    return { outcome: 'done' };
  }

  /**
   * الأرشفة والنقل في دفعة واحدة (`writeBatch`) عن قصد: فايرستور بتطبّق
   * الدفعة كلها أو مفيش. لو أرشفنا المحفظة الأول وبعدين النقل فشل، كان
   * هيبقى عندنا اشتراك شغّال مربوط بمحفظة مؤرشفة — يعني تسديد بيترفض كل
   * شهر والمستخدم مش عارف ليه.
   *
   * ومفيش `await` على `commit()` زي كل الكتابات: الدفعة بتتطبّق محليًا على
   * طول والـsnapshot بيرد فورًا، فالشاشة تتقفل من غير انتظار السيرفر.
   * الذرية بتفضل مضمونة من فايرستور نفسها لما الدفعة توصل.
   *
   * العمليات القديمة ودفعات الماضي **مش بتتلمس خالص** — هي بتحمل المحفظة
   * اللي خرجت منها فعلاً، وتغييرها كان هيبقى إعادة كتابة للتاريخ.
   */
  async function archiveWallet(
    id: string,
    reassign: { subscriptions?: Record<string, string>; gamiyas?: Record<string, string>; incomes?: Record<string, string> },
  ): Promise<WalletWriteResult> {
    if (!uid) return { outcome: 'done' };
    // بند 13: نفس جزء "آخر محفظة شغالة" من `walletArchiveBlock` (الرصيد والنقل
    // محتاجين العمليات والشيت، وبيتفحصوا في الشاشة). نفس حد سباق الجهازين اللي في المسح
    if (latestWallets.current.filter(w => !w.archived).length <= 1) return { outcome: 'blocked', block: { kind: 'last-active' } };
    const batch = writeBatch(db);
    // الدخل الثابت زي الاشتراك بالظبط: بيولّد عمليات جديدة، فلو فضل على
    // محفظة مؤرشفة كل تسجيل بعد كده هيترفض.
    // الدخل اللي اتمسح (`deleteIncome`) وشيت الأرشفة مفتوح بيتفوّت: `update`
    // على مستند مش موجود كان هيوقّع الدفعة كلها والمحفظة ما تتأرشفش
    Object.entries(reassign.incomes || {}).forEach(([incomeId, walletId]) => {
      if (!incomes.some(i => i.id === incomeId)) return;
      batch.update(doc(db, 'users', uid, 'incomes', incomeId), { walletId });
    });
    // نفس الحاجة للاشتراك والجمعية اللي اتمسحوا من جهاز تاني والشيت مفتوح.
    // **فاضل شباك صغير:** التفويت بيشتغل بس لما المسح يكون وصل النسخة دي. لو
    // اتمسح على السيرفر ولسه الـsnapshot ما وصلش، الدفعة بتقع زي الأول —
    // والرسالة بتسمّي المحفظة، فالمستخدم عارف إيه اللي ما اتأرشفش ويجرب تاني
    Object.entries(reassign.subscriptions || {}).forEach(([subId, walletId]) => {
      if (!subscriptions.some(s => s.id === subId)) return;
      batch.update(doc(db, 'users', uid, 'subscriptions', subId), { walletId });
    });
    Object.entries(reassign.gamiyas || {}).forEach(([gamiyaId, walletId]) => {
      if (!gamiyas.some(g => g.id === gamiyaId)) return;
      batch.update(doc(db, 'users', uid, 'gamiyas', gamiyaId), { walletId });
    });
    batch.update(doc(db, 'users', uid, 'wallets', id), {
      archived: true, archivedAt: new Date().toISOString(),
    });
    track(batch.commit(), namedLabel('أرشفة المحفظة', wallets.find(w => w.id === id)?.name));
    return { outcome: 'done' };
  }

  async function restoreWallet(id: string) {
    if (!uid) return;
    // بنشيل الحقلين خالص بدل `archived: false` — المحفظة ترجع لنفس شكل
    // المحافظ اللي ما اتأرشفتش أصلاً، فمفيش حالتين لنفس المعنى
    track(updateDoc(doc(db, 'users', uid, 'wallets', id), {
      archived: deleteField(), archivedAt: deleteField(),
    }));
  }
  async function addCategory(name: string) {
    if (!uid) return;
    addDocNoWait('categories', { name }, namedLabel('الفئة', name));
  }
  async function updateCategory(id: string, data: Partial<Category>) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'categories', id), data));
  }
  /**
   * الميزانية بتتمسح مع الفئة. مستند الميزانية مفتاحه هو معرّف الفئة، فلو
   * سبناه بيفضل سقف يتيم في فايرستور بيدخل في حسبة "المتبقي للتوزيع" من
   * غير أي صف يفسّره — المستخدم بيشوف فلوس موزّعة على فئة مش موجودة.
   */
  async function deleteCategory(id: string) {
    if (!uid) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'categories', id));
    if (budgets[id] != null) batch.delete(doc(db, 'users', uid, 'budgets', id));
    track(batch.commit());
  }

  /** نفس منطق `archiveWallet` — والميزانية بتتمسح هنا كمان لنفس السبب */
  async function archiveCategory(id: string, reassign: Record<string, string>) {
    if (!uid) return;
    const batch = writeBatch(db);
    Object.entries(reassign).forEach(([subId, categoryId]) => {
      batch.update(doc(db, 'users', uid, 'subscriptions', subId), { categoryId });
    });
    if (budgets[id] != null) batch.delete(doc(db, 'users', uid, 'budgets', id));
    batch.update(doc(db, 'users', uid, 'categories', id), {
      archived: true, archivedAt: new Date().toISOString(),
    });
    track(batch.commit());
  }

  /**
   * بيبعت الرأي لمجموعة `feedback` العامة.
   *
   * القراية ممنوعة من العميل (القواعد)، فمش هنعرف حال المستند من
   * `onSnapshot` زي أي حاجة تانية في التطبيق — الطريق الوحيد هو وعد
   * الكتابة نفسه. والوعد ده **مبيتحلش خالص** وإحنا أوفلاين، فبنسابقه
   * بمهلة وبنقول الحقيقة: "هيتبعت أول ما النت يرجع" مش "اتبعت".
   */
  async function submitFeedback(type: FeedbackType, text: string): Promise<FeedbackOutcome> {
    if (!uid) return 'failed';
    // الحساب بيتمسح: رأي بيتكتب بعد آخر قراية فاضية كان هيفضل بعد "اتمسح حسابك" (silent-failure-hunter + database-reviewer)
    if (deletingRef.current) return 'failed';
    const payload = { ...buildFeedbackDoc(uid, type, text), createdAt: serverTimestamp() };
    const write = countPending(addDoc(collection(db, 'feedback'), payload));
    // الأخطاء بتتلقط هنا مش في track: الشاشة بتعرض النتيجة بنفسها
    write.catch(() => {});

    if (!serverReachableRef.current) return 'pending';
    const timeout = new Promise<'pending'>(r => setTimeout(() => r('pending'), FEEDBACK_ACK_MS));
    try {
      return await Promise.race([write.then(() => 'sent' as const), timeout]);
    } catch {
      return 'failed';
    }
  }

  async function restoreCategory(id: string) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'categories', id), {
      archived: deleteField(), archivedAt: deleteField(),
    }));
  }
  async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
    if (!uid) return '';
    // بنضمن وجود createdAt دايمًا عشان الوقت يظهر مع كل العمليات (حتى اللي بتتولد من الديون والاشتراكات والجمعية)
    const withTimestamp = { createdAt: new Date().toISOString(), ...tx };
    const clean = Object.fromEntries(Object.entries(withTimestamp).filter(([, v]) => v !== undefined));
    return addDocNoWait('transactions', clean, 'العملية');
  }
  async function updateTransaction(id: string, tx: Partial<Transaction>, settlements: Settlement[] = []) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    if (settlements.length === 0) {
      track(updateDoc(doc(db, 'users', uid, 'transactions', id), clean), 'تعديل العملية');
      return;
    }
    // التعديل والتسوية مع بعض أو مفيش — تعديل من غير تسويته معناه فلوس اتحركت
    // في محفظة مخفية والإجمالي ما اتغيرش
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid, 'transactions', id), clean);
    stageSettlements(batch, settlements);
    track(batch.commit());
  }

  /**
   * تعديل عملية مربوطة بدين (أصله، دفعة، زيادة) — العملية والدين مع بعض في
   * ذرة واحدة (بند 14، 2026-10-27). قبل كده `updateTransaction` كان بيعدّل
   * العملية بس، فالرصيد يتحرك والمتبقي وعدد الأقساط يفضلوا على الرقم القديم.
   *
   * **ذرية مش batch من حالة الرياكت** لنفس سبب `addDebtPayment`: مصفوفة
   * الدفعات بتتقري من السيرفر، فدفعة نزلت من جهاز تاني متتمسحش وإحنا بنكتب
   * المصفوفة. والتمن نفسه: محتاجة نت (قاعدة 7) ونتيجة قاطعة.
   *
   * المحفظة الجديدة لازم تكون شغالة؛ لو المحفظة ما اتغيّرتش وهي مؤرشفة، التسوية
   * (`settlements`) هي اللي بتغطيها في نفس الذرة — زي التعديل العادي بالظبط.
   */
  async function updateDebtLinkedTransaction(
    txId: string, edit: Partial<Transaction> & LinkedEditNext, expected: Pick<Transaction, 'amount' | 'walletId' | 'type'>,
    settlements: Settlement[] = [],
  ): Promise<TxEditResult> {
    if (!uid) return { outcome: 'failed' };
    // التقريب الأول وبعدين الفحص (`storableAmount`): "1e307" كان بيعدّي `isFinite`
    // ويتقرّب لـInfinity ويتكتب على العملية والدين. والعملية والدين بنفس الرقم
    // المقرّب بالظبط — نفس الرقم اللي التسوية في المودال بتتحسب منه
    const amount = storableAmount(edit.amount);
    if (amount === null) return { outcome: 'failed' };
    const tx = { ...edit, amount };
    const debtId = debts.find(d => debtRoleOf(d, txId))?.id;
    if (!debtId) {
      noteAtomicFailure('تعديل عملية الدين', new LinkedTxMissingError());
      return { outcome: 'gone' };
    }
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(db, 'users', uid, 'transactions', txId);
    const result: { note: string | null } = { note: null };
    try {
      await countPending(runTransaction(db, async (t) => {
        const debtSnap = await t.get(debtRef);
        if (!debtSnap.exists()) throw new DebtMissingError();
        const txSnap = await t.get(txRef);
        if (!txSnap.exists()) throw new LinkedTxMissingError();
        const debt = debtFromDoc<Debt>(debtId, debtSnap.data(), true);
        const current = txSnap.data() as Transaction;
        // اتعدّلت من جهاز تاني بعد ما المودال اتفتح: التسوية (`settlements`)
        // اتحسبت على الأرقام القديمة، فالكتابة كانت هتسوّي برقم غلط
        if (current.amount !== expected.amount || current.walletId !== expected.walletId || current.type !== expected.type) {
          throw new LinkedTxMissingError();
        }
        const plan = debtLinkedEditPlan(debt, txId, tx, todayStr());
        if (!plan) throw new LinkedTxMissingError();
        if (tx.walletId !== current.walletId
          && !(await walletUsable(t, doc(db, 'users', uid!, 'wallets', tx.walletId)))) {
          throw new WalletMissingError();
        }
        // كل القرايات خلصت — من هنا كتابات بس
        // نفس إشارات باقي مسارات الدين (silent-failure-hunter): فرق متجاهَل، طيّ فشل أو
        // فرق متجاهَل بيتشال صريح، أو عدد مينفعش يتخزّن — المعرّف بس (sentryScrub). بعد
        // آخر قراية عشان السطر ميتكتبش لكتابة ما حصلتش (money-reviewer + silent-failure-hunter)
        noteIgnoredResidue(debt);
        if (plan.clearResidue || plan.clearIgnoredResidue) plan.patch.installmentResidue = deleteField();
        if (plan.clearResidue) noteOnce(`fold:${debtId}`, '[debt] installmentResidue fold failed, cleared', debtId);
        if (plan.countNotStorable) noteOnce(`count:${debtId}`, '[debt] installment count not storable, old count kept', debtId);
        const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
        t.update(txRef, clean);
        t.update(debtRef, plan.patch);
        stageSettlements(t, settlements);
        result.note = installmentEditMessage(plan.countBefore, plan.countAfter);
      }));
      return { outcome: 'done', note: result.note };
    } catch (e) {
      noteAtomicFailure('تعديل عملية الدين', e);
      if (e instanceof WalletMissingError) return { outcome: 'wallet-missing' };
      if (e instanceof LinkedTxMissingError || e instanceof DebtMissingError) return { outcome: 'gone' };
      return { outcome: 'failed' };
    }
  }
  /**
   * حذف سجل (دين/اشتراك/جمعية) **بكل العمليات المالية المولّدة منه**، في دفعة
   * واحدة بتتبعت من غير انتظار.
   *
   * قبل كده كان الشكل:
   *
   *     await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
   *     track(deleteDoc(recordRef));
   *
   * وده كان بيقرا كإنه بيستنى تأكيد السيرفر على كل حذفة. عمليًا مكانش بيستنى،
   * لأن `deleteTransactionDoc` كانت برمي وعد `track` وترجع على طول — بس ده
   * كان **بالصدفة**، وأول تنضيفة تخلي الدالة ترجّع وعدها كانت هتولّد مصيدة
   * "الزرار بيفضل بيلف للأبد" على طول: التلات شاشات بتلفّ الحذف في `runBusy`،
   * واللي بيقفل الزرار بـ`ref` وبيفكّه في `finally` — و`finally` اللي مبتوصلش
   * معناها زرار مقفول لآخر الجلسة، مش بيلف وبس.
   *
   * وكان كمان بيسيب الحذف **مش ذري**: كل عملية في كتابة، والسجل في كتابة
   * تالتة. لو واحدة اترفضت بيفضل عندنا سجل متمسوح وعملياته موجودة (أو العكس)
   * — وده بالظبط اللي `stageReconcile` اتعملت عشان تمنعه في المسار التاني.
   *
   * دلوقتي: دفعة واحدة، بتتكتب محليًا على طول، والـ`onSnapshot` بيرد فورًا،
   * والرفع بيحصل لوحده أول ما النت يرجع — قاعدة 7 بالحرف.
   */
  /**
   * آخر حالة للمحافظ والعمليات، لفحص المسح لحظة الدوسة. `deleteDebt` اللي
   * الـAlert بيناديه هو نسخة الـrender اللي فتح التأكيد، فلو قرا الـstate
   * مباشرة كان هيشوف نفس اللي الشاشة شافته قبل التأكيد — والفحص التاني
   * مبيعملش حاجة (money-reviewer + silent-failure-hunter).
   */
  const cascadeInputs = useRef({ wallets, transactions, loadErrors });
  cascadeInputs.current = { wallets, transactions, loadErrors };

  function deleteWithTransactions(
    kind: CascadeKind, name: string, recordRef: DocumentReference, txIds: string[], label?: string,
  ): CascadeDeleteResult {
    if (!uid) return { outcome: 'done' };
    // **المسح مبيعملش تسوية.** عملية منهم على محفظة مؤرشفة كانت بتتمسح
    // والرصيد المؤرشف يبعد عن الصفر ساكت (المؤرشفة برّه الإجمالي). الشاشة
    // بتفحص قبل التأكيد؛ الفحص هنا لحظة الدوسة، لو المحفظة اتأرشفت (من الجهاز
    // ده أو من جهاز تاني ووصل الـlistener) والتأكيد مفتوح — عشان كده بيقرا
    // `cascadeInputs` (آخر render) مش الـstate اللي في الـclosure.
    //
    // **وده مش جوه ذرة:** المسح دفعة بتشتغل أوفلاين عن قصد (فوق)، فمبتقراش
    // من السيرفر. أرشفة من جهاز تاني لسه ما وصلتش الـlistener مش هتتمسك هنا.
    const blocked = cascadeDeleteBlock({ kind, name, txIds, ...cascadeInputs.current, loading: pendingFigures() });
    if (blocked) return { outcome: 'blocked', ...blocked };
    // حد الدفعة في فايرستور 500 عملية. سجل بأكتر من كده مش واقعي (اشتراك
    // شهري لـ40 سنة)، بس لو حصل بنقسّم بدل ما الدفعة كلها تترفض.
    //
    // **والضمان هنا لازم يتقال بالظبط:** كل دفعة لوحدها ذرية، لكن **مفيش
    // ذرية بين الدفعات** — بنبعتهم كلهم مع بعض عن قصد، لأن تسلسلهم معناه
    // انتظار تأكيد الدفعة اللي قبلها، وده بيكسر الحذف أوفلاين (الوعد مبيتحلش
    // خالص من غير نت، فالسجل مكانش هيتمسح محليًا أصلاً). يعني لسجل فيه أكتر
    // من 499 عملية، فشل جزئي (توكن خلص، خروج في نفس اللحظة) ممكن يسيب
    // عمليات يتيمة. اخترنا إن الحذف يشتغل أوفلاين على حساب الحالة دي —
    // والوضع القديم مكانش فيه ذرية أصلاً لا جوه الدفعة ولا بينها.
    const refs = txIds.map(txId => doc(db, 'users', uid!, 'transactions', txId));
    const chunks: DocumentReference[][] = [];
    for (let i = 0; i < refs.length; i += BATCH_LIMIT - 1) chunks.push(refs.slice(i, i + BATCH_LIMIT - 1));
    if (chunks.length === 0) chunks.push([]);
    chunks.forEach((chunk, idx) => {
      const batch = writeBatch(db);
      chunk.forEach(ref => batch.delete(ref));
      if (idx === chunks.length - 1) batch.delete(recordRef);
      // رقم الدفعة في الاسم عشان لو واحدة بس فشلت يبان **أنهي** واحدة في
      // اللوج — التنبيه للمستخدم واحد بس في الجلسة، فاللوج هو اللي بيفرّق
      track(batch.commit(), chunks.length > 1 ? `${label} (دفعة ${idx + 1} من ${chunks.length})` : label);
    });
    return { outcome: 'done' };
  }

  /**
   * أي عملية بتتحذف من أي شاشة لازم السجل اللي ولّدها يتعدل معاها، وإلا بيفضل
   * عندنا دين/اشتراك/جمعية متعلقين بعملية مش موجودة — والمستخدم بيشوف رصيد وهمي.
   * - دفعة أو زيادة أو شهر جمعية: بنشيل الحركة من السجل بس (الشهر بيرجع "لسه ما اتسددش")
   * - المبلغ الأساسي للدين: لو الدين لسه مافيهوش دفعات ولا زيادات بيتمسح كله
   *   (مفيهوش غير القيد ده)، ولو فيه بيفضل موجود بس بيبقى "بالأجل" عشان منمسحش
   *   حركات حقيقية المستخدم سجّلها بنفسه في أيام تانية
   */
  /**
   * بتحط تعديل السجل المرتبط في **نفس** الدفعة بتاعة حذف العملية.
   *
   * قبل كده كانت كتابات منفصلة: العملية تتمسح، وبعدين تحديث الدين/الاشتراك
   * يتبعت لوحده. لو التاني فشل كان بيفضل عندنا دين مربوط بعملية مش موجودة —
   * وده بالظبط اللي الدالة دي موجودة تمنعه. الدفعة الواحدة بتضمن الاتنين
   * مع بعض أو مفيش.
   */
  function stageReconcile(batch: WriteBatch, txId: string) {
    if (!uid) return;

    for (const d of debts) {
      if (d.initialTransactionId === txId) {
        const hasHistory = (d.payments || []).length > 0 || (d.increases || []).length > 0;
        if (hasHistory) {
          batch.update(doc(db, 'users', uid, 'debts', d.id), {
            initialTransactionId: deleteField(),
            initialWalletId: deleteField(),
          });
        } else {
          batch.delete(doc(db, 'users', uid, 'debts', d.id));
        }
        return;
      }
      // دفعة أو زيادة: نفس الدالة اللي بتبني تحذير مودال العملية (`transactionDeleteDebtPlan`،
      // D3 2026-10-30)، فعدد الأقساط في الرسالة هو اللي بيتكتب. **من حالة الرياكت (مش ذرية)**
      // ومن غير `pinInstallmentAmount` عن قصد: قيمة قسط اتعدّلت من جهاز تاني كانت هتتكتب
      // فوقها (silent-failure-hunter). لو جهاز تاني زوّد زيادة في نفس اللحظة، إزاحتها بتضيع
      // من الخطة — والبصمة (D2) بتبقى مش مطابقة فالفرق بيتجاهل (متسجّل في TIMELINE)
      const plan = transactionDeleteDebtPlan(d, txId);
      if (plan) {
        // فرق متجاهَل (نسخة قديمة غيّرت الزيادات — D2) بيتسجّل زي باقي مسارات الدين
        if (plan.kind === 'increase') noteIgnoredResidue(d);
        const patch: Record<string, unknown> = plan.kind === 'payment' ? { payments: plan.payments } : { increases: plan.increases };
        if (plan.residue?.op === 'set') patch.installmentResidue = plan.residue.value;
        if (plan.residue?.op === 'clear') {
          patch.installmentResidue = deleteField();
          noteOnce(`fold:${d.id}`, '[debt] installmentResidue fold failed, cleared', d.id);
        }
        const count = countToWrite(plan.countAfter, d.installmentCount, d.id);
        if (count !== undefined) patch.installmentCount = count;
        // مسح عملية الزيادة اللي فتحت الدين ← المعاد القديم بيرجع (بند 12) — نفس debtLinkWarning
        if (plan.dueRestore) patch.dueDate = plan.dueRestore;
        batch.update(doc(db, 'users', uid, 'debts', d.id), patch);
        return;
      }
    }

    for (const sub of subscriptions) {
      const history = sub.history || [];
      const idx = history.findIndex(h => h.transactionId === txId);
      if (idx === -1) continue;
      // الدفعة معروف هي قفلت أنهي فترة ← الفترة دي بترجع **تسأل** ("اتخصم؟")
      // والمعاد الجاي زي ما هو. مبترجعش مفتوحة عادي: التلقائي كان هيخصمها
      // تاني مع أول فتحة — وده بالظبط اللي المستخدم مسح العملية عشانه
      const key = history[idx].periodKey;
      if (key) {
        // arrayRemove للسطر ده بالظبط مش المصفوفة كلها من ذاكرة الرياكت: التلقائي
        // ممكن يكون ضاف فترة على السيرفر لسه ما وصلتناش، والمصفوفة القديمة كانت هتمسحها
        // **متبقّي مقبول:** لو السطر هنا مش مطابق حرفيًا للي على السيرفر (جهاز تاني لسه
        // ما وصلناش تحديثه)، arrayRemove مبيعملش حاجة ساكت — السطر يفضل في history
        // بعملية اتمسحت. الفلوس صح والفترة بترجع تسأل (closed)، ومفيش شاشة بتقرا history؛
        // الـcascade بتاع مسح الاشتراك بيمسح عملية ممسوحة أصلاً = مفيش أثر (SFH جولة 2)
        // ولو دي الفترة اللي قبل المعاد على طول، المعاد بيرجع لها (نفس العقد القديم:
        // الشاشة تقول "مستحق" عنها مش عن اللي بعدها) — وهي لسه "بتسأل" مش تلقائي
        const rollBack = subscriptionNextCycle(sub, key) === sub.nextDueDate;
        batch.update(doc(db, 'users', uid, 'subscriptions', sub.id),
          'history', arrayRemove(history[idx]),
          new FieldPath('closed', key), { reopened: true, at: new Date().toISOString() },
          ...(rollBack ? ['nextDueDate', key] : []));
        return;
      }
      // دفعة قديمة (قبل الفترات) — نفس السلوك القديم
      // لو دي آخر دفعة اتسجلت، بنرجّع موعد الاستحقاق خطوة ورا بعكس نفس المعادلة
      // اللي قدّمته. لو دفعة قديمة، الموعد الحالي لسه صح فبنسيبه زي ما هو
      const isLast = idx === history.length - 1;
      const rolledBack = sub.frequency === 'monthly' ? addMonths(sub.nextDueDate, -1)
        : sub.frequency === 'yearly' ? addMonths(sub.nextDueDate, -12)
        : addDays(sub.nextDueDate, -(sub.customDays || 30));
      batch.update(doc(db, 'users', uid, 'subscriptions', sub.id), {
        history: history.filter(h => h.transactionId !== txId),
        ...(isLast ? { nextDueDate: rolledBack } : {}),
      });
      return;
    }

    for (const g of gamiyas) {
      if (!(g.months || []).some(m => m.transactionId === txId)) continue;
      const months = g.months.map(m => {
        if (m.transactionId !== txId) return m;
        const { transactionId, auto: _a, ...rest } = m;
        // بيسأل، وعمره ما يتسجل لوحده تاني (`lib/autoCharge.ts`)
        return { ...rest, status: 'pending' as const, reopened: true };
      });
      batch.update(doc(db, 'users', uid, 'gamiyas', g.id), { months });
      return;
    }
  }

  /**
   * بتحط تحويلات التسوية في الدفعة: المحفظة المؤرشفة بترجع صفر، والفرق بيروح
   * (أو ييجي من) المحفظة الشغالة اللي المستخدم اختارها.
   *
   * التحويل عملية سحب عادية، وده مقصود: السحب مش داخل في أي إجمالي مصروف ولا
   * إيراد في التطبيق كله (اتفحص: التقارير بفترتيها، الميزانيات، مصروف الشهر
   * في الرئيسية، شخبطة، وإجماليات الأرشيف — كلهم بيفلتروا على النوع صراحةً).
   * يعني التسوية بتصحّح الأرصدة من غير ما تلوّث ولا تقرير.
   */
  function stageSettlements(batch: Pick<WriteBatch, 'set'> | FirestoreTransaction, settlements: Settlement[]) {
    if (!uid) return;
    settlements.forEach(st => {
      const amount = Math.abs(st.delta);
      if (amount === 0) return;
      const ref = doc(collection(db, 'users', uid, 'transactions'));
      // الاتنين ليهم نفس `set` — النوع بس اللي مبيتجمعش من غير cast
      (batch as Pick<WriteBatch, 'set'>).set(ref, {
        type: 'withdraw',
        amount,
        // موجب = المؤرشفة زادت، فالزيادة تخرج منها للمحفظة الشغالة
        walletId: st.delta > 0 ? st.archivedWalletId : st.targetWalletId,
        toWalletId: st.delta > 0 ? st.targetWalletId : st.archivedWalletId,
        date: todayStr(),
        note: settlementNote(st.archivedWalletName),
        isSettlement: true,
        archivedWalletId: st.archivedWalletId,
        createdAt: new Date().toISOString(),
      });
    });
  }

  /**
   * الحذف + تعديل السجل المرتبط + تسوية المحافظ المؤرشفة، كلهم في دفعة واحدة.
   * لو أي حتة فشلت، مفيش أي حاجة اتكتبت.
   */
  async function deleteTransaction(id: string, settlements: Settlement[] = []) {
    if (!uid) return;
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'transactions', id));
    stageReconcile(batch, id);
    stageSettlements(batch, settlements);
    track(batch.commit());
  }

  // بتقول للمستخدم قبل التأكيد إيه اللي هيحصل للسجل المرتبط بالعملية دي
  function transactionLinkWarning(id: string): string | null {
    // الدين: الجملة + سطر عدد الأقساط بنفس حساب الكتابة (`debtLinkWarning`، D3)
    for (const d of debts) {
      const w = debtLinkWarning(d, id);
      if (w) return w;
    }
    for (const sub of subscriptions) {
      const entry = (sub.history || []).find(h => h.transactionId === id);
      if (entry?.periodKey) {
        return `دي دفعة اشتراك "${sub.name}" عن ${chargeDateLabel(entry.periodKey, todayStr())} — لو مسحتها هترجع تسألك "اتخصم؟" في الرئيسية، ومش هتتسجل لوحدها تاني. لو المبلغ بس غلط، عدّلها بدل ما تمسحها.`;
      }
      if (entry) {
        return `دي دفعة اشتراك "${sub.name}" — هتتشال من سجل الاشتراك وموعد الاستحقاق هيترجع.`;
      }
    }
    for (const g of gamiyas) {
      if ((g.months || []).some(m => m.transactionId === id)) {
        return `دي عملية شهر في جمعية "${g.name}" — الشهر هيرجع "لسه ما اتسددش" وهيسألك في الرئيسية، ومش هيتسجل لوحده تاني. لو المبلغ بس غلط، عدّلها بدل ما تمسحها.`;
      }
    }
    // عكس الجمعية والاشتراك عن قصد: الفترة **مبترجعش** — لو رجعت، التسجيل
    // التلقائي كان هيسجلها تاني. فالمستخدم لازم يعرف ده قبل ما يمسح
    for (const inc of incomes) {
      const key = Object.keys(inc.closed || {}).find(k => inc.closed![k].txId === id);
      if (key) {
        return `دي من الدخل الثابت "${inc.name}" عن ${incomePeriodLabel(inc, key, todayStr())} — لو مسحتها مش هتتسجل تاني. لو المبلغ بس غلط، عدّلها بدل ما تمسحها.`;
      }
    }
    return null;
  }
  async function setBudget(categoryId: string, limit: number) {
    if (!uid) return;
    track(setDoc(doc(db, 'users', uid, 'budgets', categoryId), { limit }), 'سقف الميزانية');
  }
  async function setMonthlyIncome(month: string, income: number) {
    if (!uid) return;
    track(setDoc(doc(db, 'users', uid, 'shakhbata_income', month), { income }), 'دخل الشهر');
  }
  async function setShakhbataPercents(p: ShakhbataPercents) {
    if (!uid) return;
    track(setDoc(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), p), 'نسب توزيع الدخل');
  }

  /**
   * فرق تقريب متخزّن واتجاهل (بتاع قسط تاني من نسخة قديمة، أو بايظ) — العدد
   * بيرجع للقاعدة القديمة وده آمن، بس منسيبوش ساكت. المعرّف بس (sentryScrub).
   */
  // مرة لكل دين في الجلسة: الفرق المتجاهَل مبيتصلحش لوحده، و`runTransaction`
  // بتعيد الـcallback لما تتصادم — من غيرها نفس السطر كان هيتكرر مع كل دفعة
  const ignoredResidueNoted = useRef(new Set<string>());
  function noteOnce(key: string, message: string, debtId: string) {
    if (ignoredResidueNoted.current.has(key)) return;
    ignoredResidueNoted.current.add(key);
    console.warn(message, debtId);
  }
  /**
   * العدد الجديد لو ينفع يتكتب ومختلف — غير كده `undefined`. عدد مش صالح (NaN، أو
   * أكبر من اللي بيتخزّن بدقة) مبيتكتبش، والعدد القديم بيفضل، وبنسجّل المعرّف مرة
   * (silent-failure-hunter الجولة 3) بدل ما يتخطى ساكت.
   */
  function countToWrite(next: number | null, current: number | undefined, debtId: string): number | undefined {
    if (next === null) return undefined;
    if (!storableCount(next)) {
      noteOnce(`count:${debtId}`, '[debt] installment count not storable, old count kept', debtId);
      return undefined;
    }
    return next !== current ? next : undefined;
  }

  function noteIgnoredResidue(debt: Debt) {
    if (installmentResidueIgnored(debt)) noteOnce(`ignored:${debt.id}`, '[debt] installmentResidue ignored, old count rule used', debt.id);
    // دين قديم (عدد من غير قسط متخزّن) والتثبيت مش ممكن (بيانات بايظة) ← القسط بيفضل
    // يتحرك مع العدد؛ منسيبوش ساكت (silent-failure-hunter)
    if (debt.isInstallment && typeof debt.installmentAmount !== 'number' && debt.installmentCount
      && pinInstallmentAmount(debt) === null) {
      noteOnce(`pin:${debt.id}`, '[debt] legacy installment could not be pinned, old rule kept', debt.id);
    }
  }

  /**
   * الفرق بعد زيادة أو مسحها — للـpatch وللعدّ. فرق معروف والحسبة فشلت (مبلغ مش
   * رقم) ← بيتشال صريح (القاعدة القديمة) مع سطر بالمعرّف، بدل ما يفضل فرق قديم
   * بيتعدّ بيه (type-design-analyzer + silent-failure-hunter). مفيش فرق معروف ←
   * مفيش حاجة تتكتب (مبنخمّنش فرق لدين قديم).
   */
  function residueAfterIncreaseChange(
    d: Debt, delta: number, increasesAfter: Debt['increases'], mode?: LeftoverMode,
  ): { patch: unknown; forCount: Debt['installmentResidue'] } | null {
    if (!installmentResidueKnown(d)) return null;
    // البصمة (D2) من نفس قايمة الزيادات اللي هتتكتب في الـpatch، واختيار الباقي (D1)
    // من نفس الدالة اللي بتبني السؤال (`residueForIncrease`)
    const folded = residueForIncrease(d, delta, increasesAfter, mode);
    if (folded) return { patch: folded, forCount: folded };
    noteOnce(`fold:${d.id}`, '[debt] installmentResidue fold failed, cleared', d.id);
    return { patch: deleteField(), forCount: undefined };
  }

  async function addDebt(data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
    dueDate?: string; reminderDaysBefore?: number;
  }) {
    if (!uid) return;
    // مبلغ الدين بالقرش ولازم رقم حقيقي (2026-09-30): "1e999" كان بيعدّي من المودال
    // ويتكتب دين وعملية Infinity. الرفض بيوصل المودال كخطأ ("حصل خطأ، جرب تاني")
    const total = toMoneyAmount(data.totalAmount);
    if (total === null) throw new Error('invalid debt amount');
    data = { ...data, totalAmount: total };
    // وعدد الأقساط زي أي كتابة عدد (`storableCount`) وخطته ممكنة — **قبل** العملية
    // المالية، وإلا كانت هتفضل عملية يتيمة في المحفظة (money-reviewer 2026-09-30)
    const plan = data.isInstallment ? planInstallments(total, data.installmentCount ?? NaN) : null;
    if (data.isInstallment && (!storableCount(data.installmentCount) || !plan)) {
      throw new Error('invalid installment plan');
    }
    let initialTransactionId: string | undefined;
    if (data.walletId) {
      const type = data.direction === 'owed_to_me' ? 'expense' : 'income';
      initialTransactionId = await addTransaction({
        type, amount: data.totalAmount, walletId: data.walletId, date: data.date,
        note: `${data.direction === 'owed_to_me' ? 'قرض لـ' : 'استلاف من'} ${data.personName}`,
      });
    }
    /**
     * قيمة القسط بتتحسب مرة واحدة هنا وبتتخزّن. لو سبناها تتحسب كل مرة
     * (`الإجمالي ÷ العدد`) كانت هترقص مع كل تعديل للعدد — والمستخدم مستنّي
     * القسط يفضل ثابت والعدد هو اللي يتحرّك.
     */
    // **مقرّبة للقرش**: المودال بيقترح الرقم ده بالظبط، فلو خزّناه بكسر
    // لا نهائي (1083.333...) اللي بيدفع الاقتراح كان بيطلعله "دفعت 1,083.33
    // بدل 1,083.33، الأقساط بقت 7" — رقمين متطابقين وسط جملة بتقول إنهم
    // مختلفين. اللي بيتخزّن هو اللي بيتعرض.
    // ومعاها فرق التقريب (2026-09-30) — القسط الأخير بيشيله، فـ1000 على 12
    // بيخلص في 12 قسط مش 13
    const installmentAmount = plan?.value;
    // دين جديد مالوش زيادات ← البصمة 0 (D2)
    const installmentResidue = plan ? stampResidue({ amount: plan.residue, forInstallment: plan.value, over: plan.over }, []) ?? undefined : undefined;
    const clean = Object.fromEntries(Object.entries({
      direction: data.direction, personName: data.personName, personPhone: data.personPhone, personContactId: data.personContactId, totalAmount: data.totalAmount, date: data.date,
      isInstallment: data.isInstallment, installmentCount: data.installmentCount, installmentAmount, installmentResidue, note: data.note,
      initialWalletId: data.walletId, initialTransactionId,
      dueDate: data.dueDate, reminderDaysBefore: data.reminderDaysBefore,
    }).filter(([, v]) => v !== undefined));
    addDocNoWait('debts', { ...clean, payments: [], increases: [], createdAt: new Date().toISOString() }, namedLabel('الدين', data.personName));
  }
  /**
   * تعديل بيانات الشخص أو الملاحظة على دين موجود.
   *
   * الحقول اللي بتوصل فاضية بتتشال من السجل بـ deleteField بدل ما تتحفظ
   * كنص فاضي — عشان `personPhone` الفاضي ميعملش سطر رقم فاضي على الكارت،
   * و`personContactId` الفاضي ميخليش اسم الشخص لينك بيفتح كارت مش موجود.
   */
  async function updateDebt(id: string, data: DebtMetadata) {
    if (!uid) return;
    const patch: Record<string, unknown> = {};
    (Object.keys(data) as (keyof DebtMetadata)[]).forEach(key => {
      const value = data[key];
      if (value === undefined) return;
      // التذكير رقم مش نص: null معناها شيله
      if (key === 'reminderDaysBefore') {
        patch.reminderDaysBefore = value === null ? deleteField() : value;
        return;
      }
      const trimmed = String(value).trim();
      // الاسم لازم يفضل موجود — قواعد فايرستور بترفض دين من غير personName
      if (key === 'personName') {
        if (trimmed) patch.personName = trimmed;
        return;
      }
      patch[key] = trimmed || deleteField();
    });
    if (Object.keys(patch).length === 0) return;
    track(updateDoc(doc(db, 'users', uid, 'debts', id), patch), namedLabel('تعديل الدين', data.personName?.trim() || debts.find(d => d.id === id)?.personName));
  }

  async function deleteDebt(id: string): Promise<CascadeDeleteResult> {
    if (!uid) return { outcome: 'done' };
    const debt = debts.find(d => d.id === id);
    return deleteWithTransactions('debt', debt?.personName ?? '', doc(db, 'users', uid, 'debts', id),
      debtTransactionIds(debt), namedLabel('حذف الدين', debt?.personName));
  }
  /**
   * **دفعة الدين بقت عملية ذرية** — قبل كده كانت بتقرا `debt.payments` من حالة
   * الرياكت وتكتب المصفوفة كلها تاني، فدفعتين في نفس الوقت (جهازين، أو دوستين
   * قبل ما الأولى ترجع) كانوا الاتنين بيشوفوا نفس المصفوفة القديمة والتانية
   * بتمسح الأولى — فلوس اتدفعت واختفت من الكشف. دلوقتي المصفوفة بتتقري من
   * السيرفر **جوه** العملية الذرية، فالتانية بتلاقي الأولى وبتزوّد عليها.
   *
   * والعملية المالية نفسها بقت جوه نفس الذرة: العملية والدفعة بيتكتبوا مع بعض
   * أو مفيش — بدل ما العملية تتكتب وتحديث الدين يضيع فيفضل عندنا خصم من
   * المحفظة مش مقابله أي دفعة في الكشف.
   *
   * **وده مش خرق لقاعدة "الكتابة متستناش تأكيد السيرفر"** — ده نفس الاستثناء
   * المكتوب في القاعدة نفسها: أي حاجة **بتقرا من السيرفر** بتستنى بطبيعتها.
   * وعشان الانتظار ميبقاش مفتوح: بنرفض على طول لو مفيش اتصال، وبنستنى اللي
   * لسه بيرفع بسقف زمني، وبنرجّع نتيجة قاطعة تتعرض من `PAY_OUTCOME_ALERT_DEBT`.
   */
  async function addDebtPayment(
    debtId: string, amount: number, walletId: string, date: string, categoryId?: string,
  ): Promise<DebtPayResult> {
    if (!uid) return { outcome: 'done' };
    // بالقرش (money-reviewer 2026-09-30): 0.006 من الخانة كان بيتسجل كده، وخطة الأقساط
    // والفرق شغالين بالقروش الصحيحة فكان بيبعد الخطة عن الإجمالي. اللي بيتعرض هو
    // اللي بيتسجل
    const money = toMoneyAmount(amount);
    if (money === null) {
      // المودال بيرفضه قبل كده برسالته؛ نادي تاني هيشوف "ما اتسجلش"، فالسبب هنا (المعرّف بس)
      console.warn('[debt] payment amount refused (not a valid money amount)', debtId);
      return { outcome: 'failed' };
    }
    amount = money;
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    // الجملة بتتحسب جوه العملية الذرية (على الدين اللي اتقرا من السيرفر) وبتتقري
    // من بره بعد ما تنجح. الحامل ده مش ترف: الـcallback ممكن تتعاد لما العملية
    // تتصادم، والقيمة اللي تهمنا هي بتاعة اللفة اللي نجحت
    const result: { note: string | null; settledNow: boolean } = { note: null, settledNow: false };
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = debtFromDoc<Debt>(debtId, snap.data(), true);
        // كل القرايات قبل كل الكتابات — شرط من فايربيز نفسها
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', walletId)))) throw new WalletMissingError();

        const type = debt.direction === 'owed_to_me' ? 'income' : 'expense';
        const txData = {
          type, amount, walletId, date,
          categoryId: type === 'expense' ? categoryId : undefined,
          note: `${debt.direction === 'owed_to_me' ? 'استلام دين من' : 'سداد دين لـ'} ${debt.personName}`,
          createdAt: new Date().toISOString(),
        };
        t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));

        const payment: DebtPayment = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount, walletId, transactionId: txRef.id,
          ...(categoryId ? { categoryId } : {}),
        };
        const patch: Record<string, unknown> = { payments: [...(debt.payments || []), payment] };

        /**
         * دفعة بغير قيمة القسط بتغيّر **عدد** الأقساط، مش قيمتها. اللي دفع نص
         * قسط بياخد قسط زيادة، واللي دفع قسطين بيخلّص بدري — وبنقوله بالكلام.
         */
        // دين قديم من غير قيمة متخزّنة: القيمة بالعدد القديم تتثبّت (ومعاها فرق
        // تقريبها) في نفس الكتابة — **قبل** العدّ، فالعدد بيتحسب بالخطة اللي
        // هتتكتب، مش بيتغيّر ساكت في الكتابة اللي بعدها
        noteIgnoredResidue(debt);
        const pin = pinInstallmentAmount(debt);
        const planned: Debt = pin ? { ...debt, ...pin } : debt;
        Object.assign(patch, pin);
        const nextCount = installmentCountAfterPayment(planned, amount);
        const count = countToWrite(nextCount, debt.installmentCount, debtId);
        if (count !== undefined) patch.installmentCount = count;

        /**
         * دين الأقساط بياخد معاد واحد معناه "القسط الجاي"، وبيتقدّم شهر مع كل
         * دفعة — نفس فكرة nextDueDate في الاشتراكات، بدل ما نعمل جدول شهور كامل
         * زي الجمعية.
         *
         * لو الدفعة خلّصت الدين، المعاد بيفضل زي ما هو ومبنمسحوش: التذكيرات
         * أصلاً بتتخطى الديون المسددة، ولو المستخدم مسح الدفعة بعد كده الدين
         * بيرجع مفتوح والتذكير بيرجع معاه.
         */
        if (debt.isInstallment && debt.dueDate) {
          const remainingAfter = debtGrandTotal(debt) - (debtPaid(debt) + amount);
          if (remainingAfter > PIASTRE_EPS) patch.dueDate = addMonths(debt.dueDate, 1);
        }

        t.update(debtRef, patch);

        const remainingBefore = debtRemaining(debt);
        // المقارنة بالمبلغ اللي المودال اقترحه (2026-09-30): على القسط الأخير ده
        // المتبقي كله، فاللي دفع القسط المقرّب بدله بيتقاله إن فيه قسط زيادة
        result.note = installmentChangeMessage(
          amount,
          installmentValue(planned) === null ? amount : suggestedInstallmentPayment(planned),
          debt.installmentCount ?? 0,
          // العدد اللي اتكتب فعلاً — مش NaN في الرسالة (`??` مبيمسكش NaN)
          count ?? debt.installmentCount ?? 0,
          remainingBefore - amount <= PIASTRE_EPS,
        );
        // نفس القيمة اللي فوق، عشان `note` و`settledNow` ميبعدوش عن بعض في تعديل جاي
        result.settledNow = remainingBefore > PIASTRE_EPS && remainingBefore - amount <= PIASTRE_EPS;
      }));
      return { outcome: 'done', note: result.note, settledNow: result.settledNow };
    } catch (e) {
      // ذرية يعني كله أو مفيش — ففشلها معناه إن مفيش أي خصم اتسجل، والشاشة
      // بتقول كده صريح بدل ما المستخدم يفضل يتخمّن
      noteAtomicFailure('دفعة الدين', e);
      return { outcome: e instanceof WalletMissingError ? 'wallet-missing' : 'failed' };
    }
  }
  /**
   * تعديل عدد الأقساط بإيد المستخدم.
   *
   * العدد اللي بيكتبه هو الإجمالي (زي "القسط 3 من 6")، والقسط بيتعاد
   * حسابه من المتبقي على الأقساط الباقية — ده معنى "قسّمهالي على N".
   * بترجّع `false` لو العدد مش مقبول، فالشاشة تقوله ليه.
   *
   * **ودي فضلت كتابة عادية مش عملية ذرية عن قصد:** هي مبتحركش فلوس ومبتلمسش
   * مصفوفة — بتكتب وصف الدين (العدد وقيمة القسط المقترحة) واللي بيتكتب هو
   * اللي المستخدم كتبه بإيده. أسوأ سباق ممكن يحصل إن دفعة تنزل في نفس اللحظة
   * فيطلع العدد قديم بواحد، والرصيد والمتبقي مايتأثروش خالص (محسوبين من
   * الدفعات مش من العدد)، وأول دفعة جاية بتعيد حسابه صح. وخليناها كده عشان
   * تفضل شغالة من غير نت زي أي تعديل تاني على الدين.
   */
  async function setInstallmentCount(debtId: string, nextTotal: number): Promise<boolean> {
    if (!uid) return false;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return false;
    const plan = planInstallmentCountEdit(debt, nextTotal);
    if (!plan) return false;
    // مبصوم بمجموع الزيادات الحالي (D2). المجموع مش رقم ← الفرق بيتشال (القاعدة القديمة)
    // بدل ما يفضل القديم جنب قسط جديد — **بسطر**، زي كل مسار تاني بيشيل الفرق
    // (silent-failure-hunter، الجولة 1 على D2). والفرق القديم المتجاهَل كمان بيتسجّل
    noteIgnoredResidue(debt);
    const stamped = stampResidue({ amount: plan.residue, forInstallment: plan.value, over: plan.over }, debt.increases);
    if (!stamped) noteOnce(`fold:${debtId}`, '[debt] installmentResidue fold failed, cleared', debtId);
    track(
      updateDoc(doc(db, 'users', uid, 'debts', debtId), {
        installmentCount: plan.count,
        installmentAmount: plan.value,
        // في نفس الكتابة، ومحسوب على المتبقي اللي اتقسّم دلوقتي (2026-09-30)
        installmentResidue: stamped ?? deleteField(),
      }),
      namedLabel('عدد أقساط الدين', debt.personName),
    );
    return true;
  }

  /**
   * حذف الدفعة بقى ذري زي إضافتها، ولنفس السببين: المصفوفة بتتقري من السيرفر
   * (فحذف ودفعة في نفس الوقت مبيمسحوش بعض)، والعملية المالية بتتمسح جوه نفس
   * الذرة بدل ما تتمسح في كتابة منفصلة ممكن تنجح والتانية لأ.
   *
   * بتتنادى من علامة المسح جنب كل دفعة في تاريخ الدين (`debts.tsx`). الشاشة
   * بتمنعها لو المحفظة المربوطة مؤرشفة (`debtEntryArchivedWalletBlock`) —
   * المسح هنا مبيعملش تسوية، فكان هيسيب رصيد المؤرشفة مش صفر.
   */
  async function deleteDebtPayment(debtId: string, paymentId: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    if (!serverReachableRef.current) return 'no-connection';
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = debtFromDoc<Debt>(debtId, snap.data(), true);
        const payment = (debt.payments || []).find(p => p.id === paymentId);
        // اتمسحت قبل كده (من جهاز تاني، أو دوسة اتكررت) — مفيش حاجة تتعمل،
        // والنتيجة "تمام" لأن اللي المستخدم عايزه حاصل فعلاً
        if (!payment) return;
        if (payment.transactionId && payment.walletId
          && await walletArchived(t, doc(db, 'users', uid!, 'wallets', payment.walletId))) {
          throw new WalletArchivedError();
        }
        const payments = (debt.payments || []).filter(p => p.id !== paymentId);
        // **العدد لازم يترجع معاها.** من غير ده، دفعة غيّرت العدد من 6 لـ7 وبعدين
        // اتمسحت كانت بتسيب العدد 7 للأبد — فالكارت يقول "القسط 1 من 7" لدين
        // حسابه 6.
        noteIgnoredResidue(debt);
        const pin = pinInstallmentAmount(debt);
        const patch: Record<string, unknown> = { payments, ...pin };
        const recount = installmentCountFor({ ...debt, ...pin, payments });
        const count = countToWrite(recount, debt.installmentCount, debtId);
        if (count !== undefined) patch.installmentCount = count;
        if (payment.transactionId) t.delete(doc(db, 'users', uid!, 'transactions', payment.transactionId));
        t.update(debtRef, patch);
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('حذف دفعة الدين', e);
      return e instanceof WalletArchivedError ? 'wallet-missing' : 'failed';
    }
  }
  /**
   * زيادة الدين — ذرية لنفس أسباب الدفعة بالظبط (شوف `addDebtPayment` فوق)،
   * وبترجّع نفس شكل نتيجتها: `note` لو عدد الأقساط اتغيّر، والشاشة بتقوله
   * بنفس الطريقة (2026-09-29).
   */
  async function addDebtIncrease(
    debtId: string, amount: number, date: string, walletId?: string,
    leftover?: LeftoverSeen,
  ): Promise<DebtIncreaseResult> {
    if (!uid) return { outcome: 'done' };
    // مبلغ مش رقم حقيقي (Infinity/NaN) كان هيتكتب زيادة وعدد أقساط Infinity —
    // القواعد مبتفحصش القيمة، فالحارس هنا (قاعدة 6)
    // بالقرش زي الدفعة، **والفحص بعد التقريب** (`toMoneyAmount`): 1e307 كان بيعدّي
    // `isFinite` وبعدين `roundMoney` تطلعه Infinity ويتكتب
    const money = toMoneyAmount(amount);
    if (money === null) {
      console.warn('[debt] increase amount refused (not a valid money amount)', debtId);
      return { outcome: 'failed' };
    }
    amount = money;
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    // نفس حامل `addDebtPayment`: الـcallback ممكن تتعاد، والجملة بتاعة اللفة اللي نجحت
    const result: { note: string | null; dueNote: string | null } = { note: null, dueNote: null };
    try {
      await countPending(runTransaction(db, async (t) => {
        result.note = null;
        result.dueNote = null;
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = debtFromDoc<Debt>(debtId, snap.data(), true);
        // الزيادة ممكن تكون من غير محفظة (تسجيل على الورق)، وساعتها مفيش عملية
        // مالية أصلاً ومفيش محفظة تتفحص
        if (walletId && !(await walletUsable(t, doc(db, 'users', uid!, 'wallets', walletId)))) {
          throw new WalletMissingError();
        }
        // D1 (قرار مؤمن): السؤال بيتحسب تاني من **السيرفر**؛ لو المستخدم شاف باقي غير اللي
        // هنا (أو ما اتسألش وفيه سؤال، أو العكس) ← مفيش كتابة خالص ويتسأل تاني — مش تطبيق
        // اختيار على أرقام ما شافهاش، ومش افتراضي. قبل أي `t.set`/`t.update`
        const serverChoice = increaseLeftoverChoice({ ...debt, ...pinInstallmentAmount(debt) }, amount);
        if (!sameLeftoverSeen(serverChoice, leftover)) throw new LeftoverChangedError();

        let transactionId: string | undefined;
        if (walletId) {
          const type = debt.direction === 'owed_to_me' ? 'expense' : 'income';
          const txData = {
            type, amount, walletId, date,
            note: `${debt.direction === 'owed_to_me' ? 'زيادة قرض لـ' : 'زيادة استلاف من'} ${debt.personName}`,
            createdAt: new Date().toISOString(),
          };
          t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));
          transactionId = txRef.id;
        }
        // دين أقساط كان اتسدد والزيادة فتحته ← معاد القسط الجاي يتقدّم بدل ما
        // التذكير يرجع على يوم فات (بيتحسب من الدين قبل الزيادة). القديم بيتخزّن في الزيادة
        // عشان مسحها يرجّعه، والرسالة بتقول الجديد (بند 12، قرار مؤمن 2026-11-05)
        const nextDue = reopenedDueDate(debt, amount, date, todayStr());
        const entry: DebtEntry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount,
          ...(walletId ? { walletId, transactionId } : {}),
          ...(nextDue && debt.dueDate ? { reopenedFrom: debt.dueDate, reopenedTo: nextDue } : {}),
        };
        const increases = [...(debt.increases || []), entry];
        // **العدد لازم يتحسب تاني** (2026-09-29): المتبقي بيشمل الزيادات، فدين
        // 6000 على 6 بعد زيادة 2000 كان بيفضل "القسط 1 من 6" لحد أول دفعة. نفس
        // حساب `deleteDebtIncrease` في الاتجاه التاني، وعلى الدين اللي اتقرا جوه
        // الذرة — والقسط نفسه (`installmentAmount`) مبيتغيّرش
        noteIgnoredResidue(debt);
        const pin = pinInstallmentAmount(debt);
        const patch: Record<string, unknown> = { increases, ...pin };
        // الزيادة بتدخل الخطة (2026-09-30): لو اللي فاضل تقريب بس القسط الأخير بيشيله
        // (1000/12 + 500 = 18 مش 19 بقسط 0.06)، ولو كسر حقيقي بيفضل قسط أصغر
        const residue = residueAfterIncreaseChange({ ...debt, ...pin }, amount, increases, leftover?.mode);
        if (residue) patch.installmentResidue = residue.patch;
        if (nextDue) {
          patch.dueDate = nextDue;
          result.dueNote = reopenedDueMessage(nextDue);
        }
        else if (debt.isInstallment && debt.dueDate && !isDateStr(debt.dueDate)) {
          // المعاد المتخزّن بايظ ← سايبينه زي ما هو بدل ما نخترع واحد. المعرّف بس (sentryScrub)
          console.warn('[debt] stored dueDate is not YYYY-MM-DD, left as is', debtId);
        }
        const recount = installmentCountFor({ ...debt, ...pin, ...(residue ? { installmentResidue: residue.forCount } : {}), increases });
        // مستند قديم بقيمة مش رقم كان هيدّي NaN — العدد القديم أحسن من NaN مكتوب
        // عدد مش صالح (NaN، أو أكبر من اللي بيتخزّن بدقة) ← العدد القديم بيفضل وسطر بالمعرّف
        const count = countToWrite(recount, debt.installmentCount, debtId);
        if (count !== undefined) {
          patch.installmentCount = count;
          // null عن قصد لو العدد القديم مش معروف (دين قديم من غير عدد): العدد الصح
          // بيتكتب، بس مفيش "بدل كام" صادقة تتقال — "بدل 0" كانت هتبقى كدب
          result.note = installmentIncreaseMessage(debt.installmentCount, count);
        }
        t.update(debtRef, patch);
      }));
      return { outcome: 'done', note: result.note, dueNote: result.dueNote };
    } catch (e) {
      // مش فشل: الدين اتغيّر من جهاز تاني والمستخدم هيتسأل تاني — مش Sentry
      if (e instanceof LeftoverChangedError) {
        // المعرّف بس (sentryScrub): لو الرفض اتكرر عند حد يبقى فيه أثر يفسّره
        console.warn('[debt] increase leftover changed since shown, nothing written', debtId);
        return { outcome: 'leftover-changed' };
      }
      noteAtomicFailure('زيادة الدين', e);
      return { outcome: e instanceof WalletMissingError ? 'wallet-missing' : 'failed' };
    }
  }
  /**
   * حذف الزيادة — ذري زي حذف الدفعة بالظبط، وبيتنادى من نفس المكان وبنفس
   * منع المحفظة المؤرشفة (شوف الملحوظة اللي فوق `deleteDebtPayment`)
   */
  async function deleteDebtIncrease(debtId: string, entryId: string, out?: DebtIncreaseDeleteOut): Promise<PayOutcome> {
    if (out) { out.dueRestored = undefined; out.entryGone = false; }
    if (!uid) return 'done';
    if (!serverReachableRef.current) return 'no-connection';
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = debtFromDoc<Debt>(debtId, snap.data(), true);
        const entry = (debt.increases || []).find(e => e.id === entryId);
        // اتمسحت من جهاز تاني: مفيش وعد يتقارن ("المعاد ما رجعش" هنا كانت هتبقى كدب — silent-failure-hunter جولة 2)
        if (out) out.entryGone = !entry;
        if (!entry) return;
        if (entry.transactionId && entry.walletId
          && await walletArchived(t, doc(db, 'users', uid!, 'wallets', entry.walletId))) {
          throw new WalletArchivedError();
        }
        const increases = (debt.increases || []).filter(e => e.id !== entryId);
        noteIgnoredResidue(debt);
        const pin = pinInstallmentAmount(debt);
        const patch: Record<string, unknown> = { increases, ...pin };
        // المسح بيطرح الزيادة من الخطة — نفس حالة الدين لو الزيادة ما اتعملتش
        const residue = residueAfterIncreaseChange({ ...debt, ...pin }, -Number(entry.amount), increases);
        if (residue) patch.installmentResidue = residue.patch;
        const recount = installmentCountFor({ ...debt, ...pin, ...(residue ? { installmentResidue: residue.forCount } : {}), increases });
        const count = countToWrite(recount, debt.installmentCount, debtId);
        if (count !== undefined) patch.installmentCount = count;
        // الزيادة دي هي اللي فتحت الدين وقدّمت المعاد ← بيرجع القديم (بند 12)، من الدين اللي اتقرا جوه الذرة
        const restore = dueDateAfterIncreaseRemoval(debt, [entry], increases);
        if (restore) patch.dueDate = restore;
        // الذرة ممكن تتعاد: آخر لفة هي اللي بتتكتب. التأكيد اتحسب من حالة الرياكت، فالشاشة بتقارن (silent-failure-hunter + money-reviewer)
        if (out) out.dueRestored = restore;
        if (entry.transactionId) t.delete(doc(db, 'users', uid!, 'transactions', entry.transactionId));
        t.update(debtRef, patch);
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('حذف زيادة الدين', e);
      return e instanceof WalletArchivedError ? 'wallet-missing' : 'failed';
    }
  }

  async function addSubscription(data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }): Promise<EntrySaveResult> {
    // نفس فحص الفورم (بند 15) — الشاشة اللي تنسى بتترفض برضه، قبل أي كتابة
    const invalid = subscriptionEntryProblem(data);
    if (invalid) return invalid;
    if (!uid) return { outcome: 'done' };
    const { chargeMode, ...rest } = data;
    rest.amount = storableAmount(rest.amount)!;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    addDocNoWait('subscriptions', {
      ...clean, ...chargeModePatch(chargeMode ?? 'confirm', undefined, todayStr()),
      active: true, history: [], closed: {}, createdAt: new Date().toISOString(),
    }, namedLabel('الاشتراك', data.name));
    return { outcome: 'done' };
  }
  async function updateSubscription(id: string, data: Partial<Subscription>): Promise<EntrySaveResult> {
    // "مخصص" من غير `customDays` في التعديل ← بيتفحص على المتخزّن (tdd-guide): الشرط
    // إن المخصص ليه أيام صحيحة، مش إن كل تعديل يبعتها تاني
    const stored = subscriptions.find(s => s.id === id);
    const invalid = subscriptionEntryProblem(
      data.frequency === 'custom' && data.customDays === undefined ? { ...data, customDays: stored?.customDays } : data,
    );
    if (invalid) return invalid;
    if (!uid) return { outcome: 'done' };
    // لازم نشيل قيم undefined — Firestore بترفضها وبترمي خطأ يمنع الحفظ كله
    const current = subscriptions.find(s => s.id === id);
    const { chargeMode, chargeAutoSince: _ignored, ...rest } = data;
    if (rest.amount !== undefined) rest.amount = storableAmount(rest.amount)!;
    const clean: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    // "تلقائي" من النهاردة بس — مش من أول ما الاشتراك اتعمل (`chargeModePatch`)
    if (chargeMode) Object.assign(clean, chargeModePatch(chargeMode, current, todayStr()));
    track(updateDoc(doc(db, 'users', uid, 'subscriptions', id), clean), namedLabel('تعديل الاشتراك', current?.name));
    return { outcome: 'done' };
  }
  /**
   * وقّف الاشتراك / رجّعه (قرار مؤمن 2026-11-02). الإيقاف `active:false` بس: مفيش عملية بتتمسح
   * ولا فترة بتتقفل، والتاريخ زي ما هو — المسح لسه الطريق الوحيد اللي بيمسح التاريخ.
   * الكروت والتلقائي والتذكيرات بيقروا `active` (`subscriptionOpenCharges`، `scheduleAllReminders`).
   * الرجوع بيحرّك المعاد لأول معاد من النهاردة (`subscriptionResumeDate`): المرات اللي فاتت وهو
   * واقف مبتتسجلش.
   *
   * **الإيقاف** كتابة عادية (`track`) زي `setIncomeStatus` — بيشتغل من غير نت ومبيحركش فلوس.
   * **الرجوع ذري ومن السيرفر** (silent-failure-hunter، جولة 1): المعاد بيتحسب من المستند اللي على
   * السيرفر مش من نسخة قديمة (جهاز تاني ممكن يكون عدّل المعاد)، والمحفظة بتتفحص هناك كمان —
   * فحص الحالة المحلية كان بيقول "المحفظة اتمسحت" غلط والمحافظ لسه بتحمّل
   */
  async function setSubscriptionActive(id: string, active: boolean): Promise<PayOutcome | 'missing'> {
    if (!uid) return 'done';
    const sub = subscriptions.find(s => s.id === id);
    const ref = doc(db, 'users', uid, 'subscriptions', id);
    if (!active) {
      track(updateDoc(ref, { active: false }), namedLabel('إيقاف الاشتراك', sub?.name));
      return 'done';
    }
    if (!serverReachableRef.current) return 'no-connection';
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(ref);
        // اتمسح من جهاز تاني ← مش "رجّعنا" (silent-failure-hunter، جولة 2)
        if (!snap.exists()) throw new ChargeMissingError();
        const server = subscriptionFromDoc<Subscription>(id, snap.data(), true);
        // رجع من جهاز تاني خلاص ← مفيش حاجة تتكتب (ومنحرّكش معاده)
        if (server.active !== false) return;
        // المحفظة اتأرشفت أو اتمسحت وهو واقف (الأرشفة مبتطلبش نقل الواقف)
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', server.walletId)))) throw new WalletMissingError();
        t.update(ref, { active: true, nextDueDate: subscriptionResumeDate(server, todayStr()) });
      }));
      return 'done';
    } catch (e) {
      if (e instanceof WalletMissingError) return 'wallet-missing';
      if (e instanceof ChargeMissingError) return 'missing';
      noteAtomicFailure('رجوع الاشتراك', e);
      return 'failed';
    }
  }
  async function deleteSubscription(id: string): Promise<CascadeDeleteResult> {
    if (!uid) return { outcome: 'done' };
    const sub = subscriptions.find(s => s.id === id);
    return deleteWithTransactions('subscription', sub?.name ?? '', doc(db, 'users', uid, 'subscriptions', id),
      subscriptionTransactionIds(sub), namedLabel('حذف الاشتراك', sub?.name));
  }
  /**
   * بيتعمل جوه runTransaction عشان القراية والكتابة يبقوا خطوة واحدة ذرية.
   * قبل كده كان بيقرا الاشتراك من حالة الرياكت، فنداءين في نفس الوقت كانوا
   * الاتنين بيشوفوا نفس الحالة القديمة وبيسجلوا دفعتين — يعني خصم مضاعف.
   * بنقرا من السيرفر جوه العملية الذرية، فالنداء التاني بيلاقي الدفعة اتسجلت
   * ويقف. علامة التكرار هي نفس التاريخ ونفس المبلغ (منقدرش نضيف حقل جديد من
   * غير تعديل قواعد Firestore في الكونسول).
   */
  async function markSubscriptionPaid(id: string, date: string, seenAmount?: number): Promise<PayOutcome | 'already-paid-today' | 'stopped' | 'amount-changed'> {
    if (deletingRef.current) return 'failed';
    if (!uid) return 'done';
    // من غير اتصال العملية دي مش هتعرف تشتغل أصلاً (بتقرا من السيرفر)، فبنرفض
    // على طول برسالة واضحة بدل ما المستخدم يستنى قدام زرار مقفول ويطلعله خطأ بعدين
    if (!serverReachableRef.current) return 'no-connection';
    const subRef = doc(db, 'users', uid, 'subscriptions', id);
    // بما إننا مش بنستنى تأكيد السيرفر على الكتابات العادية، ممكن المستخدم يعمل
    // اشتراك ويدوس "سدّد" قبل ما الاشتراك نفسه يوصل. والعملية الذرية بتقرا من
    // السيرفر، فكانت هتلاقيه مش موجود وتخرج من غير ما تعمل حاجة — الزرار يشتغل
    // ومفيش سداد يتسجل. فبنستنى الأول اللي عندنا يرفع
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    const today = todayStr();
    let paidToday = false;
    try {
      await countPending(runTransaction(db, async (t) => {
        paidToday = false;
        const snap = await t.get(subRef);
        if (!snap.exists()) return;
        const sub = subscriptionFromDoc<Subscription>(id, snap.data(), true);
        // واقف (ممكن من جهاز تاني والزرار لسه باين هنا) ← مفيش خصم، ونتيجة صريحة
        if (sub.active === false) throw new SubscriptionStoppedError();
        if (seenAmountDiffers(seenAmount, sub.amount)) throw amountChanged(seenAmount, sub.amount);
        const history = sub.history || [];
        // دوستين "سدّد" في نفس اليوم ← دفعة واحدة (عقد قديم — duplication.emulator).
        // بس **مش ساكتة**: الشاشة بتقول إنها اتسجلت النهاردة خلاص، وإن الفترة
        // المتأخرة التانية (لو فيه) في كارت "اتخصم؟" في الرئيسية
        if (history.some(h => h.date === date && h.amount === sub.amount)) { paidToday = true; return; }

        // "سدّد" بيقفل **فترة**: الأقدم المفتوحة (فيها اللي رجعت تسأل)، ولو
        // مفيش — اللي جاية. نفس مفتاح التلقائي ونفس معرّف العملية، فالتلقائي
        // على جهاز تاني بيلاقيها مقفولة ومبيخصمش تاني
        const key = subscriptionManualKey(sub, today);
        const txRef = doc(db, 'users', uid!, 'transactions', subscriptionTxId(id, key));

        // المحفظة بتتقري من جوه العملية الذرية عشان الإجابة تبقى عن الحالة
        // اللي هتتكتب عليها فعلاً، مش عن نسخة في ذاكرة الرياكت ممكن تكون
        // قديمة. كل القرايات لازم تسبق كل الكتابات في العملية الذرية.
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', sub.walletId)))) throw new WalletMissingError();
        const existing = await t.get(txRef);

        const at = new Date().toISOString();
        // موجودة (مقفولة من غير علامة لأي سبب) ← بنقفل الفترة من غير ما نكتب فوقها
        if (!existing.exists()) {
          const txData = {
            type: 'expense' as const, amount: sub.amount, walletId: sub.walletId, date,
            categoryId: sub.categoryId, note: `اشتراك: ${sub.name}`,
            subscriptionId: id, periodKey: key, createdAt: at,
          };
          t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));
        }
        const closed = { ...(sub.closed || {}), [key]: { txId: txRef.id, at } };
        const payment: SubscriptionPayment = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount: sub.amount, transactionId: txRef.id, periodKey: key,
        };
        const nextHistory = history.some(h => h.transactionId === txRef.id) ? history : [...history, payment];
        t.update(subRef, { history: nextHistory, closed, nextDueDate: subscriptionAdvance(sub, closed) });
      }));
      return paidToday ? 'already-paid-today' : 'done';
    } catch (e) {
      if (e instanceof SubscriptionStoppedError) return 'stopped';
      // مش فشل (مش Sentry): الشاشة بتقول إن المبلغ اتغيّر والمستخدم يقرر تاني على الجديد
      if (e instanceof AmountChangedError) { console.warn('[subscription] amount changed since shown, nothing written', id, ...amountsForDevLog(e)); return 'amount-changed'; }
      // العملية الذرية إما تتم كلها أو مفيش — ففشلها معناه إن مفيش أي خصم اتسجل،
      // والشاشة بتقول كده صريح بدل تنبيه الخطأ العام بتاع track
      if (!(e instanceof WalletMissingError)) noteAtomicFailure('تسديد الاشتراك', e);
      return e instanceof WalletMissingError ? 'wallet-missing' : 'failed';
    }
  }

  /**
   * "ما اتخصمش" (اشتراك اتلغى، شهر مجاني). ذري: جهاز تاني ممكن يكون سجّل
   * الفترة دي في نفس اللحظة — لو سبقنا، بنلاقيها مقفولة ومبنكتبش فوق علامته.
   */
  async function skipSubscriptionCharge(id: string, key: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    if (!serverReachableRef.current) return 'no-connection';
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    const subRef = doc(db, 'users', uid, 'subscriptions', id);
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(subRef);
        if (!snap.exists()) return;
        const sub = subscriptionFromDoc<Subscription>(id, snap.data(), true);
        // الحالة الحقيقية (money-reviewer): الواقف بيتخطّى اللي رجعت تسأل بس، مش فترة عادية
        if (!subscriptionOpenCharges(sub, todayStr()).some(o => o.key === key)) return;
        const closed = { ...(sub.closed || {}), [key]: { skipped: true, at: new Date().toISOString() } };
        t.update(subRef, { closed, nextDueDate: subscriptionAdvance(sub, closed) });
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('فوّت فترة اشتراك', e);
      return 'failed';
    }
  }

  /**
   * تسجيل فترات اشتراك أو شهور جمعية (كارت "اتخصم؟"، أو التلقائي) في ذرة
   * واحدة — نفس `recordIncomePeriods` بالظبط. **مفيش خصم مرتين**:
   * 1. الفترات المفتوحة بتتحسب من المستند اللي على السيرفر جوه الذرة — اللي
   *    اتقفل (بـ"سدّد" من الشاشة، أو من جهاز تاني) بيتفوّت.
   * 2. معرّف العملية ثابت، والعملية بتتكتب **بس لو مش موجودة** — ولو موجودة
   *    الفترة بتتقفل عليها من غير ما نكتب فوقها، فتعديل المستخدم مبيضيعش.
   * 3. التلقائي (`auto`) بيسجل بس الفترات اللي `autoOk` — اللي رجعت تسأل
   *    (عمليتها اتمسحت) وشهر الاستلام وأي فترة قبل تفعيل التلقائي بيسألوا.
   */
  async function recordCharges(
    kind: ChargeKind, id: string, entries: { key: string; amount: number }[], opts: { auto?: boolean } = {},
  ): Promise<IncomeRecordResult> {
    if (deletingRef.current) return { outcome: 'failed', recorded: [] };
    if (!uid || entries.length === 0) return { outcome: 'done', recorded: [] };
    if (!serverReachableRef.current) return { outcome: 'no-connection', recorded: [] };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection', recorded: [] };
    const auto = !!opts.auto;
    const ref = doc(db, 'users', uid, kind === 'subscription' ? 'subscriptions' : 'gamiyas', id);
    const today = todayStr();
    let recorded: string[] = [];
    let stopped = false;
    try {
      await countPending(runTransaction(db, async (t) => {
        recorded = [];
        stopped = false;
        const snap = await t.get(ref);
        if (!snap.exists()) throw new ChargeMissingError();
        const data = kind === 'subscription' ? subscriptionFromDoc<Subscription>(id, snap.data(), true) : gamiyaFromDoc<Gamiya>(id, snap.data(), true);
        const open = kind === 'subscription'
          ? subscriptionOpenCharges(data as Subscription, today)
          : gamiyaOpenCharges(data as Gamiya, today);
        const seen = new Set<string>();
        const todo = entries.filter(e => {
          const o = open.find(x => x.key === e.key);
          if (!o || seen.has(e.key) || !(e.amount > 0) || !Number.isFinite(e.amount) || (auto && !o.autoOk)) return false;
          seen.add(e.key);
          return true;
        });
        // واقف وفيه مفتاح مطلوب مش مفتوح **ومش مقفول** — المقفول اتسجل فعلاً، فده "اتسجلت قبل كده" مش "اتوقف"
        stopped = kind === 'subscription' && (data as Subscription).active === false
          && entries.some(e => !open.some(o => o.key === e.key) && !(data as Subscription).closed?.[e.key]);
        if (todo.length === 0) return;
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', data.walletId)))) throw new WalletMissingError();
        const txRefs = todo.map(e => doc(db, 'users', uid!, 'transactions',
          kind === 'subscription' ? subscriptionTxId(id, e.key) : gamiyaTxId(id, e.key)));
        const existing = await Promise.all(txRefs.map(r => t.get(r)));
        const at = new Date().toISOString();

        if (kind === 'subscription') {
          const sub = data as Subscription;
          const closed = { ...(sub.closed || {}) };
          const history = [...(sub.history || [])];
          todo.forEach((e, i) => {
            const txId = txRefs[i].id;
            closed[e.key] = auto ? { txId, auto: true, at } : { txId, at };
            if (!history.some(h => h.transactionId === txId)) {
              history.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
                date: e.key, amount: e.amount, transactionId: txId, periodKey: e.key, ...(auto ? { auto: true } : {}),
              });
            }
            if (existing[i].exists()) return;
            const txData = {
              type: 'expense' as const, amount: e.amount, walletId: sub.walletId, date: e.key,
              categoryId: sub.categoryId, note: `اشتراك: ${sub.name}`,
              subscriptionId: id, periodKey: e.key, createdAt: at, ...(auto ? { autoRecorded: true } : {}),
            };
            t.set(txRefs[i], Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));
            recorded.push(e.key);
          });
          t.update(ref, { closed, history, nextDueDate: subscriptionAdvance(sub, closed) });
          return;
        }

        const g = data as Gamiya;
        const months = (g.months || []).map(m => {
          const i = todo.findIndex(e => e.key === m.id);
          if (i === -1) return m;
          const { reopened: _r, auto: _a, transactionId: _t, ...rest } = m;
          if (!existing[i].exists()) {
            t.set(txRefs[i], {
              type: m.isPayoutMonth ? 'income' : 'expense', amount: todo[i].amount, walletId: g.walletId, date: m.dueDate,
              note: `${m.isPayoutMonth ? 'استلام جمعية' : 'قسط جمعية'}: ${g.name} (شهر ${m.monthIndex})`,
              gamiyaId: id, periodKey: m.id, createdAt: at, ...(auto ? { autoRecorded: true } : {}),
            });
            recorded.push(m.id);
          }
          return { ...rest, status: 'done' as const, transactionId: txRefs[i].id, ...(auto ? { auto: true } : {}) };
        });
        t.update(ref, { months });
      }));
      return { outcome: 'done', recorded, ...(stopped ? { stopped } : {}) };
    } catch (e) {
      // اتمسح من جهاز تاني — مفيش حاجة تتسجل، ومش فشل
      if (e instanceof ChargeMissingError) return { outcome: 'done', recorded: [] };
      noteAtomicFailure(kind === 'subscription' ? 'تسجيل الاشتراك' : 'تسجيل الجمعية', e);
      return { outcome: e instanceof WalletMissingError ? 'wallet-missing' : 'failed', recorded: [] };
    }
  }

  // ── الدخل الثابت ──────────────────────────────────────────────────────

  async function addIncome(draft: IncomeDraft & { mode: IncomeMode }) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries({ ...draft, name: draft.name.trim() }).filter(([, v]) => v !== undefined));
    addDocNoWait('incomes', {
      ...clean, status: 'active', startDate: todayStr(), closed: {}, createdAt: new Date().toISOString(),
    }, namedLabel('الدخل الثابت', draft.name));
  }

  /**
   * لو الجدول اتغيّر لدرجة إن مفاتيح الفترات اتغيّرت (شهري↔أسبوعي أو يوم
   * الأسبوع)، `startDate` بيتنقل لبعد آخر دورة اتقفلت — غير كده الأسابيع اللي
   * اتسجلت كانت هتبان مفتوحة بمفاتيح جديدة وتتسجل مرتين (`incomeRescheduleStart`).
   * والحقل بتاع الجدول التاني بيتشال بدل ما يفضل معلّق في المستند.
   */
  async function updateIncome(id: string, patch: Partial<IncomeDraft & { mode: IncomeMode }>) {
    if (!uid) return;
    const current = incomes.find(i => i.id === id);
    const clean: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (current && incomeScheduleKeysChange(current, patch)) {
      clean.startDate = incomeRescheduleStart(current, todayStr());
    }
    const freq = patch.frequency ?? current?.frequency;
    if (freq === 'weekly') clean.dayOfMonth = deleteField();
    if (freq === 'monthly') clean.weekday = deleteField();
    track(updateDoc(doc(db, 'users', uid, 'incomes', id), clean), namedLabel('تعديل الدخل الثابت', current?.name));
  }

  /**
   * الرجوع من الإيقاف بيبدأ العدّ من النهاردة (`startDate`): الإيقاف معناه
   * "مفيش دخل"، فالفترات اللي وقعت وهو واقف مش بتتلحق بعدين.
   */
  async function setIncomeStatus(id: string, status: IncomeStatus) {
    if (!uid) return;
    const patch = status === 'active' ? { status, startDate: todayStr() } : { status };
    track(updateDoc(doc(db, 'users', uid, 'incomes', id), patch), namedLabel('الدخل الثابت', incomes.find(i => i.id === id)?.name));
  }

  /**
   * "مانزلش" — الفترة بتتقفل من غير عملية. `FieldPath` مش إعادة كتابة
   * `closed` كله: لو جهاز تاني سجّل فترة في نفس اللحظة، الخريطة القديمة
   * اللي عندنا كانت هتمسح علامته، فالتسجيل التلقائي يرجع يسجلها تاني.
   *
   * **سباق معروف ومقبول:** جهاز تاني لسه شايف الفترة مفتوحة ودوس "ما نزلش"
   * بعد ما اتسجلت، فالعلامة بتتحول `{ skipped }` والـtxId بيضيع منها. الفلوس
   * صح (العملية موجودة) والفترة لسه مقفولة؛ اللي بيضيع الربط بس، ومفيش
   * حاجة بتقرا `skipped` دلوقتي. لو حاجة اتبنت عليه، ده لازم يبقى ذري.
   */
  async function skipIncomePeriod(incomeId: string, key: string) {
    if (!uid) return;
    track(
      updateDoc(doc(db, 'users', uid, 'incomes', incomeId), new FieldPath('closed', key), { skipped: true, at: new Date().toISOString() }),
      namedLabel('الدخل الثابت', incomes.find(i => i.id === incomeId)?.name),
    );
  }

  /**
   * مسح دخل **عمره ما سجّل حاجة**. اللي سجّل ولو مرة بيتوقف بس — تاريخه لازم
   * يفضل. ذري لأن جهاز تاني ممكن يكون بيسجل منه في نفس اللحظة: التسجيل
   * بيكتب علامة `closed` في نفس ذرته، فلو سبقنا الذرة دي بتتعاد وتلاقيها.
   * ولأن معرّف العملية ثابت، كل فترة مقفولة بيتقري معرّفها كمان — ده بيغطي
   * سباق `skipIncomePeriod` اللي بيشيل الـtxId من العلامة والعملية موجودة.
   */
  async function deleteIncome(incomeId: string): Promise<IncomeDeleteOutcome> {
    if (!uid) return 'failed';
    const local = incomes.find(i => i.id === incomeId);
    if (local && incomeHasRecords(local, transactions)) return 'has-records';
    if (!serverReachableRef.current) return 'no-connection';
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    const incRef = doc(db, 'users', uid, 'incomes', incomeId);
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(incRef);
        // اتمسح من جهاز تاني — اللي المستخدم طلبه حصل
        if (!snap.exists()) return;
        const closed: Record<string, IncomeClosed> = (snap.data() as any).closed || {};
        if (Object.values(closed).some(c => !!c.txId)) throw new IncomeHasRecordsError();
        const txs = await Promise.all(
          Object.keys(closed).map(k => t.get(doc(db, 'users', uid!, 'transactions', incomeTxId(incomeId, k)))),
        );
        if (txs.some(x => x.exists())) throw new IncomeHasRecordsError();
        t.delete(incRef);
      }));
      return 'done';
    } catch (e) {
      if (e instanceof IncomeHasRecordsError) return 'has-records';
      noteAtomicFailure('مسح الدخل الثابت', e);
      return 'failed';
    }
  }

  /**
   * تسجيل فترة أو أكتر في ذرة واحدة. **مفيش تسجيل مرتين** من تلات جهات:
   * 1. `closed` بتتقري من السيرفر جوه الذرة — الفترة المقفولة بتتفوّت.
   * 2. معرّف العملية ثابت (`incomeTxId`) — ولو موجودة (مقفولة من غير علامة
   *    لأي سبب) بتتقفل من غير ما تتكتب فوقها، فتعديل المستخدم عليها مبيضيعش.
   * 3. نداءين في نفس اللحظة (جهازين، أو فتح التطبيق مرتين): فايرستور بتعيد
   *    الذرة التانية فبتلاقي الأولى قفلت.
   * وكل القرايات قبل كل الكتابات.
   */
  async function recordIncomePeriods(incomeId: string, entries: { key: string; amount: number }[], opts: { auto?: boolean } = {}): Promise<IncomeRecordResult> {
    if (deletingRef.current) return { outcome: 'failed', recorded: [] };
    if (!uid || entries.length === 0) return { outcome: 'done', recorded: [] };
    if (!serverReachableRef.current) return { outcome: 'no-connection', recorded: [] };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection', recorded: [] };
    const incRef = doc(db, 'users', uid, 'incomes', incomeId);
    const today = todayStr();
    let recorded: string[] = [];
    try {
      await countPending(runTransaction(db, async (t) => {
        recorded = [];
        const snap = await t.get(incRef);
        if (!snap.exists()) throw new IncomeMissingError();
        const inc = incomeFromDoc<RecurringIncome>(incomeId, snap.data(), true);
        // اتوقف من جهاز تاني — مفيش حاجة تتسجل، ومش فشل
        if (inc.status !== 'active') return;
        const todo = entries.filter(e => !inc.closed?.[e.key] && e.amount > 0);
        if (todo.length === 0) return;
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', inc.walletId)))) throw new WalletMissingError();
        const txRefs = todo.map(e => doc(db, 'users', uid!, 'transactions', incomeTxId(incomeId, e.key)));
        const existing = await Promise.all(txRefs.map(r => t.get(r)));

        const at = new Date().toISOString();
        const closed = { ...(inc.closed || {}) };
        todo.forEach((e, i) => {
          closed[e.key] = { txId: txRefs[i].id, at };
          if (existing[i].exists()) return;
          t.set(txRefs[i], {
            type: 'income', amount: e.amount, walletId: inc.walletId,
            date: incomeTxDate(inc, e.key, today),
            note: `${inc.name} — ${incomePeriodLabel(inc, e.key, today)}`,
            incomeId, periodKey: e.key, createdAt: at, ...(opts.auto ? { autoRecorded: true } : {}),
          });
          recorded.push(e.key);
        });
        t.update(incRef, { closed });
      }));
      return { outcome: 'done', recorded };
    } catch (e) {
      noteAtomicFailure('تسجيل الدخل الثابت', e);
      return { outcome: e instanceof WalletMissingError ? 'wallet-missing' : 'failed', recorded: [] };
    }
  }

  /**
   * بنستنى اللي كتبناه محليًا يوصل السيرفر قبل أي عملية بتقرا منه، وإلا ممكن
   * تلاقي سجل لسه بيرفع فتفتكره مش موجود.
   * `waitForPendingWrites` **مبيتحلش خالص** وإحنا أوفلاين (اتقاس)، فبنسابقه مع
   * إشارة "الاتصال وقع" ومع سقف زمني — عشان الانتظار يفضل محدود دايمًا.
   * بيرجّع false يعني ما وصلناش السيرفر، ومحصلش أي خصم لأننا مابدأناش أصلاً.
   */
  /**
   * أول تجهيز للحساب: المحافظ (بأرصدتها الافتتاحية) والفئات و`seeded: true`
   * في عملية ذرية واحدة — يا كلهم يتسجلوا يا ولا واحد.
   *
   * **بيستنى السيرفر** (استثناء قاعدة 7 زي أي عملية ذرية): المستخدم لازم يعرف
   * اتحفظ ولا لأ — ده بالظبط اللي كان ناقص في `claimSeeding` القديمة اللي
   * كانت بتبلع فشلها وتسيب الحساب من غير محافظ.
   *
   * مش بنرفض على `serverReachable` زي باقي العمليات الذرية: الحساب الجديد
   * مفيهوش ولا محفظة ولا عملية، والـlistener على مجموعة فاضية مبيبعتش snapshot
   * (CLAUDE.md، "مشاكل معروفة") — فـ`serverReachable` بيفضل false وكان هيرفض
   * على طول. بدل كده سقف وقت، و`runTransaction` نفسها بترفض أوفلاين.
   *
   * `seeded` بيتفحص **جوه** العملية: جهازين بيجهّزوا نفس الحساب مع بعض ←
   * واحد بس يكتب (نفس حماية `claimSeeding`). ولو محاولة سابقة وصلت السيرفر
   * بعد ما السقف خلص، المحاولة الجاية بتلاقيه ← `already-done` مش تكرار.
   */
  async function completeSetup(choice: SetupChoice): Promise<SetupOutcome> {
    if (!uid || deletingRef.current) return 'failed';
    const invalid = validateSetupChoice(choice);
    if (invalid) { console.warn('[setup] اختيارات مش صحيحة وصلت للحفظ', invalid); return 'failed'; }
    const userRef = doc(db, 'users', uid);
    const fingerprint = setupFingerprint(choice);
    const markDone = () => {
      setSetupStatus('done');
      AsyncStorage.setItem(setupDoneKey(uid), '1').catch(() => {});
    };
    const tx = countPending(runTransaction(db, async (t) => {
        const snap = await t.get(userRef);
        // اتجهّز قبل كده: بنفس الاختيارات ولا بغيرها؟ (محاولة قديمة وصلت بعد السقف
        // بأرقام قبل ما المستخدم يعدّلها، أو جهاز تاني)
        if (snap.exists() && snap.data()?.seeded) {
          return snap.data()?.setupChoice === fingerprint ? 'already-done' as const : 'already-done-other' as const;
        }
        choice.wallets.forEach(w => t.set(doc(collection(db, 'users', uid, 'wallets')), {
          name: w.name.trim(), openingBalance: roundMoney(w.openingBalance), lowAlert: 0,
        }));
        choice.categories.forEach(name => t.set(doc(collection(db, 'users', uid, 'categories')), { name: name.trim() }));
        t.set(userRef, { seeded: true, setupChoice: fingerprint, setupCompletedAt: new Date().toISOString() }, { merge: true });
        return 'done' as const;
    }));
    try {
      const outcome = await withTimeout(tx, SETUP_SAVE_TIMEOUT_MS);
      markDone();
      return outcome;
    } catch (e) {
      if ((e as Error)?.message === 'timeout') {
        // السقف خلص بس العملية نفسها لسه ممكن تكمل (Promise.race مبيلغيهاش). مش
        // بنقول "ما اتحفظش" — ده مش مؤكد (silent-failure-hunter). ولو وصلت بعدين،
        // الحالة بتبقى done والتطبيق بيفتح لوحده؛ لو فشلت، الشاشة فاضلة زي ما هي
        // كل النتايج بتتقال: المستخدم ممكن يكون رجع يعدّل، فالشاشة بتتقفل
        // فجأة — الـAlert بيقول ليه، وبالاختيارات بتاعة أنهي محاولة (silent-failure-hunter)
        tx.then(r => {
          markDone();
          const msg = r === 'already-done-other' ? SETUP_OTHER_MESSAGE : SETUP_LATE_DONE_MESSAGE;
          notice(msg.title, msg.body);
        }).catch(err => noteAtomicFailure('تجهيز الحساب (المحاولة المتأخرة فشلت)', err));
        noteAtomicFailure('تجهيز الحساب (السقف خلص)', e);
        return 'unconfirmed';
      }
      const code = (e as { code?: string })?.code;
      noteAtomicFailure('تجهيز الحساب', e);
      // unavailable من runTransaction نفسها قاطعة: العملية ما اتكتبتش
      return code === 'unavailable' ? 'no-connection' : 'failed';
    }
  }

  async function waitForOurWritesToLand(): Promise<boolean> {
    const lost = whenConnectionLost();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), PENDING_WAIT_TIMEOUT_MS);
    });
    try {
      const winner = await Promise.race([
        waitForPendingWrites(db).then(() => 'landed' as const),
        lost.promise,
        cap,
      ]);
      return winner === 'landed';
    } catch {
      return false;
    } finally {
      lost.cancel();
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * مسح الحساب — الخطوة 1 (`reports/2026-11-03-account-delete-export.md`): كل مستند تحت `users/{uid}` من **السيرفر**
   * (مش من حالة الـlisteners — ممكن تكون نص من الكاش)، على دفعات (حد الـbatch 500 — بنستخدم 400)، **وبنستنى تأكيد كل دفعة**:
   * ده الاستثناء من قاعدة "متستناش السيرفر" — المستخدم لازم يعرف إن المسح حصل فعلاً قبل ما حساب الدخول يتمسح ويبقى مفيش
   * طريق يرجع يكمّل. `users/{uid}` آخر حاجة. قبلها كتاباتنا اللي لسه بترفع لازم توصل (من غيرها كتابة في الطابور ترجع
   * تعمل مستند بعد المسح). بيتعاد بأمان: كل مرة بتقرا اللي فاضل وتمسحه. **والرأي** (`feedback` برّه `users/{uid}`) بيتمسح معاهم
   * بالـ`uid` (قرار مؤمن 2026-11-03 — محتاج القاعدة الجديدة منشورة قبل أي بناء فيه الكود ده).
   */
  async function deleteAllMyData(): Promise<DeleteDataResult> {
    if (!uid) return { outcome: 'failed', deleted: 0, uncertain: false };
    let deleted = 0;
    /** السقف خلص وإحنا **بنمسح** (الدفعة ممكن توصل بعدين) ← مش متأكدين. وإحنا بنقرا بس ← مفيش حاجة اتمسحت (جولة 1 — كان بيقول "ممكن جزء اتمسح" ويسيب القفل) */
    let committing = false;
    /**
     * محاولة قبل كده سابت العلامة (مسحت جزء، أو "مش متأكدين") ← الحساب ممكن يكون اتفرمت فعلاً، فالفشل هنا عمره ما يفك
     * القفل حتى لو المحاولة دي ما مسحتش حاجة (silent-failure-hunter جولة 2: كان التسجيل التلقائي و"نبدأ بإيه؟" بيرجعوا
     * على حساب نصه ممسوح). العلامة بتتشال لما المحاولة الأولى تقع قبل أي مسح، فـ`resumed` هنا معناه "فيه مسح حصل أو ممكن يكون حصل"
     */
    const resumed = deletingRef.current || deletionPending;
    /**
     * الفشل **قبل ما أي حاجة تتمسح** بيفك القفل والعلامة (silent-failure-hunter جولة 2 BLOCKER: كان بيسيب الحساب من غير
     * تسجيل تلقائي ولا دفع للأبد، وساكت). المسح الجزئي أو المش متأكد بيسيب القفل عن قصد — البيانات اتفرمتت فعلاً
     */
    const fail = (uncertain = false): DeleteDataResult => {
      if (deleted === 0 && !uncertain && !resumed) {
        deletingRef.current = false;
        setDeletionPending(false);
        AsyncStorage.removeItem(deletePendingKey(uid)).catch(e => console.warn('[delete-account] clear pending failed', e instanceof Error ? e.name : 'unknown'));
      }
      return { outcome: serverReachableRef.current ? 'failed' : 'no-connection', deleted, uncertain };
    };
    if (!serverReachableRef.current) return fail();
    // من دلوقتي مفيش تسجيل تلقائي ولا دفع ولا "نبدأ بإيه؟" — والعلامة على الجهاز بتفضل بعد قفل التطبيق. الكتابة بتتستنى:
    // لو العلامة مااتكتبتش والمسح كمّل، قفل التطبيق في النص كان هيرجّع شاشة التجهيز
    deletingRef.current = true;
    setDeletionPending(true);
    // العلامة مااتكتبتش ← منمسحش ولا حاجة (قفل التطبيق في النص كان هيرجّع "نبدأ بإيه؟" على حساب بيتمسح)
    try { await AsyncStorage.setItem(deletePendingKey(uid), '1'); }
    catch (e) { console.warn('[delete-account] pending flag failed', e instanceof Error ? e.name : 'unknown'); return fail(); }
    if (!(await waitForOurWritesToLand())) return fail();
    const readAll = async (): Promise<DocumentReference[]> => {
      // والرأي اللي بعته (برّه `users/{uid}` — بالـ`uid`؛ القواعد بتسمح لصاحبه بس، قرار مؤمن 2026-11-03). لو القاعدة لسه
      // مش منشورة الاستعلام بيترفض ← المسح كله بيقف قبل أي حاجة (`fail` بيفك القفل) — مش بيتخطّى الرأي ساكت
      const snaps = await withTimeout(Promise.all([
        ...ACCOUNT_COLLECTIONS.map(name => getDocsFromServer(collection(db, 'users', uid, name))),
        getDocsFromServer(query(collection(db, 'feedback'), where('uid', '==', uid))),
      ]), EXPORT_READ_TIMEOUT_MS);
      return snaps.flatMap(s => s.docs.map(d => d.ref));
    };
    const deleteRefs = async (refs: DocumentReference[]) => {
      for (let i = 0; i < refs.length; i += ACCOUNT_DELETE_BATCH) {
        const batch = writeBatch(db);
        const chunk = refs.slice(i, i + ACCOUNT_DELETE_BATCH);
        chunk.forEach(r => batch.delete(r));
        committing = true;
        await withTimeout(batch.commit(), EXPORT_READ_TIMEOUT_MS);
        committing = false;
        deleted += chunk.length;
      }
    };
    // لفّات: امسح اللي اتقرا، واقرا تاني من السيرفر — حاجة اتكتبت في النص (تسجيل تلقائي بدأ قبل العلامة) بتتمسح في
    // اللفّة الجاية. `done` بس بعد قراية فاضية (money-reviewer: من غيرها عملية بمبلغ كانت بتفضل بعد "اتمسح حسابك")
    try {
      for (let round = 0; round < ACCOUNT_DELETE_VERIFY_ROUNDS; round++) {
        const refs = await readAll();
        if (refs.length === 0) {
          // آخر حاجة: مستند المستخدم (فيه `seeded`) — لو اتمسح الأول والباقي وقع، الفتحة الجاية كانت هتعرض "نبدأ بإيه؟"
          // فشله بعد قراية فاضية ← "مش متأكدين": محاولة قبلها ممكن تكون مسحت الباقي، فـ"مفيش حاجة اتمسحت" مش صح (جولة 2)
          try { await withTimeout(deleteDoc(doc(db, 'users', uid)), EXPORT_READ_TIMEOUT_MS); }
          catch (e) { console.warn('[delete-account] user doc failed', e instanceof Error ? e.name : 'unknown'); return fail(true); }
          return { outcome: 'done' };
        }
        await deleteRefs(refs);
      }
      console.warn('[delete-account] still not empty after rounds', ACCOUNT_DELETE_VERIFY_ROUNDS);
      return fail();
    } catch (e) {
      const timedOut = e instanceof Error && e.message === 'timeout';
      console.warn('[delete-account] failed', e instanceof Error ? e.name : 'unknown', (e as { code?: string })?.code ?? '', `deleted=${deleted}`, timedOut ? 'timeout' : '');
      // الكود بس لـSentry (مش الرسالة): `permission-denied` هنا غالبًا قاعدة الرأي مش منشورة — من غيره كانت هتبان "جرّب تاني" بس
      noteAtomicFailure('مسح الحساب', e);
      // السقف الزمني مبيلغيش الكتابة: الدفعة ممكن توصل بعدين ← "مش متأكدين" مش رقم مجزوم — بس لو السقف خلص وإحنا بنمسح
      return fail(timedOut && committing);
    }
  }

  /**
   * التصدير الكامل بيقرا **من السيرفر مرة واحدة** مش من حالة الـlisteners (silent-failure-hunter): `delivered` بيتملى
   * من snapshot الكاش كمان، و`fromCache` متتبّع للمحافظ والعمليات بس — فالديون مثلاً كانت ممكن تطلع ورقة فاضية
   * والملف يبان "كل بياناتي". هنا يا الملف كامل من السيرفر، يا رسالة صريحة. **قبلها** بنستنى كتاباتنا اللي لسه بترفع
   * توصل (من غيرها عملية اتسجلت حالًا كانت هتغيب عن الملف). نفس شكل البيانات اللي الـlisteners بتبنيه.
   */
  async function readAllFromServer(): Promise<{ outcome: 'done'; data: FullExportInput } | { outcome: 'no-connection' | 'failed' }> {
    if (!uid) return { outcome: 'failed' };
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    // مش كل false معناها "مفيش نت" (silent-failure-hunter جولة 2): سقف الانتظار أو طابور بطيء والنت شغال ← failed
    // بالرسالة العامة، مش "مفيش نت" والمستخدم يدوّر على مشكلة مش موجودة
    if (!(await waitForOurWritesToLand())) return { outcome: serverReachableRef.current ? 'failed' : 'no-connection' };
    const col = (name: string) => getDocsFromServer(collection(db, 'users', uid, name));
    try {
      const [w, c, t, b, si, sp, d, s, g, i, fb] = await withTimeout(Promise.all([
        col('wallets'), col('categories'), col('transactions'), col('budgets'), col('shakhbata_income'),
        getDocFromServer(doc(db, 'users', uid, 'shakhbata_settings', 'percents')),
        col('debts'), col('subscriptions'), col('gamiyas'), col('incomes'),
        // الرأي برّه `users/{uid}` — الاستعلام لازم `where uid` (القاعدة بترفض غيره). محتاج قاعدة الرأي الجديدة منشورة،
        // ومن غيرها التصدير كله بيرجع `failed` برسالة صريحة (مش ملف ناقص ساكت) — نفس ترتيب النشر بتاع مسح الحساب
        getDocsFromServer(query(collection(db, 'feedback'), where('uid', '==', uid))),
      ]), EXPORT_READ_TIMEOUT_MS);
      const budgetsMap: Budgets = {};
      // مستند من غير رقم بيتخطّى (كان هيطلع خلية فاضية في الإكسيل من غير ما حد يعرف) — NIT جولة 2
      b.docs.forEach(x => { const v = numberField(x.data(), 'limit', 'budgets'); if (v !== undefined) budgetsMap[x.id] = v; });
      const incomeMap: ShakhbataIncome = {};
      si.docs.forEach(x => { const v = numberField(x.data(), 'income', 'shakhbata_income'); if (v !== undefined) incomeMap[x.id] = v; });
      const p = sp.exists() ? (sp.data() as any) : null;
      return {
        outcome: 'done',
        data: {
          // نفس تطبيع الـlisteners (بند B — money-reviewer): الملف والشاشة يقولوا نفس الحاجة. **ماعدا العمليات البايظة:**
          // الملف = كل اللي متخزّن، فبتطلع زي ما هي وعليها عمود "مشكلة" (`buildFullExportSheets`) — مش متشالة
          wallets: w.docs.map(x => walletFromDoc<Wallet>(x.id, x.data())),
          categories: c.docs.map(x => withId<Category>(x.id, x.data())),
          transactions: t.docs.map(x => withId<Transaction>(x.id, x.data())),
          debts: d.docs.map(x => debtFromDoc<Debt>(x.id, x.data())),
          subscriptions: s.docs.map(x => subscriptionFromDoc<Subscription>(x.id, x.data())),
          gamiyas: g.docs.map(x => gamiyaFromDoc<Gamiya>(x.id, x.data())),
          incomes: i.docs.map(x => incomeFromDoc<RecurringIncome>(x.id, x.data())),
          budgets: budgetsMap, shakhbataIncome: incomeMap,
          // مستند النسب مش موجود ← `null`: الملف بيقول "الافتراضي" مش كأن المستخدم اختار 50/30/20
          shakhbataPercents: p ? { needs: finiteOr(p.needs, DEFAULT_PERCENTS.needs, ['shakhbata_settings', 'needs']), wants: finiteOr(p.wants, DEFAULT_PERCENTS.wants, ['shakhbata_settings', 'wants']), future: finiteOr(p.future, DEFAULT_PERCENTS.future, ['shakhbata_settings', 'future']) } : null,
          feedback: fb.docs.map(x => feedbackFromDoc(x.id, x.data() as Record<string, unknown>)),
        },
      };
    } catch (e) {
      console.warn('[export] read from server failed', e instanceof Error ? e.name : 'unknown', (e as { code?: string })?.code ?? '');
      const code = (e as { code?: string })?.code;
      // "مفيش نت" بس لو النت فعلاً واقع دلوقتي — timeout أو unavailable والنت شغال (بطء) ← failed بالرسالة العامة
      const offline = !serverReachableRef.current && (code === 'unavailable' || (e instanceof Error && e.message === 'timeout'));
      return { outcome: offline ? 'no-connection' : 'failed' };
    }
  }

  async function addGamiya(data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }): Promise<EntrySaveResult> {
    // نفس فحص الفورم (بند 15) — الشاشة اللي تنسى بتترفض برضه، قبل أي كتابة
    const invalid = gamiyaEntryProblem(data);
    if (invalid) return invalid;
    if (!uid) return { outcome: 'done' };
    const monthlyAmount = storableAmount(data.monthlyAmount)!;
    const payoutAmount = storableAmount(data.payoutAmount)!;
    const months: GamiyaMonth[] = Array.from({ length: data.totalMonths }, (_, i) => {
      const monthIndex = i + 1;
      const isPayoutMonth = monthIndex === data.payoutMonthIndex;
      return {
        id: `${monthIndex}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        monthIndex,
        dueDate: addMonths(data.startDate, i),
        isPayoutMonth,
        amount: isPayoutMonth ? payoutAmount : monthlyAmount,
        status: 'pending',
      };
    });
    const { chargeMode, ...rest } = data;
    addDocNoWait('gamiyas', {
      ...rest, monthlyAmount, payoutAmount, ...chargeModePatch(chargeMode ?? 'confirm', undefined, todayStr()), months, createdAt: new Date().toISOString(),
    }, namedLabel('الجمعية', data.name));
    return { outcome: 'done' };
  }
  async function updateGamiya(id: string, data: GamiyaEdit): Promise<EntrySaveResult> {
    // التعديل مبيلمسش مبالغ ولا شهور (اتولّدوا خلاص) — النوع نفسه مبيسمحش بيهم
    // (money-reviewer: `Partial<Gamiya>` كان باب خلفي لـInfinity)، والتذكير بيتفحص (بند 15)
    if (data.reminderDaysBefore !== undefined && !validReminderDays(data.reminderDaysBefore)) return invalidEntry('reminderDays');
    if (!uid) return { outcome: 'done' };
    const current = gamiyas.find(x => x.id === id);
    const { chargeMode } = data;
    // قايمة مسموحة وقت التشغيل مش النوع بس (typescript-reviewer): `GamiyaEdit` مبيمنعش
    // مفتاح زيادة لو حد بعت متغيّر (`{ ...gamiya }`)، فالمبالغ والشهور و`chargeAutoSince`
    // كانوا هيتكتبوا من غير فحص
    const clean: Record<string, unknown> = Object.fromEntries(
      (['name', 'walletId', 'reminderDaysBefore'] as const)
        .filter(k => data[k] !== undefined).map(k => [k, data[k]]),
    );
    if (chargeMode) Object.assign(clean, chargeModePatch(chargeMode, current, todayStr()));
    track(updateDoc(doc(db, 'users', uid, 'gamiyas', id), clean), namedLabel('تعديل الجمعية', current?.name));
    return { outcome: 'done' };
  }
  async function deleteGamiya(id: string): Promise<CascadeDeleteResult> {
    if (!uid) return { outcome: 'done' };
    const g = gamiyas.find(x => x.id === id);
    return deleteWithTransactions('gamiya', g?.name ?? '', doc(db, 'users', uid, 'gamiyas', id),
      gamiyaTransactionIds(g), namedLabel('حذف الجمعية', g?.name));
  }
  /**
   * زي markSubscriptionPaid: عملية ذرية بتقرا الجمعية من السيرفر وبتتأكد إن
   * الشهر لسه pending قبل ما تخصم. قبل كده كانت بتقرا من حالة الرياكت من غير ما
   * تبص على حالة الشهر أصلاً، فنداءها مرتين على نفس الشهر كان بيعمل عمليتين خصم،
   * والشهر بيتربط بالتانية فالأولى بتفضل عملية يتيمة في الأرشيف بتقلل الرصيد.
   */
  async function markGamiyaMonthDone(gamiyaId: string, monthId: string, seenAmount?: number): Promise<PayOutcome | 'amount-changed'> {
    if (deletingRef.current) return 'failed';
    if (!uid) return 'done';
    // زي markSubscriptionPaid بالظبط: رفض فوري من غير اتصال، وانتظار اللي لسه
    // بيرفع قبل القراية من السيرفر، والكل متسابق مع "الاتصال وقع"
    if (!serverReachableRef.current) return 'no-connection';
    const gamiyaRef = doc(db, 'users', uid, 'gamiyas', gamiyaId);
    // نفس معرّف التلقائي وكارت "اتخصم؟" — الشهر عمليته واحدة مهما اتسجل منين
    const txRef = doc(db, 'users', uid, 'transactions', gamiyaTxId(gamiyaId, monthId));
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(gamiyaRef);
        if (!snap.exists()) return;
        const g = gamiyaFromDoc<Gamiya>(gamiyaId, snap.data(), true);
        const month = (g.months || []).find(m => m.id === monthId);
        if (!month || month.status === 'done') return;
        if (seenAmountDiffers(seenAmount, month.amount)) throw amountChanged(seenAmount, month.amount);

        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', g.walletId)))) throw new WalletMissingError();
        const existing = await t.get(txRef);

        // موجودة ← الشهر بيتقفل عليها من غير ما نكتب فوقها (تعديل المستخدم يفضل)
        if (!existing.exists()) {
          t.set(txRef, {
            type: month.isPayoutMonth ? 'income' : 'expense', amount: month.amount, walletId: g.walletId, date: month.dueDate,
            note: `${month.isPayoutMonth ? 'استلام جمعية' : 'قسط جمعية'}: ${g.name} (شهر ${month.monthIndex})`,
            gamiyaId, periodKey: monthId, createdAt: new Date().toISOString(),
          });
        }
        const updatedMonths = g.months.map(m => {
          if (m.id !== monthId) return m;
          const { reopened: _r, auto: _a, ...rest } = m;
          return { ...rest, status: 'done' as const, transactionId: txRef.id };
        });
        t.update(gamiyaRef, { months: updatedMonths });
      }));
      return 'done';
    } catch (e) {
      if (e instanceof AmountChangedError) { console.warn('[gamiya] month amount changed since shown, nothing written', gamiyaId, monthId, ...amountsForDevLog(e)); return 'amount-changed'; }
      if (!(e instanceof WalletMissingError)) noteAtomicFailure('تسديد شهر الجمعية', e);
      return e instanceof WalletMissingError ? 'wallet-missing' : 'failed';
    }
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, brokenTransactions, budgets, shakhbataIncome, shakhbataPercents,
        debts, subscriptions, gamiyas, incomes, pendingWrites, pendingTxIds, serverReachable, figuresFromServer, coldSnapshot, figuresPending,
        loadErrors, retryLoad: () => setListenRetry(n => n + 1), setupStatus, completeSetup,
        linkSourcesReady: LINK_SOURCES.every(n => delivered.has(n) && !loadErrors.includes(n)),
        transfersStatus: transfersStatusFrom(delivered, loadErrors),
        readAllFromServer, deleteAllMyData, deletionPending,
        addWallet, updateWallet, deleteWallet, archiveWallet, restoreWallet,
        addCategory, updateCategory, deleteCategory, archiveCategory, restoreCategory,
        submitFeedback,
        addTransaction, updateTransaction, updateDebtLinkedTransaction, deleteTransaction, transactionLinkWarning,
        setBudget, setMonthlyIncome, setShakhbataPercents,
        addDebt, updateDebt, deleteDebt, addDebtPayment, deleteDebtPayment, addDebtIncrease, deleteDebtIncrease,
        setInstallmentCount,
        addSubscription, updateSubscription, deleteSubscription, markSubscriptionPaid, setSubscriptionActive,
        addGamiya, updateGamiya, deleteGamiya, markGamiyaMonthDone, recordCharges, skipSubscriptionCharge,
        addIncome, updateIncome, setIncomeStatus, recordIncomePeriods, skipIncomePeriod, deleteIncome,
      }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}