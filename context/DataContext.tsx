import { useNotice } from '@/components/NoticeProvider';
import { useAuth } from '@/context/AuthContext';
import { figuresFresh } from '@/lib/staleFigures';
import { transfersStatusFrom, type TransfersStatus } from '@/lib/spending';
import { debtFromDoc, finiteOr, gamiyaFromDoc, incomeFromDoc, numberField, splitTransactions, subscriptionFromDoc, walletFromDoc, withId, type BrokenTransaction } from '@/lib/fromDoc';
import { dueDateAfterIncreaseRemoval, dueDateAfterPaymentRemoval, paymentsAfterRemoval, reopenedDueMessage } from '@/lib/reopenDue';
import { buildColdSnapshot, COLD_CACHE_PREFIX, COLD_CACHE_WRITE_DELAY_MS, coldCacheKey, parseColdSnapshot, type ColdSnapshot } from '@/lib/coldCache';
import type { FullExportInput } from '@/lib/fullExport';
import { feedbackFromDoc } from '@/lib/fullExport';
import { db } from '@/firebaseConfig';
import {
  CHARGE_IN_FLIGHT_DELETE_BLOCK, CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA, NO_ACCOUNT_DELETE_BLOCK_DEBT, NO_ACCOUNT_DELETE_BLOCK_GAMIYA, NO_ACCOUNT_DELETE_BLOCK_SUBSCRIPTION, cascadeDeleteBlock, debtTransactionIds, gamiyaTransactionIds, settlementNote, subscriptionTransactionIds, walletDeleteBlock,
  type ArchiveBlock, type CascadeDeleteBlock, type CascadeKind,
} from '@/lib/archiving';
import { reportAtomicFailure, type AtomicOp } from '@/lib/atomicFailure';
import { buildFeedbackDoc, type FeedbackType } from '@/lib/feedback';
import { debtLinkedEditPlan, debtRoleOf, installmentEditMessage, linkedEditAlreadyApplied, storableAmount, type LinkedEditNext } from '@/lib/linkedEdit';
import {
  dueInsideClosedPeriod as dueInsideClosedPeriodEntry, gamiyaEntryProblem, invalidEntry, subscriptionEntryProblem, validReminderDays, type EntrySaveResult,
} from '@/lib/entryValidation';
import {
  addDays, addMonths, addMonthsAnchored, debtGrandTotal, debtPaid, debtRemaining,
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
  incomeHasRecords, incomeOpenPeriods, incomePeriodLabel, incomeRescheduleStart, incomeScheduleKeysChange, incomeTxDate, incomeTxId,
  incomeUpcomingPeriod,
  type IncomeClosed, type IncomeDraft, type IncomeMode, type IncomeStatus, type RecurringIncome,
} from '@/lib/recurringIncome';
import type { ListenerName } from '@/lib/listenerErrors';
import {
  anchorDayPatch, chargeDateLabel, chargeModePatch, gamiyaOpenCharges, gamiyaTxId, subscriptionAdvance, subscriptionAnchorDay, subscriptionDueFloor, subscriptionManualKey, subscriptionNextCycle,
  subscriptionOpenCharges, subscriptionResumeDate, subscriptionTxId, type ChargeClosed, type ChargeMode,
} from '@/lib/autoCharge';
import {
  SETUP_LATE_DONE_MESSAGE, SETUP_OTHER_MESSAGE, createdBeforeSetupFeature, setupCategoryIcon, setupDoneKey, setupFingerprint, validateSetupChoice,
  type SetupChoice, type SetupOutcome, type SetupStatus,
} from '@/lib/firstRunSetup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hapticError } from '@/lib/haptics';
import {
  hasLinkFields, isFinalWriteRejection, mergePatch, OUTBOX_EDIT_UNPROTECTED_BODY, OUTBOX_EDIT_UNPROTECTED_TITLE, OUTBOX_KEY_FAIL_SESSIONS,
  OUTBOX_MAX_FAILED_SESSIONS, OUTBOX_UNREADABLE_TITLE, planReplay, openEntry, rejectedReplayBody, repeatedFailReplayBody, unreadableReplayBody,
  walletGoneReplayBody, type StoredEntry,
} from '@/lib/outbox';
import {
  OutboxEntriesClearError, OutboxKeyDeleteError, clearOutboxForUid, clearOutboxKeyReadFailures, consumeUserSignOut, getOutboxClearedIds, hasOutboxTombstone, listOutboxEntries,
  logOutboxFailure, mergeOrRewriteOutboxEntry, noteOutboxKeyReadFailure, outboxIdsAfterPendingSaves, outboxSessionId, putOutboxEntry,
  readOutboxKey, removeOutboxEntry, replayOutboxDoc, reportOutboxEvent, serverTxStatus, setOutboxClearedIds, sweepOtherOutboxes, updateOutboxMeta,
  writeOutboxTombstone,
} from '@/lib/outboxStore';

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
/** الفترة اللي التأكيد سمّاها مش اللي الذرة هتقفلها (جهاز تاني قفلها الأول) — مفيش كتابة خالص */
class PeriodChangedError extends Error { name = 'PeriodChangedError'; }
/** مبلغ الاشتراك المتخزّن مش مبلغ ينفع يتسجل (NaN، صفر، سالب) — الجولة 2 */
class BadStoredAmountError extends Error { name = 'BadStoredAmountError'; }
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
export type TxEditOutcome = PayOutcome | 'gone' | 'uncertain';
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
/** الجمعية موجودة بس الشهر اللي اتطلب مش فيها — غير `ChargeMissingError` عشان الرسالة متقولش "الجمعية اتمسحت" */
class MonthMissingError extends Error { name = 'MonthMissingError'; }

/** الدخل اتسجل منه حاجة (من جهاز تاني) بين الدوسة والمسح */
class IncomeHasRecordsError extends Error { name = 'IncomeHasRecordsError'; }

/** اللي تعديل الجمعية يقدر يغيّره — المبالغ والشهور مش منهم (بند 15) */
export type GamiyaEdit = Partial<Pick<Gamiya, 'name' | 'walletId' | 'reminderDaysBefore' | 'chargeMode'>>;

/** نتيجة `deleteWallet`/`archiveWallet` — `blocked` بنفس نوع حظر الشاشة، فالرسالة واحدة */
export type WalletWriteResult = { outcome: 'done' } | { outcome: 'blocked'; block: ArchiveBlock };

/**
 * وقت كتابة **فريد على الجهاز ده**: نفس `toISOString` بس لو اتطلب مرتين في نفس الملّي ثانية التاني بيتزق ملّي.
 * بصمة الكتابة (`at`/`createdAt`) في الاشتراك والجمعية بتتقارن عشان نعرف "دي كتابتنا اللي وصلت" (بند A/B) —
 * نداءين متوازيين في نفس الملّي ثانية (تلقائي + تلقائي) كانوا هياخدوا نفس البصمة والتاني يفتكر كتابة الأول بتاعته.
 * بين جهازين: نفس الملّي ثانية **ونفس الفترة** — مش واقعي، ولو حصل النتيجة "اتسجلت" وهي فعلاً اتسجلت مرة واحدة.
 */
let lastStampMs = 0;
function uniqueStamp() {
  lastStampMs = Math.max(Date.now(), lastStampMs + 1);
  return new Date(lastStampMs).toISOString();
}

/** الفترة دي اتقفلت بكتابتنا إحنا (`at` بتاع المحاولة دي) على عمليتها الثابتة — مش من جهاز تاني */
function closedByUs(c: ChargeClosed | undefined, txId: string, at: string) {
  return !!c && !c.reopened && c.at === at && c.txId === txId;
}

/** مبلغ عملية موجودة (اتعدّلت مثلاً) — سطر التاريخ بيتكتب بيه هو، مش باللي اتبعت */
function existingAmount(snap: { exists(): boolean; data(): any }, fallback: number): number {
  const a = snap.exists() ? snap.data()?.amount : undefined;
  return typeof a === 'number' && Number.isFinite(a) ? a : fallback;
}

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
 * `period-changed` (الاشتراك بس): الفترة اللي التأكيد سمّاها اتقفلت من جهاز تاني. نفس قالب `AMOUNT_CHANGED_ALERT`:
 * إيه اللي حصل، ومفيش فلوس اتحركت، وتعمل إيه. نوع لوحده مش جوه `PayOutcome` (زي `amount-changed`): باقي مسارات الدفع مالهاش الحالة دي.
 */
export const PERIOD_CHANGED_ALERT = {
  title: 'الفترة اتغيّرت',
  body: 'الاشتراك ده اتغيّر من جهاز تاني، فما اتسجلش أي خصم. راجعه تاني قبل ما تسجّل.',
};

/**
 * الذرة فشلت وسؤال السيرفر بعدها كمان فشل (مراجعة الاشتراكات 2026-11-17، نفس `PAY_OUTCOME_ALERT_DEBT.uncertain`):
 * مش عارفين الخصم اتسجل ولا لأ، فممنوع "مفيش أي خصم اتسجل" — المستخدم كان هيعيد ويتخصم مرتين.
 */
export const CHARGE_UNCERTAIN_ALERT = {
  title: 'مش متأكدين اتسجل ولا لأ',
  body: 'النت قطع واحنا بنسجّل، فمش عارفين الخصم وصل ولا لأ. افتح الأرشيف وبص الأول، ولو مش موجود سجّله تاني — عشان ميتخصمش مرتين.',
};
/** نفس `CHARGE_UNCERTAIN_ALERT` لشهر استلام الجمعية — الفلوس داخلة، فـ"الخصم" غلط (مراجعة الجمعية الجولة 2) */
export const CHARGE_UNCERTAIN_ALERT_PAYOUT = {
  title: 'مش متأكدين اتسجل ولا لأ',
  body: 'النت قطع واحنا بنسجّل، فمش عارفين الاستلام وصل ولا لأ. افتح الأرشيف وبص الأول، ولو مش موجود سجّله تاني — عشان ميتسجلش مرتين.',
};
/** الاشتراك/الجمعية اتمسح من جهاز تاني قبل التسجيل */
export const CHARGE_MISSING_ALERT = {
  subscription: { title: 'الاشتراك ده اتمسح', body: 'اتمسح (يمكن من جهاز تاني)، فما اتسجلش أي خصم.' },
  gamiya: { title: 'الجمعية دي اتمسحت', body: 'اتمسحت (يمكن من جهاز تاني)، فما اتسجلش حاجة.' },
} as const;
/** الجمعية لسه موجودة بس الشهر ده مش فيها (اتغيّرت من جهاز تاني) — "الجمعية اتمسحت" هنا كلام غلط (مراجعة الجولة 2) */
export const GAMIYA_MONTH_MISSING_ALERT = {
  title: 'الشهر ده مش موجود',
  body: 'الشهر ده مبقاش في الجمعية (يمكن اتغيّرت من جهاز تاني)، فما اتسجلش حاجة. افتح الجمعية تاني وبص على شهورها.',
};

/** شهر استلام الجمعية: نفس رسالة المحفظة بس بكلام الاستلام ("خصم" هنا غلط) */
export const GAMIYA_PAYOUT_WALLET_MISSING_ALERT = {
  title: 'محتاج محفظة تانية',
  body: 'المحفظة المربوطة بيها اتمسحت أو اتأرشفت، فما اتسجلش أي استلام. عدّل الجمعية واختار محفظة شغالة وجرب تاني.',
};

/**
 * نفس الرسالة بس بتسمّي السجل اللي المستخدم واقف عليه. "عدّل واختار محفظة"
 * لوحدها بتسيبه يدوّر: هو واقف على كارت الجمعية، والكلام بيقوله يعدّل إيه؟
 */
export const PAY_OUTCOME_ALERT_GAMIYA: typeof PAY_OUTCOME_ALERT = {
  ...PAY_OUTCOME_ALERT,
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة المربوطة بيها اتمسحت أو اتأرشفت، فما اتسجلش أي خصم. عدّل الجمعية واختار محفظة شغالة وجرب تاني.',
  },
};

/**
 * شهر الاستلام (مراجعة الجمعية 2026-11-18): الفلوس **داخلة**، فـ"مفيش أي خصم اتسجل" غلط — نفس الرسايل بكلام الاستلام.
 * `wallet-missing` هو `GAMIYA_PAYOUT_WALLET_MISSING_ALERT` بالظبط (مصدر واحد).
 */
export const PAY_OUTCOME_ALERT_GAMIYA_PAYOUT: typeof PAY_OUTCOME_ALERT = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتسجلش الاستلام. العملية دي لازم تتأكد من السيرفر عشان ميتسجلش مرتين — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتسجلش',
    body: 'العملية ما تمّتش ومفيش أي استلام اتسجل. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': GAMIYA_PAYOUT_WALLET_MISSING_ALERT,
};

/**
 * "اتخصم"/"استلمت" من شاشة الجمعية (`markGamiyaMonthDone`). فوق `PayOutcome`:
 * - `amount-changed`: المبلغ اتغيّر من جهاز تاني والتأكيد مفتوح.
 * - `missing`: الجمعية اتمسحت — مفيش حاجة اتسجلت (`CHARGE_MISSING_ALERT.gamiya`).
 * - `month-missing`: الجمعية موجودة بس الشهر مش فيها — مفيش حاجة اتسجلت (`GAMIYA_MONTH_MISSING_ALERT`).
 * - `already-recorded`: الشهر اتسجل قبل كده (جهاز تاني، الكارت، التلقائي) — مفيش كتابة (`GAMIYA_ALREADY_RECORDED_ALERT`).
 * - `bad-amount`: مبلغ الشهر المتخزّن مش رقم صالح — مفيش كتابة، ومش "المبلغ اتغيّر" للأبد (`GAMIYA_BAD_AMOUNT_ALERT`).
 * - `uncertain`: الذرة فشلت وسؤال السيرفر بعدها كمان فشل (`CHARGE_UNCERTAIN_ALERT`).
 */
export type GamiyaMarkOutcome = PayOutcome | 'amount-changed' | 'missing' | 'month-missing' | 'already-recorded' | 'bad-amount' | 'uncertain';
/** نفس صيغة "اتسجلت قبل كده" بتاعة الكارت */
export const GAMIYA_ALREADY_RECORDED_ALERT = {
  title: 'اتسجلت قبل كده',
  body: 'الشهر ده كان اتسجل خلاص (من جهاز تاني أو من الرئيسية)، فما سجلناش تاني. لو المبلغ مختلف عدّله من الأرشيف.',
};
/** مبلغ الشهر المتخزّن مش رقم صالح (بيانات قديمة) — شاشة الجمعية مفيهاش "المبلغ مختلف"، فالطريق من الرئيسية */
export const GAMIYA_BAD_AMOUNT_ALERT = {
  title: 'المبلغ مش مقروء',
  body: 'المبلغ المتسجّل للشهر ده مش رقم صالح، فما اتسجلش حاجة. سجّله من كارت "مستنيين ردك" في الرئيسية واكتب المبلغ بنفسك.',
};
/** الإضافة/التعديل ونسخة الحساب مش جاهزة (`uid` فاضي) — كانت بترجع "تم" ومفيش حاجة اتكتبت */
export const GAMIYA_NOT_SAVED_MESSAGE = 'الجمعية ما اتحفظتش — مفيش حساب مفتوح دلوقتي. سجّل دخول تاني وجرب.';

/**
 * نفس الرسايل بس للدين: المحفظة هنا بتتختار في مودال الدفعة نفسه، فالكلام
 * لازم يوجّه على المودال اللي المستخدم واقف فيه مش على تعديل السجل.
 */
/**
 * نتيجة دفعة/زيادة الدين. فوق `PayOutcome`:
 * - `gone`: الدين نفسه اتمسح (من جهاز تاني) — "جرب تاني" مش هتنفع.
 * - `uncertain`: الذرة فشلت بعد ما ممكن تكون وصلت (الرد ضاع)، وسؤال السيرفر بعدها كمان فشل — مش
 *   عارفين اتسجلت ولا لأ، فممنوع نقول "مفيش حاجة اتسجلت" (المستخدم هيعيد ← مرتين).
 */
export type DebtPayOutcome = PayOutcome | 'gone' | 'uncertain';
/** مسح دفعة/زيادة: `gone` = الدين نفسه اتمسح */
export type DebtEntryDeleteOutcome = PayOutcome | 'gone';

export const DEBT_GONE_ALERT = {
  title: 'الدين اتمسح',
  body: 'الدين ده اتمسح (يمكن من جهاز تاني)، فمفيش حاجة اتسجلت.',
};
/** نفس الرسالة بس للمسح: "اتسجلت" هنا غلط، المستخدم بيمسح مش بيسجّل */
export const DEBT_GONE_DELETE_ALERT = {
  title: 'الدين اتمسح',
  body: 'الدين ده اتمسح (يمكن من جهاز تاني)، فمفيش حاجة اتغيّرت.',
};

export const PAY_OUTCOME_ALERT_DEBT: Record<Exclude<DebtPayOutcome, 'done'>, { title: string; body: string }> = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتسجلش حاجة. العملية دي لازم تتأكد من السيرفر عشان متتسجلش مرتين — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتسجلش',
    body: 'العملية ما كملتش ومفيش حاجة اتسجلت ولا الرصيد اتغيّر. اتأكد إن النت شغال وجرب تاني.',
  },
  'wallet-missing': {
    title: 'محتاج محفظة تانية',
    body: 'المحفظة اللي اخترتها اتمسحت أو اتأرشفت، فما اتسجلتش حاجة. اختار محفظة شغالة وجرب تاني.',
  },
  gone: DEBT_GONE_ALERT,
  uncertain: {
    title: 'مش متأكدين اتسجلت ولا لأ',
    body: 'النت قطع واحنا بنسجّل، فمش عارفين وصلت ولا لأ. افتح الدين وبص على تاريخه الأول، ولو العملية مش موجودة فيه جرّب تاني — عشان متتسجلش مرتين.',
  },
};

/** دين جديد: المحفظة المختارة اتمسحت أو اتأرشفت (من جهاز تاني) — مفيش حاجة اتكتبت */
export const ADD_DEBT_WALLET_MISSING_ALERT = {
  title: 'محتاج محفظة تانية',
  body: 'المحفظة اللي اخترتها اتمسحت أو اتأرشفت، فالدين ما اتسجلش. اختار محفظة شغالة وجرب تاني.',
};
export type AddDebtResult = { outcome: 'done' | 'wallet-missing' };

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
    body: 'مبلغ الشهر ده اتعدّل من جهاز تاني، فمفيش فلوس اتحركت. شوف المبلغ الجديد وأكّد تاني لو موافق عليه.',
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
  uncertain: {
    title: 'مش متأكدين اتحفظ ولا لأ',
    body: 'النت قطع واحنا بنحفظ، فمش عارفين التعديل وصل ولا لأ. افتح العملية تاني وبص على المبلغ قبل ما تعدّل تاني.',
  },
};

/**
 * تسجيل الدخل الثابت. مش `PAY_OUTCOME_ALERT`: هناك الكلام عن "خصم"، وهنا
 * فلوس داخلة — اللي المستخدم محتاج يعرفه إن مفيش حاجة اتضافت لرصيده.
 */
export const INCOME_RECORD_ALERT: Record<Exclude<IncomeRecordOutcome, 'done'>, { title: string; body: string }> = {
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
  // مراجعة الدخل 2026-11-18 (M2): الدخل اتمسح — مش "اتأكد من النت"
  missing: {
    title: 'الدخل ده اتمسح',
    body: 'اتمسح (يمكن من جهاز تاني)، فما اتسجلش حاجة.',
  },
  // H1+H2: الذرة فشلت وسؤال السيرفر كمان — ممكن يكون اتسجل، فممنوع "ما اتسجلش" (نفس `CHARGE_UNCERTAIN_ALERT`)
  uncertain: {
    title: 'مش متأكدين اتسجل ولا لأ',
    body: 'النت قطع واحنا بنسجّل، فمش عارفين الدخل وصل ولا لأ. افتح الأرشيف وبص الأول، ولو مش موجود سجّله تاني — عشان ميتسجلش مرتين.',
  },
  // M3: "نزل" بالمبلغ المعتاد والمعتاد اتعدّل من جهاز تاني (نفس `AMOUNT_CHANGED_ALERT`)
  'amount-changed': {
    title: 'المبلغ اتغيّر',
    body: 'مبلغ الدخل ده اتعدّل من جهاز تاني، فما اتسجلش حاجة. شوف المبلغ الجديد وأكّد تاني لو موافق عليه.',
  },
};

/**
 * `done` و`recorded` فاضي (M2): ليه ما اتسجلش — "اتسجل" بيتقال بس لو `recorded` فيه حاجة. من غير سبب = اتسجلت قبل كده.
 */
export const INCOME_NOT_RECORDED_ALERT = {
  stopped: {
    title: 'الدخل ده متوقف',
    body: 'اتوقف (يمكن من جهاز تاني)، فما اتسجلش حاجة. لو عايز تسجّله، رجّعه من التخطيط ← دخل ثابت الأول.',
  },
  skipped: {
    title: 'اتقفلت على إنها ما نزلتش',
    body: 'الفترة دي اتقفلت قبل كده على إنها ما نزلتش (يمكن من جهاز تاني)، فما سجلناش حاجة. لو نزلت فعلاً، سجّلها إيراد عادي من "+".',
  },
  already: {
    title: 'اتسجلت قبل كده',
    body: 'الفترة دي كانت اتسجلت خلاص (يمكن من جهاز تاني)، فما سجلناش تاني. لو المبلغ مختلف عدّله من الأرشيف.',
  },
  changed: {
    title: 'الفترة اتغيّرت',
    body: 'معاد الدخل ده اتغيّر من جهاز تاني، فما اتسجلش حاجة. راجعه تاني.',
  },
  badAmount: {
    title: 'المبلغ مش مقروء',
    body: 'المبلغ مش رقم صالح، فما اتسجلش حاجة. دوس "المبلغ مختلف" واكتب المبلغ اللي نزل.',
  },
} as const;

/** رسالة نتيجة "نزل" (الكارت وشاشة الدخل) — `null` = اتسجل فعلاً */
export function incomeRecordNotice(r: IncomeRecordResult): { title: string; body: string } | null {
  if (r.outcome !== 'done') return INCOME_RECORD_ALERT[r.outcome];
  if (r.recorded.length > 0) return null;
  if (r.stopped) return INCOME_NOT_RECORDED_ALERT.stopped;
  if (r.skipped) return INCOME_NOT_RECORDED_ALERT.skipped;
  if (r.badAmount) return INCOME_NOT_RECORDED_ALERT.badAmount;
  if (r.changed) return INCOME_NOT_RECORDED_ALERT.changed;
  return INCOME_NOT_RECORDED_ALERT.already;
}

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
export const DEBT_ENTRY_DELETE_ALERT: Record<Exclude<DebtEntryDeleteOutcome, 'done'>, { title: string; body: string }> = {
  gone: DEBT_GONE_DELETE_ALERT,
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
export type DebtPayResult = { outcome: DebtPayOutcome; note?: string | null; settledNow?: boolean };
/**
 * الزيادة (D1، 2026-10-30): `leftover-changed` = اللي المستخدم اختاره للباقي ("يتضاف على آخر
 * قسط" / "قسط منفصل") مابقاش هو الباقي على السيرفر — ما اتسجلش حاجة، والشيت بتسأل تاني.
 * نوع لوحده مش جوه `PayOutcome`: باقي شاشات الدفع مالهاش الحالة دي
 */
/** `dueNote`: "المعاد الجاي بقى …" لما الزيادة فتحت دين أقساط متسدد (بند 12) */
export type DebtIncreaseDeleteOut = { dueRestored?: string | null; entryGone?: boolean };
/** نفس `DebtIncreaseDeleteOut` للدفعة (الجولة 2، بند 2): التأكيد بيوعد بالمعاد في الاتنين */
export type DebtEntryDeleteOut = DebtIncreaseDeleteOut;

/**
 * مسح عملية من مودال العملية (الأرشيف/الرئيسية). العادي batch بيشتغل أوفلاين ← `done` على طول. عملية **دفعة أو زيادة
 * دين** ذرة بتقرا الدين من السيرفر (الجولة 2، بند 1) ← محتاجة نت ونتيجة قاطعة: `uncertain` = الذرة فشلت وسؤال السيرفر
 * بعدها كمان فشل. `dueNotRestored`: التأكيد قال المعاد هيرجع والسيرفر ما رجّعوش (الدين اتغيّر من جهاز تاني).
 */
export type TxDeleteOutcome = 'done' | 'no-connection' | 'failed' | 'uncertain' | 'no-account';
export type TxDeleteResult = {
  outcome: TxDeleteOutcome; dueNotRestored?: 'payment' | 'increase';
  /** العملية مربوطة بشهر جمعية (مراجعة 2026-11-18) — الرسالة بتتكلم عن الجمعية مش الدين (`txDeleteOutcomeAlert`) */
  subject?: 'gamiya';
};
export const TX_DELETE_OUTCOME_ALERT: Record<Exclude<TxDeleteOutcome, 'done'>, { title: string; body: string }> = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'العملية ما اتمسحتش والرصيد زي ما هو. العملية دي مربوطة بدين، فالمسح لازم يتأكد من السيرفر عشان الدين يتظبط صح — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتمسحتش',
    body: 'العملية لسه موجودة والدين زي ما هو والرصيد ما اتلمسش. اتأكد إن النت شغال وجرب تاني.',
  },
  uncertain: {
    title: 'مش متأكدين اتمسحت ولا لأ',
    body: 'النت قطع واحنا بنمسح، فمش عارفين المسح وصل ولا لأ. افتح الدين وبص على تاريخه، ولو العملية لسه فيه امسحها تاني.',
  },
  'no-account': {
    title: 'ما اتمسحتش',
    body: 'العملية لسه موجودة والرصيد ما اتلمسش — مفيش حساب مفتوح دلوقتي. سجّل دخول تاني وجرب.',
  },
};
/** نفس `TX_DELETE_OUTCOME_ALERT` لعملية شهر جمعية — المسح بيرجّع الشهر يسأل، فلازم يتأكد من السيرفر */
export const TX_DELETE_OUTCOME_ALERT_GAMIYA: typeof TX_DELETE_OUTCOME_ALERT = {
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'العملية ما اتمسحتش والرصيد زي ما هو. العملية دي مربوطة بشهر في جمعية، فالمسح لازم يتأكد من السيرفر عشان الشهر يرجع يسألك صح — جرب تاني أول ما النت يرجع.',
  },
  failed: {
    title: 'ما اتمسحتش',
    body: 'العملية لسه موجودة والجمعية زي ما هي والرصيد ما اتلمسش. اتأكد إن النت شغال وجرب تاني.',
  },
  uncertain: {
    title: 'مش متأكدين اتمسحت ولا لأ',
    body: 'النت قطع واحنا بنمسح، فمش عارفين المسح وصل ولا لأ. افتح الأرشيف وبص، ولو العملية لسه موجودة امسحها تاني.',
  },
  'no-account': TX_DELETE_OUTCOME_ALERT['no-account'],
};
/** رسالة نتيجة مسح العملية حسب اللي مربوطة بيه */
export function txDeleteOutcomeAlert(outcome: Exclude<TxDeleteOutcome, 'done'>, subject?: TxDeleteResult['subject']) {
  return (subject === 'gamiya' ? TX_DELETE_OUTCOME_ALERT_GAMIYA : TX_DELETE_OUTCOME_ALERT)[outcome];
}
export type DebtIncreaseResult = { outcome: DebtPayOutcome | 'leftover-changed'; note?: string | null; dueNote?: string | null };
export const LEFTOVER_CHANGED_ALERT = {
  title: 'الدين اتغيّر',
  body: 'الدين اتغيّر من جهاز تاني، فمفيش أي زيادة اتسجلت ولا فلوس اتحركت. شوف الباقي الجديد واختار تاني.',
};

/** أقصى انتظار لتأكيد السيرفر على الرأي قبل ما نقول إنه في الطابور */
const FEEDBACK_ACK_MS = 8000;

export type Budgets = Record<string, number>;
export type ShakhbataIncome = Record<string, number>;
export type ShakhbataPercents = { needs: number; wants: number; future: number };

/**
 * `advancedFrom`/`advancedTo` (بند 3): الدفعة قدّمت معاد القسط الجاي من→لـ. مسحها بيرجّع `advancedFrom`
 * لو المعاد لسه `advancedTo` (`dueDateAfterPaymentRemoval`) — نفس فكرة `reopenedFrom` في الزيادة.
 */
export type DebtPayment = {
  id: string; date: string; amount: number; walletId: string; categoryId?: string; transactionId?: string;
  advancedFrom?: string; advancedTo?: string;
};
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
  /** يوم الشهر الأصلي (1–31) للشهري والسنوي — بند C (`lib/autoCharge.ts`). مش موجود = اشتراك قديم */
  anchorDay?: number;
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
  /**
   * بصمة الكتابة اللي قفلت الشهر (`uniqueStamp`، نفس `createdAt` بتاع العملية لو اتكتبت معاه) — مراجعة الجمعية 2026-11-18:
   * بعد ذرة فشلت، الشهر المقفول ببصمتنا = كتابتنا وصلت؛ مقفول من غيرها = اتسجل من مكان تاني. مش موجود = شهر قديم
   */
  at?: string;
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
  /**
   * عمليات جديدة متسجلة على الموبايل (الطابور المتشفّر) ولسه ما اتأكدتش من السيرفر — رسالة الخروج بتقول إنها هتضيع
   * (قرار مؤمن 1: الخروج بيمسحها). أوسع من `pendingWrites`: فيها اللي من فتحة قبل كده ولسه مستنية النت.
   */
  outboxCount: number;
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
   * الديون وصلت (أول snapshot) ومش مرفوضة. قبلها `debts` الفاضية مش معناها "الدين اتمسح" — مودال الدفعة/الزيادة
   * مبيقفلش برسالة «الدين اتمسح» غير لما ده true (الجولة 2، بند 5)
   */
  debtsReady: boolean;
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
  /** `durable` = تتحفظ متشفّرة على الموبايل لحد ما السيرفر يأكدها (مودال العملية الجديدة بس — `lib/outbox.ts`) */
  addTransaction: (tx: Omit<Transaction, 'id'>, opts?: { durable?: true }) => Promise<string>;
  updateTransaction: (id: string, tx: Partial<Transaction>, settlements?: Settlement[]) => Promise<void>;
  /** تعديل عملية مربوطة بدين — العملية والدين في ذرة واحدة (`lib/linkedEdit.ts`) */
  updateDebtLinkedTransaction: (
    txId: string, tx: Partial<Transaction> & LinkedEditNext, expected: Pick<Transaction, 'amount' | 'walletId' | 'type'>,
    settlements?: Settlement[],
  ) => Promise<TxEditResult>;
  /** عملية دفعة/زيادة دين ← ذرة من السيرفر بنتيجة (`TxDeleteResult`)؛ غير كده batch و`done` على طول */
  deleteTransaction: (id: string, settlements?: Settlement[]) => Promise<TxDeleteResult>;
  transactionLinkWarning: (id: string) => string | null;
  setBudget: (categoryId: string, limit: number) => Promise<void>;
  setMonthlyIncome: (month: string, income: number) => Promise<void>;
  setShakhbataPercents: (p: ShakhbataPercents) => Promise<void>;
  addDebt: (data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
    dueDate?: string; reminderDaysBefore?: number;
  }) => Promise<AddDebtResult>;
  updateDebt: (id: string, data: DebtMetadata) => Promise<void>;
  deleteDebt: (id: string) => Promise<CascadeDeleteResult>;
  addDebtPayment: (debtId: string, amount: number, walletId: string, date: string, categoryId?: string) => Promise<DebtPayResult>;
  setInstallmentCount: (debtId: string, nextTotal: number) => Promise<boolean>;
  /** `out` زي `deleteDebtIncrease` (الجولة 2، بند 2): المعاد اللي رجع فعلاً، والدفعة كانت اتمسحت قبل كده */
  deleteDebtPayment: (debtId: string, paymentId: string, out?: DebtEntryDeleteOut) => Promise<DebtEntryDeleteOutcome>;
  addDebtIncrease: (debtId: string, amount: number, date: string, walletId?: string, leftover?: LeftoverSeen) => Promise<DebtIncreaseResult>;
  /**
   * `out.dueRestored`: المعاد اللي رجع فعلاً من الذرة (بند 12) — الشاشة بتقارنه باللي التأكيد وعد بيه.
   * `out.entryGone`: الزيادة كانت اتمسحت قبل كده (جهاز تاني) — مفيش حاجة تتقارن
   */
  deleteDebtIncrease: (debtId: string, entryId: string, out?: DebtIncreaseDeleteOut) => Promise<DebtEntryDeleteOutcome>;
  addSubscription: (data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }) => Promise<EntrySaveResult>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<EntrySaveResult>;
  deleteSubscription: (id: string) => Promise<CascadeDeleteResult>;
  markSubscriptionPaid: (id: string, date: string, seenAmount?: number, seenKey?: string) => Promise<SubscriptionPayOutcome>;
  /** وقّف/رجّع الاشتراك (2026-11-02). الرجوع بيرفض لو المحفظة مش شغالة */
  setSubscriptionActive: (id: string, active: boolean) => Promise<PayOutcome | 'missing'>;
  addGamiya: (data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
    chargeMode?: ChargeMode;
  }) => Promise<EntrySaveResult>;
  updateGamiya: (id: string, data: GamiyaEdit) => Promise<EntrySaveResult>;
  deleteGamiya: (id: string) => Promise<CascadeDeleteResult>;
  markGamiyaMonthDone: (gamiyaId: string, monthId: string, seenAmount?: number) => Promise<GamiyaMarkOutcome>;
  /** تسجيل فترات اشتراك/جمعية (كارت "اتخصم؟" أو التلقائي) — ذري، ومفيش فترة بتتسجل مرتين */
  recordCharges: (kind: ChargeKind, id: string, entries: { key: string; amount: number }[], opts?: { auto?: boolean }) => Promise<ChargeRecordResult>;
  /** "ما اتخصمش" — الفترة بتتقفل من غير عملية */
  skipSubscriptionCharge: (id: string, key: string) => Promise<SkipChargeOutcome>;
  addIncome: (draft: IncomeDraft & { mode: IncomeMode }) => Promise<void>;
  updateIncome: (id: string, patch: Partial<IncomeDraft & { mode: IncomeMode }>) => Promise<void>;
  setIncomeStatus: (id: string, status: IncomeStatus) => Promise<void>;
  recordIncomePeriods: (incomeId: string, entries: { key: string; amount: number }[], opts?: IncomeRecordOpts) => Promise<IncomeRecordResult>;
  skipIncomePeriod: (incomeId: string, key: string) => Promise<void>;
  deleteIncome: (incomeId: string) => Promise<IncomeDeleteOutcome>;
};

/**
 * نتيجة تسجيل الدخل: قاطعة زي أي عملية ذرية، ومعاها الفترات اللي اتسجلت
 * فعلاً — اللي كانت مقفولة قبل كده (جهاز تاني سبقنا) مش بتتحسب، فالرسالة
 * مبتقولش "سجلنا" عن حاجة ما اتسجلتش دلوقتي.
 */
/**
 * مراجعة الدخل (2026-11-18) — نفس `ChargeRecordResult`:
 * - `missing`: الدخل اتمسح. `uncertain`: الذرة فشلت وسؤال السيرفر كمان. `amount-changed`: "نزل" بالمعتاد والمعتاد اتغيّر.
 * - `recorded` فاضي ومعاه السبب: `stopped` (متوقف)، `skipped` ("ما نزلش")، `already` (اتسجلت من مكان تاني)،
 *   `changed` (الفترة مش في الجدول)، `badAmount` (المبلغ بيتقرّب لصفر أو مش رقم)، `modeChanged` (التلقائي والدخل بقى بيسأل).
 */
export type IncomeRecordOutcome = PayOutcome | 'missing' | 'uncertain' | 'amount-changed';
export type IncomeRecordResult = {
  /**
   * `recordedTotal` (الجولة الأخيرة 2026-11-18): مجموع المبالغ اللي **اتكتبت فعلاً** على عمليات `recorded` — من الكتابة نفسها
   * أو من العملية على السيرفر (الرد اللي ضاع). موجود بس لما `recorded` مش فاضي؛ الإشعار بياخده بدل `inc.amount × العدد`.
   */
  outcome: IncomeRecordOutcome; recorded: string[]; recordedTotal?: number;
  stopped?: boolean; skipped?: boolean; already?: boolean; changed?: boolean; badAmount?: boolean; modeChanged?: boolean;
};
/** `seenAmount` = المستخدم أكّد المبلغ المعتاد ده (مش كتب رقم بإيده) — الذرة بترفض لو المعتاد على السيرفر مختلف */
export type IncomeRecordOpts = { auto?: boolean; seenAmount?: number };
export type ChargeKind = 'subscription' | 'gamiya';

/**
 * نتيجة `recordCharges` (الاشتراكات والجمعية — مراجعة 2026-11-17). فوق `PayOutcome`:
 * - `missing`: الاشتراك/الجمعية اتمسح (من جهاز تاني) — مفيش حاجة اتسجلت، ومش فشل.
 * - `uncertain`: الذرة فشلت بعد ما ممكن تكون وصلت، وسؤال السيرفر كمان فشل — ممنوع "مفيش أي خصم اتسجل".
 * ولما `recorded` فاضي، السبب بيتقال: `stopped` (اتوقف)، `skipped` (اتقفلت "ما اتخصمش" من جهاز تاني)،
 * `changed` (الفترة مابقتش في الجدول — المعاد اتغيّر). من غير ولا واحد منهم = اتسجلت فعلاً قبل كده.
 */
export type ChargeRecordOutcome = PayOutcome | 'missing' | 'uncertain';
export type ChargeRecordResult = {
  outcome: ChargeRecordOutcome; recorded: string[]; stopped?: boolean; skipped?: boolean; changed?: boolean;
  /** الفترة مفتوحة بس المبلغ اللي اتبعت (أو المتخزّن) مش رقم صالح — ما اتسجلش، ومش "اتسجلت قبل كده" */
  badAmount?: boolean;
};
/** "سدّد" من شاشة الاشتراكات */
export type SubscriptionPayOutcome = PayOutcome | 'already-paid-today' | 'stopped' | 'amount-changed' | 'period-changed' | 'missing' | 'uncertain';
/**
 * "ما اتخصمش": `already-recorded` = الفترة اتسجل عليها خصم فعلاً (ممنوع نقول "مش هنسجل خصم")،
 * `stopped` = الاشتراك اتوقف، `period-changed` = الفترة مابقتش مفتوحة لسبب تاني (المعاد اتغيّر).
 */
/** `no-account`: مفيش حساب مفتوح — مش "النت" (الجولة الأخيرة 2026-11-18) */
export type SkipChargeOutcome = PayOutcome | 'missing' | 'already-recorded' | 'stopped' | 'period-changed' | 'uncertain' | 'no-account';

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
/** سقف حفظ النسخة المتشفّرة قبل الكتابة — بعده الكتابة بتمشي والحفظ بيكمّل ورا (فشله مبيوقّفش العملية) */
const OUTBOX_PERSIST_TIMEOUT_MS = 800;
/** سقف إعادة مدخلة واحدة عند الفتح — بعده بتستنى الفتحة الجاية (`runTransaction` بترفض لوحدها بعد ~10 ثواني) */
const OUTBOX_REPLAY_TIMEOUT_MS = 20000;
/** أقصى عدد مرات الإعادة في الجلسة الواحدة (مع كل رجوع للنت) */
const OUTBOX_REPLAY_RUNS_PER_SESSION = 3;

/** بيرفض بعد وقت محدد — عشان سؤال السيرفر ميعلّقش الشاشة أوفلاين */
/** بيستنى الوعد بحد أقصى `ms` ومبيرميش — بعد السقف الشغل بيكمّل ورا (حفظ الطابور المتشفّر قبل الكتابة) */
async function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
  await settleWithin(p, ms);
}

/** زي `waitAtMost` بس بيقول خلص ازاي — مسح العملية محتاج يعرف شيل مدخلتها نجح ولا لأ */
async function settleWithin(p: Promise<unknown>, ms: number): Promise<'ok' | 'failed' | 'timeout'> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    p.then(() => 'ok' as const, () => 'failed' as const),
    new Promise<'timeout'>(res => { t = setTimeout(() => res('timeout'), ms); }),
  ]);
  if (t) clearTimeout(t);
  return r;
}

/** سقف سؤال السيرفر "الدفعة/الزيادة وصلت ولا لأ؟" بعد ما الذرة فشلت (بند 1) */
const LANDED_CHECK_TIMEOUT_MS = 8000;

/**
 * معرّف سطر دفعة/زيادة في الدين. بيتعمل **برّه** الذرة (زي `txRef`): فايرستور بتعيد الـcallback لما الرد
 * يضيع (`unavailable`/`deadline-exceeded`) والـcommit اللي قبله ممكن يكون وصل — المعرّف الثابت هو اللي
 * بيخلي اللفة التانية تعرف إنها اتكتبت خلاص ومتضيفهاش تاني.
 */
function newDebtEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** السطر ده موجود في مصفوفة الدين؟ بالمعرّف، أو (للدفعة) بالعملية المربوطة */
function debtHasEntry(data: unknown, key: 'payments' | 'increases', entryId: string, txId?: string): boolean {
  const list = (data as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(list)) return false;
  return list.some(e => !!e && typeof e === 'object'
    && ((e as { id?: unknown }).id === entryId || (!!txId && (e as { transactionId?: unknown }).transactionId === txId)));
}

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
  /** معرّفات العمليات اللي ليها مدخلة في الطابور المتشفّر للحساب الحالي (`lib/outboxStore.ts`) */
  const outboxIds = useRef(new Set<string>());
  const [outboxCount, setOutboxCount] = useState(0);
  const uidNow = useRef(uid);
  uidNow.current = uid;
  /** إعادة الطابور: مرة لكل حساب في الجلسة لما تخلص؛ لو فضل حاجة (النت وقع) بتتعاد مع رجوع الاتصال */
  const outboxReplay = useRef<{ uid?: string; running: boolean; done: boolean; runs: number }>({ running: false, done: false, runs: 0 });
  /** مدخلات اتعرضت رسالتها (مش مقروءة/اترفضت/المحفظة اتقفلت) ومستنية "تمام" — متتعرضش مرتين ومتتعادش */
  const outboxNoticeShown = useRef(new Set<string>());
  /** معرّفات اتشالت في الجلسة دي — قراية متأخرة للطابور متضيفهاش تاني للعدّاد */
  const outboxDropped = useRef(new Set<string>());
  const latestTransactions = useRef(transactions);
  latestTransactions.current = transactions;
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
  /**
   * اشتراكات عليها خصم شغال دلوقتي (ذرة "سدّد"/الكارت/التلقائي) — بند H: المسح بيستنى لحد ما يخلص، غير كده
   * العملية اللي الذرة بتكتبها كانت ممكن تفضل يتيمة بعد ما الاشتراك اتمسح.
   */
  const chargeInFlight = useRef(new Map<string, number>());
  /** عدّاد مش Set (مراجعة الجمعية): "اتخصم" والتلقائي على نفس الجمعية مع بعض — اللي يخلص الأول كان بيشيل العلامة والتاني لسه شغال */
  const chargeBegin = (id: string) => { chargeInFlight.current.set(id, (chargeInFlight.current.get(id) ?? 0) + 1); };
  const chargeEnd = (id: string) => {
    const n = (chargeInFlight.current.get(id) ?? 0) - 1;
    if (n > 0) chargeInFlight.current.set(id, n); else chargeInFlight.current.delete(id);
  };
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

  /**
   * الطابور المتشفّر والحساب: الخروج (أو حساب تاني) ← مدخلات الحساب القديم **ومفتاحه** بيتمسحوا (قرار مؤمن 1 — رسالة
   * الخروج بتقول العدد). الدخول ← مدخلات أي حساب تاني فاضلة على الجهاز بتتكنس (العدد بس في اللوج)، ومعرّفات الحساب ده
   * بتتقري عشان `outboxCount` والـlistener.
   */
  const outboxUidPrev = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = outboxUidPrev.current;
    outboxUidPrev.current = uid;
    outboxIds.current = new Set();
    setOutboxCount(0);
    outboxReplay.current = { uid, running: false, done: false, runs: 0 };
    outboxNoticeShown.current = new Set();
    outboxDropped.current = new Set();
    if (prev && prev !== uid) {
      if (consumeUserSignOut(prev)) {
        // علامة "اتمسح قبل كده" الأول (بالمعرّفات، بعد ما أي حفظ لسه شغال يخلص — مفيش حفظ متأخر يفلت منها): لو المسح
        // فشل، الإعادة مبترجّعش اللي المستخدم اختار إنه يضيع. المسح الناجح بيشيلها. الاتنين فشلوا ← محاولة كمان، وبعدين Sentry
        const clearSignedOut = async (): Promise<boolean> => {
          let marked = true;
          try { await setOutboxClearedIds(prev, await outboxIdsAfterPendingSaves(prev)); }
          catch (e) { marked = false; logOutboxFailure('cleared marker failed', e); }
          try { await clearOutboxForUid(prev, () => uidNow.current); return true; }
          catch (e) { logOutboxFailure('clear on sign-out failed', e); return marked; }
        };
        void clearSignedOut()
          .then(ok => (ok ? true : clearSignedOut()))
          .then(ok => { if (!ok) reportOutboxEvent('signout-clear-failed'); });
      } else {
        // خروج من غير ما المستخدم يطلبه (التوكن اتلغى…) ← المدخلات بتفضل لنفس الحساب (الـAAD والكنس بيعزلوا غيره)
        console.warn('[outbox] unexpected sign-out, entries kept');
      }
    }
    if (!uid) return;
    sweepOtherOutboxes(uid, () => uidNow.current)
      .then(n => { if (n > 0) console.warn('[outbox] swept entries of another account', n); })
      .catch(e => logOutboxFailure('sweep failed', e));
    listOutboxEntries(uid)
      .then(list => {
        if (uidNow.current !== uid) return;
        list.forEach(e => { if (!outboxDropped.current.has(e.txId)) outboxIds.current.add(e.txId); });
        setOutboxCount(outboxIds.current.size);
      })
      .catch(e => logOutboxFailure('list failed', e));
  }, [uid]);

  /**
   * إعادة الطابور عند الفتح (`replayOutbox`): لما الحساب يبان، والسيرفر متاح، وعلامة مسح الحساب اتقرت (`setupStatus`
   * بيفضل `checking` لحد ما تتقري) ومفيش مسح شغال. لو فضل حاجة (النت وقع في النص) بتتعاد مع رجوع الاتصال.
   */
  useEffect(() => {
    if (!uid || !serverReachable || setupStatus === 'checking' || deletingRef.current) return;
    const st = outboxReplay.current;
    if (st.uid === uid && (st.running || st.done)) return;
    // سقف للجلسة: كل رجوع للنت كان بيعيد محاولة فاشلة (علامة مااتكتبتش…) من غير نهاية — الفتحة الجاية بتحاول تاني
    const runs = (st.uid === uid ? st.runs : 0) + 1;
    if (runs > OUTBOX_REPLAY_RUNS_PER_SESSION) return;
    outboxReplay.current = { uid, running: true, done: false, runs };
    replayOutbox(uid)
      .catch(e => { logOutboxFailure('replay failed', e); return false; })
      .then(done => { if (outboxReplay.current.uid === uid) outboxReplay.current = { uid, running: false, done, runs }; });
  }, [uid, serverReachable, setupStatus]);

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
      // الطابور المتشفّر: العملية ظهرت من غير كتابة معلّقة ← السيرفر عنده نسختها، المدخلة ملهاش لازمة
      // (من غير تخزين على القرص: مستند من غير `hasPendingWrites` في الكاش ده اتشاف من السيرفر في الجلسة دي)
      if (outboxIds.current.size > 0) {
        snap.docs.forEach(d => { if (!d.metadata.hasPendingWrites && outboxIds.current.has(d.id)) dropOutbox(uid, d.id); });
      }

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
  async function addTransaction(tx: Omit<Transaction, 'id'>, opts?: { durable?: true }): Promise<string> {
    // ممنوع '' هنا: المودال كان بيعتبرها نجاح ويقفل من غير ما يكتب حاجة (silent-failure-hunter)
    if (!uid) throw new Error('addTransaction: no signed-in user');
    // بنضمن وجود createdAt دايمًا عشان الوقت يظهر مع كل العمليات (حتى اللي بتتولد من الديون والاشتراكات والجمعية)
    const withTimestamp = { createdAt: new Date().toISOString(), ...tx };
    const clean = Object.fromEntries(Object.entries(withTimestamp).filter(([, v]) => v !== undefined));
    if (!opts?.durable) return addDocNoWait('transactions', clean, 'العملية');
    // العملية المربوطة (دخل/اشتراك/جمعية/تسوية) بتتكتب مع سجلها — إعادتها لوحدها كانت هتعمل عملية من غير سجل
    if (hasLinkFields(clean)) {
      console.warn('[outbox] durable refused for a linked transaction');
      return addDocNoWait('transactions', clean, 'العملية');
    }
    return addDurableTransaction(uid, clean);
  }

  /**
   * الطابور المتشفّر (reports/2026-11-16-outbox-design.md): النسخة على الجهاز الأول (بسقف `OUTBOX_PERSIST_TIMEOUT_MS`)،
   * وبعدين نفس كتابة `addDocNoWait`. فشل الحفظ أو بطؤه **مبيوقّفش** الكتابة — الطابور حماية زيادة مش شرط.
   * المدخلة بتتشال لما العملية تظهر في الـlistener من غير كتابة معلّقة، أو لو `setDoc` اترفض (رسالة `track` العادية).
   */
  async function addDurableTransaction(forUid: string, clean: Record<string, unknown>): Promise<string> {
    const ref = doc(collection(db, 'users', forUid, 'transactions'));
    const id = ref.id;
    outboxIds.current.add(id);
    setOutboxCount(outboxIds.current.size);
    const put = putOutboxEntry(forUid, id, clean).then(
      r => { if (r === 'skipped') { console.warn('[outbox] limit reached, not persisted'); reportOutboxEvent('limit-reached'); forgetOutboxId(id); } },
      e => { logOutboxFailure('persist failed', e); reportOutboxEvent('persist-failed'); forgetOutboxId(id); },
    );
    await waitAtMost(put, OUTBOX_PERSIST_TIMEOUT_MS);
    // رفض نهائي بس (القواعد/شكل البيانات) بيشيل المدخلة — أي كود تاني (طابور اتلغى مع خروج غصب…) ← تفضل للإعادة
    track(setDoc(ref, clean).catch(e => {
      if (isFinalWriteRejection(e)) dropOutbox(forUid, id);
      throw e;
    }), 'العملية');
    return id;
  }

  function forgetOutboxId(id: string) {
    outboxDropped.current.add(id);
    if (!outboxIds.current.delete(id)) return;
    setOutboxCount(outboxIds.current.size);
  }

  /** شيل مدخلة من الطابور (اتأكدت، اترفضت، اتمسحت). فشل الشيل ← لوج بس: الإعادة بعدين بتلاقيها موجودة فبتشيلها */
  function dropOutbox(forUid: string, id: string) {
    if (uidNow.current === forUid) forgetOutboxId(id);
    return removeOutboxEntry(forUid, id).catch(e => logOutboxFailure('remove failed', e));
  }

  /**
   * إعادة الطابور عند الفتح — مدخلات **جلسة سابقة** بس (الحالية لسه في طابور فايربيز). كل واحدة في `runTransaction`:
   * موجودة على السيرفر ← المدخلة بتتشال **من غير كتابة** (تعديل 100 ← 120 من جهاز تاني ميتمسحش)؛ مش موجودة ← `t.set`.
   * `unavailable`/السقف ← تفضل للمرة الجاية؛ `permission-denied`/`invalid-argument` ← تتشال برسالة واحدة. مش مقروءة
   * (مفتاح ضايع/فك فشل) ← رسالة «ما قدرناش نرجّعها» بالعدد والتاريخ، وبتتشال بعد "تمام". النجاح من غير رسالة (قرار 2).
   *
   * **ثغرة معروفة ومقبولة (قرار مؤمن 3):** العملية وصلت السيرفر والتطبيق اتقفل قبل ما المدخلة تتشال، واتمسحت من جهاز
   * تاني في الثواني دي ← الإعادة هنا بتلاقيها مش موجودة فبترجّعها. مفيش علامة "اتمسحت" على السيرفر نفرّق بيها.
   *
   * بيرجّع `true` لو مفيش حاجة فاضلة تتعاد في الجلسة دي.
   */
  async function replayOutbox(forUid: string): Promise<boolean> {
    let listed: { txId: string; stored: StoredEntry | null }[];
    try { listed = await listOutboxEntries(forUid); } catch (e) { logOutboxFailure('list failed', e); return false; }
    if (uidNow.current !== forUid) return false;
    if (listed.length === 0) return true;
    // اللي اتشال في الجلسة دي أو مستني "تمام" على رسالته ← لا بيتعدّ تاني ولا بيتعاد
    listed = listed.filter(e => !outboxDropped.current.has(e.txId) && !outboxNoticeShown.current.has(e.txId));
    listed.forEach(e => outboxIds.current.add(e.txId));
    setOutboxCount(outboxIds.current.size);
    const sid = outboxSessionId();
    const broken = listed.filter(e => !e.stored).map(e => ({ txId: e.txId, savedAt: null as string | null }));
    let plan = planReplay(listed.filter((e): e is { txId: string; stored: StoredEntry } => !!e.stored), sid);
    // مسح الخروج فشل قبل كده ← المدخلات اللي كانت موجودة وقت الخروج المستخدم اختار إنها تضيع (قرار مؤمن 1)
    let cleared: Set<string>;
    try { cleared = await getOutboxClearedIds(forUid); } catch (e) { logOutboxFailure('cleared marker read failed', e); return false; }
    if (cleared.size > 0) {
      const old = plan.filter(e => cleared.has(e.txId));
      if (old.length) {
        console.warn('[outbox] dropped entries kept from a failed sign-out clear', old.length);
        await Promise.all(old.map(e => dropOutbox(forUid, e.txId)));
        plan = plan.filter(e => !cleared.has(e.txId));
      }
    }
    if (plan.length === 0 && broken.length === 0) return true;
    let key: Uint8Array | null;
    try {
      key = await readOutboxKey(forUid);
      clearOutboxKeyReadFailures(forUid).catch(e => logOutboxFailure('keyfail clear failed', e));
    } catch (e) {
      logOutboxFailure('key read failed', e);
      // فشل مرة ← نستنى الجلسة الجاية؛ فشل في جلستين مختلفتين ← مش هنقدر نقراها، فرسالة «ما قدرناش نرجّع» بدل الاستنى للأبد
      let sessions = 0;
      try { sessions = await noteOutboxKeyReadFailure(forUid); } catch (e2) { logOutboxFailure('keyfail note failed', e2); reportOutboxEvent('meta-write-failed'); }
      if (sessions < OUTBOX_KEY_FAIL_SESSIONS) return false;
      key = null;
    }
    const readable: { txId: string; data: Record<string, unknown>; stored: StoredEntry }[] = [];
    const unreadable = [...broken];
    for (const e of plan) {
      const opened = openEntry(e.stored, forUid, e.txId, key);
      if (opened.ok) readable.push({ txId: e.txId, data: opened.data, stored: e.stored });
      else unreadable.push({ txId: e.txId, savedAt: e.stored.savedAt });
    }
    if (unreadable.length > 0) {
      unreadable.forEach(u => outboxNoticeShown.current.add(u.txId));
      console.warn('[outbox] unreadable entries', unreadable.length);
      const dates = unreadable.map(u => u.savedAt).filter((d): d is string => isDateStr(d)).sort();
      // مفيش مفتاح جديد عليها، ومبتتشالش غير بعد ما المستخدم يشوف الرسالة — قفل التطبيق قبل "تمام" ← بتظهر تاني
      notice(OUTBOX_UNREADABLE_TITLE, unreadableReplayBody(unreadable.length, dates[0] ?? todayStr(), todayStr()), () => {
        unreadable.forEach(u => { outboxNoticeShown.current.delete(u.txId); void dropOutbox(forUid, u.txId); });
      });
    }
    if (readable.length === 0) return true;
    if (deletingRef.current || uidNow.current !== forUid) return false;
    if (!(await waitForOurWritesToLand())) return false;
    let allDone = true;
    /** بتتشال بعد "تمام" على رسالتها مش قبل (لو التطبيق اتقفل قبل ما يشوفها بتظهر تاني) */
    const giveUp: { txId: string; data: Record<string, unknown>; kind: 'rejected' | 'repeated' | 'wallet' }[] = [];
    const noteMeta = (txId: string, patch: Pick<StoredEntry, 'rj' | 'fa'>) =>
      updateOutboxMeta(forUid, txId, patch).catch(e2 => { logOutboxFailure('meta failed', e2); reportOutboxEvent('meta-write-failed'); });
    for (const r of readable) {
      if (deletingRef.current || uidNow.current !== forUid || !serverReachableRef.current) { allDone = false; break; }
      // العملية اتمسحت وشيل مدخلتها فشل ← علامة المسح بتمنع الإعادة. قراية العلامة فشلت ← منكتبش (المرة الجاية)
      try {
        if (await hasOutboxTombstone(forUid, r.txId)) { await dropOutbox(forUid, r.txId); continue; }
      } catch (e) { logOutboxFailure('tombstone read failed', e); allDone = false; continue; }
      try {
        const res = await withTimeout(countPending(replayOutboxDoc(forUid, r.txId, r.data)), OUTBOX_REPLAY_TIMEOUT_MS);
        if (res === 'wallet-gone') { giveUp.push({ txId: r.txId, data: r.data, kind: 'wallet' }); continue; }
        await dropOutbox(forUid, r.txId);
      } catch (e) {
        noteAtomicFailure('رفع العمليات المحفوظة', e);
        const code = (e as { code?: string })?.code;
        // السقف خلص (أو deadline) والذرة ممكن لسه توصل ← مش فشل يتحسب؛ تفضل للمرة الجاية
        const inFlight = (e instanceof Error && e.message === 'timeout') || code === 'deadline-exceeded';
        if (inFlight) { allDone = false; continue; }
        if (code === 'invalid-argument') {
          giveUp.push({ txId: r.txId, data: r.data, kind: 'rejected' });
        } else if (code === 'permission-denied') {
          // أول رفض ممكن يكون التوكن لسه ما اتربطش بعد الدخول ← نعلّم الجلسة ونستنى. اتكرر في جلسة تانية ← رفض حقيقي
          if (r.stored.rj && r.stored.rj !== sid) giveUp.push({ txId: r.txId, data: r.data, kind: 'rejected' });
          else {
            allDone = false;
            if (!r.stored.rj) await noteMeta(r.txId, { rj: sid });
          }
        } else {
          // النت/تعارض… ← تفضل، بس بعد `OUTBOX_MAX_FAILED_SESSIONS` جلسات مختلفة بنقول للمستخدم بدل ما تستنى للأبد
          const fa = [...new Set([...(r.stored.fa ?? []), sid])];
          if (fa.length >= OUTBOX_MAX_FAILED_SESSIONS) giveUp.push({ txId: r.txId, data: r.data, kind: 'repeated' });
          else {
            allDone = false;
            await noteMeta(r.txId, { fa });
          }
        }
      }
    }
    // قبل أي "سجّلها تاني": العملية لازم تكون **مش** على السيرفر (محاولة قديمة عدّت السقف ممكن تكون وصلت) — موجودة ← اترفعت،
    // بتتشال من غير رسالة. مقدرناش نتأكد ← تفضل للمرة الجاية (مش رسالة ممكن تعمل نسخة تانية)
    const confirmedGiveUp: typeof giveUp = [];
    for (const g of giveUp) {
      const status = await serverTxStatus(forUid, g.txId, OUTBOX_REPLAY_TIMEOUT_MS);
      if (status === 'present') { await dropOutbox(forUid, g.txId); continue; }
      if (status === 'missing') confirmedGiveUp.push(g);
      else allDone = false;
    }
    if (confirmedGiveUp.length > 0 && uidNow.current === forUid) {
      confirmedGiveUp.forEach(g => outboxNoticeShown.current.add(g.txId));
      hapticError();
      const today = todayStr();
      const bodyFor = { rejected: rejectedReplayBody, repeated: repeatedFailReplayBody, wallet: walletGoneReplayBody };
      const body = confirmedGiveUp.map(g => bodyFor[g.kind](g.data.amount, g.data.date, today)).join('\n\n');
      notice(WRITE_ERROR_TITLE, body, () => {
        confirmedGiveUp.forEach(g => { outboxNoticeShown.current.delete(g.txId); void dropOutbox(forUid, g.txId); });
      });
    }
    return allDone;
  }

  async function updateTransaction(id: string, tx: Partial<Transaction>, settlements: Settlement[] = []) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    // لسه في الطابور المتشفّر ← التعديل بيتدمج في المدخلة (قرار مؤمن 4) عشان الإعادة متكتبش الرقم القديم.
    // التسوية (محفظة مؤرشفة) برّه الطابور عن قصد — بتمشي مع الـbatch العادي
    // من غير سقف: تخزين محلي، ولازم يخلص قبل ما فايربيز تبعت التعديل
    if (outboxIds.current.has(id)) {
      const forUid = uid;
      // مقدرناش ندمج (مش مقروءة/فشل) ← نكتب المدخلة من جديد بالعملية كاملة بعد التعديل — بس لو لسه مستنية (مش اتأكدت
      // واتشالت في النص؛ إحياها كان هيرجّع عملية). مفيش مدخلة أصلاً ← مبنعملش واحدة
      const fallback = () => {
        if (!outboxIds.current.has(id) || outboxDropped.current.has(id)) return null;
        const base = latestTransactions.current.find(t => t.id === id);
        if (!base) return null;
        const { id: _id, ...rest } = base;
        return mergePatch(rest, clean);
      };
      let result: Awaited<ReturnType<typeof mergeOrRewriteOutboxEntry>>;
      try { result = await mergeOrRewriteOutboxEntry(forUid, id, clean, fallback); }
      catch (e) { logOutboxFailure('merge failed', e); result = 'unprotected'; }
      if (result === 'unprotected' && outboxIds.current.has(id)) {
        // المدخلة القديمة (بالرقم القديم) أسوأ من مفيش: الإعادة كانت هتكتبه. بنشيلها ونقول للمستخدم إن العملية مش محمية
        console.warn('[outbox] edit not protected, entry dropped');
        await dropOutbox(forUid, id);
        notice(OUTBOX_EDIT_UNPROTECTED_TITLE, OUTBOX_EDIT_UNPROTECTED_BODY);
      }
    }
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
          // **إلا** لو ده تعديلنا نفسه: الـcommit وصل والرد ضاع واللفة دي إعادة (بند 6) ← تمام من غير كتابة
          const cleanEdit = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
          if (linkedEditAlreadyApplied(debt, txId, current as unknown as Record<string, unknown>, cleanEdit)) {
            return;
          }
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
      if (e instanceof WalletMissingError || e instanceof LinkedTxMissingError || e instanceof DebtMissingError) {
        noteAtomicFailure('تعديل عملية الدين', e);
        return { outcome: e instanceof WalletMissingError ? 'wallet-missing' : 'gone' };
      }
      // رفض من غير سبب بتاعنا (نت/سقف): الـcommit ممكن يكون وصل والرد ضاع (الجولة 2، بند 3 — زي الدفعة). السيرفر
      // الأول: العملية **و**سطرها في الدين عليهم التعديل ده ← done؛ مش عليهم ← failed؛ السؤال فشل ← uncertain
      const landed = await linkedEditLanded(debtRef, txRef, txId, tx);
      if (landed === 'landed') return { outcome: 'done', note: result.note };
      noteAtomicFailure('تعديل عملية الدين', e);
      if (landed === 'gone') return { outcome: 'gone' };
      return { outcome: landed === 'unknown' ? 'uncertain' : 'failed' };
    }
  }

  /** تعديل عملية الدين وصل؟ نفس فحص إعادة الذرة (`linkedEditAlreadyApplied`) بس على قراية من السيرفر بسقف */
  async function linkedEditLanded(
    debtRef: DocumentReference, txRef: DocumentReference, txId: string, tx: Record<string, unknown>,
  ): Promise<'landed' | 'missing' | 'gone' | 'unknown'> {
    try {
      const [txSnap, debtSnap] = await withTimeout(Promise.all([getDocFromServer(txRef), getDocFromServer(debtRef)]), LANDED_CHECK_TIMEOUT_MS);
      if (!txSnap.exists() || !debtSnap.exists()) return 'gone';
      const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
      const debt = debtFromDoc<Debt>(debtRef.id, debtSnap.data(), true);
      return linkedEditAlreadyApplied(debt, txId, txSnap.data() as Record<string, unknown>, clean) ? 'landed' : 'missing';
    } catch (e) {
      // كود الخطأ بس (sentryScrub)
      console.warn('[debt] linked edit landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return 'unknown';
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
  const cascadeInputs = useRef({ wallets, transactions, loadErrors, debts });
  cascadeInputs.current = { wallets, transactions, loadErrors, debts };
  /** آخر اشتراكات (بند H) — مسح الاشتراك بيقرا `closed`/`history` من آخر render مش من نسخة التأكيد */
  const latestSubscriptions = useRef(subscriptions);
  latestSubscriptions.current = subscriptions;
  /** نفس الفكرة للجمعية (بند C) */
  const latestGamiyas = useRef(gamiyas);
  latestGamiyas.current = gamiyas;

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
  function stageReconcile(batch: WriteBatch, txId: string): { pruneSubscription?: string } {
    if (!uid) return {};

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
        return {};
      }
      // دفعة أو زيادة: **مش هنا** — `deleteTransaction` بيوديها ذرة من السيرفر (`deleteDebtLinkedTransaction`، الجولة 2،
      // بند 1). الـbatch ده كان بيشيلها بـ`arrayRemove` من حالة الرياكت، وسطر اتعدّل من جهاز تاني كان بيفضل بعملية اتمسحت
    }

    // بند (مراجعة 2026-11-17): الاشتراك والفترة من **العملية نفسها** (`subscriptionId` + `periodKey`) — سطرها في
    // `history` عندنا ممكن يكون ناقص (التلقائي من جهاز تاني لسه ما وصلش، أو اتشال)، وكان بيسيب الفترة مقفولة على عملية
    // اتمسحت فمبتسألش تاني. لو السطر موجود بيتشال كمان
    const tx = transactions.find(x => x.id === txId);
    const txSub = tx?.subscriptionId ? subscriptions.find(x => x.id === tx.subscriptionId) : undefined;
    const txKey = typeof tx?.periodKey === 'string' && isDateStr(tx.periodKey) ? tx.periodKey : undefined;
    if (txSub && txKey && txSub.closed?.[txKey]?.txId === txId) {
      const row = (txSub.history || []).find(h => h.transactionId === txId);
      const rollBack = subscriptionNextCycle(txSub, txKey) === txSub.nextDueDate;
      batch.update(doc(db, 'users', uid, 'subscriptions', txSub.id),
        new FieldPath('closed', txKey), { reopened: true, at: new Date().toISOString() },
        ...(row ? ['history', arrayRemove(row)] : []),
        ...(rollBack ? ['nextDueDate', txKey] : []));
      return { pruneSubscription: txSub.id };
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
        // لو السطر هنا مش مطابق حرفيًا للي على السيرفر (جهاز تاني لسه ما وصلناش تحديثه)،
        // arrayRemove مبيلاقيهوش — فبعد ما الدفعة توصل `pruneSubscriptionHistory` بيشيله بمعرّف
        // العملية من نسخة السيرفر (الجولة 2: "سدّد" بيقرا history، فالسطر الفاضل مش من غير أثر)
        // ولو دي الفترة اللي قبل المعاد على طول، المعاد بيرجع لها (نفس العقد القديم:
        // الشاشة تقول "مستحق" عنها مش عن اللي بعدها) — وهي لسه "بتسأل" مش تلقائي
        const rollBack = subscriptionNextCycle(sub, key) === sub.nextDueDate;
        batch.update(doc(db, 'users', uid, 'subscriptions', sub.id),
          'history', arrayRemove(history[idx]),
          new FieldPath('closed', key), { reopened: true, at: new Date().toISOString() },
          ...(rollBack ? ['nextDueDate', key] : []));
        return { pruneSubscription: sub.id };
      }
      // دفعة قديمة (قبل الفترات) — نفس السلوك القديم
      // لو دي آخر دفعة اتسجلت، بنرجّع موعد الاستحقاق خطوة ورا بعكس نفس المعادلة
      // اللي قدّمته. لو دفعة قديمة، الموعد الحالي لسه صح فبنسيبه زي ما هو
      const isLast = idx === history.length - 1;
      const anchor = subscriptionAnchorDay(sub) ?? Number(sub.nextDueDate.slice(8, 10));
      const rolledBack = sub.frequency === 'monthly' ? addMonthsAnchored(sub.nextDueDate, -1, anchor)
        : sub.frequency === 'yearly' ? addMonthsAnchored(sub.nextDueDate, -12, anchor)
        : addDays(sub.nextDueDate, -(sub.customDays || 30));
      batch.update(doc(db, 'users', uid, 'subscriptions', sub.id), {
        history: history.filter(h => h.transactionId !== txId),
        ...(isLast ? { nextDueDate: rolledBack } : {}),
      });
      return {};
    }

    // شهر الجمعية: **مش هنا** — `deleteTransaction` بيوديه ذرة من السيرفر (`deleteGamiyaLinkedTransaction`، بند E): الـbatch
    // ده كان بيكتب مصفوفة الشهور كلها من حالة الرياكت، فشهر اتسجل من جهاز تاني ولسه ما وصلناش كان بيرجع "لسه ما اتسددش"
    return {};
  }

  /**
   * الجولة 2 (money-reviewer): بعد ما مسح عملية الاشتراك يوصل السيرفر، السطر بتاعها بيتشال من `history` **من نسخة
   * السيرفر** (ذرة، بمعرّف العملية) — `arrayRemove` في الدفعة بيدوّر على نسخة الرياكت بالظبط، ولو جهاز تاني عدّل السطر
   * ولسه ما وصلناش كان بيسيبه ساكت. والسطر ده مش شكلي: "سدّد" بيقرا `history` (نفس اليوم ونفس المبلغ ← "اتسجل النهاردة
   * خلاص"، ومعرّف ثابت موجود ← مفيش سطر جديد). الدفعة نفسها بتفضل أوفلاين وبتعمل كل اللي تقدر عليه؛ ده تنضيف بعدها.
   * فشله بيتقال (Sentry باسم الخطوة) — الفلوس صح والفترة بترجع تسأل في الحالتين.
   */
  async function pruneSubscriptionHistory(subId: string, txId: string) {
    if (!uid) return;
    const ref = doc(db, 'users', uid, 'subscriptions', subId);
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists()) return;
        const history = ((snap.data() as { history?: SubscriptionPayment[] }).history) || [];
        const kept = history.filter(h => h?.transactionId !== txId);
        if (kept.length !== history.length) t.update(ref, { history: kept });
      }));
    } catch (e) {
      noteAtomicFailure('تنضيف سجل الاشتراك', e);
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
  async function deleteTransaction(id: string, settlements: Settlement[] = []): Promise<TxDeleteResult> {
    // مفيش حساب ← مفيش مسح، فمش "اتمسحت" (المودال كان بيتقفل والعملية لسه موجودة)
    if (!uid) return { outcome: 'no-account' };
    // المدخلة الأول: لو التطبيق اتقفل بعد الحذف وقبل شيلها، الإعادة كانت هترجّع العملية اللي اتمسحت
    // شيلها فشل أو اتأخر ← علامة مسح، والإعادة بتشوفها ومبتكتبش
    if (outboxIds.current.has(id)) {
      forgetOutboxId(id);
      const removed = await settleWithin(removeOutboxEntry(uid, id), OUTBOX_PERSIST_TIMEOUT_MS);
      if (removed !== 'ok') {
        console.warn('[outbox] remove before delete', removed, '- writing tombstone');
        await waitAtMost(writeOutboxTombstone(uid, id).catch(e => logOutboxFailure('tombstone failed', e)), OUTBOX_PERSIST_TIMEOUT_MS);
      }
    }
    // دفعة أو زيادة دين ← ذرة من السيرفر (الجولة 2، بند 1). الوعد بالمعاد من نفس الـrender اللي بنى التأكيد
    const linkedDebt = debts.find(d => transactionDeleteDebtPlan(d, id));
    if (linkedDebt) {
      const promised = transactionDeleteDebtPlan(linkedDebt, id)!;
      return deleteDebtLinkedTransaction(id, linkedDebt.id, settlements, promised.kind, promised.dueRestore ?? null);
    }
    // عملية شهر جمعية ← ذرة من السيرفر بتعدّل الشهر ده بس (بند E). الجمعية من الشهر المربوط، ولو مش لاقيينه عندنا من
    // `gamiyaId` على العملية نفسها (التحديث لسه ما وصلناش)
    const gamiyaId = gamiyas.find(g => (g.months || []).some(m => m.transactionId === id))?.id
      ?? transactions.find(x => x.id === id)?.gamiyaId ?? brokenTransactions.find(x => x.id === id)?.gamiyaId;
    if (gamiyaId) return deleteGamiyaLinkedTransaction(id, gamiyaId, settlements);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'transactions', id));
    const { pruneSubscription } = stageReconcile(batch, id);
    stageSettlements(batch, settlements);
    const commit = batch.commit();
    track(commit);
    // بعد ما المسح يوصل بس (الدفعة اتأكدت ← النت موجود). فشل الدفعة نفسها بيتقال من `track`
    if (pruneSubscription) commit.then(() => pruneSubscriptionHistory(pruneSubscription, id), () => {});
    return { outcome: 'done' };
  }

  /**
   * مسح عملية شهر جمعية (بند E، مراجعة الجمعية 2026-11-18 — نفس `deleteDebtLinkedTransaction`). كان batch بيكتب
   * `months` كلها من حالة الرياكت: شهر اتسجل من جهاز تاني ولسه ما وصلناش كان بيرجع "لسه ما اتسددش" وعمليته تفضل
   * (بتحرّك الرصيد ومحدش بيسأل عنها). دلوقتي الجمعية بتتقري **من السيرفر** جوه ذرة، والشهر اللي بيرجع يسأل هو اللي
   * مربوط بالعملية دي بس، والعملية والتسوية في نفس الذرة. التمن: محتاجة نت (قاعدة 7) — والنتيجة قاطعة للمودال.
   */
  async function deleteGamiyaLinkedTransaction(txId: string, gamiyaId: string, settlements: Settlement[]): Promise<TxDeleteResult> {
    const subject = 'gamiya' as const;
    if (!uid) return { outcome: 'failed', subject };
    if (!serverReachableRef.current) return { outcome: 'no-connection', subject };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection', subject };
    const gamiyaRef = doc(db, 'users', uid, 'gamiyas', gamiyaId);
    const txRef = doc(db, 'users', uid, 'transactions', txId);
    try {
      await countPending(runTransaction(db, async (t) => {
        const txSnap = await t.get(txRef);
        const gSnap = await t.get(gamiyaRef);
        const g = gSnap.exists() ? gamiyaFromDoc<Gamiya>(gamiyaId, gSnap.data(), true) : null;
        // كل القرايات خلصت — من هنا كتابات بس
        // العملية اتمسحت قبل كده (جهاز تاني، أو commit وصل والرد ضاع): التسوية اتحسبت على أثرها، فمتتكتبش تاني
        if (txSnap.exists()) {
          t.delete(txRef);
          stageSettlements(t, settlements);
        }
        if (!g || !g.months.some(m => m.transactionId === txId)) return;
        // المصفوفة من نسخة السيرفر اللي اتقرت جوه الذرة، والشهر المربوط بالعملية دي بس هو اللي بيتغيّر
        const months = g.months.map(m => {
          if (m.transactionId !== txId) return m;
          const { transactionId: _t, auto: _a, at: _at, ...rest } = m;
          // بيسأل، وعمره ما يتسجل لوحده تاني (`lib/autoCharge.ts`)
          return { ...rest, status: 'pending' as const, reopened: true };
        });
        t.update(gamiyaRef, { months });
      }));
      return { outcome: 'done' };
    } catch (e) {
      // ذرية يعني كله أو مفيش — بس الـcommit ممكن يكون وصل والرد ضاع ← السيرفر الأول، والتسجيل بعده
      const landed = await gamiyaTxDeleteLanded(gamiyaRef, txRef, txId);
      if (landed === 'landed') return { outcome: 'done' };
      noteAtomicFailure('حذف عملية الجمعية', e);
      return { outcome: landed === 'unknown' ? 'uncertain' : 'failed', subject };
    }
  }

  /** مسح عملية الجمعية وصل؟ = العملية مش على السيرفر **و**مفيش شهر مربوط بيها. `unknown` = السؤال نفسه فشل */
  async function gamiyaTxDeleteLanded(
    gamiyaRef: DocumentReference, txRef: DocumentReference, txId: string,
  ): Promise<'landed' | 'missing' | 'unknown'> {
    try {
      const [txSnap, gSnap] = await withTimeout(Promise.all([getDocFromServer(txRef), getDocFromServer(gamiyaRef)]), LANDED_CHECK_TIMEOUT_MS);
      if (txSnap.exists()) return 'missing';
      const raw = gSnap.exists() ? (gSnap.data() as { months?: unknown }).months : undefined;
      const linked = Array.isArray(raw) && raw.some((m: { transactionId?: unknown } | null) => m?.transactionId === txId);
      return linked ? 'missing' : 'landed';
    } catch (e) {
      console.warn('[gamiya] tx delete landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return 'unknown';
    }
  }

  /**
   * مسح عملية دفعة/زيادة دين من مودال العملية (الجولة 2، بند 1 — money-reviewer + silent-failure-hunter). كان batch من
   * حالة الرياكت بـ`arrayRemove(السطر)`: لو السطر اتعدّل من جهاز تاني ولسه ما وصلناش، `arrayRemove` مبيلاقيهوش — العملية
   * تتمسح والدفعة تفضل (المدفوع والباقي غلط) والعدد والمعاد يتكتبوا كإنها اتشالت. دلوقتي زي `deleteDebtPayment`:
   * الدين بيتقري **من السيرفر** جوه ذرة، والسطر بيتلاقى بعمليته (`transactionDeleteDebtPlan` — نفس دالة التحذير، D3)،
   * والعدد والفرق والمعاد من النسخة دي، والعملية والتسوية في نفس الذرة. التمن: محتاجة نت (قاعدة 7).
   *
   * **مبيثبّتش قسط الدين القديم** (زي `stageReconcile` بالظبط): الرسالة اتحسبت من غيره. ومبيمنعش المحفظة المؤرشفة —
   * المودال بيعمل تسوية (`settlements`)، عكس شاشة الدين.
   */
  async function deleteDebtLinkedTransaction(
    txId: string, debtId: string, settlements: Settlement[], kind: 'payment' | 'increase', promisedDue: string | null,
  ): Promise<TxDeleteResult> {
    if (!uid) return { outcome: 'failed' };
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(db, 'users', uid, 'transactions', txId);
    // آخر لفة هي اللي بتتكتب (الذرة ممكن تتعاد) — `undefined` = مفيش سطر اتشال فمفيش وعد يتقارن
    const result: { dueRestored: string | null | undefined } = { dueRestored: undefined };
    try {
      await countPending(runTransaction(db, async (t) => {
        result.dueRestored = undefined;
        const txSnap = await t.get(txRef);
        const debtSnap = await t.get(debtRef);
        const debt = debtSnap.exists() ? debtFromDoc<Debt>(debtId, debtSnap.data(), true) : null;
        const plan = debt ? transactionDeleteDebtPlan(debt, txId) : null;
        // كل القرايات خلصت — من هنا كتابات بس
        // العملية اتمسحت قبل كده (جهاز تاني، أو commit وصل والرد ضاع): التسوية اتحسبت على أثرها، فمتتكتبش تاني
        if (txSnap.exists()) {
          t.delete(txRef);
          stageSettlements(t, settlements);
        }
        // الدين اتمسح أو السطر مش فيه ← العملية لوحدها (اللي المستخدم عايزه حاصل)
        if (!debt || !plan) return;
        if (plan.kind === 'increase') noteIgnoredResidue(debt);
        // المصفوفة كلها من نسخة السيرفر اللي اتقرت جوه الذرة — مش `arrayRemove` لسطر من حالة الرياكت
        const patch: Record<string, unknown> = plan.kind === 'payment' ? { payments: plan.payments } : { increases: plan.increases };
        if (plan.residue?.op === 'set') patch.installmentResidue = plan.residue.value;
        if (plan.residue?.op === 'clear') {
          patch.installmentResidue = deleteField();
          noteOnce(`fold:${debtId}`, '[debt] installmentResidue fold failed, cleared', debtId);
        }
        const count = countToWrite(plan.countAfter, debt.installmentCount, debtId);
        if (count !== undefined) patch.installmentCount = count;
        if (plan.dueRestore) patch.dueDate = plan.dueRestore;
        t.update(debtRef, patch);
        result.dueRestored = plan.dueRestore ?? null;
      }));
    } catch (e) {
      // ذرية يعني كله أو مفيش — بس الـcommit ممكن يكون وصل والرد ضاع ← السيرفر الأول، والتسجيل بعده (بند 4)
      const landed = await debtTxDeleteLanded(debtRef, txRef, txId);
      if (landed === 'landed') return { outcome: 'done' };
      noteAtomicFailure('حذف عملية الدين', e);
      return { outcome: landed === 'unknown' ? 'uncertain' : 'failed' };
    }
    // التأكيد وعد إن المعاد هيرجع والذرة (من السيرفر) ما رجّعتوش ← الشاشة بتقول (زي `deleteDebtIncrease`)
    if (promisedDue && result.dueRestored !== undefined && result.dueRestored !== promisedDue) {
      return { outcome: 'done', dueNotRestored: kind };
    }
    return { outcome: 'done' };
  }

  /** مسح عملية الدين وصل؟ = العملية مش على السيرفر **و**مفيش سطر في الدين مربوط بيها. `unknown` = السؤال نفسه فشل */
  async function debtTxDeleteLanded(
    debtRef: DocumentReference, txRef: DocumentReference, txId: string,
  ): Promise<'landed' | 'missing' | 'unknown'> {
    try {
      const [txSnap, debtSnap] = await withTimeout(Promise.all([getDocFromServer(txRef), getDocFromServer(debtRef)]), LANDED_CHECK_TIMEOUT_MS);
      if (txSnap.exists()) return 'missing';
      const data = debtSnap.exists() ? debtSnap.data() : undefined;
      const linked = debtHasEntry(data, 'payments', '', txId) || debtHasEntry(data, 'increases', '', txId);
      return linked ? 'missing' : 'landed';
    } catch (e) {
      console.warn('[debt] tx delete landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return 'unknown';
    }
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
    // L4: بالعلامة، أو بـ`incomeId` على العملية نفسها (سباق "ما نزلش" بيشيل الـtxId من العلامة والعملية لسه موجودة)
    const tx = transactions.find(x => x.id === id);
    for (const inc of incomes) {
      const key = Object.keys(inc.closed || {}).find(k => inc.closed![k].txId === id)
        ?? (tx?.incomeId === inc.id ? tx.periodKey : undefined);
      if (key) {
        return `دي من الدخل الثابت "${inc.name}" عن ${incomePeriodLabel(inc, key, todayStr())} — لو مسحتها مش هتتسجل تاني. لو المبلغ بس غلط، عدّلها بدل ما تمسحها.`;
      }
      if (tx?.incomeId === inc.id) {
        return `دي من الدخل الثابت "${inc.name}" — لو مسحتها مش هتتسجل تاني. لو المبلغ بس غلط، عدّلها بدل ما تمسحها.`;
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
  }): Promise<AddDebtResult> {
    if (!uid) return { outcome: 'done' };
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
    // المحفظة المختارة لازم تكون شغالة — زي الدفعة (`walletUsable`)، بس من آخر حالة معروفة مش من السيرفر:
    // الدين الجديد بيتكتب أوفلاين عن قصد. مؤرشفة أو مش موجودة ← رفض صريح قبل أي كتابة (بند 2)
    if (data.walletId) {
      const w = cascadeInputs.current.wallets.find(x => x.id === data.walletId);
      if (!w || w.archived) {
        console.warn('[debt] add refused, wallet missing or archived');
        return { outcome: 'wallet-missing' };
      }
    }
    // العملية الافتتاحية والدين في **دفعة واحدة** (بند 2): قبل كده كانوا كتابتين، فلو الدين اترفض (القواعد)
    // كانت العملية بتفضل يتيمة في المحفظة. المعرّف بيتعمل هنا عشان الدين يتربط بيه في نفس الكتابة
    const batch = writeBatch(db);
    let initialTransactionId: string | undefined;
    if (data.walletId) {
      const type = data.direction === 'owed_to_me' ? 'expense' : 'income';
      const txRef = doc(collection(db, 'users', uid, 'transactions'));
      batch.set(txRef, {
        createdAt: new Date().toISOString(),
        type, amount: data.totalAmount, walletId: data.walletId, date: data.date,
        note: data.direction === 'owed_to_me' ? `قرض لـ${data.personName}` : `استلاف من ${data.personName}`,
      });
      initialTransactionId = txRef.id;
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
    batch.set(doc(collection(db, 'users', uid, 'debts')), { ...clean, payments: [], increases: [], createdAt: new Date().toISOString() });
    // من غير انتظار (قاعدة 7): الدفعة بتتكتب محليًا على طول وبتترفع لوحدها لما النت يرجع
    track(batch.commit(), namedLabel('الدين', data.personName));
    return { outcome: 'done' };
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
    // مفيش حساب ← مفيش مسح، فمش "تم" ساكت (زي `deleteGamiya`)
    if (!uid) return { outcome: 'blocked', ...NO_ACCOUNT_DELETE_BLOCK_DEBT };
    // من آخر render مش من الـclosure (بند 4): التأكيد اتفتح على نسخة قديمة، ودفعة نزلت وهو مفتوح كانت
    // عمليتها هتفضل يتيمة بعد مسح الدين
    const debt = cascadeInputs.current.debts.find(d => d.id === id);
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
    // برّه الذرة زي `txRef` (بند 1): اللفة اللي بتتعاد بعد commit وصل بتلاقيه وبتقف
    const paymentId = newDebtEntryId();
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    // الجملة بتتحسب جوه العملية الذرية (على الدين اللي اتقرا من السيرفر) وبتتقري
    // من بره بعد ما تنجح. الحامل ده مش ترف: الـcallback ممكن تتعاد لما العملية
    // تتصادم، والقيمة اللي تهمنا هي بتاعة آخر لفة كتبت — لفة لقت الدفعة متسجلة خلاص مبتلمسهوش
    const result: { note: string | null; settledNow: boolean } = { note: null, settledNow: false };
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        // الـcommit اللي قبل كده وصل والرد ضاع ← مفيش كتابة تانية (كانت هتعمل دفعة مكررة على نفس العملية)
        if (debtHasEntry(snap.data(), 'payments', paymentId, txRef.id)) return;
        const debt = debtFromDoc<Debt>(debtId, snap.data(), true);
        // كل القرايات قبل كل الكتابات — شرط من فايربيز نفسها
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', walletId)))) throw new WalletMissingError();

        const type = debt.direction === 'owed_to_me' ? 'income' : 'expense';
        const txData = {
          type, amount, walletId, date,
          categoryId: type === 'expense' ? categoryId : undefined,
          note: debt.direction === 'owed_to_me' ? `استلام دين من ${debt.personName}` : `سداد دين لـ${debt.personName}`,
          createdAt: new Date().toISOString(),
        };
        t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));

        const payment: DebtPayment = {
          id: paymentId,
          date, amount, walletId, transactionId: txRef.id,
          ...(categoryId ? { categoryId } : {}),
        };
        const patch: Record<string, unknown> = {};

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
          if (remainingAfter > PIASTRE_EPS) {
            patch.dueDate = addMonths(debt.dueDate, 1);
            // بند 3: مسح الدفعة بيرجّع المعاد ده لو لسه هو اللي هي حطّته (`dueDateAfterPaymentRemoval`)
            if (isDateStr(debt.dueDate)) { payment.advancedFrom = debt.dueDate; payment.advancedTo = patch.dueDate as string; }
          }
        }
        patch.payments = [...(debt.payments || []), payment];

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
      // الدين اتمسح (جهاز تاني) — مش فشل يتبلغ، و"جرب تاني" مش هتنفع (بند 5). المعرّف بس (sentryScrub)
      if (e instanceof DebtMissingError) {
        console.warn('[debt] payment refused, debt gone', debtId);
        return { outcome: 'gone' };
      }
      if (e instanceof WalletMissingError) {
        noteAtomicFailure('دفعة الدين', e);
        return { outcome: 'wallet-missing' };
      }
      // ذرية يعني كله أو مفيش — **بس** الـcommit ممكن يكون وصل والرد ضاع. فقبل "مفيش أي خصم اتسجل" بنسأل السيرفر
      const landed = await debtEntryLanded(debtRef, 'payments', paymentId, txRef.id);
      if (landed === 'landed') return { outcome: 'done', note: result.note, settledNow: result.settledNow };
      // بعد سؤال السيرفر (الجولة 2، بند 4): كتابة وصلت متتسجلش "فشلت" في اللوج وSentry
      noteAtomicFailure('دفعة الدين', e);
      if (landed === 'gone') return { outcome: 'gone' };
      return { outcome: landed === 'unknown' ? 'uncertain' : 'failed' };
    }
  }

  /**
   * الذرة فشلت — السطر ده وصل السيرفر ولا لأ؟ (بند 1) `unknown` = السؤال نفسه فشل أو عدّى السقف، فالشاشة
   * مبتجزمش بـ"مفيش حاجة اتسجلت".
   */
  async function debtEntryLanded(
    debtRef: DocumentReference, key: 'payments' | 'increases', entryId: string, txId?: string,
  ): Promise<'landed' | 'missing' | 'gone' | 'unknown'> {
    // **شباك ضيق متبقّي (الجولة 2، بند 7):** `missing` معناه "مش على السيرفر **لحظة السؤال**". لو الكلاينت استسلم
    // (السقف/`unavailable`) والـcommit لسه في السكة، السيرفر ممكن يطبّقه **بعد** القراية دي — فالشاشة تقول "ما اتسجلش"
    // والسطر يظهر بعدها في الـlistener. مفيش تكرار ساكت: المعرّف ثابت (`paymentId`/`entryId`)، والمستخدم بيشوف السطر
    // في تاريخ الدين قبل ما يعيد؛ والإعادة نفسها معرّف جديد، فلو عاد من غير ما يبص ← سطرين ظاهرين مش واحد مخفي.
    try {
      const snap = await withTimeout(getDocFromServer(debtRef), LANDED_CHECK_TIMEOUT_MS);
      if (!snap.exists()) return 'gone';
      return debtHasEntry(snap.data(), key, entryId, txId) ? 'landed' : 'missing';
    } catch (e) {
      // كود الخطأ بس — مفيش بيانات (sentryScrub)
      console.warn('[debt] landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return 'unknown';
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
  async function deleteDebtPayment(debtId: string, paymentId: string, out?: DebtEntryDeleteOut): Promise<DebtEntryDeleteOutcome> {
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
        const payment = (debt.payments || []).find(p => p.id === paymentId);
        // اتمسحت قبل كده (من جهاز تاني، أو دوسة اتكررت) — مفيش حاجة تتعمل،
        // والنتيجة "تمام" لأن اللي المستخدم عايزه حاصل فعلاً. ومفيش وعد بالمعاد يتقارن (زي الزيادة)
        if (out) { out.entryGone = !payment; out.dueRestored = undefined; }
        if (!payment) return;
        if (payment.transactionId && payment.walletId
          && await walletArchived(t, doc(db, 'users', uid!, 'wallets', payment.walletId))) {
          throw new WalletArchivedError();
        }
        // السلسلة متوصّلة (الجولة 2، بند 6): مسح دفعة من النص بيورّث بدايتها للي بعدها
        const payments = paymentsAfterRemoval([payment], (debt.payments || []).filter(p => p.id !== paymentId));
        // **العدد لازم يترجع معاها.** من غير ده، دفعة غيّرت العدد من 6 لـ7 وبعدين
        // اتمسحت كانت بتسيب العدد 7 للأبد — فالكارت يقول "القسط 1 من 7" لدين
        // حسابه 6.
        noteIgnoredResidue(debt);
        const pin = pinInstallmentAmount(debt);
        const patch: Record<string, unknown> = { payments, ...pin };
        const recount = installmentCountFor({ ...debt, ...pin, payments });
        const count = countToWrite(recount, debt.installmentCount, debtId);
        if (count !== undefined) patch.installmentCount = count;
        // الدفعة دي قدّمت المعاد وهو لسه زي ما حطّته ← بيرجع (بند 3)، من الدين اللي اتقرا جوه الذرة
        const restore = dueDateAfterPaymentRemoval(debt, [payment], payments);
        if (restore) patch.dueDate = restore;
        // الشاشة بتقارنه باللي التأكيد وعد بيه (الجولة 2، بند 2 — زي `deleteDebtIncrease`)
        if (out) out.dueRestored = restore;
        if (payment.transactionId) t.delete(doc(db, 'users', uid!, 'transactions', payment.transactionId));
        t.update(debtRef, patch);
      }));
      return 'done';
    } catch (e) {
      if (e instanceof DebtMissingError) {
        console.warn('[debt] payment delete refused, debt gone', debtId);
        return 'gone';
      }
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
    // برّه الذرة (بند 1) — زي `addDebtPayment`. الزيادة اللي على الورق مالهاش `txRef`، فالمعرّف ده لوحده اللي بيمنع التكرار
    const entryId = newDebtEntryId();
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    // نفس حامل `addDebtPayment`: الـcallback ممكن تتعاد، والجملة بتاعة آخر لفة كتبت
    const result: { note: string | null; dueNote: string | null } = { note: null, dueNote: null };
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        // الـcommit اللي قبل كده وصل ← مفيش كتابة تانية. **قبل** فحص الباقي (D1): الدين بعد الزيادة باقيه
        // مختلف، فالفحص كان هيقول "الدين اتغيّر" على زيادة اتسجلت فعلاً
        if (debtHasEntry(snap.data(), 'increases', entryId, walletId ? txRef.id : undefined)) return;
        result.note = null;
        result.dueNote = null;
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
            note: debt.direction === 'owed_to_me' ? `زيادة قرض لـ${debt.personName}` : `زيادة استلاف من ${debt.personName}`,
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
          id: entryId,
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
      if (e instanceof DebtMissingError) {
        console.warn('[debt] increase refused, debt gone', debtId);
        return { outcome: 'gone' };
      }
      if (e instanceof WalletMissingError) {
        noteAtomicFailure('زيادة الدين', e);
        return { outcome: 'wallet-missing' };
      }
      // نفس `addDebtPayment`: قبل "مفيش حاجة اتسجلت" بنسأل السيرفر (بند 1)، والتسجيل بعده (الجولة 2، بند 4)
      const landed = await debtEntryLanded(debtRef, 'increases', entryId, walletId ? txRef.id : undefined);
      if (landed === 'landed') return { outcome: 'done', note: result.note, dueNote: result.dueNote };
      noteAtomicFailure('زيادة الدين', e);
      if (landed === 'gone') return { outcome: 'gone' };
      return { outcome: landed === 'unknown' ? 'uncertain' : 'failed' };
    }
  }
  /**
   * حذف الزيادة — ذري زي حذف الدفعة بالظبط، وبيتنادى من نفس المكان وبنفس
   * منع المحفظة المؤرشفة (شوف الملحوظة اللي فوق `deleteDebtPayment`)
   */
  async function deleteDebtIncrease(debtId: string, entryId: string, out?: DebtIncreaseDeleteOut): Promise<DebtEntryDeleteOutcome> {
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
      if (e instanceof DebtMissingError) {
        console.warn('[debt] increase delete refused, debt gone', debtId);
        return 'gone';
      }
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
    // بند C: اليوم الأصلي بيتخزّن من الأول، فـ31 يناير ← 28 فبراير ← 31 مارس (مش 28 للأبد)
    const anchor = rest.frequency === 'custom' ? undefined : subscriptionAnchorDay({ nextDueDate: rest.nextDueDate });
    addDocNoWait('subscriptions', {
      ...clean, ...(anchor ? { anchorDay: anchor } : {}), ...chargeModePatch(chargeMode ?? 'confirm', undefined, todayStr()),
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
    // بند D: المعاد اتغيّر فعلاً (الشاشة بتبعته بس لو اتغيّر، والفحص هنا للي بيبعته زي ما هو)
    const dueMoved = data.nextDueDate !== undefined && data.nextDueDate !== stored?.nextDueDate;
    if (dueMoved && stored) {
      // الجولة 2 (money-reviewer): الحد بيتحسب على شكل الاشتراك **بعد** التعديل (التكرار والأيام واليوم الأصلي الجداد) —
      // بالقديم، سنوي ← شهري كان بيترفض: الحد كان "بعد سنة" من آخر فترة اتقفلت مش "بعد شهر".
      // **الحد من الحالة المحلية مش من ذرة على السيرفر:** فترة اتقفلت من جهاز تاني ولسه ما وصلتناش مش داخلة فيه —
      // شباك ضيق مقبول (التعديل كتابة أوفلاين عادية، والقفل نفسه ذري بمعرّف ثابت فمفيش خصم مرتين)
      const freq = data.frequency ?? stored.frequency;
      const after: Subscription = {
        ...stored,
        frequency: freq,
        customDays: data.customDays ?? stored.customDays,
        anchorDay: freq === 'custom' ? stored.anchorDay : Number(data.nextDueDate!.slice(8, 10)),
      };
      const floor = subscriptionDueFloor(after);
      if (floor && data.nextDueDate! < floor) return dueInsideClosedPeriodEntry(chargeDateLabel(floor, todayStr()));
    }
    if (!uid) return { outcome: 'done' };
    // لازم نشيل قيم undefined — Firestore بترفضها وبترمي خطأ يمنع الحفظ كله
    const current = stored;
    const { chargeMode, chargeAutoSince: _ignored, anchorDay: _anchor, ...rest } = data;
    if (rest.amount !== undefined) rest.amount = storableAmount(rest.amount)!;
    if (!dueMoved) delete rest.nextDueDate;
    const clean: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    // "تلقائي" من النهاردة بس — مش من أول ما الاشتراك اتعمل (`chargeModePatch`)
    if (chargeMode) Object.assign(clean, chargeModePatch(chargeMode, current, todayStr()));
    if (dueMoved) {
      // بند C: اليوم الأصلي = يوم المعاد الجديد
      const freq = data.frequency ?? stored?.frequency;
      if (freq !== 'custom') clean.anchorDay = Number(data.nextDueDate!.slice(8, 10));
      // بند D: المعاد اتنقل على "تلقائي" ← الفترات الجديدة اللي معادها قبل النهاردة بتسأل مش بتتخصم لوحدها
      // (المعاد الجديد بيفتح مفاتيح جديدة — من غير ده كانت بتتخصم تاني فوق اللي اتسجل)
      const mode = chargeMode ?? stored?.chargeMode;
      if (mode === 'auto') clean.chargeAutoSince = todayStr();
    }
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
        t.update(ref, { active: true, nextDueDate: subscriptionResumeDate(server, todayStr()), ...anchorDayPatch(server) });
      }));
      return 'done';
    } catch (e) {
      if (e instanceof WalletMissingError) return 'wallet-missing';
      if (e instanceof ChargeMissingError) return 'missing';
      noteAtomicFailure('رجوع الاشتراك', e);
      return 'failed';
    }
  }
  /**
   * بند H (2026-11-17): العمليات من آخر render (`cascadeInputs`) — مش من الـclosure اللي فتح التأكيد — ومن كل مكان
   * بيشاور عليها: `history`، و`closed` (عملية قفلت فترة وسطرها ضاع من `history`)، وأي عملية عليها `subscriptionId`.
   * وخصم شغال على نفس الاشتراك ← المسح بيستنى: الذرة كانت هتكتب عملية بعد المسح وتفضل يتيمة.
   * **متبقّي:** المسح دفعة أوفلاين (مش ذرة من السيرفر) — عملية تلقائي من جهاز تاني لسه ما وصلتش الـlistener مش هتتمسح.
   */
  async function deleteSubscription(id: string): Promise<CascadeDeleteResult> {
    if (!uid) return { outcome: 'blocked', ...NO_ACCOUNT_DELETE_BLOCK_SUBSCRIPTION };
    const sub = latestSubscriptions.current.find(s => s.id === id);
    if (chargeInFlight.current.has(id)) return { outcome: 'blocked', ...CHARGE_IN_FLIGHT_DELETE_BLOCK };
    return deleteWithTransactions('subscription', sub?.name ?? '', doc(db, 'users', uid, 'subscriptions', id),
      subscriptionTransactionIds(sub, cascadeInputs.current.transactions), namedLabel('حذف الاشتراك', sub?.name));
  }
  /**
   * بيتعمل جوه runTransaction عشان القراية والكتابة يبقوا خطوة واحدة ذرية.
   * قبل كده كان بيقرا الاشتراك من حالة الرياكت، فنداءين في نفس الوقت كانوا
   * الاتنين بيشوفوا نفس الحالة القديمة وبيسجلوا دفعتين — يعني خصم مضاعف.
   * بنقرا من السيرفر جوه العملية الذرية، فالنداء التاني بيلاقي الدفعة اتسجلت
   * ويقف. علامة التكرار هي نفس التاريخ ونفس المبلغ (منقدرش نضيف حقل جديد من
   * غير تعديل قواعد Firestore في الكونسول).
   */
  async function markSubscriptionPaid(id: string, date: string, seenAmount?: number, seenKey?: string): Promise<SubscriptionPayOutcome> {
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
    // مفتاح الفترة بيتحسب من todayStr() بتاعة الدالة دي مش من بارامتر date، فلو حد بعت date قديم مفيش ضمان إنهم زي بعض
    const today = todayStr();
    /**
     * بند A/B (مراجعة 2026-11-17): `at` **برّه** الذرة — نفس القيمة في كل محاولة، فهي بصمتنا على الفترة اللي اتقفلت.
     * فايرستور بتعيد الـcallback لما الرد يضيع والـcommit ممكن يكون وصل: الإعادة بتلاقي الفترة مقفولة ببصمتنا ← `done`
     * (مش "اتسجل النهاردة خلاص")، ولو كل المحاولات فشلت بنسأل السيرفر عن البصمة قبل "مفيش أي خصم اتسجل".
     */
    const at = uniqueStamp();
    const tried = new Set<string>();
    let paidToday = false;
    let oursLanded = false;
    chargeBegin(id);
    try {
      await countPending(runTransaction(db, async (t) => {
        paidToday = false;
        oursLanded = false;
        const snap = await t.get(subRef);
        if (!snap.exists()) throw new ChargeMissingError();
        const sub = subscriptionFromDoc<Subscription>(id, snap.data(), true);
        // محاولة قبل كده وصلت (الرد ضاع) ← دي كتابتنا، مش "اتسجل قبل كده"
        if ([...tried].some(k => closedByUs(sub.closed?.[k], subscriptionTxId(id, k), at))) { oursLanded = true; return; }
        // واقف (ممكن من جهاز تاني والزرار لسه باين هنا) ← مفيش خصم، ونتيجة صريحة
        if (sub.active === false) throw new SubscriptionStoppedError();
        if (seenAmountDiffers(seenAmount, sub.amount)) throw amountChanged(seenAmount, sub.amount);
        // الجولة 2 (money-reviewer): نفس `recordCharges` — المبلغ اللي بيتكتب مقرّب للقرش، ومتخزّن بايظ ← مفيش كتابة
        const amount = storableAmount(sub.amount);
        if (amount === null) throw new BadStoredAmountError();
        const history = sub.history || [];
        // دوستين "سدّد" في نفس اليوم ← دفعة واحدة (عقد قديم — duplication.emulator).
        // بس **مش ساكتة**: الشاشة بتقول إنها اتسجلت النهاردة خلاص، وإن الفترة
        // المتأخرة التانية (لو فيه) في كارت "اتخصم؟" في الرئيسية
        // المقارنة بالقرش: سطر قديم اتكتب بالمبلغ من غير تقريب (100.456) لسه نفس الدفعة
        if (history.some(h => h.date === date && typeof h.amount === 'number' && roundMoney(h.amount) === amount)) { paidToday = true; return; }

        // "سدّد" بيقفل **فترة**: الأقدم المفتوحة (فيها اللي رجعت تسأل)، ولو
        // مفيش — اللي جاية. نفس مفتاح التلقائي ونفس معرّف العملية، فالتلقائي
        // على جهاز تاني بيلاقيها مقفولة ومبيخصمش تاني
        const key = subscriptionManualKey(sub, today);
        // التأكيد سمّى فترة معيّنة؛ لو جهاز تاني قفلها، الأقدم المفتوحة بقت اللي بعدها — مبنقفلش فترة مش اللي المستخدم وافق عليها
        if (seenKey !== undefined && seenKey !== key) throw new PeriodChangedError();
        tried.add(key);
        const txRef = doc(db, 'users', uid!, 'transactions', subscriptionTxId(id, key));

        // المحفظة بتتقري من جوه العملية الذرية عشان الإجابة تبقى عن الحالة
        // اللي هتتكتب عليها فعلاً، مش عن نسخة في ذاكرة الرياكت ممكن تكون
        // قديمة. كل القرايات لازم تسبق كل الكتابات في العملية الذرية.
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', sub.walletId)))) throw new WalletMissingError();
        const existing = await t.get(txRef);

        // موجودة (مقفولة من غير علامة لأي سبب) ← بنقفل الفترة من غير ما نكتب فوقها
        if (!existing.exists()) {
          const txData = {
            type: 'expense' as const, amount, walletId: sub.walletId, date,
            categoryId: sub.categoryId, note: `اشتراك: ${sub.name}`,
            subscriptionId: id, periodKey: key, createdAt: at,
          };
          t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));
        }
        const closed = { ...(sub.closed || {}), [key]: { txId: txRef.id, at } };
        const payment: SubscriptionPayment = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount: existingAmount(existing, amount), transactionId: txRef.id, periodKey: key,
        };
        const nextHistory = history.some(h => h.transactionId === txRef.id) ? history : [...history, payment];
        t.update(subRef, { history: nextHistory, closed, nextDueDate: subscriptionAdvance(sub, closed), ...anchorDayPatch(sub) });
      }));
      return paidToday && !oursLanded ? 'already-paid-today' : 'done';
    } catch (e) {
      if (e instanceof ChargeMissingError) { console.warn('[subscription] pay refused, subscription gone', id); return 'missing'; }
      if (e instanceof SubscriptionStoppedError) return 'stopped';
      // مش فشل (مش Sentry): الشاشة بتقول إن المبلغ اتغيّر والمستخدم يقرر تاني على الجديد
      if (e instanceof AmountChangedError) { console.warn('[subscription] amount changed since shown, nothing written', id, ...amountsForDevLog(e)); return 'amount-changed'; }
      if (e instanceof PeriodChangedError) { console.warn('[subscription] period changed since shown, nothing written', id); return 'period-changed'; }
      if (e instanceof WalletMissingError) return 'wallet-missing';
      // مفيش كتابة خالص (اترفضت قبلها) — مش محتاج سؤال السيرفر. اسم الخطوة بس، من غير المبلغ (sentryScrub)
      if (e instanceof BadStoredAmountError) { console.warn('[subscription] pay refused, stored amount unreadable', id); return 'failed'; }
      // ذرية يعني كله أو مفيش — **بس** الـcommit ممكن يكون وصل والرد ضاع. فقبل "مفيش أي خصم اتسجل" بنسأل السيرفر
      const landed = await subscriptionChargeLanded(subRef, id, [...tried], at);
      if (landed.state === 'landed') return 'done';
      // بعد سؤال السيرفر: كتابة وصلت متتسجلش "فشلت" في اللوج وSentry
      noteAtomicFailure('تسديد الاشتراك', e);
      if (landed.state === 'gone') return 'missing';
      return landed.state === 'unknown' ? 'uncertain' : 'failed';
    } finally {
      chargeEnd(id);
    }
  }

  /**
   * الذرة فشلت — بصمتنا (`at`) وصلت السيرفر على أي فترة من اللي حاولنا نقفلها؟ (بند A، نفس `debtEntryLanded`)
   * `recorded` = الفترات اللي **عمليتها** اتكتبت مننا (`createdAt` = بصمتنا)، مش اللي اتقفلت على عملية موجودة.
   * `unknown` = السؤال نفسه فشل أو عدّى السقف، فالشاشة مبتجزمش بـ"مفيش أي خصم اتسجل".
   * **نفس الشباك الضيق المتبقّي زي الدين:** `missing` = مش على السيرفر **لحظة السؤال**؛ المعرّف ثابت، فلو الـcommit
   * وصل بعدها مفيش تكرار — الإعادة بتلاقي الفترة مقفولة.
   */
  async function subscriptionChargeLanded(
    subRef: DocumentReference, id: string, keys: string[], at: string,
  ): Promise<{ state: 'landed' | 'missing' | 'gone' | 'unknown'; recorded: string[] }> {
    try {
      const [snap, ...txSnaps] = await withTimeout(Promise.all([
        getDocFromServer(subRef),
        ...keys.map(k => getDocFromServer(doc(db, 'users', uid!, 'transactions', subscriptionTxId(id, k)))),
      ]), LANDED_CHECK_TIMEOUT_MS);
      if (!snap.exists()) return { state: 'gone', recorded: [] };
      const closed = (snap.data() as { closed?: Record<string, ChargeClosed> }).closed;
      const ours = keys.filter(k => closedByUs(closed?.[k], subscriptionTxId(id, k), at));
      const recorded = keys.filter((k, i) => ours.includes(k) && txSnaps[i].exists() && txSnaps[i].data()?.createdAt === at);
      return { state: ours.length > 0 ? 'landed' : 'missing', recorded };
    } catch (e) {
      // كود الخطأ بس — مفيش بيانات (sentryScrub)
      console.warn('[subscription] landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return { state: 'unknown', recorded: [] };
    }
  }

  /**
   * نفس فكرة `subscriptionChargeLanded` للجمعية. **الشهر بقى عليه بصمة** (`months[].at`، مراجعة 2026-11-18): `landed` بس لو
   * شهر اتقفل ببصمتنا (= الـcommit بتاعنا وصل) — مقفول من غير بصمتنا = `already` (اتسجل من جهاز تاني/الكارت/التلقائي).
   * قبلها أي شهر مقفول على عمليته الثابتة كان بيتحسب "وصل"، فـ"اتخصم" من الشاشة كانت بتقول "تم" على كتابة مش بتاعتنا.
   * `recorded` = الشهور اللي **عمليتها** اتكتبت مننا (`createdAt` = بصمتنا)، مش اللي اتقفلت على عملية موجودة.
   */
  async function gamiyaChargeLanded(
    ref: DocumentReference, id: string, keys: string[], at: string,
  ): Promise<{ state: 'landed' | 'already' | 'missing' | 'gone' | 'unknown'; recorded: string[] }> {
    try {
      const [snap, ...txSnaps] = await withTimeout(Promise.all([
        getDocFromServer(ref),
        ...keys.map(k => getDocFromServer(doc(db, 'users', uid!, 'transactions', gamiyaTxId(id, k)))),
      ]), LANDED_CHECK_TIMEOUT_MS);
      if (!snap.exists()) return { state: 'gone', recorded: [] };
      const raw = (snap.data() as { months?: unknown }).months;
      const months = (Array.isArray(raw) ? raw : []) as GamiyaMonth[];
      const monthOf = (k: string) => months.find(m => m?.id === k);
      const ours = keys.filter(k => {
        const m = monthOf(k);
        return !!m && m.status === 'done' && m.at === at && m.transactionId === gamiyaTxId(id, k);
      });
      const recorded = ours.filter(k => {
        const tx = txSnaps[keys.indexOf(k)];
        return tx.exists() && tx.data()?.createdAt === at;
      });
      if (ours.length > 0) return { state: 'landed', recorded };
      // `already` = **كل** الشهور اتقفلت من مكان تاني. بعضها بس ← اللي فاضل ما اتسجلش، فده فشل مش "اتسجلت قبل كده"
      // (مراجعة الجولة 2: `some` كانت بتحوّل ذرة فشلت لـ`{done, recorded: []}` والشهر التاني لسه مفتوح)
      if (keys.length > 0 && keys.every(k => monthOf(k)?.status === 'done')) return { state: 'already', recorded: [] };
      return { state: 'missing', recorded: [] };
    } catch (e) {
      console.warn('[gamiya] landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return { state: 'unknown', recorded: [] };
    }
  }

  /**
   * "ما اتخصمش" (اشتراك اتلغى، شهر مجاني). ذري: جهاز تاني ممكن يكون سجّل
   * الفترة دي في نفس اللحظة — لو سبقنا، بنلاقيها مقفولة ومبنكتبش فوق علامته.
   * والنتيجة بتقول ليه ما اتقفلتش (بند E): اتسجل عليها خصم فعلاً، اتوقف، اتمسح، أو الفترة اتغيّرت —
   * الشاشة كانت بتقول "مش هنسجل خصم" والخصم موجود.
   */
  async function skipSubscriptionCharge(id: string, key: string): Promise<SkipChargeOutcome> {
    // مفيش حساب ← ما اتقفلش حاجة، فمش "تم" — وسببه الحساب مش النت
    if (!uid) return 'no-account';
    if (!serverReachableRef.current) return 'no-connection';
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    const subRef = doc(db, 'users', uid, 'subscriptions', id);
    const at = uniqueStamp();
    let result: SkipChargeOutcome = 'done';
    try {
      await countPending(runTransaction(db, async (t) => {
        result = 'done';
        const snap = await t.get(subRef);
        if (!snap.exists()) { result = 'missing'; return; }
        const sub = subscriptionFromDoc<Subscription>(id, snap.data(), true);
        const c = sub.closed?.[key];
        // اتفوّتت خلاص (مننا في محاولة وصلت، أو من جهاز تاني) ← نفس النتيجة
        if (c?.skipped && !c.reopened) return;
        if (c?.txId && !c.reopened) { result = 'already-recorded'; return; }
        // الحالة الحقيقية (money-reviewer): الواقف بيتخطّى اللي رجعت تسأل بس، مش فترة عادية
        if (!subscriptionOpenCharges(sub, todayStr()).some(o => o.key === key)) {
          result = sub.active === false ? 'stopped' : 'period-changed';
          return;
        }
        const closed = { ...(sub.closed || {}), [key]: { skipped: true, at } };
        t.update(subRef, { closed, nextDueDate: subscriptionAdvance(sub, closed), ...anchorDayPatch(sub) });
      }));
      return result;
    } catch (e) {
      try {
        const snap = await withTimeout(getDocFromServer(subRef), LANDED_CHECK_TIMEOUT_MS);
        if (!snap.exists()) return 'missing';
        const c = (snap.data() as { closed?: Record<string, ChargeClosed> }).closed?.[key];
        if (c?.skipped && c.at === at) return 'done';
        // الجولة 2 (silent-failure-hunter): الفترة اتحسمت على السيرفر من مكان تاني — نفس نتيجة الذرة لو كانت قرت ده،
        // مش "مقدرناش" (الشاشة كانت هتقول جرّب تاني وعليها خصم فعلاً)
        if (c && !c.reopened && c.txId) { console.warn('[subscription] skip failed, period already recorded on server', id); return 'already-recorded'; }
        if (c && !c.reopened && c.skipped) { console.warn('[subscription] skip failed, period already skipped on server', id); return 'done'; }
        noteAtomicFailure('فوّت فترة اشتراك', e);
        return 'failed';
      } catch (checkError) {
        console.warn('[subscription] skip landed check failed', (checkError as { code?: string })?.code ?? 'timeout');
        noteAtomicFailure('فوّت فترة اشتراك', e);
        return 'uncertain';
      }
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
   *
   * **الإعادة والرد اللي ضاع (بند A/B، 2026-11-17):** `at` برّه الذرة = بصمتنا على العملية (`createdAt`). الإعادة بعد
   * commit وصل بتلاقي الفترة مقفولة على عملية ببصمتنا ← بتتحسب في `recorded` (مش "اتسجلت من جهاز تاني")، ولو كل
   * المحاولات فشلت بنسأل السيرفر قبل "مفيش أي خصم اتسجل" (`uncertain` لو السؤال كمان فشل).
   */
  async function recordCharges(
    kind: ChargeKind, id: string, entries: { key: string; amount: number }[], opts: { auto?: boolean } = {},
  ): Promise<ChargeRecordResult> {
    if (deletingRef.current) return { outcome: 'failed', recorded: [] };
    if (!uid || entries.length === 0) return { outcome: 'done', recorded: [] };
    if (!serverReachableRef.current) return { outcome: 'no-connection', recorded: [] };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection', recorded: [] };
    const auto = !!opts.auto;
    const ref = doc(db, 'users', uid, kind === 'subscription' ? 'subscriptions' : 'gamiyas', id);
    const today = todayStr();
    const txIdOf = (key: string) => (kind === 'subscription' ? subscriptionTxId(id, key) : gamiyaTxId(id, key));
    const at = uniqueStamp();
    const keys = [...new Set(entries.map(e => e.key))];
    let recorded: string[] = [];
    let reasons: Pick<ChargeRecordResult, 'stopped' | 'skipped' | 'changed' | 'badAmount'> = {};
    // الاشتراك والجمعية الاتنين (بند C): المسح بيستنى الخصم الشغال
    chargeBegin(id);
    try {
      await countPending(runTransaction(db, async (t) => {
        recorded = [];
        reasons = {};
        const snap = await t.get(ref);
        if (!snap.exists()) throw new ChargeMissingError();
        const data = kind === 'subscription' ? subscriptionFromDoc<Subscription>(id, snap.data(), true) : gamiyaFromDoc<Gamiya>(id, snap.data(), true);
        const open = kind === 'subscription'
          ? subscriptionOpenCharges(data as Subscription, today)
          : gamiyaOpenCharges(data as Gamiya, today);
        // فترة مش مفتوحة لأنها مقفولة على عمليتها الثابتة — ممكن تكون كتابتنا في محاولة وصلت (بند B)
        const closedOnTx = (key: string) => {
          if (kind === 'subscription') {
            const c = (data as Subscription).closed?.[key];
            return !!c && !c.reopened && c.txId === txIdOf(key);
          }
          return (data as Gamiya).months?.some(m => m.id === key && m.status === 'done' && m.transactionId === txIdOf(key));
        };
        const notOpen = keys.filter(k => !open.some(o => o.key === k));
        const maybeOurs = notOpen.filter(closedOnTx);
        const prior = await Promise.all(maybeOurs.map(k => t.get(doc(db, 'users', uid!, 'transactions', txIdOf(k)))));
        const oursBefore = maybeOurs.filter((k, i) => prior[i].exists() && prior[i].data()?.createdAt === at);

        const seen = new Set<string>();
        const todo: { key: string; amount: number }[] = [];
        entries.forEach(e => {
          const o = open.find(x => x.key === e.key);
          if (!o || seen.has(e.key) || (auto && !o.autoOk)) return;
          // التلقائي بياخد المبلغ من المستند اللي على السيرفر (مش من نسخة الرياكت)، والكارت بيتقرّب للقرش
          const amount = storableAmount(auto ? o.amount : e.amount);
          if (amount === null) { reasons.badAmount = true; return; }
          seen.add(e.key);
          todo.push({ key: e.key, amount });
        });
        // ليه مفيش حاجة اتسجلت — للمفاتيح اللي مش مفتوحة ومش مننا
        if (kind === 'subscription') {
          const s = data as Subscription;
          const others = notOpen.filter(k => !oursBefore.includes(k));
          // واقف وفيه مفتاح مطلوب مش مفتوح **ومش مقفول** — المقفول اتسجل فعلاً، فده "اتسجلت قبل كده" مش "اتوقف"
          if (s.active === false && others.some(k => !s.closed?.[k])) reasons.stopped = true;
          else if (others.some(k => s.closed?.[k]?.skipped && !s.closed[k].reopened)) reasons.skipped = true;
          else if (others.some(k => !s.closed?.[k])) reasons.changed = true;
        } else if (notOpen.some(k => {
          // مقفول (حتى على عملية قديمة بمعرّف مش ثابت) = اتسجل قبل كده، مش "الجمعية اتغيّرت" — مراجعة 2026-11-18
          const m = (data as Gamiya).months?.find(x => x.id === k);
          return !oursBefore.includes(k) && (!m || m.status !== 'done');
        })) {
          reasons.changed = true;
        }
        recorded = [...oursBefore];
        if (todo.length === 0) return;
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', data.walletId)))) throw new WalletMissingError();
        const txRefs = todo.map(e => doc(db, 'users', uid!, 'transactions', txIdOf(e.key)));
        const existing = await Promise.all(txRefs.map(r => t.get(r)));

        if (kind === 'subscription') {
          const sub = data as Subscription;
          const closed = { ...(sub.closed || {}) };
          const history = [...(sub.history || [])];
          todo.forEach((e, i) => {
            const txId = txRefs[i].id;
            closed[e.key] = auto ? { txId, auto: true, at } : { txId, at };
            // قرار مؤمن 2026-11-12: التأكيد بإيدك من الكارت بيتسجل بتاريخ النهاردة زي "سدّد" من الشاشة
            // (التلقائي بيفضل بتاريخ المعاد). المعرّف ومفتاح الفترة بيفضلوا بالمعاد
            const recDate = auto ? e.key : today;
            if (!history.some(h => h.transactionId === txId)) {
              history.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i,
                // العملية موجودة (اتعدّلت مثلاً) ← السطر بمبلغها هي، مش باللي اتبعت
                date: recDate, amount: existingAmount(existing[i], e.amount), transactionId: txId, periodKey: e.key, ...(auto ? { auto: true } : {}),
              });
            }
            if (existing[i].exists()) return;
            const txData = {
              type: 'expense' as const, amount: e.amount, walletId: sub.walletId, date: recDate,
              categoryId: sub.categoryId, note: `اشتراك: ${sub.name}`,
              subscriptionId: id, periodKey: e.key, createdAt: at, ...(auto ? { autoRecorded: true } : {}),
            };
            t.set(txRefs[i], Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));
            recorded.push(e.key);
          });
          t.update(ref, { closed, history, nextDueDate: subscriptionAdvance(sub, closed), ...anchorDayPatch(sub) });
          return;
        }

        const g = data as Gamiya;
        const months = (g.months || []).map(m => {
          const i = todo.findIndex(e => e.key === m.id);
          if (i === -1) return m;
          const { reopened: _r, auto: _a, transactionId: _t, at: _at, ...rest } = m;
          if (!existing[i].exists()) {
            t.set(txRefs[i], {
              type: m.isPayoutMonth ? 'income' : 'expense', amount: todo[i].amount, walletId: g.walletId, date: m.dueDate,
              note: `${m.isPayoutMonth ? 'استلام جمعية' : 'قسط جمعية'}: ${g.name} (شهر ${m.monthIndex})`,
              gamiyaId: id, periodKey: m.id, createdAt: at, ...(auto ? { autoRecorded: true } : {}),
            });
            recorded.push(m.id);
          }
          return { ...rest, status: 'done' as const, transactionId: txRefs[i].id, at, ...(auto ? { auto: true } : {}) };
        });
        t.update(ref, { months });
      }));
      return { outcome: 'done', recorded, ...(recorded.length === 0 ? reasons : {}) };
    } catch (e) {
      // اتمسح من جهاز تاني — مفيش حاجة تتسجل، ومش فشل؛ بس الشاشة لازم تقول كده (بند G)
      if (e instanceof ChargeMissingError) { console.warn(`[${kind}] record refused, gone`, id); return { outcome: 'missing', recorded: [] }; }
      if (e instanceof WalletMissingError) {
        noteAtomicFailure(kind === 'subscription' ? 'تسجيل الاشتراك' : 'تسجيل الجمعية', e);
        return { outcome: 'wallet-missing', recorded: [] };
      }
      const landed = kind === 'subscription'
        ? await subscriptionChargeLanded(ref, id, keys, at)
        : await gamiyaChargeLanded(ref, id, keys, at);
      if (landed.state === 'landed') return { outcome: 'done', recorded: landed.recorded };
      // الجمعية: الشهر اتقفل من مكان تاني (مش ببصمتنا) ← نفس اللي الذرة كانت هترجّعه لو قرت ده: "اتسجلت قبل كده"
      if (landed.state === 'already') { console.warn('[gamiya] record failed, month already closed on server', id); return { outcome: 'done', recorded: [] }; }
      noteAtomicFailure(kind === 'subscription' ? 'تسجيل الاشتراك' : 'تسجيل الجمعية', e);
      if (landed.state === 'gone') return { outcome: 'missing', recorded: [] };
      return { outcome: landed.state === 'unknown' ? 'uncertain' : 'failed', recorded: [] };
    } finally {
      chargeEnd(id);
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
   * صح (العملية موجودة) والفترة لسه مقفولة؛ اللي بيضيع الربط بس.
   * **اللي بيقرا `skipped` مبيصدّقهوش لوحده:** `recordIncomePeriods` (جوه الذرة)
   * و`incomeRecordLanded` بيقروا العملية بمعرّفها الثابت — موجودة ← "اتسجلت"
   * مش "ما نزلش"؛ و`deleteIncome` بيقراها كمان. أي قارئ جديد لـ`skipped` لازم
   * يعمل نفس الحاجة، أو السباق ده يتقفل بذرة.
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
  async function recordIncomePeriods(incomeId: string, entries: { key: string; amount: number }[], opts: IncomeRecordOpts = {}): Promise<IncomeRecordResult> {
    if (deletingRef.current) return { outcome: 'failed', recorded: [] };
    // مفيش حساب ← مفيش تسجيل، فمش "تم" ساكت (M2)
    if (!uid) return { outcome: 'failed', recorded: [] };
    if (entries.length === 0) return { outcome: 'done', recorded: [] };
    if (!serverReachableRef.current) return { outcome: 'no-connection', recorded: [] };
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection', recorded: [] };
    const auto = !!opts.auto;
    const incRef = doc(db, 'users', uid, 'incomes', incomeId);
    const today = todayStr();
    const txRefOf = (key: string) => doc(db, 'users', uid!, 'transactions', incomeTxId(incomeId, key));
    /**
     * H1+H2 (مراجعة الدخل 2026-11-18، نفس `recordCharges`): `at` والمفاتيح **برّه** الذرة — نفس البصمة في كل محاولة، وبتتكتب
     * على `closed[key].at` وعلى `createdAt` بتاع العملية. الإعادة بعد commit وصل بتلاقي الفترة مقفولة ببصمتنا ← بتتحسب في
     * `recorded` (مش "اتسجلت قبل كده")، ولو كل المحاولات فشلت بنسأل السيرفر قبل "ما اتسجلش" (`incomeRecordLanded`).
     */
    const at = uniqueStamp();
    const keys = [...new Set(entries.map(e => e.key))];
    let recorded: string[] = [];
    let recordedTotal = 0;
    let reasons: Omit<IncomeRecordResult, 'outcome' | 'recorded' | 'recordedTotal'> = {};
    /** المبلغ اللي على العملية نفسها — مش اللي كنا ناويين نكتبه */
    const txAmount = (data: Record<string, unknown> | undefined) => (typeof data?.amount === 'number' && Number.isFinite(data.amount) ? data.amount : 0);
    try {
      await countPending(runTransaction(db, async (t) => {
        recorded = [];
        recordedTotal = 0;
        reasons = {};
        const snap = await t.get(incRef);
        if (!snap.exists()) throw new IncomeMissingError();
        const inc = incomeFromDoc<RecurringIncome>(incomeId, snap.data(), true);
        // فترة مقفولة ببصمتنا على عمليتها الثابتة — محاولة قبل كده وصلت والرد ضاع
        const maybeOurs = keys.filter(k => { const c = inc.closed?.[k]; return !!c && c.at === at && c.txId === incomeTxId(incomeId, k); });
        const prior = await Promise.all(maybeOurs.map(k => t.get(txRefOf(k))));
        const oursBefore = maybeOurs.filter((k, i) => prior[i].exists() && prior[i].data()?.createdAt === at);
        recorded = [...oursBefore];
        prior.forEach((p, i) => { if (oursBefore.includes(maybeOurs[i])) recordedTotal += txAmount(p.data()); });
        const others = keys.filter(k => !maybeOurs.includes(k));
        /**
         * الجولة الأخيرة (2026-11-18): علامة `{ skipped }` من غير txId مبتتصدّقش لوحدها — سباق `skipIncomePeriod` بيقلبها
         * والعملية موجودة. العملية بمعرّفها الثابت بتتقري هنا (كل القرايات قبل أي كتابة): موجودة ببصمتنا ← اتسجلت مننا
         * (محاولة وصلت و"ما نزلش" قلب العلامة بعدها)، موجودة من غير بصمتنا ← اتسجلت قبل كده، مش موجودة ← "ما نزلش" بجد.
         */
        const skipMarked = others.filter(k => inc.closed?.[k]?.skipped && !inc.closed[k].txId);
        const skipTx = await Promise.all(skipMarked.map(k => t.get(txRefOf(k))));
        const skipTxOf = (k: string) => skipTx[skipMarked.indexOf(k)];
        skipMarked.forEach((k, i) => {
          if (skipTx[i].exists() && skipTx[i].data()?.createdAt === at) { recorded.push(k); recordedTotal += txAmount(skipTx[i].data()); }
        });
        // مقفولة من مكان تاني: "ما نزلش" (والعملية مش موجودة) ← skipped، غير كده اتسجلت قبل كده
        const noteClosedReasons = (closedKeys: string[]) => {
          const rest = closedKeys.filter(k => !recorded.includes(k));
          if (rest.some(k => skipMarked.includes(k) && !skipTxOf(k).exists())) reasons.skipped = true;
          else if (rest.length > 0) reasons.already = true;
        };
        // اتوقف من جهاز تاني — مفيش حاجة تتسجل، ومش فشل؛ بس السبب بيتقال
        if (inc.status !== 'active') {
          if (others.some(k => !inc.closed?.[k])) reasons.stopped = true;
          else noteClosedReasons(others);
          return;
        }
        // M3: التلقائي والدخل بقى "بيسأل" على السيرفر ← ميتسجلش لوحده
        if (auto && inc.mode !== 'auto') { reasons.modeChanged = true; return; }
        // M3: الجدول من السيرفر — التلقائي الفترات اللي معادها جه بس، و"نزل" بإيدك ممكن كمان الجاية (بدري)
        const allowed = new Set(incomeOpenPeriods(inc, today));
        if (!auto) { const up = incomeUpcomingPeriod(inc, today); if (up) allowed.add(up); }
        const seen = new Set<string>();
        const todo: { key: string; amount: number }[] = [];
        entries.forEach(e => {
          if (seen.has(e.key) || !allowed.has(e.key)) return;
          seen.add(e.key);
          // M4: التلقائي بياخد المبلغ من المستند اللي على السيرفر، والكل بيتقرّب للقرش؛ اللي بيتقرّب لصفر بيترفض
          const amount = storableAmount(auto ? inc.amount : e.amount);
          if (amount === null) { reasons.badAmount = true; return; }
          todo.push({ key: e.key, amount });
        });
        const notTried = others.filter(k => !allowed.has(k));
        noteClosedReasons(notTried.filter(k => inc.closed?.[k]));
        if (notTried.some(k => !inc.closed?.[k])) reasons.changed = true;
        if (todo.length === 0) return;
        // M3: "نزل" بالمبلغ المعتاد والمعتاد اتغيّر على السيرفر ← ما وافقش على الجديد
        if (!auto && seenAmountDiffers(opts.seenAmount, inc.amount)) throw amountChanged(opts.seenAmount, inc.amount);
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', inc.walletId)))) throw new WalletMissingError();
        const txRefs = todo.map(e => txRefOf(e.key));
        const existing = await Promise.all(txRefs.map(r => t.get(r)));

        const closed = { ...(inc.closed || {}) };
        todo.forEach((e, i) => {
          closed[e.key] = { txId: txRefs[i].id, at };
          // موجودة (مقفولة من غير علامة لأي سبب) ← بتتقفل من غير ما نكتب فوق تعديل المستخدم
          if (existing[i].exists()) { reasons.already = true; return; }
          t.set(txRefs[i], {
            type: 'income', amount: e.amount, walletId: inc.walletId,
            date: incomeTxDate(inc, e.key, today),
            note: `${inc.name} — ${incomePeriodLabel(inc, e.key, today)}`,
            incomeId, periodKey: e.key, createdAt: at, ...(auto ? { autoRecorded: true } : {}),
          });
          recorded.push(e.key);
          recordedTotal += e.amount;
        });
        t.update(incRef, { closed });
      }));
      if (recorded.length > 0) return { outcome: 'done', recorded, recordedTotal: roundMoney(recordedTotal) };
      return { outcome: 'done', recorded, ...reasons };
    } catch (e) {
      // M2: اتمسح من جهاز تاني — مش فشل نت، ورسالته لوحدها
      if (e instanceof IncomeMissingError) { console.warn('[income] record refused, income gone', incomeId); return { outcome: 'missing', recorded: [] }; }
      // مش فشل (مش Sentry): الشاشة بتقول إن المبلغ اتغيّر والمستخدم يقرر تاني
      if (e instanceof AmountChangedError) { console.warn('[income] amount changed since shown, nothing written', incomeId, ...amountsForDevLog(e)); return { outcome: 'amount-changed', recorded: [] }; }
      if (e instanceof WalletMissingError) {
        noteAtomicFailure('تسجيل الدخل الثابت', e);
        return { outcome: 'wallet-missing', recorded: [] };
      }
      // ذرية يعني كله أو مفيش — بس الـcommit ممكن يكون وصل والرد ضاع. فقبل "ما اتسجلش" بنسأل السيرفر
      const landed = await incomeRecordLanded(incRef, incomeId, keys, at);
      if (landed.state === 'landed') {
        return { outcome: 'done', recorded: landed.recorded, ...(landed.recorded.length > 0 ? { recordedTotal: landed.recordedTotal } : {}) };
      }
      // كل الفترات اتقفلت من مكان تاني (مش ببصمتنا) ← نفس اللي الذرة كانت هترجّعه لو قرت ده
      if (landed.state === 'already') { console.warn('[income] record failed, periods already closed on server', incomeId); return { outcome: 'done', recorded: [], ...landed.reasons }; }
      // بعد سؤال السيرفر: كتابة وصلت متتسجلش "فشلت" في اللوج وSentry
      noteAtomicFailure('تسجيل الدخل الثابت', e);
      if (landed.state === 'gone') return { outcome: 'missing', recorded: [] };
      return { outcome: landed.state === 'unknown' ? 'uncertain' : 'failed', recorded: [] };
    }
  }

  /**
   * الذرة فشلت — بصمتنا (`at`) وصلت السيرفر على أي فترة؟ (نفس `subscriptionChargeLanded`/`gamiyaChargeLanded`)
   * `landed` = فترة اتقفلت ببصمتنا؛ `recorded` = اللي **عمليتها** اتكتبت مننا (`createdAt` = بصمتنا). `already` = **كل** الفترات
   * اتقفلت من مكان تاني. `unknown` = السؤال نفسه فشل أو عدّى السقف، فالشاشة مبتجزمش بـ"ما اتسجلش".
   */
  async function incomeRecordLanded(
    incRef: DocumentReference, incomeId: string, keys: string[], at: string,
  ): Promise<{ state: 'landed' | 'already' | 'missing' | 'gone' | 'unknown'; recorded: string[]; recordedTotal?: number; reasons?: { skipped?: boolean; already?: boolean } }> {
    try {
      const [snap, ...txSnaps] = await withTimeout(Promise.all([
        getDocFromServer(incRef),
        ...keys.map(k => getDocFromServer(doc(db, 'users', uid!, 'transactions', incomeTxId(incomeId, k)))),
      ]), LANDED_CHECK_TIMEOUT_MS);
      if (!snap.exists()) return { state: 'gone', recorded: [] };
      const closed = (snap.data() as { closed?: Record<string, IncomeClosed> }).closed;
      const txOurs = (i: number) => txSnaps[i].exists() && txSnaps[i].data()?.createdAt === at;
      const ours = keys.filter(k => closed?.[k]?.at === at && closed?.[k]?.txId === incomeTxId(incomeId, k));
      /**
       * اللي اتكتب مننا = عمليته ببصمتنا، والفترة مقفولة: ببصمتنا، **أو** "ما نزلش" قلب العلامة بعد ما كتابتنا وصلت
       * (سباق `skipIncomePeriod` — الجولة الأخيرة 2026-11-18). العملية موجودة يعني الفلوس اتسجلت، مش "ما نزلش".
       */
      const skipOverOurs = (k: string, i: number) => !!closed?.[k]?.skipped && !closed[k].txId && txOurs(i);
      const recordedIdx = keys.map((k, i) => (ours.includes(k) && txOurs(i)) || skipOverOurs(k, i));
      const recorded = keys.filter((_, i) => recordedIdx[i]);
      const recordedTotal = roundMoney(keys.reduce((s, _, i) => {
        const amount = recordedIdx[i] ? txSnaps[i].data()?.amount : 0;
        return s + (typeof amount === 'number' && Number.isFinite(amount) ? amount : 0);
      }, 0));
      if (ours.length > 0 || recorded.length > 0) return { state: 'landed', recorded, recordedTotal };
      if (keys.length > 0 && keys.every(k => !!closed?.[k])) {
        // "ما نزلش" بس لو العملية مش موجودة — موجودة (من مكان تاني) ← اتسجلت قبل كده
        const skipped = keys.some((k, i) => closed?.[k]?.skipped && !closed[k].txId && !txSnaps[i].exists());
        return { state: 'already', recorded: [], reasons: skipped ? { skipped: true } : { already: true } };
      }
      return { state: 'missing', recorded: [] };
    } catch (e) {
      // كود الخطأ بس — مفيش بيانات (sentryScrub)
      console.warn('[income] landed check failed', (e as { code?: string })?.code ?? 'timeout');
      return { state: 'unknown', recorded: [] };
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
        choice.categories.forEach(name => {
          // الأيقونة (إيموجي) على الفئة نفسها بنفس حقل `icon` اللي `updateCategory` بيكتبه؛ «أخرى» والمكتوبة بإيد المستخدم من غيرها
          const icon = setupCategoryIcon(name);
          t.set(doc(collection(db, 'users', uid, 'categories')), icon ? { name: name.trim(), icon } : { name: name.trim() });
        });
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
          // الطابور المتشفّر ومفتاحه — من غيره الإعادة كانت هترجّع عمليات على حساب اتمسح
          outboxIds.current.clear();
          setOutboxCount(0);
          try { await clearOutboxForUid(uid); } catch (e) {
            logOutboxFailure('clear on delete failed', e);
            // المفتاح فضل في SecureStore بعد مسح الحساب — Sentry بالاسم بس (الكنس الجاي بيحاول تاني من السجل)
            if (e instanceof OutboxKeyDeleteError) reportOutboxEvent('account-delete-key-failed');
            // المدخلات نفسها ما اتمسحتش (والمفتاح ما اتلمسش) — سبب لوحده عشان الاتنين ميتلخبطوش في Sentry
            else if (e instanceof OutboxEntriesClearError) reportOutboxEvent('account-delete-entries-failed');
          }
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
    // مفيش حساب ← مفيش كتابة، فممنوع "تم" (مراجعة الجمعية 2026-11-18): الفورم بتفضل مفتوحة بالرسالة
    if (!uid) return { outcome: 'failed', message: GAMIYA_NOT_SAVED_MESSAGE };
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
    if (!uid) return { outcome: 'failed', message: GAMIYA_NOT_SAVED_MESSAGE };
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
  /**
   * بند C (مراجعة الجمعية 2026-11-18، نفس `deleteSubscription`): الجمعية من آخر render (`latestGamiyas`) مش من الـclosure
   * اللي فتح التأكيد، والعمليات من كل مكان بيشاور عليها (`gamiyaTransactionIds`): `months[].transactionId`، والمعرّف
   * الثابت لكل شهر (شهر سجّله جهاز تاني والتحديث لسه ما وصلناش)، وأي عملية عليها `gamiyaId`. وتسجيل شغال على نفس
   * الجمعية ← المسح بيستنى: الذرة كانت هتكتب عملية بعد المسح وتفضل يتيمة.
   * **متبقّي:** زي الاشتراك — المسح دفعة أوفلاين؛ عملية من جهاز تاني بمعرّف مش ثابت لسه ما وصلتش مش هتتمسح.
   */
  async function deleteGamiya(id: string): Promise<CascadeDeleteResult> {
    // مفيش حساب ← مفيش مسح، فمش "تم" ساكت
    if (!uid) return { outcome: 'blocked', ...NO_ACCOUNT_DELETE_BLOCK_GAMIYA };
    const g = latestGamiyas.current.find(x => x.id === id);
    if (chargeInFlight.current.has(id)) return { outcome: 'blocked', ...CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA };
    return deleteWithTransactions('gamiya', g?.name ?? '', doc(db, 'users', uid, 'gamiyas', id),
      gamiyaTransactionIds(g, cascadeInputs.current.transactions), namedLabel('حذف الجمعية', g?.name));
  }
  /**
   * زي markSubscriptionPaid: عملية ذرية بتقرا الجمعية من السيرفر وبتتأكد إن
   * الشهر لسه pending قبل ما تخصم. قبل كده كانت بتقرا من حالة الرياكت من غير ما
   * تبص على حالة الشهر أصلاً، فنداءها مرتين على نفس الشهر كان بيعمل عمليتين خصم،
   * والشهر بيتربط بالتانية فالأولى بتفضل عملية يتيمة في الأرشيف بتقلل الرصيد.
   *
   * **مراجعة الجمعية 2026-11-18 (بنود A/B):** نفس عقد "سدّد" بتاع الاشتراك —
   * - `at` **برّه** الذرة = `createdAt` العملية و`months[].at`: الإعادة بعد commit وصل بتلاقي الشهر مقفول ببصمتنا ← `done`،
   *   ولو كل المحاولات فشلت بنسأل السيرفر (`gamiyaChargeLanded`) قبل "مفيش أي خصم اتسجل" (`uncertain` لو السؤال فشل).
   * - الجمعية/الشهر اتمسح ← `missing`؛ الشهر اتسجل قبل كده ← `already-recorded` (الاتنين كانوا `done` ساكت).
   * - المبلغ المتخزّن بايظ ← `bad-amount` **قبل** مقارنة المبلغ المعروض (NaN ≠ NaN كان "المبلغ اتغيّر" للأبد)، والمكتوب مقرّب للقرش.
   * **ليه مش `recordCharges`:** هناك الشهور اللي معادها جه بس (`gamiyaOpenCharges`)، والشاشة بتسجّل أي شهر لسه
   * pending (قسط بدري) — فالمسار ده فاضل لوحده بنفس العقد، والمعرّف الثابت واحد فالشهر عمليته واحدة مهما اتسجل منين.
   */
  async function markGamiyaMonthDone(gamiyaId: string, monthId: string, seenAmount?: number): Promise<GamiyaMarkOutcome> {
    if (deletingRef.current) return 'failed';
    // مفيش حساب ← مفيش كتابة، فمش "تم"
    if (!uid) return 'failed';
    // زي markSubscriptionPaid بالظبط: رفض فوري من غير اتصال، وانتظار اللي لسه
    // بيرفع قبل القراية من السيرفر، والكل متسابق مع "الاتصال وقع"
    if (!serverReachableRef.current) return 'no-connection';
    const gamiyaRef = doc(db, 'users', uid, 'gamiyas', gamiyaId);
    // نفس معرّف التلقائي وكارت "اتخصم؟" — الشهر عمليته واحدة مهما اتسجل منين
    const txRef = doc(db, 'users', uid, 'transactions', gamiyaTxId(gamiyaId, monthId));
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    const at = uniqueStamp();
    let result: 'done' | 'already-recorded' = 'done';
    chargeBegin(gamiyaId);
    try {
      await countPending(runTransaction(db, async (t) => {
        result = 'done';
        const snap = await t.get(gamiyaRef);
        if (!snap.exists()) throw new ChargeMissingError();
        const g = gamiyaFromDoc<Gamiya>(gamiyaId, snap.data(), true);
        const month = (g.months || []).find(m => m.id === monthId);
        if (!month) throw new MonthMissingError();
        if (month.status === 'done') {
          // محاولة قبل كده وصلت (الرد ضاع) ← دي كتابتنا؛ غير كده اتسجل من مكان تاني
          if (!(month.at === at && month.transactionId === txRef.id)) result = 'already-recorded';
          return;
        }
        const amount = storableAmount(month.amount);
        if (amount === null) throw new BadStoredAmountError();
        if (seenAmountDiffers(seenAmount, month.amount)) throw amountChanged(seenAmount, month.amount);

        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', g.walletId)))) throw new WalletMissingError();
        const existing = await t.get(txRef);

        // موجودة ← الشهر بيتقفل عليها من غير ما نكتب فوقها (تعديل المستخدم يفضل)
        if (!existing.exists()) {
          t.set(txRef, {
            type: month.isPayoutMonth ? 'income' : 'expense', amount, walletId: g.walletId, date: month.dueDate,
            note: `${month.isPayoutMonth ? 'استلام جمعية' : 'قسط جمعية'}: ${g.name} (شهر ${month.monthIndex})`,
            gamiyaId, periodKey: monthId, createdAt: at,
          });
        }
        const updatedMonths = g.months.map(m => {
          if (m.id !== monthId) return m;
          const { reopened: _r, auto: _a, at: _at, ...rest } = m;
          return { ...rest, status: 'done' as const, transactionId: txRef.id, at };
        });
        t.update(gamiyaRef, { months: updatedMonths });
      }));
      return result;
    } catch (e) {
      if (e instanceof ChargeMissingError) { console.warn('[gamiya] mark refused, gamiya gone', gamiyaId); return 'missing'; }
      if (e instanceof MonthMissingError) { console.warn('[gamiya] mark refused, month not in gamiya', gamiyaId); return 'month-missing'; }
      if (e instanceof AmountChangedError) { console.warn('[gamiya] month amount changed since shown, nothing written', gamiyaId, monthId, ...amountsForDevLog(e)); return 'amount-changed'; }
      if (e instanceof WalletMissingError) return 'wallet-missing';
      // مفيش كتابة خالص (اترفضت قبلها) — مش محتاج سؤال السيرفر. اسم الخطوة بس، من غير المبلغ (sentryScrub)
      if (e instanceof BadStoredAmountError) { console.warn('[gamiya] mark refused, stored amount unreadable', gamiyaId); return 'bad-amount'; }
      // ذرية يعني كله أو مفيش — **بس** الـcommit ممكن يكون وصل والرد ضاع. فقبل "مفيش أي خصم اتسجل" بنسأل السيرفر
      const landed = await gamiyaChargeLanded(gamiyaRef, gamiyaId, [monthId], at);
      if (landed.state === 'landed') return 'done';
      if (landed.state === 'already') { console.warn('[gamiya] mark failed, month already closed on server', gamiyaId); return 'already-recorded'; }
      // بعد سؤال السيرفر: كتابة وصلت متتسجلش "فشلت" في اللوج وSentry
      noteAtomicFailure('تسديد شهر الجمعية', e);
      if (landed.state === 'gone') return 'missing';
      return landed.state === 'unknown' ? 'uncertain' : 'failed';
    } finally {
      chargeEnd(gamiyaId);
    }
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, brokenTransactions, budgets, shakhbataIncome, shakhbataPercents,
        debts, subscriptions, gamiyas, incomes, pendingWrites, outboxCount, pendingTxIds, serverReachable, figuresFromServer, coldSnapshot, figuresPending,
        loadErrors, retryLoad: () => setListenRetry(n => n + 1), setupStatus, completeSetup,
        linkSourcesReady: LINK_SOURCES.every(n => delivered.has(n) && !loadErrors.includes(n)),
        debtsReady: delivered.has('debts') && !loadErrors.includes('debts'),
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