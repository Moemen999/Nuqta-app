/**
 * المحفظة اللي الفورم بيبدأ بيها (ب4، 2026-11-13).
 *
 * قرار مؤمن: سداد الدين وزيادته بيبدأوا على **محفظة الدين نفسه**، وأي فورم
 * إضافة تاني بيبدأ على **آخر محفظة المستخدم استخدمها**. التعديل بيفضل على
 * محفظة السجل نفسه (مش هنا).
 *
 * دوال صافية، من غير تخزين: "آخر محفظة" بتتحسب من العمليات اللي في الذاكرة.
 * والقاعدة اللي فوق كل حاجة: **مفيش محفظة مؤرشفة بتتقترح كبداية أبدًا** — الأرشفة
 * معناها إنها اختفت من الاختيارات، والبداية عليها كانت هتلغي المعنى ده وتسجّل فلوس
 * في محفظة محدش شايفها. ولو مفيش محفظة شغّالة النتيجة `undefined` والفورم بيتصرف
 * زي ما كان بيتصرف من غير محفظة (بيرفض الحفظ برسالة).
 *
 * الأنواع هنا بنيوية عن قصد (مش من `DataContext`) عشان الملف يفضل خفيف وصافي.
 */

type WalletLike = { id: string; archived?: boolean };

type TxLike = {
  id: string;
  type: 'expense' | 'income' | 'withdraw';
  walletId: string;
  toWalletId?: string;
  createdAt?: string;
  autoRecorded?: boolean;
  isSettlement?: boolean;
  incomeId?: string;
  subscriptionId?: string;
  gamiyaId?: string;
};

type DebtLike = {
  initialWalletId?: string;
  payments?: ReadonlyArray<{ date: string; walletId?: string }>;
  increases?: ReadonlyArray<{ date: string; walletId?: string }>;
};

/** سماح لساعة جهاز متقدمة: عملية createdAt بتاعتها بعد "دلوقتي" بأكتر من يوم بتتجاهل */
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** ids المحافظ الشغّالة بترتيب القايمة */
export function activeWalletIds(wallets: ReadonlyArray<WalletLike>): string[] {
  return wallets.filter(w => !w.archived).map(w => w.id);
}

/** وقت الإنشاء كرقم، أو null لو مش نص تاريخ حقيقي (أو في المستقبل البعيد لو اتدّى `nowMs`) */
function stampOf(t: TxLike, nowMs?: number): number | null {
  if (typeof t.createdAt !== 'string') return null;
  const ms = Date.parse(t.createdAt);
  if (!Number.isFinite(ms)) return null;
  if (nowMs !== undefined && ms > nowMs + FUTURE_SKEW_MS) return null;
  return ms;
}

/**
 * اختيار محفظة اتعمل في فورم بس بيتحسب "آخر استخدام": مش التلقائي ولا التسوية، ولا أي عملية
 * محفظتها جاية من إعداد متخزّن (دخل ثابت/اشتراك/جمعية — `incomeId`/`subscriptionId`/`gamiyaId`)
 * حتى لو المستخدم هو اللي أكّدها. سداد وزيادة وإنشاء الدين والعمليات العادية بتتحسب.
 */
function isUserTx(t: TxLike) {
  return !t.autoRecorded && !t.isSettlement && !t.incomeId && !t.subscriptionId && !t.gamiyaId;
}

/** أحدث عنصر بالـcreatedAt، والتعادل بالأكبر معرّفًا (ثابت مهما كان ترتيب المصفوفة) */
function newest(rows: ReadonlyArray<TxLike>, nowMs?: number): TxLike | undefined {
  let best: TxLike | undefined;
  let bestMs = -Infinity;
  for (const t of rows) {
    const ms = stampOf(t, nowMs);
    if (ms === null) continue;
    if (ms > bestMs || (ms === bestMs && best !== undefined && t.id > best.id)) { best = t; bestMs = ms; }
  }
  return best;
}

/**
 * آخر محفظة المستخدم سجّل عليها بنفسه: أحدث `createdAt` بين المصروف والإيراد
 * اليدوي (مش السحب، ومش اللي اتسجل لوحده، ومش التسوية) على محفظة شغّالة.
 * مفيش → `undefined`.
 */
export function lastUsedWalletId(
  transactions: ReadonlyArray<TxLike>,
  activeIds: ReadonlyArray<string>,
  nowMs?: number,
): string | undefined {
  const active = new Set(activeIds);
  return newest(
    transactions.filter(t => t.type !== 'withdraw' && isUserTx(t) && active.has(t.walletId)),
    nowMs,
  )?.walletId;
}

/**
 * محفظة "إلى" في التحويل: وجهة آخر تحويل المستخدم لو شغّالة و≠ "من"، وإلا أول
 * محفظة شغّالة ≠ "من". **عمرها ما تساوي "من"** — ولو مفيش غير محفظة واحدة `undefined`.
 */
export function lastTransferToWalletId(
  transactions: ReadonlyArray<TxLike>,
  activeIds: ReadonlyArray<string>,
  fromId: string | undefined,
  nowMs?: number,
): string | undefined {
  const active = new Set(activeIds);
  const last = newest(transactions.filter(t => t.type === 'withdraw' && isUserTx(t)), nowMs);
  const to = last?.toWalletId;
  if (to !== undefined && active.has(to) && to !== fromId) return to;
  return activeIds.find(id => id !== fromId);
}

/**
 * محفظة الدين نفسه: `initialWalletId` لو شغّالة، وإلا محفظة أحدث دفعة/زيادة
 * عليها محفظة شغّالة (بالتاريخ، والتعادل بالأحدث ترتيبًا — الدفعات قبل الزيادات).
 * مفيش (شرا بالأجل من غير حركات، أو كل المحافظ مؤرشفة) → `undefined`.
 */
export function debtOwnWalletId(debt: DebtLike, activeIds: ReadonlyArray<string>): string | undefined {
  const active = new Set(activeIds);
  if (debt.initialWalletId !== undefined && active.has(debt.initialWalletId)) return debt.initialWalletId;
  const entries = [...(debt.payments ?? []), ...(debt.increases ?? [])];
  let best: string | undefined;
  let bestDate = '';
  for (const e of entries) {
    // من غير تاريخ صالح مفيش ترتيب نعتمد عليه — المقارنة بـundefined كانت بتخلّيه يكسب للأبد
    if (typeof e.date !== 'string' || e.date === '') continue;
    if (e.walletId === undefined || !active.has(e.walletId)) continue;
    // `>=` عشان التعادل ياخد الأحدث ترتيبًا
    if (best === undefined || e.date >= bestDate) { best = e.walletId; bestDate = e.date; }
  }
  return best;
}

/**
 * البداية النهائية للفورم. الترتيب: محفظة الدين (لو فيه دين) ← آخر محفظة اتستخدمت ←
 * أول محفظة شغّالة بترتيب القايمة ← `undefined`. مفيش مؤرشفة في أي خطوة.
 */
export function defaultWalletId(opts: {
  wallets: ReadonlyArray<WalletLike>;
  transactions: ReadonlyArray<TxLike>;
  debt?: DebtLike;
  nowMs?: number;
}): string | undefined {
  const ids = activeWalletIds(opts.wallets);
  if (ids.length === 0) return undefined;
  if (opts.debt) {
    const own = debtOwnWalletId(opts.debt, ids);
    if (own !== undefined) return own;
  }
  return lastUsedWalletId(opts.transactions, ids, opts.nowMs) ?? ids[0];
}
