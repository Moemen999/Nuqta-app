import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebaseConfig';
import { settlementNote } from '@/lib/archiving';
import { buildFeedbackDoc, type FeedbackType } from '@/lib/feedback';
import {
  addDays, addMonths, debtGrandTotal, debtPaid, debtRemaining,
  installmentChangeMessage, installmentCountAfterPayment, installmentCountFor,
  installmentValue, planInstallmentCountEdit, PIASTRE_EPS, roundMoney, todayStr,
} from '@/lib/finance';
import {
  addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, runTransaction, serverTimestamp,
  setDoc, updateDoc, waitForPendingWrites, writeBatch,
  type DocumentReference, type Transaction as FirestoreTransaction, type WriteBatch,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { WRITE_ERROR_RESET_MS, WRITE_ERROR_TITLE, namedLabel, writeErrorBody } from '@/lib/writeError';

/**
 * `archived` و`archivedAt` اختياريين عن قصد: المحافظ والفئات الموجودة من قبل
 * مالهاش الحقلين دول خالص، وقواعد Firestore بتتحقق من المستند بعد الدمج —
 * فلو خليناهم إجباريين كل محفظة قديمة كانت هتبقى غير قابلة للتعديل.
 * `archivedAt` نص ISO زي `createdAt` في كل حتة تانية في التطبيق.
 */
export type Wallet = {
  id: string; name: string; openingBalance: number; lowAlert: number;
  archived?: boolean; archivedAt?: string;
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
class WalletMissingError extends Error {}

/**
 * الدين نفسه مش موجود على السيرفر وإحنا جوه العملية الذرية — يا إما اتمسح من
 * جهاز تاني، يا إما لسه ما وصلش (وده اللي `waitForOurWritesToLand` بيمنعه).
 * الرمي بيلغي العملية كلها، فمفيش عملية يتيمة بتتكتب لدين مش موجود.
 */
class DebtMissingError extends Error {}

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
 * نتيجة دفعة الدين: النتيجة القاطعة زي أي عملية بتقرا من السيرفر، ومعاها
 * جملة تغيّر الأقساط لو العدد اتحرك (`note`) — الاتنين لازم يرجعوا مع بعض
 * عشان الشاشة تعرف تقول "اتسجلت" و"الأقساط بقت 7" في نفس اللحظة.
 */
export type DebtPayResult = { outcome: PayOutcome; note?: string | null };

/** أقصى انتظار لتأكيد السيرفر على الرأي قبل ما نقول إنه في الطابور */
const FEEDBACK_ACK_MS = 8000;

export type Budgets = Record<string, number>;
export type ShakhbataIncome = Record<string, number>;
export type ShakhbataPercents = { needs: number; wants: number; future: number };

export type DebtPayment = { id: string; date: string; amount: number; walletId: string; categoryId?: string; transactionId?: string };
export type DebtEntry = { id: string; date: string; amount: number; walletId?: string; transactionId?: string };
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

export type SubscriptionPayment = { id: string; date: string; amount: number; transactionId?: string };
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
};

export type GamiyaMonth = {
  id: string;
  monthIndex: number;
  dueDate: string;
  isPayoutMonth: boolean;
  amount: number;
  status: 'pending' | 'done';
  transactionId?: string;
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
};

type DataContextType = {
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budgets;
  shakhbataIncome: ShakhbataIncome;
  shakhbataPercents: ShakhbataPercents;
  debts: Debt[];
  subscriptions: Subscription[];
  gamiyas: Gamiya[];
  /** عدد الكتابات اللي اتبعتت ولسه ما جاش تأكيد من السيرفر بيها */
  pendingWrites: number;
  /** العمليات اللي اتحفظت على الموبايل ولسه بترفع (من metadata بتاعة فايربيز) */
  pendingTxIds: Set<string>;
  /** إحنا متصلين بسيرفر فايربيز دلوقتي ولا شغالين من الكاش (من `metadata.fromCache`) */
  serverReachable: boolean;
  addWallet: (name: string) => Promise<void>;
  updateWallet: (id: string, data: Partial<Wallet>) => Promise<void>;
  deleteWallet: (id: string) => Promise<void>;
  archiveWallet: (id: string, reassign: { subscriptions?: Record<string, string>; gamiyas?: Record<string, string> }) => Promise<void>;
  restoreWallet: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  archiveCategory: (id: string, reassign: Record<string, string>) => Promise<void>;
  submitFeedback: (type: FeedbackType, text: string) => Promise<FeedbackOutcome>;
  restoreCategory: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<string>;
  updateTransaction: (id: string, tx: Partial<Transaction>, settlements?: Settlement[]) => Promise<void>;
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
  deleteDebt: (id: string) => Promise<void>;
  addDebtPayment: (debtId: string, amount: number, walletId: string, date: string, categoryId?: string) => Promise<DebtPayResult>;
  setInstallmentCount: (debtId: string, nextTotal: number) => Promise<boolean>;
  deleteDebtPayment: (debtId: string, paymentId: string) => Promise<PayOutcome>;
  addDebtIncrease: (debtId: string, amount: number, date: string, walletId?: string) => Promise<PayOutcome>;
  deleteDebtIncrease: (debtId: string, entryId: string) => Promise<PayOutcome>;
  addSubscription: (data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
  }) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  markSubscriptionPaid: (id: string, date: string) => Promise<PayOutcome>;
  addGamiya: (data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
  }) => Promise<void>;
  updateGamiya: (id: string, data: Partial<Gamiya>) => Promise<void>;
  deleteGamiya: (id: string) => Promise<void>;
  markGamiyaMonthDone: (gamiyaId: string, monthId: string) => Promise<PayOutcome>;
};

const DataContext = createContext<DataContextType | undefined>(undefined);

const DEFAULT_WALLETS = [
  { name: 'CIB', openingBalance: 0, lowAlert: 0 },
  { name: 'NBE', openingBalance: 0, lowAlert: 0 },
  { name: 'CASH', openingBalance: 0, lowAlert: 0 },
];
const DEFAULT_CATEGORIES = ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى'];
const DEFAULT_PERCENTS: ShakhbataPercents = { needs: 50, wants: 30, future: 20 };
/**
 * أقصى انتظار للكتابات اللي لسه بترفع قبل أي عملية بتقرا من السيرفر. فايربيز
 * بتعلن انقطاع الاتصال خلال ~10 ثواني، فالسقف ده شبكة أمان لو الإشارة اتأخرت
 */
const PENDING_WAIT_TIMEOUT_MS = 15000;

/** حد فايرستور لعدد العمليات في الدفعة الواحدة */
const BATCH_LIMIT = 500;

async function claimSeeding(uid: string): Promise<boolean> {
  const userRef = doc(db, 'users', uid);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists() ? snap.data() : {};
      if (data?.seeded) return false;
      tx.set(userRef, { ...(data || {}), seeded: true }, { merge: true });
      return true;
    });
  } catch {
    return false;
  }
}

/** مقارنة رخيصة عشان منعملش Set جديدة (ورسمة جديدة) كل ما ييجي snapshot بنفس المحتوى */
function sameIds(prev: Set<string>, next: string[]) {
  return prev.size === next.length && next.every(id => prev.has(id));
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});
  const [shakhbataIncome, setShakhbataIncome] = useState<ShakhbataIncome>({});
  const [shakhbataPercents, setShakhbataPercentsState] = useState<ShakhbataPercents>(DEFAULT_PERCENTS);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [gamiyas, setGamiyas] = useState<Gamiya[]>([]);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [pendingTxIds, setPendingTxIds] = useState<Set<string>>(new Set());
  const pendingCount = useRef(0);
  const errorShown = useRef(false);
  // بنبدأ بـ false لحد ما أول snapshot ييجي من السيرفر فعلاً: أول ثانية من فتح
  // التطبيق بنعتبر نفسنا مش متصلين. ده بيمنع إن حد يفتح التطبيق وهو من غير نت
  // ويدوس "سدّد" فيقع في نفس مصيدة الزرار المقفول
  const [serverReachable, setServerReachable] = useState(false);
  const serverReachableRef = useRef(false);
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
   * بنستخدم تنبيه `track` العام معاه. بس السطر ده لازم يتكتب برضه:
   * `deleteDebtPayment` و`deleteDebtIncrease` **مفيش ولا شاشة بتناديهم** لحد
   * دلوقتي، فمن غيره فشلهم مش هيسيب أي أثر لا في لوج ولا قدام المستخدم.
   *
   * بنكتب اسم العملية بس — مفيش أسامي ولا مبالغ. الـconsole بيتحوّل
   * breadcrumbs في Sentry، وقسم Sentry في CLAUDE.md بيقول مفيش ولا رقم من
   * فلوس المستخدم يخرج (و`sentryScrub` بيشيل الـbreadcrumbs دي أصلاً).
   */
  function noteAtomicFailure(op: string, e: unknown) {
    console.warn('عملية ذرية فشلت', op, e);
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
     * القفل بيتفك بالزرار **وبمؤقّت احتياطي**.
     *
     * لو تنبيه تاني كان مفتوح لحظتها، المنصة ممكن تبلع التنبيه ده خالص —
     * وساعتها `onPress` عمره ما هيشتغل، والقفل يفضل مقفول لآخر الجلسة. يعني
     * كل كتابة تفشل بعد كده تبقى صامتة. المؤقّت بيضمن إن أسوأ حالة هي تنبيه
     * واحد ضايع، مش كل التنبيهات بعده.
     */
    const unlock = () => { errorShown.current = false; };
    const backstop = setTimeout(unlock, WRITE_ERROR_RESET_MS);
    Alert.alert(
      WRITE_ERROR_TITLE,
      writeErrorBody(label),
      [{ text: 'تمام', onPress: () => { clearTimeout(backstop); unlock(); } }]
    );
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
      setWallets([]); setCategories([]); setTransactions([]); setBudgets({}); setShakhbataIncome({});
      setShakhbataPercentsState(DEFAULT_PERCENTS);
      setDebts([]); setSubscriptions([]); setGamiyas([]);
      setPendingTxIds(new Set());
      setServerReachable(false);
      serverReachableRef.current = false;
      return;
    }

    (async () => {
      const shouldSeed = await claimSeeding(uid);
      if (shouldSeed) {
        DEFAULT_WALLETS.forEach(w => addDocNoWait('wallets', w));
        DEFAULT_CATEGORIES.forEach(name => addDocNoWait('categories', { name }));
      }
    })();

    const unsubWallets = onSnapshot(collection(db, 'users', uid, 'wallets'), { includeMetadataChanges: true }, (snap) => {
      setWallets(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      noteConnection(snap.metadata.fromCache);
    });
    const unsubCategories = onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    // includeMetadataChanges عشان نعرف مين لسه بيرفع ومين وصل: من غيرها فايربيز
    // مبتبعتش snapshot تاني لما السيرفر يأكد كتابة محتواها ما اتغيرش، فالعلامة
    // كانت هتفضل ظاهرة على العملية بعد ما ترفع فعلاً
    const unsubTx = onSnapshot(collection(db, 'users', uid, 'transactions'), { includeMetadataChanges: true }, (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      const stillUploading = snap.docs.filter(d => d.metadata.hasPendingWrites).map(d => d.id);
      setPendingTxIds(prev => (sameIds(prev, stillUploading) ? prev : new Set(stillUploading)));

      // fromCache معناها إن العميل مش متزامن مع السيرفر دلوقتي — ودي أصدق إجابة
      // على سؤال "هل أقدر أوصل فايرستور؟" لأنها جاية من فايربيز نفسها
      noteConnection(snap.metadata.fromCache);
    });
    const unsubBudgets = onSnapshot(collection(db, 'users', uid, 'budgets'), (snap) => {
      const b: Budgets = {};
      snap.docs.forEach(d => { b[d.id] = (d.data() as any).limit; });
      setBudgets(b);
    });
    const unsubShakhbata = onSnapshot(collection(db, 'users', uid, 'shakhbata_income'), (snap) => {
      const s: ShakhbataIncome = {};
      snap.docs.forEach(d => { s[d.id] = (d.data() as any).income; });
      setShakhbataIncome(s);
    });
    const unsubPercents = onSnapshot(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setShakhbataPercentsState({
          needs: data.needs ?? DEFAULT_PERCENTS.needs,
          wants: data.wants ?? DEFAULT_PERCENTS.wants,
          future: data.future ?? DEFAULT_PERCENTS.future,
        });
      } else {
        setShakhbataPercentsState(DEFAULT_PERCENTS);
      }
    });
    const unsubDebts = onSnapshot(collection(db, 'users', uid, 'debts'), (snap) => {
      setDebts(snap.docs.map(d => ({ id: d.id, increases: [], ...(d.data() as any) })) as Debt[]);
    });
    const unsubSubs = onSnapshot(collection(db, 'users', uid, 'subscriptions'), (snap) => {
      setSubscriptions(snap.docs.map(d => ({ id: d.id, history: [], ...(d.data() as any) })) as Subscription[]);
    });
    const unsubGamiyas = onSnapshot(collection(db, 'users', uid, 'gamiyas'), (snap) => {
      setGamiyas(snap.docs.map(d => ({ id: d.id, months: [], ...(d.data() as any) })) as Gamiya[]);
    });

    return () => {
      unsubWallets(); unsubCategories(); unsubTx(); unsubBudgets(); unsubShakhbata(); unsubPercents();
      unsubDebts(); unsubSubs(); unsubGamiyas();
    };
  }, [uid]);

  async function addWallet(name: string) {
    if (!uid) return;
    addDocNoWait('wallets', { name, openingBalance: 0, lowAlert: 0 }, namedLabel('المحفظة', name));
  }
  async function updateWallet(id: string, data: Partial<Wallet>) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'wallets', id), data));
  }
  async function deleteWallet(id: string) {
    if (!uid) return;
    track(deleteDoc(doc(db, 'users', uid, 'wallets', id)));
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
    reassign: { subscriptions?: Record<string, string>; gamiyas?: Record<string, string> },
  ) {
    if (!uid) return;
    const batch = writeBatch(db);
    Object.entries(reassign.subscriptions || {}).forEach(([subId, walletId]) => {
      batch.update(doc(db, 'users', uid, 'subscriptions', subId), { walletId });
    });
    Object.entries(reassign.gamiyas || {}).forEach(([gamiyaId, walletId]) => {
      batch.update(doc(db, 'users', uid, 'gamiyas', gamiyaId), { walletId });
    });
    batch.update(doc(db, 'users', uid, 'wallets', id), {
      archived: true, archivedAt: new Date().toISOString(),
    });
    track(batch.commit());
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
  function deleteWithTransactions(recordRef: DocumentReference, txIds: string[], label?: string) {
    if (!uid) return;
    // حد الدفعة في فايرستور 500 عملية. سجل بأكتر من كده مش واقعي (اشتراك شهري
    // لـ40 سنة)، بس لو حصل بنقسّم بدل ما الدفعة كلها تترفض — والسجل نفسه
    // بيتمسح في آخر دفعة، عشان لو التقسيم اتقطع في النص ميبقاش عندنا سجل
    // متمسوح وعملياته لسه موجودة
    const refs = txIds.map(txId => doc(db, 'users', uid!, 'transactions', txId));
    const chunks: DocumentReference[][] = [];
    for (let i = 0; i < refs.length; i += BATCH_LIMIT - 1) chunks.push(refs.slice(i, i + BATCH_LIMIT - 1));
    if (chunks.length === 0) chunks.push([]);
    chunks.forEach((chunk, idx) => {
      const batch = writeBatch(db);
      chunk.forEach(ref => batch.delete(ref));
      if (idx === chunks.length - 1) batch.delete(recordRef);
      track(batch.commit(), label);
    });
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
      if ((d.payments || []).some(p => p.transactionId === txId)) {
        const payments = d.payments.filter(p => p.transactionId !== txId);
        // العدد بيترجع مع الدفعة: حذف العملية المربوطة بدفعة لازم يسيب الدين
        // موصوف صح، مش بعدد أقساط من زمن دفعة مابقتش موجودة
        const patch: Record<string, unknown> = { payments };
        const recount = installmentCountFor({ ...d, payments });
        if (recount !== null && recount !== d.installmentCount) patch.installmentCount = recount;
        batch.update(doc(db, 'users', uid, 'debts', d.id), patch);
        return;
      }
      if ((d.increases || []).some(e => e.transactionId === txId)) {
        const increases = (d.increases || []).filter(e => e.transactionId !== txId);
        const patch: Record<string, unknown> = { increases };
        const recount = installmentCountFor({ ...d, increases });
        if (recount !== null && recount !== d.installmentCount) patch.installmentCount = recount;
        batch.update(doc(db, 'users', uid, 'debts', d.id), patch);
        return;
      }
    }

    for (const sub of subscriptions) {
      const history = sub.history || [];
      const idx = history.findIndex(h => h.transactionId === txId);
      if (idx === -1) continue;
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
        const { transactionId, ...rest } = m;
        return { ...rest, status: 'pending' as const };
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
  function stageSettlements(batch: WriteBatch, settlements: Settlement[]) {
    if (!uid) return;
    settlements.forEach(st => {
      const amount = Math.abs(st.delta);
      if (amount === 0) return;
      const ref = doc(collection(db, 'users', uid, 'transactions'));
      batch.set(ref, {
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
    for (const d of debts) {
      if (d.initialTransactionId === id) {
        const hasHistory = (d.payments || []).length > 0 || (d.increases || []).length > 0;
        return hasHistory
          ? `العملية دي هي أساس دين "${d.personName}" — الدين هيفضل موجود بس هيبقى بالأجل من غير أثر على أي محفظة.`
          : `العملية دي هي أساس دين "${d.personName}" — الدين هيتمسح كمان.`;
      }
      if ((d.payments || []).some(p => p.transactionId === id)) {
        return `دي دفعة في دين "${d.personName}" — هتتشال من الدين كمان.`;
      }
      if ((d.increases || []).some(e => e.transactionId === id)) {
        return `دي زيادة على دين "${d.personName}" — هتتشال من الدين كمان.`;
      }
    }
    for (const sub of subscriptions) {
      if ((sub.history || []).some(h => h.transactionId === id)) {
        return `دي دفعة اشتراك "${sub.name}" — هتتشال من سجل الاشتراك وموعد الاستحقاق هيترجع.`;
      }
    }
    for (const g of gamiyas) {
      if ((g.months || []).some(m => m.transactionId === id)) {
        return `دي عملية شهر في جمعية "${g.name}" — الشهر هيرجع "لسه ما اتسددش".`;
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
    track(setDoc(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), p), 'نسب شخبطة');
  }

  async function addDebt(data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
    dueDate?: string; reminderDaysBefore?: number;
  }) {
    if (!uid) return;
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
    const installmentAmount = data.isInstallment && data.installmentCount && data.installmentCount > 0
      ? roundMoney(data.totalAmount / data.installmentCount)
      : undefined;
    const clean = Object.fromEntries(Object.entries({
      direction: data.direction, personName: data.personName, personPhone: data.personPhone, personContactId: data.personContactId, totalAmount: data.totalAmount, date: data.date,
      isInstallment: data.isInstallment, installmentCount: data.installmentCount, installmentAmount, note: data.note,
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

  async function deleteDebt(id: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === id);
    const txIds = debt ? [
      debt.initialTransactionId,
      ...(debt.payments || []).map(p => p.transactionId),
      ...(debt.increases || []).map(inc => inc.transactionId),
    ].filter((x): x is string => !!x) : [];
    deleteWithTransactions(doc(db, 'users', uid, 'debts', id), txIds, namedLabel('حذف الدين', debt?.personName));
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
    if (!serverReachableRef.current) return { outcome: 'no-connection' };
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    if (!(await waitForOurWritesToLand())) return { outcome: 'no-connection' };
    // الجملة بتتحسب جوه العملية الذرية (على الدين اللي اتقرا من السيرفر) وبتتقري
    // من بره بعد ما تنجح. الحامل ده مش ترف: الـcallback ممكن تتعاد لما العملية
    // تتصادم، والقيمة اللي تهمنا هي بتاعة اللفة اللي نجحت
    const result: { note: string | null } = { note: null };
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = { id: debtId, payments: [], increases: [], ...(snap.data() as any) } as Debt;
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
        const nextCount = installmentCountAfterPayment(debt, amount);
        if (nextCount !== null && nextCount !== debt.installmentCount) {
          patch.installmentCount = nextCount;
        }

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

        result.note = installmentChangeMessage(
          amount,
          installmentValue(debt) ?? amount,
          debt.installmentCount ?? 0,
          nextCount ?? debt.installmentCount ?? 0,
          debtRemaining(debt) - amount <= PIASTRE_EPS,
        );
      }));
      return { outcome: 'done', note: result.note };
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
    track(
      updateDoc(doc(db, 'users', uid, 'debts', debtId), {
        installmentCount: plan.count,
        installmentAmount: plan.value,
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
   * **ملحوظة:** مفيش ولا شاشة بتنادي الدالة دي لحد دلوقتي — مفيش زرار "امسح
   * الدفعة" في الواجهة، والمستخدم بيوصل لنفس النتيجة بحذف العملية المالية
   * نفسها من الأرشيف (`deleteTransaction` ← `stageReconcile`).
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
        const debt = { id: debtId, payments: [], increases: [], ...(snap.data() as any) } as Debt;
        const payment = (debt.payments || []).find(p => p.id === paymentId);
        // اتمسحت قبل كده (من جهاز تاني، أو دوسة اتكررت) — مفيش حاجة تتعمل،
        // والنتيجة "تمام" لأن اللي المستخدم عايزه حاصل فعلاً
        if (!payment) return;
        const payments = (debt.payments || []).filter(p => p.id !== paymentId);
        // **العدد لازم يترجع معاها.** من غير ده، دفعة غيّرت العدد من 6 لـ7 وبعدين
        // اتمسحت كانت بتسيب العدد 7 للأبد — فالكارت يقول "القسط 1 من 7" لدين
        // حسابه 6.
        const patch: Record<string, unknown> = { payments };
        const recount = installmentCountFor({ ...debt, payments });
        if (recount !== null && recount !== debt.installmentCount) patch.installmentCount = recount;
        if (payment.transactionId) t.delete(doc(db, 'users', uid!, 'transactions', payment.transactionId));
        t.update(debtRef, patch);
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('حذف دفعة الدين', e);
      return 'failed';
    }
  }
  /** زيادة الدين — ذرية لنفس أسباب الدفعة بالظبط (شوف `addDebtPayment` فوق) */
  async function addDebtIncrease(debtId: string, amount: number, date: string, walletId?: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    if (!serverReachableRef.current) return 'no-connection';
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = { id: debtId, payments: [], increases: [], ...(snap.data() as any) } as Debt;
        // الزيادة ممكن تكون من غير محفظة (تسجيل على الورق)، وساعتها مفيش عملية
        // مالية أصلاً ومفيش محفظة تتفحص
        if (walletId && !(await walletUsable(t, doc(db, 'users', uid!, 'wallets', walletId)))) {
          throw new WalletMissingError();
        }

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
        const entry: DebtEntry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount,
          ...(walletId ? { walletId, transactionId } : {}),
        };
        t.update(debtRef, { increases: [...(debt.increases || []), entry] });
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('زيادة الدين', e);
      return e instanceof WalletMissingError ? 'wallet-missing' : 'failed';
    }
  }
  /**
   * حذف الزيادة — ذري زي حذف الدفعة بالظبط، ومحدش بيناديه من الواجهة كمان
   * (نفس الملحوظة اللي فوق `deleteDebtPayment`)
   */
  async function deleteDebtIncrease(debtId: string, entryId: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    if (!serverReachableRef.current) return 'no-connection';
    const debtRef = doc(db, 'users', uid, 'debts', debtId);
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(debtRef);
        if (!snap.exists()) throw new DebtMissingError();
        const debt = { id: debtId, payments: [], increases: [], ...(snap.data() as any) } as Debt;
        const entry = (debt.increases || []).find(e => e.id === entryId);
        if (!entry) return;
        const increases = (debt.increases || []).filter(e => e.id !== entryId);
        const patch: Record<string, unknown> = { increases };
        const recount = installmentCountFor({ ...debt, increases });
        if (recount !== null && recount !== debt.installmentCount) patch.installmentCount = recount;
        if (entry.transactionId) t.delete(doc(db, 'users', uid!, 'transactions', entry.transactionId));
        t.update(debtRef, patch);
      }));
      return 'done';
    } catch (e) {
      noteAtomicFailure('حذف زيادة الدين', e);
      return 'failed';
    }
  }

  async function addSubscription(data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
  }) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    addDocNoWait('subscriptions', { ...clean, active: true, history: [], createdAt: new Date().toISOString() }, namedLabel('الاشتراك', data.name));
  }
  async function updateSubscription(id: string, data: Partial<Subscription>) {
    if (!uid) return;
    // لازم نشيل قيم undefined — Firestore بترفضها وبترمي خطأ يمنع الحفظ كله
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    track(updateDoc(doc(db, 'users', uid, 'subscriptions', id), clean), namedLabel('تعديل الاشتراك', subscriptions.find(s => s.id === id)?.name));
  }
  async function deleteSubscription(id: string) {
    if (!uid) return;
    const sub = subscriptions.find(s => s.id === id);
    const txIds = (sub?.history || []).map(h => h.transactionId).filter((x): x is string => !!x);
    deleteWithTransactions(doc(db, 'users', uid, 'subscriptions', id), txIds, namedLabel('حذف الاشتراك', sub?.name));
  }
  /**
   * بيتعمل جوه runTransaction عشان القراية والكتابة يبقوا خطوة واحدة ذرية.
   * قبل كده كان بيقرا الاشتراك من حالة الرياكت، فنداءين في نفس الوقت كانوا
   * الاتنين بيشوفوا نفس الحالة القديمة وبيسجلوا دفعتين — يعني خصم مضاعف.
   * بنقرا من السيرفر جوه العملية الذرية، فالنداء التاني بيلاقي الدفعة اتسجلت
   * ويقف. علامة التكرار هي نفس التاريخ ونفس المبلغ (منقدرش نضيف حقل جديد من
   * غير تعديل قواعد Firestore في الكونسول).
   */
  async function markSubscriptionPaid(id: string, date: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    // من غير اتصال العملية دي مش هتعرف تشتغل أصلاً (بتقرا من السيرفر)، فبنرفض
    // على طول برسالة واضحة بدل ما المستخدم يستنى قدام زرار مقفول ويطلعله خطأ بعدين
    if (!serverReachableRef.current) return 'no-connection';
    const subRef = doc(db, 'users', uid, 'subscriptions', id);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    // بما إننا مش بنستنى تأكيد السيرفر على الكتابات العادية، ممكن المستخدم يعمل
    // اشتراك ويدوس "سدّد" قبل ما الاشتراك نفسه يوصل. والعملية الذرية بتقرا من
    // السيرفر، فكانت هتلاقيه مش موجود وتخرج من غير ما تعمل حاجة — الزرار يشتغل
    // ومفيش سداد يتسجل. فبنستنى الأول اللي عندنا يرفع
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(subRef);
        if (!snap.exists()) return;
        const sub = { id, ...(snap.data() as any) } as Subscription;
        const history = sub.history || [];
        const alreadyPaid = history.some(h => h.date === date && h.amount === sub.amount);
        if (alreadyPaid) return;

        // المحفظة بتتقري من جوه العملية الذرية عشان الإجابة تبقى عن الحالة
        // اللي هتتكتب عليها فعلاً، مش عن نسخة في ذاكرة الرياكت ممكن تكون
        // قديمة. كل القرايات لازم تسبق كل الكتابات في العملية الذرية.
        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', sub.walletId)))) throw new WalletMissingError();

        const txData = {
          type: 'expense' as const, amount: sub.amount, walletId: sub.walletId, date,
          categoryId: sub.categoryId, note: `اشتراك: ${sub.name}`,
          createdAt: new Date().toISOString(),
        };
        t.set(txRef, Object.fromEntries(Object.entries(txData).filter(([, v]) => v !== undefined)));

        const payment: SubscriptionPayment = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          date, amount: sub.amount, transactionId: txRef.id,
        };
        const nextDue = sub.frequency === 'monthly' ? addMonths(sub.nextDueDate, 1)
          : sub.frequency === 'yearly' ? addMonths(sub.nextDueDate, 12)
          : addDays(sub.nextDueDate, sub.customDays || 30);
        t.update(subRef, { history: [...history, payment], nextDueDate: nextDue });
      }));
      return 'done';
    } catch (e) {
      // العملية الذرية إما تتم كلها أو مفيش — ففشلها معناه إن مفيش أي خصم اتسجل،
      // والشاشة بتقول كده صريح بدل تنبيه الخطأ العام بتاع track
      return e instanceof WalletMissingError ? 'wallet-missing' : 'failed';
    }
  }

  /**
   * بنستنى اللي كتبناه محليًا يوصل السيرفر قبل أي عملية بتقرا منه، وإلا ممكن
   * تلاقي سجل لسه بيرفع فتفتكره مش موجود.
   * `waitForPendingWrites` **مبيتحلش خالص** وإحنا أوفلاين (اتقاس)، فبنسابقه مع
   * إشارة "الاتصال وقع" ومع سقف زمني — عشان الانتظار يفضل محدود دايمًا.
   * بيرجّع false يعني ما وصلناش السيرفر، ومحصلش أي خصم لأننا مابدأناش أصلاً.
   */
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

  async function addGamiya(data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
  }) {
    if (!uid) return;
    const months: GamiyaMonth[] = Array.from({ length: data.totalMonths }, (_, i) => {
      const monthIndex = i + 1;
      const isPayoutMonth = monthIndex === data.payoutMonthIndex;
      return {
        id: `${monthIndex}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        monthIndex,
        dueDate: addMonths(data.startDate, i),
        isPayoutMonth,
        amount: isPayoutMonth ? data.payoutAmount : data.monthlyAmount,
        status: 'pending',
      };
    });
    addDocNoWait('gamiyas', { ...data, months, createdAt: new Date().toISOString() }, namedLabel('الجمعية', data.name));
  }
  async function updateGamiya(id: string, data: Partial<Gamiya>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    track(updateDoc(doc(db, 'users', uid, 'gamiyas', id), clean), namedLabel('تعديل الجمعية', gamiyas.find(x => x.id === id)?.name));
  }
  async function deleteGamiya(id: string) {
    if (!uid) return;
    const g = gamiyas.find(x => x.id === id);
    const txIds = (g?.months || []).map(m => m.transactionId).filter((x): x is string => !!x);
    deleteWithTransactions(doc(db, 'users', uid, 'gamiyas', id), txIds, namedLabel('حذف الجمعية', g?.name));
  }
  /**
   * زي markSubscriptionPaid: عملية ذرية بتقرا الجمعية من السيرفر وبتتأكد إن
   * الشهر لسه pending قبل ما تخصم. قبل كده كانت بتقرا من حالة الرياكت من غير ما
   * تبص على حالة الشهر أصلاً، فنداءها مرتين على نفس الشهر كان بيعمل عمليتين خصم،
   * والشهر بيتربط بالتانية فالأولى بتفضل عملية يتيمة في الأرشيف بتقلل الرصيد.
   */
  async function markGamiyaMonthDone(gamiyaId: string, monthId: string): Promise<PayOutcome> {
    if (!uid) return 'done';
    // زي markSubscriptionPaid بالظبط: رفض فوري من غير اتصال، وانتظار اللي لسه
    // بيرفع قبل القراية من السيرفر، والكل متسابق مع "الاتصال وقع"
    if (!serverReachableRef.current) return 'no-connection';
    const gamiyaRef = doc(db, 'users', uid, 'gamiyas', gamiyaId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    if (!(await waitForOurWritesToLand())) return 'no-connection';
    try {
      await countPending(runTransaction(db, async (t) => {
        const snap = await t.get(gamiyaRef);
        if (!snap.exists()) return;
        const g = { id: gamiyaId, ...(snap.data() as any) } as Gamiya;
        const month = (g.months || []).find(m => m.id === monthId);
        if (!month || month.status === 'done') return;

        if (!(await walletUsable(t, doc(db, 'users', uid!, 'wallets', g.walletId)))) throw new WalletMissingError();

        const type = month.isPayoutMonth ? 'income' : 'expense';
        t.set(txRef, {
          type, amount: month.amount, walletId: g.walletId, date: month.dueDate,
          note: `${month.isPayoutMonth ? 'استلام جمعية' : 'قسط جمعية'}: ${g.name} (شهر ${month.monthIndex})`,
          createdAt: new Date().toISOString(),
        });
        const updatedMonths = g.months.map(m =>
          m.id === monthId ? { ...m, status: 'done' as const, transactionId: txRef.id } : m
        );
        t.update(gamiyaRef, { months: updatedMonths });
      }));
      return 'done';
    } catch (e) {
      return e instanceof WalletMissingError ? 'wallet-missing' : 'failed';
    }
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, budgets, shakhbataIncome, shakhbataPercents,
        debts, subscriptions, gamiyas, pendingWrites, pendingTxIds, serverReachable,
        addWallet, updateWallet, deleteWallet, archiveWallet, restoreWallet,
        addCategory, updateCategory, deleteCategory, archiveCategory, restoreCategory,
        submitFeedback,
        addTransaction, updateTransaction, deleteTransaction, transactionLinkWarning,
        setBudget, setMonthlyIncome, setShakhbataPercents,
        addDebt, updateDebt, deleteDebt, addDebtPayment, deleteDebtPayment, addDebtIncrease, deleteDebtIncrease,
        setInstallmentCount,
        addSubscription, updateSubscription, deleteSubscription, markSubscriptionPaid,
        addGamiya, updateGamiya, deleteGamiya, markGamiyaMonthDone,
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