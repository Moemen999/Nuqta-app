import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebaseConfig';
import { addDays, addMonths } from '@/lib/finance';
import {
  collection, deleteDoc, deleteField, doc, onSnapshot, runTransaction, setDoc, updateDoc, waitForPendingWrites,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

export type Wallet = { id: string; name: string; openingBalance: number; lowAlert: number };
export type Category = { id: string; name: string; bucket?: 'needs' | 'wants' | 'future' | ''; icon?: string };
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
export type PayOutcome = 'done' | 'no-connection' | 'failed';

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
};

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
  installmentCount?: number;
  note?: string;
  createdAt: string;
  payments: DebtPayment[];
  increases: DebtEntry[];
  initialWalletId?: string;
  initialTransactionId?: string;
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
  addCategory: (name: string) => Promise<void>;
  updateCategory: (id: string, data: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<string>;
  updateTransaction: (id: string, tx: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  transactionLinkWarning: (id: string) => string | null;
  setBudget: (categoryId: string, limit: number) => Promise<void>;
  setMonthlyIncome: (month: string, income: number) => Promise<void>;
  setShakhbataPercents: (p: ShakhbataPercents) => Promise<void>;
  addDebt: (data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
  }) => Promise<void>;
  updateDebt: (id: string, data: DebtMetadata) => Promise<void>;
  deleteDebt: (id: string) => Promise<void>;
  addDebtPayment: (debtId: string, amount: number, walletId: string, date: string, categoryId?: string) => Promise<void>;
  deleteDebtPayment: (debtId: string, paymentId: string) => Promise<void>;
  addDebtIncrease: (debtId: string, amount: number, date: string, walletId?: string) => Promise<void>;
  deleteDebtIncrease: (debtId: string, entryId: string) => Promise<void>;
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
  { name: 'CIB', openingBalance: 0, lowAlert: 100 },
  { name: 'NBE', openingBalance: 0, lowAlert: 100 },
  { name: 'CASH', openingBalance: 0, lowAlert: 50 },
];
const DEFAULT_CATEGORIES = ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى'];
const DEFAULT_PERCENTS: ShakhbataPercents = { needs: 50, wants: 30, future: 20 };
/**
 * أقصى انتظار للكتابات اللي لسه بترفع قبل أي عملية بتقرا من السيرفر. فايربيز
 * بتعلن انقطاع الاتصال خلال ~10 ثواني، فالسقف ده شبكة أمان لو الإشارة اتأخرت
 */
const PENDING_WAIT_TIMEOUT_MS = 15000;

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
  function track<T>(p: Promise<T>): Promise<T | void> {
    return countPending(p).catch(reportWriteError);
  }

  /**
   * بيعد الكتابة في "لسه بترفع" بس بيسيب الخطأ يعدي لللي نداه. بيستخدمها الكود
   * اللي هيتصرف في الخطأ بنفسه (العمليات الذرية بترجّع نتيجة قاطعة للشاشة)،
   * عشان المستخدم ميشوفش تنبيهين على نفس الحاجة
   */
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
  function reportWriteError(e: any) {
    console.warn('كتابة فشلت في فايربيز', e);
    if (errorShown.current) return;
    errorShown.current = true;
    Alert.alert(
      'فيه تعديل ما اتحفظش',
      'التعديل ما وصلش للسيرفر واترجع تاني. راجع البيانات وجرب من الأول.',
      [{ text: 'تمام', onPress: () => { errorShown.current = false; } }]
    );
  }

  /**
   * بنعمل id للمستند من عندنا بدل ما نستنى addDoc ترجع بيه من السيرفر، فالكود
   * اللي محتاج الـ id (زي ربط عملية بدين) بياخده على طول والكتابة تكمل ورا.
   */
  function addDocNoWait(path: string, data: any): string {
    const ref = doc(collection(db, 'users', uid!, path));
    track(setDoc(ref, data));
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
    addDocNoWait('wallets', { name, openingBalance: 0, lowAlert: 0 });
  }
  async function updateWallet(id: string, data: Partial<Wallet>) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'wallets', id), data));
  }
  async function deleteWallet(id: string) {
    if (!uid) return;
    track(deleteDoc(doc(db, 'users', uid, 'wallets', id)));
  }
  async function addCategory(name: string) {
    if (!uid) return;
    addDocNoWait('categories', { name });
  }
  async function updateCategory(id: string, data: Partial<Category>) {
    if (!uid) return;
    track(updateDoc(doc(db, 'users', uid, 'categories', id), data));
  }
  async function deleteCategory(id: string) {
    if (!uid) return;
    track(deleteDoc(doc(db, 'users', uid, 'categories', id)));
  }
  async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
    if (!uid) return '';
    // بنضمن وجود createdAt دايمًا عشان الوقت يظهر مع كل العمليات (حتى اللي بتتولد من الديون والاشتراكات والجمعية)
    const withTimestamp = { createdAt: new Date().toISOString(), ...tx };
    const clean = Object.fromEntries(Object.entries(withTimestamp).filter(([, v]) => v !== undefined));
    return addDocNoWait('transactions', clean);
  }
  async function updateTransaction(id: string, tx: Partial<Transaction>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    track(updateDoc(doc(db, 'users', uid, 'transactions', id), clean));
  }
  // حذف العملية من غير أي تنسيق — بتستخدمها بس المسارات اللي بتمسح السجل الأصلي
  // بنفسها (حذف دين/اشتراك/جمعية)، عشان منلفش في دايرة حذف
  async function deleteTransactionDoc(id: string) {
    if (!uid) return;
    track(deleteDoc(doc(db, 'users', uid, 'transactions', id)));
  }

  /**
   * أي عملية بتتحذف من أي شاشة لازم السجل اللي ولّدها يتعدل معاها، وإلا بيفضل
   * عندنا دين/اشتراك/جمعية متعلقين بعملية مش موجودة — والمستخدم بيشوف رصيد وهمي.
   * - دفعة أو زيادة أو شهر جمعية: بنشيل الحركة من السجل بس (الشهر بيرجع "لسه ما اتسددش")
   * - المبلغ الأساسي للدين: لو الدين لسه مافيهوش دفعات ولا زيادات بيتمسح كله
   *   (مفيهوش غير القيد ده)، ولو فيه بيفضل موجود بس بيبقى "بالأجل" عشان منمسحش
   *   حركات حقيقية المستخدم سجّلها بنفسه في أيام تانية
   */
  async function reconcileLinkedRecords(txId: string) {
    if (!uid) return;

    for (const d of debts) {
      if (d.initialTransactionId === txId) {
        const hasHistory = (d.payments || []).length > 0 || (d.increases || []).length > 0;
        if (hasHistory) {
          track(updateDoc(doc(db, 'users', uid, 'debts', d.id), {
            initialTransactionId: deleteField(),
            initialWalletId: deleteField(),
          }));
        } else {
          track(deleteDoc(doc(db, 'users', uid, 'debts', d.id)));
        }
        return;
      }
      if ((d.payments || []).some(p => p.transactionId === txId)) {
        track(updateDoc(doc(db, 'users', uid, 'debts', d.id), {
          payments: d.payments.filter(p => p.transactionId !== txId),
        }));
        return;
      }
      if ((d.increases || []).some(e => e.transactionId === txId)) {
        track(updateDoc(doc(db, 'users', uid, 'debts', d.id), {
          increases: (d.increases || []).filter(e => e.transactionId !== txId),
        }));
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
      track(updateDoc(doc(db, 'users', uid, 'subscriptions', sub.id), {
        history: history.filter(h => h.transactionId !== txId),
        ...(isLast ? { nextDueDate: rolledBack } : {}),
      }));
      return;
    }

    for (const g of gamiyas) {
      if (!(g.months || []).some(m => m.transactionId === txId)) continue;
      const months = g.months.map(m => {
        if (m.transactionId !== txId) return m;
        const { transactionId, ...rest } = m;
        return { ...rest, status: 'pending' as const };
      });
      track(updateDoc(doc(db, 'users', uid, 'gamiyas', g.id), { months }));
      return;
    }
  }

  async function deleteTransaction(id: string) {
    if (!uid) return;
    await deleteTransactionDoc(id);
    await reconcileLinkedRecords(id);
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
    track(setDoc(doc(db, 'users', uid, 'budgets', categoryId), { limit }));
  }
  async function setMonthlyIncome(month: string, income: number) {
    if (!uid) return;
    track(setDoc(doc(db, 'users', uid, 'shakhbata_income', month), { income }));
  }
  async function setShakhbataPercents(p: ShakhbataPercents) {
    if (!uid) return;
    track(setDoc(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), p));
  }

  async function addDebt(data: {
    direction: 'owed_to_me' | 'i_owe'; personName: string; personPhone?: string; personContactId?: string; totalAmount: number;
    isInstallment: boolean; installmentCount?: number; note?: string; walletId?: string; date: string;
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
    const clean = Object.fromEntries(Object.entries({
      direction: data.direction, personName: data.personName, personPhone: data.personPhone, personContactId: data.personContactId, totalAmount: data.totalAmount, date: data.date,
      isInstallment: data.isInstallment, installmentCount: data.installmentCount, note: data.note,
      initialWalletId: data.walletId, initialTransactionId,
    }).filter(([, v]) => v !== undefined));
    addDocNoWait('debts', { ...clean, payments: [], increases: [], createdAt: new Date().toISOString() });
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
      const trimmed = value.trim();
      // الاسم لازم يفضل موجود — قواعد فايرستور بترفض دين من غير personName
      if (key === 'personName') {
        if (trimmed) patch.personName = trimmed;
        return;
      }
      patch[key] = trimmed || deleteField();
    });
    if (Object.keys(patch).length === 0) return;
    track(updateDoc(doc(db, 'users', uid, 'debts', id), patch));
  }

  async function deleteDebt(id: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === id);
    if (debt) {
      const txIds = [
        debt.initialTransactionId,
        ...debt.payments.map(p => p.transactionId),
        ...(debt.increases || []).map(inc => inc.transactionId),
      ].filter((x): x is string => !!x);
      await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
    }
    track(deleteDoc(doc(db, 'users', uid, 'debts', id)));
  }
  async function addDebtPayment(debtId: string, amount: number, walletId: string, date: string, categoryId?: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const type = debt.direction === 'owed_to_me' ? 'income' : 'expense';
    const txId = await addTransaction({
      type, amount, walletId, date,
      categoryId: type === 'expense' ? categoryId : undefined,
      note: `${debt.direction === 'owed_to_me' ? 'استلام دين من' : 'سداد دين لـ'} ${debt.personName}`,
    });
    const payment: DebtPayment = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date, amount, walletId, transactionId: txId,
      ...(categoryId ? { categoryId } : {}),
    };
    track(updateDoc(doc(db, 'users', uid, 'debts', debtId), { payments: [...debt.payments, payment] }));
  }
  async function deleteDebtPayment(debtId: string, paymentId: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const payment = debt.payments.find(p => p.id === paymentId);
    if (payment?.transactionId) await deleteTransactionDoc(payment.transactionId);
    track(updateDoc(doc(db, 'users', uid, 'debts', debtId), { payments: debt.payments.filter(p => p.id !== paymentId) }));
  }
  async function addDebtIncrease(debtId: string, amount: number, date: string, walletId?: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    let transactionId: string | undefined;
    if (walletId) {
      const type = debt.direction === 'owed_to_me' ? 'expense' : 'income';
      transactionId = await addTransaction({
        type, amount, walletId, date,
        note: `${debt.direction === 'owed_to_me' ? 'زيادة قرض لـ' : 'زيادة استلاف من'} ${debt.personName}`,
      });
    }
    const entry: DebtEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date, amount,
      ...(walletId ? { walletId, transactionId } : {}),
    };
    track(updateDoc(doc(db, 'users', uid, 'debts', debtId), { increases: [...(debt.increases || []), entry] }));
  }
  async function deleteDebtIncrease(debtId: string, entryId: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const entry = (debt.increases || []).find(e => e.id === entryId);
    if (entry?.transactionId) await deleteTransactionDoc(entry.transactionId);
    track(updateDoc(doc(db, 'users', uid, 'debts', debtId), { increases: (debt.increases || []).filter(e => e.id !== entryId) }));
  }

  async function addSubscription(data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
  }) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    addDocNoWait('subscriptions', { ...clean, active: true, history: [], createdAt: new Date().toISOString() });
  }
  async function updateSubscription(id: string, data: Partial<Subscription>) {
    if (!uid) return;
    // لازم نشيل قيم undefined — Firestore بترفضها وبترمي خطأ يمنع الحفظ كله
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    track(updateDoc(doc(db, 'users', uid, 'subscriptions', id), clean));
  }
  async function deleteSubscription(id: string) {
    if (!uid) return;
    const sub = subscriptions.find(s => s.id === id);
    if (sub) {
      const txIds = (sub.history || []).map(h => h.transactionId).filter((x): x is string => !!x);
      await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
    }
    track(deleteDoc(doc(db, 'users', uid, 'subscriptions', id)));
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
    } catch {
      // العملية الذرية إما تتم كلها أو مفيش — ففشلها معناه إن مفيش أي خصم اتسجل،
      // والشاشة بتقول كده صريح بدل تنبيه الخطأ العام بتاع track
      return 'failed';
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
    addDocNoWait('gamiyas', { ...data, months, createdAt: new Date().toISOString() });
  }
  async function updateGamiya(id: string, data: Partial<Gamiya>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    track(updateDoc(doc(db, 'users', uid, 'gamiyas', id), clean));
  }
  async function deleteGamiya(id: string) {
    if (!uid) return;
    const g = gamiyas.find(x => x.id === id);
    if (g) {
      const txIds = g.months.map(m => m.transactionId).filter((x): x is string => !!x);
      await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
    }
    track(deleteDoc(doc(db, 'users', uid, 'gamiyas', id)));
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
    } catch {
      return 'failed';
    }
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, budgets, shakhbataIncome, shakhbataPercents,
        debts, subscriptions, gamiyas, pendingWrites, pendingTxIds, serverReachable,
        addWallet, updateWallet, deleteWallet,
        addCategory, updateCategory, deleteCategory,
        addTransaction, updateTransaction, deleteTransaction, transactionLinkWarning,
        setBudget, setMonthlyIncome, setShakhbataPercents,
        addDebt, updateDebt, deleteDebt, addDebtPayment, deleteDebtPayment, addDebtIncrease, deleteDebtIncrease,
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