import { useData, type ChargeKind } from '@/context/DataContext';
import { useNotifications } from '@/context/NotificationsContext';
import { usePrivacy } from '@/context/PrivacyContext';
import {
  chargeDateLabel, chargeRecordedMessage, chargeRecordedNotification, chargeRecordedPart, gamiyaOpenCharges,
  subscriptionOpenCharges, type OpenCharge,
} from '@/lib/autoCharge';
import { todayStr } from '@/lib/finance';
import { notifyNow } from '@/lib/notifications';
import { INCOME_RETRY_MS, type IncomeNotice } from '@/lib/useIncomeAutoRecord';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type DueItem = { kind: ChargeKind; id: string; name: string; charges: OpenCharge[]; labelOf: (key: string) => string };

/**
 * الاشتراكات والجمعيات "التلقائي" بتتسجل **أول ما التطبيق يتفتح بعد
 * المعاد** — نفس `useIncomeAutoRecord` بالظبط (نفس البصمة، ونفس الإعادة بعد
 * دقيقة، ونفس الأخطاء اللي بتتقال مرة في اليوم). الفرق: كل اللي اتسجل في
 * المرة دي بيتقال في **رسالة واحدة** وإشعار واحد، مهما كان عدد الفترات
 * والاشتراكات (اللي غاب 3 شهور مايلاقيش 6 رسايل).
 *
 * الحماية من الخصم مرتين مش هنا — في `recordCharges` (ذري). الـref هنا توفير بس.
 */
export function useChargeAutoRecord() {
  const { subscriptions, gamiyas, serverReachable, recordCharges } = useData();
  const { enabled: notificationsOn } = useNotifications();
  const { hidePreference: amountsHidden, loaded: privacyLoaded } = usePrivacy();
  const [notices, setNotices] = useState<IncomeNotice[]>([]);
  const [wake, setWake] = useState(0);
  const [recheck, setRecheck] = useState(0);
  const running = useRef(false);
  const shownErrors = useRef(new Set<string>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastAttempt = useRef('');
  const missedRerun = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') setWake(w => w + 1); });
    return () => { sub.remove(); clearTimeout(retryTimer.current); };
  }, []);

  const wasReachable = useRef(serverReachable);
  useEffect(() => {
    if (serverReachable && !wasReachable.current) setWake(w => w + 1);
    wasReachable.current = serverReachable;
  }, [serverReachable]);

  useEffect(() => {
    if (!serverReachable || !privacyLoaded) return;
    if (running.current) { missedRerun.current = true; return; }
    const today = todayStr();
    const due: DueItem[] = [
      ...subscriptions.map(s => ({
        kind: 'subscription' as const, id: s.id, name: s.name,
        charges: subscriptionOpenCharges(s, today).filter(c => c.autoOk),
        labelOf: (key: string) => chargeDateLabel(key, today),
      })),
      ...gamiyas.map(g => ({
        kind: 'gamiya' as const, id: g.id, name: g.name,
        charges: gamiyaOpenCharges(g, today).filter(c => c.autoOk),
        labelOf: (key: string) => `شهر ${g.months.find(m => m.id === key)?.monthIndex ?? ''}`,
      })),
    ].filter(d => d.charges.length > 0);
    if (due.length === 0) return;
    const signature = `${wake}|${due.map(d => `${d.kind}:${d.id}:${d.charges.map(c => c.key).join(',')}`).join(';')}`;
    if (signature === lastAttempt.current) return;
    lastAttempt.current = signature;

    running.current = true;
    clearTimeout(retryTimer.current);
    (async () => {
      const found: IncomeNotice[] = [];
      const parts: string[] = [];
      const recordedIds: string[] = [];
      let total = 0;
      let retry = false;
      try {
        for (const d of due) {
          const r = await recordCharges(d.kind, d.id, d.charges.map(c => ({ key: c.key, amount: c.amount })), { auto: true });
          if (r.outcome === 'no-connection') { retry = true; continue; }
          if (r.outcome === 'done' && r.recorded.length > 0) {
            parts.push(chargeRecordedPart(d.kind, d.name, r.recorded.map(d.labelOf)));
            recordedIds.push(`${d.id}:${r.recorded.join(',')}`);
            total += d.charges.filter(c => r.recorded.includes(c.key)).reduce((s, c) => s + c.amount, 0);
          } else if (r.outcome === 'wallet-missing' || r.outcome === 'failed') {
            const id = `err:${d.id}:${r.outcome}:${today}`;
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            const what = d.kind === 'subscription' ? `اشتراك "${d.name}"` : `قسط جمعية "${d.name}"`;
            found.push({
              id, kind: 'error',
              text: r.outcome === 'wallet-missing'
                ? `ما سجلناش ${what}: المحفظة بتاعته اتأرشفت أو اتمسحت، ومفيش أي خصم اتسجل. عدّله واختار محفظة شغالة.`
                : `ما سجلناش ${what} دلوقتي، ومفيش أي خصم اتسجل. هنجرب تاني أول ما ترجع للتطبيق.`,
            });
          }
        }
      } finally {
        if (parts.length > 0) {
          const text = chargeRecordedMessage(parts);
          found.unshift({ id: `rec:${recordedIds.join(';')}`, kind: 'recorded', text });
          if (notificationsOn) {
            notifyNow('اتسجل لوحده', chargeRecordedNotification(text, total, amountsHidden)).catch(() => {});
          }
        }
        running.current = false;
        if (missedRerun.current) { missedRerun.current = false; setRecheck(r => r + 1); }
        if (found.length) setNotices(prev => [...prev.filter(p => !found.some(f => f.id === p.id)), ...found]);
        if (retry) retryTimer.current = setTimeout(() => setWake(w => w + 1), INCOME_RETRY_MS);
      }
    })();
  }, [subscriptions, gamiyas, serverReachable, privacyLoaded, wake, recheck, recordCharges, notificationsOn, amountsHidden]);

  const dismiss = useCallback((id: string) => {
    setNotices(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notices, dismiss };
}
