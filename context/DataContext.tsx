import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebaseConfig';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Wallet = { id: string; name: string; openingBalance: number; lowAlert: number };
export type Category = { id: string; name: string };
export type Transaction = {
  id: string;
  type: 'expense' | 'income' | 'withdraw';
  amount: number;
  walletId: string;
  toWalletId?: string;
  categoryId?: string;
  note?: string;
  date: string;
};
export type Budgets = Record<string, number>;

type DataContextType = {
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budgets;
  addWallet: (name: string) => Promise<void>;
  updateWallet: (id: string, data: Partial<Wallet>) => Promise<void>;
  deleteWallet: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<void>;
  updateTransaction: (id: string, tx: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  setBudget: (categoryId: string, limit: number) => Promise<void>;
};

const DataContext = createContext<DataContextType | undefined>(undefined);

const DEFAULT_WALLETS = [
  { name: 'CIB', openingBalance: 0, lowAlert: 100 },
  { name: 'NBE', openingBalance: 0, lowAlert: 100 },
  { name: 'CASH', openingBalance: 0, lowAlert: 50 },
];
const DEFAULT_CATEGORIES = ['المواصلات', 'الفطار', 'السوبرماركت', 'أكل', 'أخرى'];

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budgets>({});

  useEffect(() => {
    if (!uid) {
      setWallets([]); setCategories([]); setTransactions([]); setBudgets({});
      return;
    }

    // العلمين دول بيضمنوا إن "التعبئة التلقائية الأولى" تحصل مرة واحدة بس،
    // أول ما نستقبل أول رد من Firebase — مش في أي وقت القايمة تبقى فاضية
    let isFirstWalletsSnapshot = true;
    let isFirstCategoriesSnapshot = true;

    const unsubWallets = onSnapshot(collection(db, 'users', uid, 'wallets'), (snap) => {
      if (snap.empty && isFirstWalletsSnapshot) {
        DEFAULT_WALLETS.forEach(w => addDoc(collection(db, 'users', uid, 'wallets'), w));
      } else {
        setWallets(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }
      isFirstWalletsSnapshot = false;
    });

    const unsubCategories = onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
      if (snap.empty && isFirstCategoriesSnapshot) {
        DEFAULT_CATEGORIES.forEach(name => addDoc(collection(db, 'users', uid, 'categories'), { name }));
      } else {
        setCategories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }
      isFirstCategoriesSnapshot = false;
    });

    const unsubTx = onSnapshot(collection(db, 'users', uid, 'transactions'), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubBudgets = onSnapshot(collection(db, 'users', uid, 'budgets'), (snap) => {
      const b: Budgets = {};
      snap.docs.forEach(d => { b[d.id] = (d.data() as any).limit; });
      setBudgets(b);
    });

    return () => { unsubWallets(); unsubCategories(); unsubTx(); unsubBudgets(); };
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
  async function deleteCategory(id: string) {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'categories', id));
  }
  async function addTransaction(tx: Omit<Transaction, 'id'>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    await addDoc(collection(db, 'users', uid, 'transactions'), clean);
  }
  async function updateTransaction(id: string, tx: Partial<Transaction>) {
    if (!uid) return;
    const clean = Object.fromEntries(Object.entries(tx).filter(([, v]) => v !== undefined));
    await updateDoc(doc(db, 'users', uid, 'transactions', id), clean);
  }
  async function deleteTransaction(id: string) {
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid, 'transactions', id));
  }
  async function setBudget(categoryId: string, limit: number) {
    if (!uid) return;
    await setDoc(doc(db, 'users', uid, 'budgets', categoryId), { limit });
  }

  return (
    <DataContext.Provider
      value={{
        wallets, categories, transactions, budgets,
        addWallet, updateWallet, deleteWallet,
        addCategory, deleteCategory,
        addTransaction, updateTransaction, deleteTransaction,
        setBudget,
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