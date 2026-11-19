import { LOAD_ERROR_RETRY, listenerNamesPhrase, type ListenerName } from '@/lib/listenerErrors';

/**
 * الرقم البطل وشرايح المحافظ في الرئيسية (مراجعة التطبيق كله، الميزة 7 — HIGH، المشكّك أكّدها).
 *
 * الرصيد بيتحسب من المحافظ **والعمليات** (`walletBalance`). قبل كده:
 * - العمليات لسه ما وصلتش ← الرصيد الافتتاحي كان بيتعرض على إنه الرصيد دلوقتي (والكاش البارد كان اتشال لأن المحافظ وصلت).
 * - listener العمليات أو المحافظ وقع ← رقم غلط (أو 0 ومفيش شرايح) من غير أي علامة متتقفلش جنبه — البانر اللي فوق بـ✕.
 *
 * دلوقتي الحالة بتتقرر هنا، والرئيسية بتعرض: قديم (الكاش) / ناقص (اتقال إيه اللي ما وصلش مكان الرقم) / بنحمّل / الرقم.
 * **الديون والاشتراكات مش جوه الرصيد** (العمليات المربوطة بيهم عمليات عادية)، فوقوعهم مبيلمسش الرقم البطل.
 */
export const HERO_FIGURE_SOURCES: ListenerName[] = ['wallets', 'transactions'];

export type HeroFigures =
  | { kind: 'cold' }
  | { kind: 'failed'; missing: ListenerName[] }
  | { kind: 'loading' }
  | { kind: 'waiting' }
  | { kind: 'live' };

/**
 * الترتيب (الجولة الأخيرة): **الفشل أول** (M1 — الكاش كان بيغطي listener واقع بـ«(قديم)» و«مفيش نت» والسبب مش النت)،
 * بعده الكاش (آخر أرقام معروفة أحسن من فاضي)، بعده لسه بتوصل: من غير نت بعد مهلة التحميل (`waitingNet`) ← «مستنيين النت»
 * (H1-A — كان بيبان «إجمالي رصيدك 0» بعد ✕ بانر «مفيش نت»)، وإلا «بنحمّل…».
 */
export function heroFigures(i: {
  cold: boolean; loadErrors: ListenerName[]; figuresPending: ListenerName[] | undefined; waitingNet?: boolean;
}): HeroFigures {
  const missing = HERO_FIGURE_SOURCES.filter(n => (i.loadErrors ?? []).includes(n));
  if (missing.length > 0) return { kind: 'failed', missing };
  if (i.cold) return { kind: 'cold' };
  if (HERO_FIGURE_SOURCES.some(n => (i.figuresPending ?? []).includes(n))) return i.waitingNet ? { kind: 'waiting' } : { kind: 'loading' };
  return { kind: 'live' };
}

export const HERO_LABEL = 'إجمالي رصيدك';
export const HERO_LOADING_TEXT = 'بنحمّل…';
/** مكان الرقم: العمليات ما وصلتش من السيرفر ومفيش نت ومفيش كاش — متتقفلش (مش بانر) */
export const HERO_WAITING_TEXT = 'مستنيين النت عشان نجيب رصيدك';

/**
 * العلامة جنب «إجمالي رصيدك» **متتقفلش** (البانرات تحت ممكن تتقفل أو تتمرر، وقارئ الشاشة بيقرا الرقم قبلها).
 * «ممكن يكون قديم» = النت قطع بعد ما الأرقام وصلت (`useStaleFigures`) — البانر بتاعه بـ✕ بقرار 2026-11، والعلامة دي لأ.
 */
export function heroLabel(state: HeroFigures, stale: boolean): string {
  if (state.kind === 'cold') return `${HERO_LABEL} (قديم)`;
  if (state.kind === 'failed') return `${HERO_LABEL} (ناقص)`;
  if (state.kind === 'live' && stale) return `${HERO_LABEL} (ممكن يكون قديم)`;
  return HERO_LABEL;
}

/** مكان الرقم لما المحافظ أو العمليات ما وصلتش */
export function heroFailedText(missing: ListenerName[]): string {
  return `مقدرناش نجيب ${listenerNamesPhrase(missing)}`;
}

/** واحد من الاتنين وقع أو لسه بيوصل ← أي تنبيه مبني على الأرصدة أو العمليات مش مضمون */
export function figuresUnsure(loadErrors: ListenerName[] | undefined, figuresPending: ListenerName[] | undefined): boolean {
  return HERO_FIGURE_SOURCES.some(n => (loadErrors ?? []).includes(n) || (figuresPending ?? []).includes(n));
}

/** «الأرقام اتحدّثت» بس لما الاتنين من السيرفر، ووصلوا، ومفيش منهم واقع */
export function figuresSettled(i: { figuresFromServer: boolean; loadErrors: ListenerName[] | undefined; figuresPending: ListenerName[] | undefined }): boolean {
  return i.figuresFromServer && !figuresUnsure(i.loadErrors, i.figuresPending);
}

/**
 * عمليات في الطابور المتشفّر على الموبايل ولسه ما اترفعتش (`outboxCount`) — بعد فتحة باردة من غير نت مش بتبان في
 * «آخر العمليات» (الإعادة بتستنى السيرفر)، فالسطر ده هو اللي بيقول إنها موجودة. صفر ← مفيش سطر.
 * `online` (M4، الجولة الأخيرة): النت شغال والإعادة وقفت (فشلت أو خلصت محاولاتها) — مفيش ولا كلمة عن النت، والإعادة
 * بتتعاد مع رجوع الاتصال أو الفتحة الجاية.
 */
export function outboxLinePhrase(n: number, opts: { online?: boolean } = {}): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const base = n === 1 ? 'عندك عملية متسجلة على الموبايل ولسه ما اترفعتش'
    : n === 2 ? 'عندك عمليتين متسجلين على الموبايل ولسه ما اترفعوش'
    : `عندك ${n} ${n <= 10 ? 'عمليات' : 'عملية'} متسجلة على الموبايل ولسه ما اترفعتش`;
  if (!opts.online) return base;
  return `${base} — ${n === 1 ? 'هنجرب نرفعها تاني' : 'هنجرب نرفعهم تاني'}`;
}

export const RECENT_EMPTY_TEXT = {
  failed: `عملياتك ما وصلتش من السيرفر — مش ضايعة. دوس "${LOAD_ERROR_RETRY}" فوق.`,
  offline: 'مستنيين النت عشان نجيب عملياتك',
  none: 'لسه ما سجلتش أي عملية',
} as const;

/**
 * «آخر العمليات» فاضية: قبل مهلة التحميل أو والعمليات لسه بتوصل ← ولا كلمة (كانت «لسه معملتش أي عملية» بتلمع في
 * أول كل فتحة)؛ العمليات وقعت ← ما وصلتش (مش «لسه ما سجلتش» — دي كانت بتتقري «عملياتي راحت»).
 */
export function recentEmptyText(i: { loadWindowPassed: boolean; txFailed: boolean; offlineEmpty: boolean; txPending: boolean }): string | null {
  if (!i.loadWindowPassed) return null;
  if (i.txFailed) return RECENT_EMPTY_TEXT.failed;
  if (i.offlineEmpty) return RECENT_EMPTY_TEXT.offline;
  if (i.txPending) return null;
  return RECENT_EMPTY_TEXT.none;
}
