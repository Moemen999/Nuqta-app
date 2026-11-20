import { useData, type ChargeKind } from '@/context/DataContext';
import { useNotifications } from '@/context/NotificationsContext';
import { usePrivacy } from '@/context/PrivacyContext';
import {
  chargeDateLabel, chargeRecordedMessage, chargeRecordedNotification, chargeRecordedPart, gamiyaOpenCharges,
  subscriptionOpenCharges, type OpenCharge,
} from '@/lib/autoCharge';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { todayStr } from '@/lib/finance';
import { notifyNow } from '@/lib/notifications';
import { AUTO_UNCERTAIN_RETRY_MAX, INCOME_RETRY_MS, claimUncertainNotification, type IncomeNotice } from '@/lib/useIncomeAutoRecord';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type DueItem = { kind: ChargeKind; id: string; name: string; charges: OpenCharge[]; labelOf: (key: string) => string };

/**
 * الجولة 2 (silent-failure-hunter): `uncertain` بيعيد بعد دقيقة — بس **بسقف**: 5 محاولات لنفس الفترات في الجلسة. بعدها
 * الرسالة بتفضل ("افتح الأرشيف وبص") والإعادة كل دقيقة بتقف — المحاولة الجاية لما التطبيق يرجع من الخلفية أو يتفتح من
 * جديد (حركة من المستخدم). نفس السقف بتاع الدخل التلقائي (`AUTO_UNCERTAIN_RETRY_MAX`)، وإشعار "مش متأكدين" مرة في
 * اليوم بنفس الدالة (`claimUncertainNotification`).
 */
export const CHARGE_UNCERTAIN_RETRY_MAX = AUTO_UNCERTAIN_RETRY_MAX;

/** `name`/`labels`: عشان رسالة "سجلنا لوحدنا" لو الفترات اتقفلت على عمليات (الجولة الأخيرة 2026-11-18) */
type UncertainItem = { kind: ChargeKind; id: string; keys: string[]; name: string; labels: Record<string, string> };

/** كل الفترات اللي ما اتأكدناش منها اتحسمت (اتقفلت على عملية، أو اتفوّتت) ← السؤال اتجاوب */
function uncertainResolved(
  u: UncertainItem,
  subscriptions: { id: string; closed?: Record<string, { txId?: string; skipped?: boolean; reopened?: boolean }> }[],
  gamiyas: { id: string; months?: { id: string; status: string }[] }[],
): boolean {
  if (u.kind === 'subscription') {
    const s = subscriptions.find(x => x.id === u.id);
    return !!s && u.keys.every(k => { const c = s.closed?.[k]; return !!c && !c.reopened && (!!c.txId || !!c.skipped); });
  }
  const g = gamiyas.find(x => x.id === u.id);
  return !!g && u.keys.every(k => g.months?.some(m => m.id === k && m.status === 'done'));
}

/** الفترات اللي اتقفلت على **عملية** (مش اتفوّتت) — دي اللي "سجلنا" عنها لما "مش متأكدين" تتحسم */
function uncertainRecordedKeys(
  u: UncertainItem,
  subscriptions: { id: string; closed?: Record<string, { txId?: string; skipped?: boolean; reopened?: boolean }> }[],
): string[] {
  if (u.kind === 'gamiya') return u.keys;
  const s = subscriptions.find(x => x.id === u.id);
  return u.keys.filter(k => !!s?.closed?.[k]?.txId && !s.closed[k].skipped);
}

/**
 * الاشتراكات والجمعيات "التلقائي" بتتسجل **أول ما التطبيق يتفتح بعد
 * المعاد** — نفس `useIncomeAutoRecord` بالظبط (نفس البصمة، ونفس الإعادة بعد
 * دقيقة، ونفس الأخطاء اللي بتتقال مرة في اليوم). الفرق: كل اللي اتسجل في
 * المرة دي بيتقال في **رسالة واحدة** وإشعار واحد، مهما كان عدد الفترات
 * والاشتراكات (اللي غاب 3 شهور مايلاقيش 6 رسايل).
 *
 * الحماية من الخصم مرتين مش هنا — في `recordCharges` (ذري). الـref هنا توفير بس.
 */
/**
 * `paused` = التطبيق مقفول (الميزة 11، security M1): الهوك متركّب تحت القفل، والتسجيل بيطلّع إشعار بالاسم والمبلغ —
 * فبيستنى لحد ما يتفتح وبعدين بيكمّل عادي (المحاولة مبتتعلّمش إنها اتعملت)
 */
export function useChargeAutoRecord({ paused = false }: { paused?: boolean } = {}) {
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
  const uncertainTries = useRef(new Map<string, number>());
  const uncertainOpen = useRef(new Map<string, UncertainItem>());
  /** آخر بيانات — الحسم بعد ما المحاولة تخلص بيقرا منها (الـsnapshot اللي بيقفل ممكن يكون وصل وهي شغالة) */
  const latest = useRef({ subscriptions, gamiyas });
  latest.current = { subscriptions, gamiyas };

  /**
   * "مش متأكدين" بتمشي لما الفترات تتحسم (الإعادة نجحت، أو اتسجلت/اتفوّتت من الكارت أو جهاز تاني). الجولة الأخيرة
   * (2026-11-18، نفس `useIncomeAutoRecord`): اللي اتقفل على عملية بيتبدّل بـ"سجلنا لوحدنا" — مش بيختفي ساكت.
   */
  const resolveUncertain = useCallback((subs: typeof subscriptions, gams: typeof gamiyas) => {
    if (uncertainOpen.current.size === 0) return;
    const done: string[] = [];
    const parts: string[] = [];
    const ids: string[] = [];
    uncertainOpen.current.forEach((u, nid) => {
      if (!uncertainResolved(u, subs, gams)) return;
      done.push(nid);
      const keys = uncertainRecordedKeys(u, subs);
      if (keys.length > 0) {
        parts.push(chargeRecordedPart(u.kind, u.name, keys.map(k => u.labels[k] ?? k)));
        ids.push(`${u.id}:${keys.join(',')}`);
      }
    });
    if (done.length === 0) return;
    done.forEach(nid => uncertainOpen.current.delete(nid));
    const rec: IncomeNotice[] = parts.length > 0 ? [{ id: `rec:${ids.join(';')}`, kind: 'recorded', text: chargeRecordedMessage(parts) }] : [];
    setNotices(prev => [...prev.filter(n => !done.includes(n.id) && !rec.some(r => r.id === n.id)), ...rec]);
  }, []);

  useEffect(() => { resolveUncertain(subscriptions, gamiyas); }, [subscriptions, gamiyas, resolveUncertain]);

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
    if (paused || !serverReachable || !privacyLoaded) return;
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
          // اتمسح (من جهاز تاني) — مفيش حاجة تتسجل ولا تتقال
          if (r.outcome === 'missing') continue;
          const what = d.kind === 'subscription' ? `اشتراك "${d.name}"` : `قسط جمعية "${d.name}"`;
          if (r.outcome === 'uncertain') {
            // الذرة فشلت وسؤال السيرفر كمان (مراجعة 2026-11-17): ممنوع "ومفيش أي خصم اتسجل" — ممكن يكون اتسجل.
            // وبنعيد بعد دقيقة: التسجيل ذري بمعرّف ثابت، فلو كان وصل الإعادة مبتكتبش حاجة
            const keys = d.charges.map(c => c.key);
            const triesKey = `${d.kind}:${d.id}:${keys.join(',')}`;
            const tries = (uncertainTries.current.get(triesKey) ?? 0) + 1;
            uncertainTries.current.set(triesKey, tries);
            if (tries < CHARGE_UNCERTAIN_RETRY_MAX) retry = true;
            else console.warn('[charge] uncertain retry cap reached');
            const id = `uncertain:${d.id}:${today}`;
            uncertainOpen.current.set(id, { kind: d.kind, id: d.id, keys, name: d.name, labels: Object.fromEntries(keys.map(k => [k, d.labelOf(k)])) });
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            if (notificationsOn && await claimUncertainNotification(id, today)) {
              notifyNow(`مش متأكدين سجلنا ${what} ولا لأ`, 'النت قطع واحنا بنسجّل. افتح الأرشيف وبص قبل ما تسجّله بإيدك.', 'charge')
                .catch(e => console.warn('[charge] notify failed', e));
            }
            found.push({
              id, kind: 'error',
              text: `مش متأكدين سجلنا ${what} ولا لأ — النت قطع واحنا بنسجّل. افتح الأرشيف وبص الأول، ولو مش موجود سجّله بإيدك، عشان ميتخصمش مرتين.`,
            });
            continue;
          }
          // الجولة 2: التلقائي اتخطّى فترة عشان المبلغ المتخزّن بايظ — مش ساكت. اسم الخطوة بس، من غير أي رقم (sentryScrub)
          if (r.outcome === 'done' && r.recorded.length === 0 && r.badAmount) console.warn('[charge] auto skipped: stored amount unreadable');
          if (r.outcome === 'done' && r.recorded.length > 0) {
            parts.push(chargeRecordedPart(d.kind, d.name, r.recorded.map(d.labelOf)));
            recordedIds.push(`${d.id}:${r.recorded.join(',')}`);
            total += d.charges.filter(c => r.recorded.includes(c.key)).reduce((s, c) => s + c.amount, 0);
          } else if (r.outcome === 'wallet-missing' || r.outcome === 'failed') {
            const id = `err:${d.id}:${r.outcome}:${today}`;
            if (shownErrors.current.has(id)) continue;
            shownErrors.current.add(id);
            // "تلقائي" معناه إن المستخدم مش هيفتح يتأكد — فالفشل لازم يوصله زي النجاح
            // (مرة في اليوم، زي الرسالة). من غير مبلغ، فمش محتاج قناع
            if (notificationsOn) {
              notifyNow(`ما سجلناش ${what}`, 'ومفيش أي خصم اتسجل. افتح التطبيق وشوف السبب في الرئيسية.', 'charge')
                .catch(e => console.warn('[charge] notify failed', e));
            }
            found.push({
              id, kind: 'error',
              text: r.outcome === 'wallet-missing'
                ? `ما سجلناش ${what}: المحفظة بتاعته اتأرشفت أو اتمسحت، ومفيش أي خصم اتسجل. اختارله محفظة شغالة من الالتزامات ← ${d.kind === 'subscription' ? 'الاشتراكات' : 'الجمعية'}.`
                : `ما سجلناش ${what} دلوقتي، ومفيش أي خصم اتسجل. هنجرب تاني أول ما ترجع للتطبيق.`,
            });
          } else if (r.outcome === 'done') {
            // اتسجل صفر ومن غير badAmount (اتقال فوق): السبب بيتسجل باسمه بس — مش بيعدّي ساكت (الجولة 2، hardening)
            if (!r.badAmount) {
              const why = r.badInstallment ? 'bad-installment' : r.changed ? 'changed' : r.stopped ? 'stopped' : r.skipped ? 'skipped' : 'already-recorded';
              console.warn('[charge] auto recorded nothing', why);
            }
          } else {
            // نتيجة التلقائي مبيتوقعهاش (مثلاً amount-changed — التلقائي مبيبعتش أرقام شافها). اسمها بس، من غير أرقام
            console.warn('[charge] auto unhandled outcome', r.outcome);
          }
        }
      } catch (e) {
        // `recordCharges` بيرجّع نتيجة دايمًا؛ ده لو رمى غصب عنه (باگ) — مبيتبلعش: Sentry + إعادة بعد دقيقة
        console.warn('[charge] auto record threw', e);
        reportAtomicFailure('الخصم التلقائي', e);
        retry = true;
      } finally {
        if (parts.length > 0) {
          const text = chargeRecordedMessage(parts);
          found.unshift({ id: `rec:${recordedIds.join(';')}`, kind: 'recorded', text });
          if (notificationsOn) {
            notifyNow('اتسجل لوحده', chargeRecordedNotification(text, total, amountsHidden), 'charge')
              .catch(e => console.warn('[charge] notify failed', e));
          }
        }
        running.current = false;
        if (missedRerun.current) { missedRerun.current = false; setRecheck(r => r + 1); }
        if (found.length) setNotices(prev => [...prev.filter(p => !found.some(f => f.id === p.id)), ...found]);
        // الجولة الأخيرة: الـsnapshot اللي بيقفل ممكن يكون وصل قبل ما "مش متأكدين" تتسجل — من غير ده كانت هتعلّق
        resolveUncertain(latest.current.subscriptions, latest.current.gamiyas);
        if (retry) retryTimer.current = setTimeout(() => setWake(w => w + 1), INCOME_RETRY_MS);
      }
    })();
  }, [paused, subscriptions, gamiyas, serverReachable, privacyLoaded, wake, recheck, recordCharges, notificationsOn, amountsHidden, resolveUncertain]);

  const dismiss = useCallback((id: string) => {
    setNotices(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notices, dismiss };
}
