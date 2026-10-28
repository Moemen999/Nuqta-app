import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';
import {
  MAX_TIMER_MS, bannerKey, hiddenUntil, nextReturnAt, parseDismissals, parseIntervals, pruneExpired,
  type BannerType, type Dismissals,
} from '@/lib/bannerDismiss';

/**
 * مخزن واحد لقفل البانرات (\`lib/bannerDismiss.ts\` فيه القواعد). واحد مش في كل
 * كومبوننت: البانرات في الرئيسية وفي الـlayout الجذري (\`DataLoadErrorBanner\`) وفي
 * سطر "مستنيين ردك"، والـ✕ في واحد لازم يبان في الكل، والإعداد من شاشة تانية.
 *
 * **المؤقّت:** واحد بس، على أقرب بانر هيرجع — لما ييجي بيبلّغ اللي بيسمعوا فالبانر
 * بيظهر من غير ما المستخدم يعمل حاجة.
 * **التخزين وقع:** القفل بيفضل في الذاكرة ومفيش رمي — الأسوأ إنه يرجع بعد إعادة
 * التشغيل، والبانر اللي بيظهر أأمن من اللي بيختفي.
 */

export const DISMISS_KEY = 'nuqta-banner-dismissals';
export const INTERVALS_KEY = 'nuqta-banner-intervals';

type State = { dismissals: Dismissals; intervals: Record<string, string>; now: number; loaded: boolean };

let state: State = { dismissals: {}, intervals: {}, now: Date.now(), loaded: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;
// قراية قديمة بتخلص بعد إعادة الضبط متكتبش فوق الحالة الجديدة
let generation = 0;

function emit(next: Partial<State>) {
  state = { ...state, ...next, now: Date.now() };
  schedule();
  listeners.forEach(l => l());
}

function schedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  const at = nextReturnAt(state.dismissals, state.intervals, Date.now());
  if (at === null) return;
  timer = setTimeout(() => {
    timer = null;
    // الرجوع: الوقت بيتحدّث والمنتهي بيتشال، فالبانر بيظهر لوحده
    emit({ dismissals: pruneExpired(state.dismissals, state.intervals, Date.now()) });
  }, Math.min(Math.max(at - Date.now(), 0), MAX_TIMER_MS));
}

function load() {
  if (!loading) {
    const g = generation;
    loading = Promise.all([AsyncStorage.getItem(DISMISS_KEY), AsyncStorage.getItem(INTERVALS_KEY)])
      .then(([d, i]) => {
        if (g !== generation) return;
        const intervals = parseIntervals(i);
        // اللي اتقفل أو اتغيّر قبل ما القراية تخلص بيكسب على المتخزّن
        const merged = { ...parseDismissals(d), ...state.dismissals };
        const mergedIntervals = { ...intervals, ...state.intervals };
        emit({ dismissals: pruneExpired(merged, mergedIntervals, Date.now()), intervals: mergedIntervals, loaded: true });
      })
      .catch(() => { if (g === generation) emit({ loaded: true }); });
  }
  return loading;
}

function save(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => { /* شوف فوق: بيفضل في الذاكرة */ });
}

function subscribe(l: () => void) {
  listeners.add(l);
  void load();
  return () => { listeners.delete(l); };
}

/**
 * الحفظ بعد ما المتخزّن يتقري (react-reviewer): ✕ أو مدة اتغيّرت قبل القراية كانت
 * بتكتب الجديد لوحده فوق القديم. القراية بتدمج القديم تحت الجديد، وبعدها بنحفظ الكل
 */
function saveAfterLoad(key: string, pick: () => unknown) {
  void load().then(() => save(key, pick()));
}

export function dismissBanner(type: BannerType, instance?: string) {
  emit({ dismissals: { ...state.dismissals, [bannerKey(type, instance)]: Date.now() } });
  saveAfterLoad(DISMISS_KEY, () => state.dismissals);
}

export function setBannerInterval(type: BannerType, id: string) {
  const intervals = { ...state.intervals, [type]: id };
  emit({ intervals, dismissals: pruneExpired(state.dismissals, intervals, Date.now()) });
  saveAfterLoad(INTERVALS_KEY, () => state.intervals);
}

/**
 * \`hidden(type, instance)\` — مقفول دلوقتي؟ **قبل ما التخزين يتقري: لأ** (البانر يظهر).
 * لمحة بانر اتقفل قبل كده أهون من تحذير يختفي لو القراية علّقت.
 */
export function useBannerDismiss() {
  const s = useSyncExternalStore(subscribe, () => state);
  const hidden = useCallback(
    (type: BannerType, instance?: string) => hiddenUntil(s.dismissals, bannerKey(type, instance), s.intervals, Date.now()) !== null,
    [s],
  );
  return { hidden, dismiss: dismissBanner, intervals: s.intervals, setInterval: setBannerInterval, loaded: s.loaded };
}

/** للاختبارات بس */
export function resetBannerDismissForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  loading = null;
  generation++;
  state = { dismissals: {}, intervals: {}, now: Date.now(), loaded: false };
  listeners.clear();
}
