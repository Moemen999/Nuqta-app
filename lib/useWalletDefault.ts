import { useCallback, useRef, useState } from 'react';

/**
 * المحفظة المختارة في فورم، مع قاعدة واحدة: **البيانات المتأخرة عمرها ما تغيّر
 * اللي المستخدم شافه** (ب4، 2026-11-13).
 *
 * - لحد ما حاجة تتثبّت، `walletId` = الافتراضي الحالي (`lib/defaultWallet.ts`)
 *   وبيتبعه لو اتغيّر (المحافظ والعمليات بتوصل من السيرفر بعد فتح الفورم).
 * - `pickWallet(id)` بيختار ويثبّت.
 * - `freeze()` بيثبّت اللي ظاهر دلوقتي — **كل خانة إدخال في الفورم لازم تناديه**
 *   (مبلغ، اسم، تاريخ، فئة، نوع...)، عشان الافتراضي مايتقلبش بعد ما المستخدم
 *   بدأ يشتغل وبعدين يحفظ على محفظة غير اللي كان شايفها. بيثبّت حتى لو مفيش
 *   محفظة ظاهرة: مفيش اختيار اتشاف، فمفيش اختيار بيظهر من ورا ضهره.
 * - `reopen()` بيفك التثبيت ويرجع للافتراضي — للمودالات اللي متركّبة طول الوقت
 *   (إضافة اشتراك/جمعية) كل ما تتفتح، وبعد الحفظ/الإلغاء.
 * - `enabled=false` (فورم التعديل): الافتراضي مالوش أي أثر، والقيمة = `ownId`
 *   (محفظة السجل نفسه) لحد ما `pickWallet` يغيّرها.
 */
export function useWalletDefault(defaultId: string | undefined, enabled = true, ownId?: string) {
  const [frozen, setFrozen] = useState<{ id: string | undefined } | null>(null);
  const walletId = frozen ? frozen.id : enabled ? defaultId : ownId;
  // آخر قيمة اترسمت فعلاً — اللي المستخدم شافه وقت الإدخال
  const shown = useRef(walletId);
  shown.current = walletId;

  const pickWallet = useCallback((id: string) => setFrozen({ id }), []);
  const freeze = useCallback(() => setFrozen(f => f ?? { id: shown.current }), []);
  const reopen = useCallback(() => setFrozen(null), []);

  return { walletId, pickWallet, freeze, reopen };
}
