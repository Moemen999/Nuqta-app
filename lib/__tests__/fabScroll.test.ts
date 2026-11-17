import { FAB_SCROLL_THRESHOLD, FAB_SETTLE_MS, FAB_TOP_ZONE, fabScrollStep, fabScrollStopped, nextFabVisible } from '@/lib/fabScroll';

describe('fabScroll: الزرار العايم بيختفي مع التمرير لتحت بس (قرار 2026-11-16)', () => {
  it('أول الشاشة ← ظاهر حتى لو كان مستخبي', () => {
    expect(nextFabVisible(300, 0, false)).toBe(true);
    expect(nextFabVisible(300, FAB_TOP_ZONE, false)).toBe(true);
  });

  it('bounce سالب (iOS) ← ظاهر ومرساة صفر', () => {
    expect(fabScrollStep(50, -30, false)).toEqual({ anchorY: 0, visible: true });
  });

  it('نازل أكتر من العتبة وبعيد عن الأول ← يختفي', () => {
    expect(nextFabVisible(100, 100 + FAB_SCROLL_THRESHOLD + 1, true)).toBe(false);
  });

  it('طالع أكتر من العتبة ← يرجع', () => {
    expect(nextFabVisible(300, 300 - FAB_SCROLL_THRESHOLD - 1, false)).toBe(true);
  });

  it('اهتزاز تحت العتبة ← الحالة زي ما هي في الاتجاهين', () => {
    expect(nextFabVisible(100, 100 + FAB_SCROLL_THRESHOLD, true)).toBe(true);
    expect(nextFabVisible(100, 100 - FAB_SCROLL_THRESHOLD, false)).toBe(false);
  });

  it('تمرير بطيء (أقل من العتبة في كل حدث) برضه يختفي، والرجوع من القمة', () => {
    let s = { anchorY: 100, visible: true };
    for (let y = 102; y <= 140; y += 2) s = fabScrollStep(s.anchorY, y, s.visible);
    expect(s.visible).toBe(false);
    expect(s.anchorY).toBe(140);
    for (let y = 138; y >= 128; y -= 2) s = fabScrollStep(s.anchorY, y, s.visible);
    expect(s.visible).toBe(true);
  });

  it('قيمة مش رقم ← ظاهر (مبنخفيش على بيانات بايظة)', () => {
    expect(nextFabVisible(100, NaN, false)).toBe(true);
  });

  it('التمرير وقف ← ظاهر، والمرساة زي ما هي', () => {
    expect(fabScrollStopped(140)).toEqual({ anchorY: 140, visible: true });
  });

  it('مهلة الرجوع بعد رفع الصباع قصيرة (~100ms)', () => {
    expect(FAB_SETTLE_MS).toBe(100);
  });
});
