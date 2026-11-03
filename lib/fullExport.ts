import type { Budgets, Category, Debt, Gamiya, ShakhbataIncome, ShakhbataPercents, Subscription, Transaction, Wallet } from '@/context/DataContext';
import type { RecurringIncome } from '@/lib/recurringIncome';

/**
 * التصدير الكامل (خط النهاية: "مسح الحساب + تصدير كامل" — `reports/2026-11-03-account-delete-export.md`).
 *
 * ورقة لكل نوع، **بالمعرّفات** (`Id`، `WalletId`…) عشان الأوراق تتربط ببعض والملف يبقى
 * "structured, machine-readable" (GDPR م20)، و**بالأسامي** جنبها عشان يتقري. الأرقام خام (مش مخفية
 * بالعين — زي تصدير الأرشيف): ده ملف المستخدم بياخده لنفسه. أسامي الأعمدة إنجليزي زي تصدير الأرشيف
 * (الإكسيل بيفرز ويفلتر عليها). كل حقل بالاسم — مش `...x`: حقل جديد مبيدخلش الملف من غير قرار.
 *
 * المؤرشف والممسوح جوّه (المحافظ والفئات المؤرشفة ليها عمود `Archived`) — ده **كل** اللي متخزّن.
 */
export type ExportRow = Record<string, string | number | boolean>;
export type ExportSheet = { name: string; rows: ExportRow[] };

export type FullExportInput = {
  wallets: Wallet[]; categories: Category[]; transactions: Transaction[];
  debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[]; incomes: RecurringIncome[];
  budgets: Budgets; shakhbataIncome: ShakhbataIncome; shakhbataPercents: ShakhbataPercents;
};

const s = (x: string | undefined | null) => x ?? '';
const n = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? x : '');

export function buildFullExportSheets(d: FullExportInput): ExportSheet[] {
  const walletName = (id?: string) => d.wallets.find(w => w.id === id)?.name ?? '';
  const categoryName = (id?: string) => d.categories.find(c => c.id === id)?.name ?? '';
  const byDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date));

  return [
    { name: 'Wallets', rows: d.wallets.map(w => ({
      Id: w.id, Name: w.name, OpeningBalance: w.openingBalance, LowAlert: w.lowAlert,
      Archived: !!w.archived, ArchivedAt: s(w.archivedAt),
    })) },
    { name: 'Categories', rows: d.categories.map(c => ({
      Id: c.id, Name: c.name, Icon: s(c.icon), Bucket: s(c.bucket), Archived: !!c.archived, ArchivedAt: s(c.archivedAt),
    })) },
    { name: 'Transactions', rows: byDate(d.transactions).map(t => ({
      Id: t.id, Date: t.date, CreatedAt: s(t.createdAt), Type: t.type, Amount: t.amount,
      WalletId: t.walletId, Wallet: walletName(t.walletId), ToWalletId: s(t.toWalletId), ToWallet: walletName(t.toWalletId),
      CategoryId: s(t.categoryId), Category: categoryName(t.categoryId), Note: s(t.note),
      SubscriptionId: s(t.subscriptionId), GamiyaId: s(t.gamiyaId), IncomeId: s(t.incomeId),
      Settlement: !!t.isSettlement, AutoRecorded: !!t.autoRecorded,
    })) },
    { name: 'Debts', rows: d.debts.map(x => ({
      Id: x.id, Direction: x.direction, Person: x.personName, Phone: s(x.personPhone), TotalAmount: x.totalAmount,
      Date: x.date, IsInstallment: x.isInstallment, InstallmentCount: n(x.installmentCount), InstallmentAmount: n(x.installmentAmount),
      DueDate: s(x.dueDate), ReminderDaysBefore: n(x.reminderDaysBefore), Note: s(x.note), CreatedAt: x.createdAt,
      InitialWalletId: s(x.initialWalletId), InitialTransactionId: s(x.initialTransactionId),
    })) },
    { name: 'DebtPayments', rows: d.debts.flatMap(x => byDate(x.payments || []).map(p => ({
      DebtId: x.id, Person: x.personName, Id: p.id, Date: p.date, Amount: p.amount,
      WalletId: p.walletId, Wallet: walletName(p.walletId), TransactionId: s(p.transactionId),
    }))) },
    { name: 'DebtIncreases', rows: d.debts.flatMap(x => byDate(x.increases || []).map(p => ({
      DebtId: x.id, Person: x.personName, Id: p.id, Date: p.date, Amount: p.amount,
      WalletId: s(p.walletId), Wallet: walletName(p.walletId), TransactionId: s(p.transactionId),
    }))) },
    { name: 'Subscriptions', rows: d.subscriptions.map(x => ({
      Id: x.id, Name: x.name, Amount: x.amount, WalletId: x.walletId, Wallet: walletName(x.walletId),
      CategoryId: s(x.categoryId), Category: categoryName(x.categoryId), Frequency: x.frequency, CustomDays: n(x.customDays),
      NextDueDate: x.nextDueDate, ReminderDaysBefore: x.reminderDaysBefore, Active: x.active !== false,
      ChargeMode: s(x.chargeMode) || 'confirm', CreatedAt: x.createdAt,
    })) },
    { name: 'SubscriptionPayments', rows: d.subscriptions.flatMap(x => byDate(x.history || []).map(p => ({
      SubscriptionId: x.id, Subscription: x.name, Id: p.id, Date: p.date, Amount: p.amount,
      PeriodKey: s(p.periodKey), TransactionId: s(p.transactionId), Auto: !!p.auto,
    }))) },
    { name: 'Gamiyas', rows: d.gamiyas.map(x => ({
      Id: x.id, Name: x.name, MonthlyAmount: x.monthlyAmount, TotalMonths: x.totalMonths, PayoutMonthIndex: x.payoutMonthIndex,
      PayoutAmount: x.payoutAmount, WalletId: x.walletId, Wallet: walletName(x.walletId), StartDate: x.startDate,
      ReminderDaysBefore: x.reminderDaysBefore, ChargeMode: s(x.chargeMode) || 'confirm', CreatedAt: x.createdAt,
    })) },
    { name: 'GamiyaMonths', rows: d.gamiyas.flatMap(x => [...(x.months || [])].sort((a, b) => a.monthIndex - b.monthIndex).map(m => ({
      GamiyaId: x.id, Gamiya: x.name, Id: m.id, MonthIndex: m.monthIndex, DueDate: m.dueDate, Amount: m.amount,
      IsPayoutMonth: m.isPayoutMonth, Status: m.status, TransactionId: s(m.transactionId),
    }))) },
    { name: 'FixedIncomes', rows: d.incomes.map(x => ({
      Id: x.id, Name: x.name, Amount: x.amount, WalletId: x.walletId, Wallet: walletName(x.walletId), Frequency: x.frequency,
      DayOfMonth: n(x.dayOfMonth), Weekday: n(x.weekday), Mode: x.mode, Status: x.status, StartDate: x.startDate, CreatedAt: x.createdAt,
    })) },
    { name: 'Budgets', rows: Object.entries(d.budgets).map(([categoryId, limit]) => ({
      CategoryId: categoryId, Category: categoryName(categoryId), MonthlyLimit: limit,
    })) },
    { name: 'Shakhbata', rows: [
      ...Object.entries(d.shakhbataIncome).sort(([a], [b]) => a.localeCompare(b)).map(([month, income]) => ({ Month: month, Income: income })),
    ] },
    { name: 'ShakhbataPercents', rows: [{ Needs: d.shakhbataPercents.needs, Wants: d.shakhbataPercents.wants, Future: d.shakhbataPercents.future }] },
  ];
}
