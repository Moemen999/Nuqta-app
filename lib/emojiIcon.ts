import { CATEGORY_ICONS, CATEGORY_ICON_MAX } from '@/lib/finance';

/**
 * أيقونة الفئة من كيبورد الموبايل: أول إيموجي بس، والمركّب واحد.
 *
 * **مفيش `Intl.Segmenter` ولا `\p{…}` عن قصد.** Hermes في RN 0.81 مش مضمون
 * فيه الاتنين، والاختبارات شغالة على Node اللي فيه الاتنين — يعني الاختبار
 * كان هينجح والتطبيق يقع على الموبايل. فالتقسيم مكتوب بالـcode points
 * ومقصور على اللي بيركّب الإيموجي: علامة الشكل، لون البشرة، ZWJ، علامات
 * العلم، علامة المربع، وزوج حروف العلم.
 */

const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

/** حاجات بتلزق في اللي قبلها ومبتبدأش إيموجي لوحدها */
function isExtender(cp: number) {
  return cp === 0xfe0f || cp === 0xfe0e              // علامة الشكل
    || (cp >= 0x1f3fb && cp <= 0x1f3ff)                // لون البشرة
    || cp === 0x20e3                                   // المربع (1️⃣)
    || (cp >= 0xe0020 && cp <= 0xe007f)                // علامات علم إنجلترا/اسكتلندا
    || (cp >= 0x0300 && cp <= 0x036f);                 // تشكيل لاتيني
}

export function firstGrapheme(s: string): string {
  if (!s) return '';
  let i = 0;
  const peek = () => (i < s.length ? s.codePointAt(i)! : -1);
  const next = () => { const cp = s.codePointAt(i)!; i += cp > 0xffff ? 2 : 1; return cp; };

  const first = next();
  if (isRegionalIndicator(first)) {
    if (isRegionalIndicator(peek())) next();
    return s.slice(0, i);
  }
  while (i < s.length) {
    const p = peek();
    if (isExtender(p)) { next(); continue; }
    // ZWJ بيربط اللي بعده: 👨 + ZWJ + 👩 = حاجة واحدة
    if (p === 0x200d) { next(); if (i < s.length) next(); continue; }
    break;
  }
  return s.slice(0, i);
}

/**
 * أول code point في إيموجي. الحروف والأرقام (عربي وإنجليزي) برّه كل
 * النطاقات دي، فبتترفض من غير ما نحتاج نعرف هي حرف إيه.
 */
function startsEmoji(cp: number) {
  return (cp >= 0x1f000 && cp <= 0x1faff)   // أغلب الإيموجي
    || (cp >= 0x2600 && cp <= 0x27bf)        // ☕ ⚡ ✈ ❤
    || (cp >= 0x2300 && cp <= 0x23ff)        // ⌚ ⏰
    || (cp >= 0x2b00 && cp <= 0x2bff)        // ⭐ ⬛
    || (cp >= 0x2190 && cp <= 0x21ff)        // ↔
    || (cp >= 0x2900 && cp <= 0x297f)        // ⤴
    || (cp >= 0x25a0 && cp <= 0x25ff)        // ▶ ◻
    || [0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0x3030, 0x303d, 0x3297, 0x3299].includes(cp);
}

export type EmojiInputResult =
  | { ok: true; icon: string; trimmed: boolean }
  | { ok: false; reason: 'empty' | 'not-emoji' | 'too-long' };

export const EMOJI_INPUT_MESSAGES: Record<'not-emoji' | 'too-long', string> = {
  'not-emoji': 'ده مش إيموجي. الحروف والأرقام مش بتنفع أيقونة — اختار إيموجي من الكيبورد.',
  'too-long': 'الإيموجي ده طويل زيادة. جرّب واحد تاني.',
};
export const EMOJI_INPUT_TRIMMED = 'خدنا أول إيموجي بس.';

export function emojiIconFromInput(raw: string): EmojiInputResult {
  const s = raw.trim();
  if (!s) return { ok: false, reason: 'empty' };
  const g = firstGrapheme(s);
  if (!startsEmoji(g.codePointAt(0)!)) return { ok: false, reason: 'not-emoji' };
  // نفس مقياس القواعد (`size()` = وحدات UTF-16 = `.length`) — اتقاس على المحاكي
  if (g.length > CATEGORY_ICON_MAX) return { ok: false, reason: 'too-long' };
  return { ok: true, icon: g, trimmed: s.slice(g.length).trim().length > 0 };
}

type IconHolder = { name: string; icon?: string; archived?: boolean };

/**
 * الأيقونة مستخدمة في فئة تانية شغالة؟ **ملاحظة مش منع**: اتنين بنفس
 * الأيقونة مش غلط، بس غالبًا المستخدم مش واخد باله. `others` = الفئات
 * التانية من غير الفئة اللي بتتعدّل.
 */
export function iconDuplicate(others: IconHolder[], icon: string | undefined) {
  if (!icon) return null;
  const active = others.filter(c => !c.archived);
  const owner = active.find(c => c.icon === icon);
  if (!owner) return null;
  const used = new Set(active.map(c => c.icon).filter(Boolean));
  const suggestion = CATEGORY_ICONS.find(ic => ic !== icon && !used.has(ic)) ?? null;
  return { usedBy: owner.name, suggestion };
}

export function iconDuplicateNote(d: { usedBy: string }) {
  return `الأيقونة دي مستخدمة في ${d.usedBy}`;
}
