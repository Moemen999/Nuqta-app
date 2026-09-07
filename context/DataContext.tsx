import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebaseConfig';
import { addDays, addMonths } from '@/lib/finance';
import {
  addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, runTransaction, setDoc, updateDoc,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
  markSubscriptionPaid: (id: string, date: string) => Promise<void>;
  addGamiya: (data: {
    name: string; monthlyAmount: number; totalMonths: number; payoutMonthIndex: number;
    payoutAmount: number; walletId: string; startDate: string; reminderDaysBefore: number;
  }) => Promise<void>;
  updateGamiya: (id: string, data: Partial<Gamiya>) => Promise<void>;
  deleteGamiya: (id: string) => Promise<void>;
  markGamiyaMonthDone: (gamiyaId: string, monthId: string) => Promise<void>;
};

const DataContext = createContext<DataContextType | undefined>(undefined);

const DEFAULT_WALLETS = [
  { name: 'CIB', openingBalance: 0, lowAlert: 100 },
  { name: 'NBE', openingBalance: 0, lowAlert: 100 },
  { name: 'CASH', openingBalance: 0, lowAlert: 50 },
];
const DEFAULT_CATEGORIES = ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى'];
const DEFAULT_PERCENTS: ShakhbataPercents = { needs: 50, wants: 30, future: 20 };

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

  useEffect(() => {
    if (!uid) {
      setWallets([]); setCategories([]); setTransactions([]); setBudgets({}); setShakhbataIncome({});
      setShakhbataPercentsState(DEFAULT_PERCENTS);
      setDebts([]); setSubscriptions([]); setGamiyas([]);
      return;
    }

    (async () => {
      const shouldSeed = await claimSeeding(uid);
      if (shouldSeed) {
        DEFAULT_WALLETS.forEach(w => addDoc(collection(db, 'users', uid, 'wallets'), w));
        DEFAULT_CATEGORIES.forEach(name => addDoc(collection(db, 'users', uid, 'categories'), { name }));
      }
    })();

    const unsubWallets = onSnapshot(collection(db, 'users', uid, 'wallets'), (snap) => {
      setWallets(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    const unsubCategories = onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    const unsubTx = onSnapshot(collection(db, 'users', uid, 'transactions'), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
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
    await addDoc(collection(db, 'users', uid, 'wallets'), { name, openingBalance: 0, lowAlert: 0 });
  }
  async function updateWallet(id: string, data: Partial<Wallet>) {
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'wallets', id), data);
  }
  async function deleteWallet(id: string) {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'wallets', id));
  }
  async function addCategory(name: string) {
    if (!uid) return;
    await addDoc(collection(db, 'users', uid, 'categories'), { name });
  }
  async function updateCategory(id: string, data: Partial<Category>) {
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid, 'categories', id), data);
  }
  async function deleteCategory(id: string) {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'categories', id));
  }
  async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
    if (!uid) return '';
    // بنضمن وجود createdAt دايمًا عشان الوقت يظهر مع كل العمليات (حتى اللي بتتولد من الديون والاشتراكات والجمعية)
    const withTimestamp = { createdAt: new Date().toISOString(), ...tx };
    const clean = Object.fromEntries(Object.entries(withTimestamp).filter(([, v]) => v !== undefined));
    const ref = await addDoc(collection(db, 'users', uid, 'transactions'), clean);
    return ref.id;
  }
  async function updateTransaction(id: string, tx: Partial<Transaction>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    await updateDoc(doc(db, 'users', uid, 'transactions', id), clean);
  }
  // حذف العملية من غير أي تنسيق — بتستخدمها بس المسارات اللي بتمسح السجل الأصلي
  // بنفسها (حذف دين/اشتراك/جمعية)، عشان منلفش في دايرة حذف
  async function deleteTransactionDoc(id: string) {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'transactions', id));
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
          await updateDoc(doc(db, 'users', uid, 'debts', d.id), {
            initialTransactionId: deleteField(),
            initialWalletId: deleteField(),
          });
        } else {
          await deleteDoc(doc(db, 'users', uid, 'debts', d.id));
        }
        return;
      }
      if ((d.payments || []).some(p => p.transactionId === txId)) {
        await updateDoc(doc(db, 'users', uid, 'debts', d.id), {
          payments: d.payments.filter(p => p.transactionId !== txId),
        });
        return;
      }
      if ((d.increases || []).some(e => e.transactionId === txId)) {
        await updateDoc(doc(db, 'users', uid, 'debts', d.id), {
          increases: (d.increases || []).filter(e => e.transactionId !== txId),
        });
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
      await updateDoc(doc(db, 'users', uid, 'subscriptions', sub.id), {
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
      await updateDoc(doc(db, 'users', uid, 'gamiyas', g.id), { months });
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
    await setDoc(doc(db, 'users', uid, 'budgets', categoryId), { limit });
  }
  async function setMonthlyIncome(month: string, income: number) {
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'shakhbata_income', month), { income });
  }
  async function setShakhbataPercents(p: ShakhbataPercents) {
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'shakhbata_settings', 'percents'), p);
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
    await addDoc(collection(db, 'users', uid, 'debts'), { ...clean, payments: [], increases: [], createdAt: new Date().toISOString() });
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
    await deleteDoc(doc(db, 'users', uid, 'debts', id));
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
    await updateDoc(doc(db, 'users', uid, 'debts', debtId), { payments: [...debt.payments, payment] });
  }
  async function deleteDebtPayment(debtId: string, paymentId: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const payment = debt.payments.find(p => p.id === paymentId);
    if (payment?.transactionId) await deleteTransactionDoc(payment.transactionId);
    await updateDoc(doc(db, 'users', uid, 'debts', debtId), { payments: debt.payments.filter(p => p.id !== paymentId) });
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
    await updateDoc(doc(db, 'users', uid, 'debts', debtId), { increases: [...(debt.increases || []), entry] });
  }
  async function deleteDebtIncrease(debtId: string, entryId: string) {
    if (!uid) return;
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const entry = (debt.increases || []).find(e => e.id === entryId);
    if (entry?.transactionId) await deleteTransactionDoc(entry.transactionId);
    await updateDoc(doc(db, 'users', uid, 'debts', debtId), { increases: (debt.increases || []).filter(e => e.id !== entryId) });
  }

  async function addSubscription(data: {
    name: string; amount: number; walletId: string; categoryId?: string;
    frequency: 'monthly' | 'yearly' | 'custom'; customDays?: number; nextDueDate: string; reminderDaysBefore: number;
  }) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await addDoc(collection(db, 'users', uid, 'subscriptions'), { ...clean, active: true, history: [], createdAt: new Date().toISOString() });
  }
  async function updateSubscription(id: string, data: Partial<Subscription>) {
    if (!uid) return;
    // لازم نشيل قيم undefined — Firestore بترفضها وبترمي خطأ يمنع الحفظ كله
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await updateDoc(doc(db, 'users', uid, 'subscriptions', id), clean);
  }
  async function deleteSubscription(id: string) {
    if (!uid) return;
    const sub = subscriptions.find(s => s.id === id);
    if (sub) {
      const txIds = (sub.history || []).map(h => h.transactionId).filter((x): x is string => !!x);
      await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
    }
    await deleteDoc(doc(db, 'users', uid, 'subscriptions', id));
  }
  /**
   * بيتعمل جوه runTransaction عشان القراية والكتابة يبقوا خطوة واحدة ذرية.
   * قبل كده كان بيقرا الاشتراك من حالة الرياكت، فنداءين في نفس الوقت كانوا
   * الاتنين بيشوفوا نفس الحالة القديمة وبيسجلوا دفعتين — يعني خصم مضاعف.
   * بنقرا من السيرفر جوه العملية الذرية، فالنداء التاني بيلاقي الدفعة اتسجلت
   * ويقف. علامة التكرار هي نفس التاريخ ونفس المبلغ (منقدرش نضيف حقل جديد من
   * غير تعديل قواعد Firestore في الكونسول).
   */
  async function markSubscriptionPaid(id: string, date: string) {
    if (!uid) return;
    const subRef = doc(db, 'users', uid, 'subscriptions', id);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    await runTransaction(db, async (t) => {
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
    });
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
    await addDoc(collection(db, 'users', uid, 'gamiyas'), { ...data, months, createdAt: new Date().toISOString() });
  }
  async function updateGamiya(id: string, data: Partial<Gamiya>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await updateDoc(doc(db, 'users', uid, 'gamiyas', id), clean);
  }
  async function deleteGamiya(id: string) {
    if (!uid) return;
    const g = gamiyas.find(x => x.id === id);
    if (g) {
      const txIds = g.months.map(m => m.transactionId).filter((x): x is string => !!x);
      await Promise.all(txIds.map(txId => deleteTransactionDoc(txId)));
    }
    await deleteDoc(doc(db, 'users', uid, 'gamiyas', id));
  }
  /**
   * زي markSubscriptionPaid: عملية ذرية بتقرا الجمعية من السيرفر وبتتأكد إن
   * الشهر لسه pending قبل ما تخصم. قبل كده كانت بتقرا من حالة الرياكت من غير ما
   * تبص على حالة الشهر أصلاً، فنداءها مرتين على نفس الشهر كان بيعمل عمليتين خصم،
   * والشهر بيتربط بالتانية فالأولى بتفضل عملية يتيمة في الأرشيف بتقلل الرصيد.
   */
  async function markGamiyaMonthDone(gamiyaId: string, monthId: string) {
    if (!uid) return;
    const gamiyaRef = doc(db, 'users', uid, 'gamiyas', gamiyaId);
    const txRef = doc(collection(db, 'users', uid, 'transactions'));
    await runTransaction(db, async (t) => {
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
    });
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, budgets, shakhbataIncome, shakhbataPercents,
        debts, subscriptions, gamiyas,
        addWallet, updateWallet, deleteWallet,
        addCategory, updateCategory, deleteCategory,
        addTransaction, updateTransaction, deleteTransaction, transactionLinkWarning,
        setBudget, setMonthlyIncome, setShakhbataPercents,
        addDebt, deleteDebt, addDebtPayment, deleteDebtPayment, addDebtIncrease, deleteDebtIncrease,
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