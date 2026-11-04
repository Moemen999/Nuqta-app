import type { Budgets, Category, Debt, Gamiya, ShakhbataIncome, ShakhbataPercents, Subscription, Transaction, Wallet } from '@/context/DataContext';
import type { RecurringIncome } from '@/lib/recurringIncome';

/**
 * التصدير الكامل (خط النهاية: "مسح الحساب + تصدير كامل" — `reports/2026-11-03-account-delete-export.md`).
 *
 * ورقة لكل نوع، **بالمعرّفات** (`Id`، `WalletId`…) عشان الأوراق تتربط ببعض والملف يبقى
 * "structured, machine-readable" (GDPR م20)، و**بالأسامي** جنبها عشان يتقري. الأرقام خام (مش مخفية
 * بالعين — زي تصدير الأرشيف): ده ملف المستخدم بياخده لنفسه. أسامي الأوراق والأعمدة عربي وقت الكتابة
 * (`localizeSheets` تحت — قرار مؤمن 2026-11-03). كل حقل بالاسم — مش `...x`: حقل جديد مبيدخلش الملف من غير قرار، و**اختبار
 * الجرد** (`fullExport.test.ts`) بيقع لو قيمة متخزّنة في أي نوع مطلعتش في الملف (silent-failure-hunter: كان فيه
 * `installmentResidue` و`closed` للاشتراك والدخل وغيرهم ناقصين).
 *
 * المؤرشف والواقف جوّه — ده **كل** اللي متخزّن. الداتا نفسها بتتقري من السيرفر (`readAllFromServer`).
 */
export type ExportRow = Record<string, string | number | boolean>;
export type ExportSheet = { name: string; rows: ExportRow[] };

export type FullExportInput = {
  wallets: Wallet[]; categories: Category[]; transactions: Transaction[];
  debts: Debt[]; subscriptions: Subscription[]; gamiyas: Gamiya[]; incomes: RecurringIncome[];
  budgets: Budgets; shakhbataIncome: ShakhbataIncome;
  /** `null` = مستند النسب مش متخزّن (المستخدم ما غيّرهاش) — الملف بيقول "الافتراضي" */
  shakhbataPercents: ShakhbataPercents | null;
  /** "شاركنا رأيك" — اللي المستخدم بعته بنفسه (`feedback where uid == انت`). بيتمسح مع الحساب، فلازم يطلع في الملف قبلها */
  feedback: ExportFeedback[];
};

/** مستند الرأي زي ما اتقرا من السيرفر. `createdAt` نص ISO (الـTimestamp بيتحوّل وقت القراية) أو فاضي */
export type ExportFeedback = {
  id: string; type: string; text: string; createdAt: string;
  appVersion: string; buildNumber: string; fullVersion: string; platform: string; deviceModel: string; osVersion: string;
};

const s = (x: string | undefined | null) => x ?? '';
const n = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? x : '');
const DEFAULT_PERCENTS = { needs: 50, wants: 30, future: 20 };

export function buildFullExportSheets(d: FullExportInput): ExportSheet[] {
  const walletName = (id?: string) => d.wallets.find(w => w.id === id)?.name ?? '';
  const categoryName = (id?: string) => d.categories.find(c => c.id === id)?.name ?? '';
  const byDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date));
  const byKey = <V>(rec: Record<string, V> | undefined) => Object.entries(rec || {}).sort(([a], [b]) => a.localeCompare(b));

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
      SubscriptionId: s(t.subscriptionId), GamiyaId: s(t.gamiyaId), IncomeId: s(t.incomeId), PeriodKey: s(t.periodKey),
      Settlement: !!t.isSettlement, ArchivedWalletId: s(t.archivedWalletId), AutoRecorded: !!t.autoRecorded,
    })) },
    { name: 'Debts', rows: d.debts.map(x => ({
      Id: x.id, Direction: x.direction, Person: x.personName, Phone: s(x.personPhone), ContactId: s(x.personContactId),
      TotalAmount: x.totalAmount, Date: x.date, IsInstallment: x.isInstallment,
      InstallmentCount: n(x.installmentCount), InstallmentAmount: n(x.installmentAmount),
      // الباقي اللي بيحدد آخر قسط (بند 8) — من غيره القسط الأخير في الملف مبيتحسبش صح
      ResidueAmount: n(x.installmentResidue?.amount), ResidueForInstallment: n(x.installmentResidue?.forInstallment),
      ResidueOver: n(x.installmentResidue?.over), ResidueIncreasesTotal: n(x.installmentResidue?.increasesTotal),
      ResidueLastAbsorbs: !!x.installmentResidue?.lastAbsorbs,
      DueDate: s(x.dueDate), ReminderDaysBefore: n(x.reminderDaysBefore), Note: s(x.note), CreatedAt: x.createdAt,
      InitialWalletId: s(x.initialWalletId), InitialTransactionId: s(x.initialTransactionId),
    })) },
    { name: 'DebtPayments', rows: d.debts.flatMap(x => byDate(x.payments || []).map(p => ({
      DebtId: x.id, Person: x.personName, Id: p.id, Date: p.date, Amount: p.amount,
      WalletId: p.walletId, Wallet: walletName(p.walletId), CategoryId: s(p.categoryId), Category: categoryName(p.categoryId),
      TransactionId: s(p.transactionId),
    }))) },
    { name: 'DebtIncreases', rows: d.debts.flatMap(x => byDate(x.increases || []).map(p => ({
      DebtId: x.id, Person: x.personName, Id: p.id, Date: p.date, Amount: p.amount,
      WalletId: s(p.walletId), Wallet: walletName(p.walletId), TransactionId: s(p.transactionId),
    }))) },
    { name: 'Subscriptions', rows: d.subscriptions.map(x => ({
      Id: x.id, Name: x.name, Amount: x.amount, WalletId: x.walletId, Wallet: walletName(x.walletId),
      CategoryId: s(x.categoryId), Category: categoryName(x.categoryId), Frequency: x.frequency, CustomDays: n(x.customDays),
      NextDueDate: x.nextDueDate, ReminderDaysBefore: x.reminderDaysBefore, Active: x.active !== false,
      ChargeMode: s(x.chargeMode) || 'confirm', ChargeAutoSince: s(x.chargeAutoSince), CreatedAt: x.createdAt,
    })) },
    { name: 'SubscriptionPayments', rows: d.subscriptions.flatMap(x => byDate(x.history || []).map(p => ({
      SubscriptionId: x.id, Subscription: x.name, Id: p.id, Date: p.date, Amount: p.amount,
      PeriodKey: s(p.periodKey), TransactionId: s(p.transactionId), Auto: !!p.auto,
    }))) },
    // الفترات المقفولة (اتخصمت / اتفوّتت / رجعت تسأل) — من غيرها "ما اتخصمش" ميبانش في أي مكان في الملف
    { name: 'SubscriptionPeriods', rows: d.subscriptions.flatMap(x => byKey(x.closed).map(([key, c]) => {
      const cl = c as { txId?: string; skipped?: boolean; reopened?: boolean; auto?: boolean; at?: string };
      return { SubscriptionId: x.id, Subscription: x.name, PeriodKey: key, TransactionId: s(cl.txId), Skipped: !!cl.skipped,
        Reopened: !!cl.reopened, Auto: !!cl.auto, At: s(cl.at) };
    })) },
    { name: 'Gamiyas', rows: d.gamiyas.map(x => ({
      Id: x.id, Name: x.name, MonthlyAmount: x.monthlyAmount, TotalMonths: x.totalMonths, PayoutMonthIndex: x.payoutMonthIndex,
      PayoutAmount: x.payoutAmount, WalletId: x.walletId, Wallet: walletName(x.walletId), StartDate: x.startDate,
      ReminderDaysBefore: x.reminderDaysBefore, ChargeMode: s(x.chargeMode) || 'confirm', ChargeAutoSince: s(x.chargeAutoSince),
      CreatedAt: x.createdAt,
    })) },
    { name: 'GamiyaMonths', rows: d.gamiyas.flatMap(x => [...(x.months || [])].sort((a, b) => a.monthIndex - b.monthIndex).map(m => ({
      GamiyaId: x.id, Gamiya: x.name, Id: m.id, MonthIndex: m.monthIndex, DueDate: m.dueDate, Amount: m.amount,
      IsPayoutMonth: m.isPayoutMonth, Status: m.status, TransactionId: s(m.transactionId), Auto: !!m.auto, Reopened: !!m.reopened,
    }))) },
    { name: 'FixedIncomes', rows: d.incomes.map(x => ({
      Id: x.id, Name: x.name, Amount: x.amount, WalletId: x.walletId, Wallet: walletName(x.walletId), Frequency: x.frequency,
      DayOfMonth: n(x.dayOfMonth), Weekday: n(x.weekday), Mode: x.mode, Status: x.status, StartDate: x.startDate, CreatedAt: x.createdAt,
    })) },
    // "نزل" / "ما نزلش" لكل فترة — أهم حاجة كانت ناقصة (silent-failure-hunter)
    { name: 'IncomePeriods', rows: d.incomes.flatMap(x => byKey(x.closed).map(([key, c]) => ({
      IncomeId: x.id, Income: x.name, PeriodKey: key, TransactionId: s(c.txId), Skipped: !!c.skipped, At: s(c.at),
    }))) },
    { name: 'Budgets', rows: Object.entries(d.budgets).map(([categoryId, limit]) => ({
      CategoryId: categoryId, Category: categoryName(categoryId), MonthlyLimit: limit,
    })) },
    { name: 'Shakhbata', rows: byKey(d.shakhbataIncome).map(([month, income]) => ({ Month: month, MonthlyIncome: income })) },
    { name: 'ShakhbataPercents', rows: [d.shakhbataPercents
      ? { Needs: d.shakhbataPercents.needs, Wants: d.shakhbataPercents.wants, Future: d.shakhbataPercents.future, IsDefault: false }
      : { Needs: DEFAULT_PERCENTS.needs, Wants: DEFAULT_PERCENTS.wants, Future: DEFAULT_PERCENTS.future, IsDefault: true }] },
    // النوع خام (`bug`/`idea`/`praise`) زي باقي القيم. الجهاز والإصدار جوّه لأنهم اتبعتوا مع الرأي (متخزّنين)
    { name: 'Feedback', rows: [...d.feedback].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(f => ({
      Id: f.id, SentAt: f.createdAt, Type: f.type, Text: f.text, FullVersion: f.fullVersion, AppVersion: f.appVersion,
      BuildNumber: f.buildNumber, Platform: f.platform, DeviceModel: f.deviceModel, OsVersion: f.osVersion,
    })) },
  ];
}

/**
 * أسامي الأوراق والأعمدة بالعربي (قرار مؤمن 2026-11-03 + بحث rnd-researcher): المستخدم بيفتح الملف بعينه، وGDPR م20 مبيشترطش
 * لغة. **المعرّفات والقيم الخام (`expense`، `monthly`، `w1`…) بتفضل زي ما هي** — هي مفتاح الربط بين الأوراق (machine-readable).
 * مفاتيح الصفوف جوّه الكود بتفضل إنجليزي (الاختبارات والجرد عليها)، والترجمة وقت كتابة الملف بس (`localizeSheets`).
 * أسامي الأوراق ≤ 31 حرف ومن غير `/ \ ? * : [ ]` (حدود Excel) — اختبار بيتأكد.
 */
export const SHEET_NAMES_AR: Record<string, string> = {
  Wallets: 'المحافظ', Categories: 'الفئات', Transactions: 'العمليات', Debts: 'الديون', DebtPayments: 'دفعات الديون',
  DebtIncreases: 'زيادات الديون', Subscriptions: 'الاشتراكات', SubscriptionPayments: 'دفعات الاشتراكات',
  SubscriptionPeriods: 'فترات الاشتراكات', Gamiyas: 'الجمعيات', GamiyaMonths: 'شهور الجمعيات', FixedIncomes: 'الدخل الثابت',
  IncomePeriods: 'فترات الدخل الثابت', Budgets: 'الميزانية', Shakhbata: 'شخبطة', ShakhbataPercents: 'نسب شخبطة',
  Feedback: 'رأيك اللي بعتّه',
};

export const COLUMN_NAMES_AR: Record<string, string> = {
  Id: 'المعرّف', Name: 'الاسم', Amount: 'المبلغ', Date: 'التاريخ', CreatedAt: 'اتعمل في', Type: 'النوع', Note: 'ملاحظة',
  Wallet: 'المحفظة', WalletId: 'معرّف المحفظة', ToWallet: 'إلى محفظة', ToWalletId: 'معرّف المحفظة المستلمة',
  Category: 'الفئة', CategoryId: 'معرّف الفئة', Icon: 'الأيقونة', Bucket: 'خانة شخبطة',
  OpeningBalance: 'الرصيد الافتتاحي', LowAlert: 'حد التنبيه', Archived: 'مؤرشفة', ArchivedAt: 'اتأرشفت في',
  SubscriptionId: 'معرّف الاشتراك', Subscription: 'الاشتراك', GamiyaId: 'معرّف الجمعية', Gamiya: 'الجمعية',
  IncomeId: 'معرّف الدخل الثابت', Income: 'الدخل الثابت', MonthlyIncome: 'الدخل الشهري', PeriodKey: 'الفترة', Settlement: 'عملية تسوية', ArchivedWalletId: 'معرّف المحفظة المؤرشفة',
  AutoRecorded: 'اتسجلت لوحدها', Direction: 'اتجاه الدين', Person: 'الشخص', Phone: 'رقم التليفون', ContactId: 'معرّف جهة الاتصال',
  TotalAmount: 'المبلغ الكلي', IsInstallment: 'بالقسط', InstallmentCount: 'عدد الأقساط', InstallmentAmount: 'قيمة القسط',
  ResidueAmount: 'فرق القسط الأخير', ResidueForInstallment: 'الفرق متحسب على قسط بقيمة', ResidueOver: 'عدد الأقساط الكاملة',
  ResidueIncreasesTotal: 'مجموع الزيادات وقت حساب الفرق', ResidueLastAbsorbs: 'الفرق متضاف على آخر قسط', DueDate: 'المعاد',
  ReminderDaysBefore: 'التذكير قبل المعاد (أيام)', InitialWalletId: 'معرّف محفظة البداية', InitialTransactionId: 'معرّف عملية البداية',
  DebtId: 'معرّف الدين', TransactionId: 'معرّف العملية', Frequency: 'التكرار', CustomDays: 'كل كام يوم',
  NextDueDate: 'المعاد الجاي', Active: 'شغال', ChargeMode: 'طريقة الخصم', ChargeAutoSince: 'التلقائي من تاريخ',
  Auto: 'اتسجلت لوحدها', Skipped: 'اتفوّتت', Reopened: 'رجعت تسأل', At: 'اتقفلت في', MonthlyAmount: 'القسط الشهري',
  TotalMonths: 'عدد الشهور', PayoutMonthIndex: 'رقم شهر الاستلام', PayoutAmount: 'مبلغ الاستلام', StartDate: 'تاريخ البداية',
  MonthIndex: 'رقم الشهر', IsPayoutMonth: 'شهر استلام', Status: 'الحالة', DayOfMonth: 'يوم الشهر', Weekday: 'يوم الأسبوع',
  Mode: 'طريقة التسجيل', MonthlyLimit: 'الحد الشهري', Month: 'الشهر', Needs: 'احتياجات', Wants: 'رفاهيات', Future: 'خطط مستقبلية',
  IsDefault: 'الافتراضي',
  SentAt: 'اتبعت في', Text: 'النص', FullVersion: 'الإصدار', AppVersion: 'إصدار التطبيق', BuildNumber: 'رقم البناء',
  Platform: 'النظام', DeviceModel: 'نوع الموبايل', OsVersion: 'إصدار النظام',
};

/** نفس الأوراق والقيم، بالأسامي العربي (عمود من غير ترجمة بيفضل باسمه — الاختبار بيمنع ده) */
export function localizeSheets(sheets: ExportSheet[]): ExportSheet[] {
  return sheets.map(sh => ({
    name: SHEET_NAMES_AR[sh.name] ?? sh.name,
    rows: sh.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [COLUMN_NAMES_AR[k] ?? k, v]))),
  }));
}
