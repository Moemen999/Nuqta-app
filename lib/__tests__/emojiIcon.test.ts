import { CATEGORY_ICONS, CATEGORY_ICON_MAX } from '@/lib/finance';
import {
  EMOJI_INPUT_MESSAGES, emojiIconFromInput, firstGrapheme, iconDuplicate, iconDuplicateNote,
} from '@/lib/emojiIcon';

/**
 * "أيقونة من الكيبورد": المستخدم بيكتب أي حاجة، وإحنا بناخد **أول إيموجي**
 * بس — والإيموجي المركّب (عيلة، لون بشرة، علم) إيموجي واحد مش كذا حرف.
 *
 * مفيش `Intl.Segmenter` ولا `\p{…}` هنا عن قصد: Hermes في RN 0.81 مش
 * مضمون فيه الاتنين، والاختبارات شغالة على Node اللي فيه الاتنين — يعني
 * الاختبار كان هينجح والتطبيق يقع. التقسيم مكتوب بالـcode points.
 */

describe('firstGrapheme — الإيموجي المركّب واحد', () => {
  it.each([
    ['بسيط', '🍔'],
    ['بعلامة شكل', '✈️'],
    ['لون بشرة', '👍🏽'],
    ['عيلة (ZWJ)', '👨‍👩‍👧'],
    ['عيلة بأربعة', '👨‍👩‍👧‍👦'],
    ['بوسة بلونين', '👩🏽‍❤️‍💋‍👨🏻'],
    ['علم دولة', '🇪🇬'],
    ['علم بعلامات (إنجلترا)', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'],
    ['قلب بعلامة شكل', '❤️'],
  ])('%s', (_label, e) => {
    expect(firstGrapheme(e + '🍕abc')).toBe(e);
    expect(firstGrapheme(e)).toBe(e);
  });

  it('علمين ورا بعض = اتنين مش واحد', () => {
    expect(firstGrapheme('🇪🇬🇸🇦')).toBe('🇪🇬');
  });

  it('فاضي ← فاضي', () => {
    expect(firstGrapheme('')).toBe('');
  });
});

describe('emojiIconFromInput', () => {
  it('إيموجي واحد ← مقبول', () => {
    expect(emojiIconFromInput('👨‍👩‍👧')).toEqual({ ok: true, icon: '👨‍👩‍👧', trimmed: false });
  });

  it('كذا إيموجي ← أول واحد بس، وبنقول إننا قصّينا', () => {
    expect(emojiIconFromInput('🍔🍕🌮')).toEqual({ ok: true, icon: '🍔', trimmed: true });
  });

  it('مسافات قبل وبعد مش بتتحسب', () => {
    expect(emojiIconFromInput('  👍🏽  ')).toEqual({ ok: true, icon: '👍🏽', trimmed: false });
  });

  it.each([['حرف عربي', 'أ'], ['حرف إنجليزي', 'a'], ['رقم', '5'], ['رقم عربي', '٥'], ['رقم في مربع', '1️⃣'], ['علامة', '#']])(
    '%s ← مرفوض برسالة واضحة', (_l, s) => {
      expect(emojiIconFromInput(s)).toEqual({ ok: false, reason: 'not-emoji' });
    });

  it('حرف قبل الإيموجي ← مرفوض (أول حاجة هي اللي بتتاخد)', () => {
    expect(emojiIconFromInput('a🍔')).toEqual({ ok: false, reason: 'not-emoji' });
  });

  it('فاضي ← empty (مش خطأ، لسه ما كتبش)', () => {
    expect(emojiIconFromInput('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('كل إيموجي مقبول بيعدّي من سقف القواعد (نفس المقياس: UTF-16)', () => {
    for (const e of ['👩🏽‍❤️‍💋‍👨🏻', '👨‍👩‍👧‍👦', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', ...CATEGORY_ICONS]) {
      const r = emojiIconFromInput(e);
      expect(r.ok).toBe(true);
      expect(e.length).toBeLessThanOrEqual(CATEGORY_ICON_MAX);
    }
  });

  it('رسالة لكل سبب رفض', () => {
    expect(EMOJI_INPUT_MESSAGES['not-emoji']).toContain('الحروف والأرقام');
    expect(EMOJI_INPUT_MESSAGES['too-long']).toBeTruthy();
  });
});

describe('iconDuplicate — ملاحظة هادية مش منع', () => {
  const others = [
    { name: 'أكل', icon: '🍔' },
    { name: 'مواصلات', icon: '🚗' },
    { name: 'قديمة', icon: '🍳', archived: true },
  ];

  it('مستخدمة في فئة تانية ← اسمها واقتراح بديل مش مستخدم', () => {
    const d = iconDuplicate(others, '🍔')!;
    expect(d.usedBy).toBe('أكل');
    expect(d.suggestion).not.toBeNull();
    expect(['🍔', '🚗']).not.toContain(d.suggestion);
    expect(iconDuplicateNote(d)).toBe('الأيقونة دي مستخدمة في أكل');
  });

  it('الفئة المؤرشفة مش بتتحسب', () => {
    expect(iconDuplicate(others, '🍳')).toBeNull();
  });

  it('مش مستخدمة ← مفيش ملاحظة', () => {
    expect(iconDuplicate(others, '🎁')).toBeNull();
  });

  it('"من غير أيقونة" عمره ما بيبقى مكرر', () => {
    expect(iconDuplicate(others, undefined)).toBeNull();
    expect(iconDuplicate([{ name: 'x', icon: '' }], '')).toBeNull();
  });

  it('لو كل القايمة مستخدمة ← مفيش اقتراح بس الملاحظة لسه موجودة', () => {
    const all = CATEGORY_ICONS.map((icon, i) => ({ name: `ف${i}`, icon }));
    const d = iconDuplicate(all, CATEGORY_ICONS[0])!;
    expect(d.suggestion).toBeNull();
    expect(d.usedBy).toBe('ف0');
  });
});
