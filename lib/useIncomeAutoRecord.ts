import AsyncStorage from '@react-native-async-storage/async-storage';
import { useData } from '@/context/DataContext';
import { useNotifications } from '@/context/NotificationsContext';
import { usePrivacy } from '@/context/PrivacyContext';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { todayStr } from '@/lib/finance';
import { notifyNow } from '@/lib/notifications';
import {
  incomeOpenPeriods, incomePeriodLabel, incomeRecordedMessage, incomeRecordedNotification,
} from '@/lib/recurringIncome';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** لو التسجيل رجع no-connection والنت لسه "شغال" (انتظار الكتابات خلص وقته) */
export const INCOME_RETRY_MS = 60_000;

export type IncomeNotice = { id: string; kind: 'recorded' | 'error'; text: string };

/**
 * `uncertain` بيعيد بعد دقيقة — بس **بسقف** لنفس الفترات في الجلسة (الدخل والخصم التلقائي، `useChargeAutoRecord`).
 * بعدها الرسالة بتفضل والإعادة بتقف لحد ما التطبيق يرجع من الخلفية أو يتفتح من جديد.
 */
export const AUTO_UNCERTAIN_RETRY_MAX = 5;
/**
 * إشعار "مش متأكدين" مرة في اليوم لنفس الدخل/الاشتراك/الجمعية **حتى بعد فتحة باردة** — على الجهاز بس، والمحتوى معرّفات
 * مستندات من غير أي مبلغ ولا اسم. (المفتاح اسمه "charge" من أيام الخصم بس، ومتسابش عشان اللي اتخزّن ميضيعش.)
 */
const UNCERTAIN_NOTIFIED_KEY = 'nuqta-charge-uncertain-notified';

/** `true` = أول مرة النهاردة (ابعت الإشعار). التخزين فشل ← `true`: إشعار زيادة أهون من إشعار ضايع */
export async function claimUncertainNotification(noticeId: string, day: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(UNCERTAIN_NOTIFIED_KEY);
    const parsed = raw ? JSON.parse(raw) as { day?: unknown; ids?: unknown } : null;
    const ids = parsed && parsed.day === day && Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.includes(noticeId)) return false;
    await AsyncStorage.setItem(UNCERTAIN_NOTIFIED_KEY, JSON.stringify({ day, ids: [...ids, noticeId] }));
    return true;
  } catch (e) {
    console.warn('[auto] uncertain notify dedupe storage failed', (e as { name?: string })?.name ?? 'unknown');
    return true;
  }
}

/** المبلغ المتخزّن على الدخل التلقائي مش مقروء — اسم نوع بس للـSentry (`atomicFailureCode`)، من غير المبلغ */
class IncomeBadAmountError extends Error { name = 'IncomeBadAmountError'; }

/** رسالة الرئيسية لما التلقائي مقدرش يسجل عشان المبلغ المتخزّن بايظ */
export const incomeBadAmountMessage = (name: string) =>
  `ما سجلناش "${name}": المبلغ المتسجّل ليه مش مقروء، ومفيش حاجة اتسجلت. عدّل الدخل من التخطيط ← دخل ثابت.`;

/** الإشعار ما اتبعتش — اسم الخطأ بس، من غير مبلغ ولا اسم (sentryScrub) */
const warnNotifyFailed = (e: unknown) => console.warn('[income] notify failed', (e as { name?: string })?.name ?? 'unknown');

/**
 * الدخل التلقائي بيتسجل **أول ما التطبيق يتفتح بعد معاده** — ومع كل رجوع من
 * الخلفية، عشان اللي سايب التطبيق مفتوح من امبارح يتسجله النهاردة.
 *
 * التسجيل نفسه ذري (`recordIncomePeriods`)، فتشغيل الهوك ده مرتين في نفس
 * اللحظة مبيسجلش مرتين — الـref هنا لتوفير النداء بس، مش هو الحماية.
 *
 * من غير نت: ساكت ومبيقولش حاجة، وبيتنادى تاني لوحده أول ما `serverReachable`
 * يرجع — أو بعد دقيقة لو النت كان شغال بس انتظار الكتابات خلص وقته. الفشل
 * التاني بيتقال في كارت على الرئيسية: "ما اتسجلش ومفيش حاجة
 * اتكتبت" — مش إشعار، لأنه محتاج المستخدم يعمل حاجة.
 */
export function useIncomeAutoRecord() {
  const { incomes, serverReachable, recordIncomePeriods } = useData();
  const { enabled: notificationsOn } = useNotifications();
  // الإشعار بيتبع التفضيل مش النطاق (بيظهر على شاشة القفل)
  const { hidePreference: amountsHidden, loaded: privacyLoaded } = usePrivacy();
  const [notices, setNotices] = useState<IncomeNotice[]>([]);
  const [wake, setWake] = useState(0);
  /** إعادة تقييم من غير ما البصمة تتغيّر — بعد محاولة فاتها تغيير وهي شغالة */
  const [recheck, setRecheck] = useState(0);
  const running = useRef(false);
  /**
   * نفس الخطأ مبيتكررش مع كل رجوع من الخلفية — بس المفتاح فيه اليوم، فلو
   * المستخدم قفل الرسالة ومصلّحش حاجة بترجع تاني بكرة بدل ما تختفي للأبد.
   */
  const shownErrors = useRef(new Set<string>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * آخر محاولة اتعملت على إيه. `incomes` و`recordIncomePeriods` بيتغيّروا
   * كمراجع مع **كل** رسمة لـ DataContext (أي snapshot في أي حتة)، فمن غير
   * البصمة دي خطأ ثابت (محفظة مؤرشفة) كان هيعمل runTransaction على السيرفر مع
   * كل snapshot. المحاولة بتتعاد بس لما: الفترات المستحقة تتغيّر، أو التطبيق
   * يرجع من الخلفية، أو النت يرجع، أو مؤقت الإعادة يخلص.
   */
  const lastAttempt = useRef('');
  /** اتغيّر حاجة واحنا في نص محاولة — العلم ref مش state، فنزوله مبيصحّيش الهوك لوحده */
  const missedRerun = useRef(false);
  /** محاولات `uncertain` لنفس الفترات في الجلسة (السقف `AUTO_UNCERTAIN_RETRY_MAX`) */
  const uncertainTries = useRef(new Map<string, number>());
  /** رسايل "مش متأكدين" المفتوحة ← الفترات اللي بتستناها تتحسم */
  const uncertainOpen = useRef(new Map<string, { id: string; keys: string[] }>());
  /**
   * محاولات اللي رمى (باگ) لنفس الدخل في الجلسة — نفس السقف — وSentry مرة واحدة للدخل في الجلسة (الجولة الأخيرة 2026-11-18:
   * كانت إعادة كل دقيقة من غير سقف وحدث Sentry مع كل واحدة)
   */
  const throwTries = useRef(new Map<string, number>());
  const throwReported = useRef(new Set<string>());
  /** المبلغ المتخزّن بايظ ← Sentry مرة واحدة للدخل في الجلسة (الرسالة نفسها مرة في اليوم بـ`shownErrors`) */
  const badAmountReported = useRef(new Set<string>());
  /** الإعادة دي جاية من مؤقت الدقيقة (مش رجوع من الخلفية ولا رجوع النت) ← اللي وصل السقف بيتفوّت */
  const timerWake = useRef(false);
  /** آخر `incomes` — الحسم بعد ما المحاولة تخلص بيقرا منه (الـsnapshot اللي بيقفل ممكن يكون وصل وهي شغالة) */
  const incomesRef = useRef(incomes);
  incomesRef.current = incomes;

  /**
   * "مش متأكدين" بتمشي لما كل الفترات تتقفل (الإعادة نجحت، أو اتسجلت/"ما نزلش" من الكارت أو جهاز تاني). الجولة الأخيرة
   * (2026-11-18): لو فيه فترات اتقفلت على عملية، الرسالة بتتبدّل بـ"سجلنا" — مش بتختفي ساكتة والمستخدم مش عارف اتسجل ولا لأ.
   */
  const resolveUncertain = useCallback((list: typeof incomes) => {
    if (uncertainOpen.current.size === 0) return;
    const today = todayStr();
    const done: string[] = [];
    const recordedNotices: IncomeNotice[] = [];
    uncertainOpen.current.forEach((u, nid) => {
      const inc = list.find(i => i.id === u.id);
      if (!inc || !u.keys.every(k => { const c = inc.closed?.[k]; return !!c && (!!c.txId || !!c.skipped); })) return;
      done.push(nid);
      const withTx = u.keys.filter(k => !!inc.closed?.[k]?.txId);
      if (withTx.length > 0) {
        recordedNotices.push({
          id: `rec:${inc.id}:${withTx.join(',')}`, kind: 'recorded',
          text: incomeRecordedMessage(inc.name, withTx.map(k => incomePeriodLabel(inc, k, today))),
        });
      }
    });
    if (done.length === 0) return;
    done.forEach(nid => uncertainOpen.current.delete(nid));
    setNotices(prev => [
      ...prev.filter(n => !done.includes(n.id) && !recordedNotices.some(r => r.id === n.id)),
      ...recordedNotices,
    ]);
  }, []);

  useEffect(() => { resolveUncertain(incomes); }, [incomes, resolveUncertain]);

  useEffect(() => {
    // حركة من المستخدم ← مش إعادة المؤقت (اللي وصل السقف بيتجرّب تاني مرة)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { timerWake.current = false; setWake(w => w + 1); } });
    return () => { sub.remove(); clearTimeout(retryTimer.current); };
  }, []);

  // النت **رجع** (من false لـ true) ← محاولة جديدة حتى لو الفترات هي هي.
  // مش أول رسمة: دي هتبقى أول محاولة عادية، والتنبيه هنا كان هيعيدها مرتين
  const wasReachable = useRef(serverReachable);
  useEffect(() => {
    if (serverReachable && !wasReachable.current) { timerWake.current = false; setWake(w => w + 1); }
    wasReachable.current = serverReachable;
  }, [serverReachable]);

  useEffect(() => {
    // مستنيين تفضيل الإخفاء: من غيره أول إشعار كان ممكن يطلع بالرقم
    if (!serverReachable || !privacyLoaded) return;
    if (running.current) { missedRerun.current = true; return; }
    const today = todayStr();
    const due = incomes
      .filter(i => i.mode === 'auto')
      .map(inc => ({ inc, keys: incomeOpenPeriods(inc, today) }))
      .filter(x => x.keys.length > 0);
    if (due.length === 0) return;
    const signature = `${wake}|${due.map(d => `${d.inc.id}:${d.keys.join(',')}`).join(';')}`;
    if (signature === lastAttempt.current) return;
    lastAttempt.current = signature;

    running.current = true;
    clearTimeout(retryTimer.current);
    const fromTimer = timerWake.current;
    timerWake.current = false;
    (async () => {
      const found: IncomeNotice[] = [];
      let retry = false;
      // finally: لو أي حاجة جوه رمت، العلم كان هيفضل true والتسجيل التلقائي
      // يقف للأبد في الجلسة من غير ولا كلمة
      try {
        for (const { inc, keys } of due) {
          const triesKey = `${inc.id}:${keys.join(',')}`;
          // الجولة الأخيرة (2026-11-18): الإعادة كل دقيقة واحدة للكل — فدخل وصل السقف كان بيتعاد عشان دخل تاني عايز إعادة.
          // من المؤقت بيتفوّت؛ رجوع من الخلفية أو رجوع النت (حركة) بيجرّبه تاني مرة
          if (fromTimer && ((uncertainTries.current.get(triesKey) ?? 0) >= AUTO_UNCERTAIN_RETRY_MAX
            || (throwTries.current.get(inc.id) ?? 0) >= AUTO_UNCERTAIN_RETRY_MAX)) continue;
          let r: Awaited<ReturnType<typeof recordIncomePeriods>>;
          try {
            r = await recordIncomePeriods(inc.id, keys.map(key => ({ key, amount: inc.amount })), { auto: true });
          } catch (e) {
            // `recordIncomePeriods` بيرجّع نتيجة دايمًا؛ ده لو رمى غصب عنه (باگ) — مبيتبلعش: Sentry مرة للدخل في الجلسة،
            // وإعادة بعد دقيقة بنفس السقف. ودخل رمى مبيوقّفش الباقي
            console.warn('[income] auto record threw', (e as { name?: string })?.name ?? 'unknown');
            if (!throwReported.current.has(inc.id)) { throwReported.current.add(inc.id); reportAtomicFailure('الدخل التلقائي', e); }
            const tries = (throwTries.current.get(inc.id) ?? 0) + 1;
            throwTries.current.set(inc.id, tries);
            if (tries < AUTO_UNCERTAIN_RETRY_MAX) retry = true;
            continue;
          }
          // no-connection والنت "شغال": يعني انتظار الكتابات خلص وقته — مفيش
          // تغيير هيصحّي الهوك، فبنجرب تاني بعد دقيقة بدل ما نستنى الخلفية
          if (r.outcome === 'no-connection') { retry = true; continue; }
          // اتمسح (من جهاز تاني) — مفيش حاجة تتسجل ولا تتقال
          if (r.outcome === 'missing') continue;
          if (r.outcome === 'uncertain') {
            // الذرة فشلت وسؤال السيرفر كمان (مراجعة الدخل 2026-11-18): ممنوع "ومفيش حاجة اتسجلت" — ممكن يكون اتسجل.
            // والإعادة بعد دقيقة آمنة: التسجيل ذري بمعرّف ثابت، فلو كان وصل مبتكتبش حاجة
            const tries = (uncertainTries.current.get(triesKey) ?? 0) + 1;
            uncertainTries.current.set(triesKey, tries);
            if (tries < AUTO_UNCERTAIN_RETRY_MAX) retry = true;
            else console.warn('[income] uncertain retry cap reached');
            const id = `uncertain:${inc.id}:${today}`;
            uncertainOpen.current.set(id, { id: inc.id, keys });
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            if (notificationsOn && await claimUncertainNotification(id, today)) {
              notifyNow(`مش متأكدين سجلنا "${inc.name}" ولا لأ`, 'النت قطع واحنا بنسجّل. افتح الأرشيف وبص قبل ما تسجّله بإيدك.', 'income')
                .catch(warnNotifyFailed);
            }
            found.push({
              id, kind: 'error',
              text: `مش متأكدين سجلنا "${inc.name}" ولا لأ — النت قطع واحنا بنسجّل. افتح الأرشيف وبص الأول، ولو مش موجود سجّله بإيدك، عشان ميتسجلش مرتين.`,
            });
            continue;
          }
          if (r.outcome === 'done' && r.recorded.length === 0 && r.badAmount) {
            // الجولة الأخيرة (2026-11-18): كان console.warn بس، والكارت مبيظهرش للتلقائي — فالدخل ميتسجلش أبدًا والمستخدم
            // مايعرفش. رسالة في الرئيسية (مرة في اليوم) + Sentry مرة للدخل في الجلسة، من غير أي رقم (sentryScrub)
            console.warn('[income] auto skipped: stored amount unreadable');
            if (!badAmountReported.current.has(inc.id)) {
              badAmountReported.current.add(inc.id);
              reportAtomicFailure('الدخل التلقائي', new IncomeBadAmountError());
            }
            const id = `err:${inc.id}:badAmount:${today}`;
            if (!shownErrors.current.has(id)) {
              shownErrors.current.add(id);
              found.push({ id, kind: 'error', text: incomeBadAmountMessage(inc.name) });
            }
            continue;
          }
          if (r.outcome === 'done' && r.recorded.length > 0) {
            const text = incomeRecordedMessage(inc.name, r.recorded.map(k => incomePeriodLabel(inc, k, today)));
            found.push({ id: `rec:${inc.id}:${r.recorded.join(',')}`, kind: 'recorded', text });
            if (notificationsOn) {
              // الجولة الأخيرة: المبلغ من اللي اتكتب فعلاً (`recordedTotal`)، مش `inc.amount` المحلي × العدد.
              // مش موجود ← الإشعار من غير رقم بدل رقم متخمّن
              const total = r.recordedTotal;
              notifyNow(`"${inc.name}" اتسجل لوحده`, incomeRecordedNotification(text, total ?? 0, amountsHidden || total === undefined), 'income')
                .catch(warnNotifyFailed);
            }
          } else if (r.outcome === 'wallet-missing' || r.outcome === 'failed') {
            const id = `err:${inc.id}:${r.outcome}:${today}`;
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            found.push({
              id, kind: 'error',
              text: r.outcome === 'wallet-missing'
                ? `ما سجلناش "${inc.name}": المحفظة بتاعته اتأرشفت أو اتمسحت، ومفيش حاجة اتسجلت. اختارله محفظة تانية من التخطيط ← دخل ثابت.`
                : `ما سجلناش "${inc.name}" دلوقتي، ومفيش حاجة اتسجلت. هنجرب تاني أول ما ترجع للتطبيق.`,
            });
          }
        }
      } catch (e) {
        // اللي برّه النداء نفسه رمى (الإشعار، التخزين…) — باگ؛ مبيتبلعش، ومن غير إعادة (السقف فوق للنداء)
        console.warn('[income] auto record loop threw', (e as { name?: string })?.name ?? 'unknown');
        reportAtomicFailure('الدخل التلقائي', e);
      } finally {
        running.current = false;
        if (missedRerun.current) { missedRerun.current = false; setRecheck(r => r + 1); }
        // جوه finally: لو حاجة رمت في النص، اللي اتلم قبلها والإعادة مايضيعوش
        if (found.length) setNotices(prev => [...prev.filter(p => !found.some(f => f.id === p.id)), ...found]);
        // الجولة الأخيرة: الـsnapshot اللي بيقفل الفترات ممكن يكون وصل والمحاولة شغالة (قبل ما "مش متأكدين" تتسجل) —
        // من غير الحسم هنا الرسالة كانت هتعلّق لحد snapshot جديد
        resolveUncertain(incomesRef.current);
        if (retry) retryTimer.current = setTimeout(() => { timerWake.current = true; setWake(w => w + 1); }, INCOME_RETRY_MS);
      }
    })();
  }, [incomes, serverReachable, privacyLoaded, wake, recheck, recordIncomePeriods, notificationsOn, amountsHidden, resolveUncertain]);

  const dismiss = useCallback((id: string) => {
    setNotices(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notices, dismiss };
}
