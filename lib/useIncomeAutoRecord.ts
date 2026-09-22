import { useData } from '@/context/DataContext';
import { useNotifications } from '@/context/NotificationsContext';
import { usePrivacy } from '@/context/PrivacyContext';
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
  const { amountsHidden, loaded: privacyLoaded } = usePrivacy();
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') setWake(w => w + 1); });
    return () => { sub.remove(); clearTimeout(retryTimer.current); };
  }, []);

  // النت **رجع** (من false لـ true) ← محاولة جديدة حتى لو الفترات هي هي.
  // مش أول رسمة: دي هتبقى أول محاولة عادية، والتنبيه هنا كان هيعيدها مرتين
  const wasReachable = useRef(serverReachable);
  useEffect(() => {
    if (serverReachable && !wasReachable.current) setWake(w => w + 1);
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
    (async () => {
      const found: IncomeNotice[] = [];
      let retry = false;
      // finally: لو أي حاجة جوه رمت، العلم كان هيفضل true والتسجيل التلقائي
      // يقف للأبد في الجلسة من غير ولا كلمة
      try {
        for (const { inc, keys } of due) {
          const r = await recordIncomePeriods(inc.id, keys.map(key => ({ key, amount: inc.amount })));
          // no-connection والنت "شغال": يعني انتظار الكتابات خلص وقته — مفيش
          // تغيير هيصحّي الهوك، فبنجرب تاني بعد دقيقة بدل ما نستنى الخلفية
          if (r.outcome === 'no-connection') { retry = true; continue; }
          if (r.outcome === 'done' && r.recorded.length > 0) {
            const text = incomeRecordedMessage(inc.name, r.recorded.map(k => incomePeriodLabel(inc, k, today)));
            found.push({ id: `rec:${inc.id}:${r.recorded.join(',')}`, kind: 'recorded', text });
            if (notificationsOn) {
              notifyNow(`«${inc.name}» اتسجل لوحده`, incomeRecordedNotification(text, inc.amount * r.recorded.length, amountsHidden))
                .catch(() => {});
            }
          } else if (r.outcome === 'wallet-missing' || r.outcome === 'failed') {
            const id = `err:${inc.id}:${r.outcome}:${today}`;
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            found.push({
              id, kind: 'error',
              text: r.outcome === 'wallet-missing'
                ? `ما سجلناش «${inc.name}»: المحفظة بتاعته اتأرشفت أو اتمسحت، ومفيش حاجة اتسجلت. اختارله محفظة تانية من التخطيط ← دخل ثابت.`
                : `ما سجلناش «${inc.name}» دلوقتي، ومفيش حاجة اتسجلت. هنجرب تاني أول ما ترجع للتطبيق.`,
            });
          }
        }
      } finally {
        running.current = false;
        if (missedRerun.current) { missedRerun.current = false; setRecheck(r => r + 1); }
        // جوه finally: لو حاجة رمت في النص، اللي اتلم قبلها والإعادة مايضيعوش
        if (found.length) setNotices(prev => [...prev.filter(p => !found.some(f => f.id === p.id)), ...found]);
        if (retry) retryTimer.current = setTimeout(() => setWake(w => w + 1), INCOME_RETRY_MS);
      }
    })();
  }, [incomes, serverReachable, privacyLoaded, wake, recheck, recordIncomePeriods, notificationsOn, amountsHidden]);

  const dismiss = useCallback((id: string) => {
    setNotices(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notices, dismiss };
}
