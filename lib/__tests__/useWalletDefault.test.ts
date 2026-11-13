import { act, renderHook } from '@testing-library/react-native';
import { useWalletDefault } from '@/lib/useWalletDefault';

type P = { def: string | undefined; enabled?: boolean; own?: string };
const setup = (init: P) => renderHook((p: P) => useWalletDefault(p.def, p.enabled ?? true, p.own), { initialProps: init });

describe('useWalletDefault', () => {
  it('بيبدأ على الافتراضي', async () => {
    const { result } = await setup({ def: 'A' });
    expect(result.current.walletId).toBe('A');
  });

  it('الافتراضي اتغيّر قبل أي إدخال ← بيتبعه (بيانات وصلت متأخر)', async () => {
    const { result, rerender } = await setup({ def: undefined });
    expect(result.current.walletId).toBeUndefined();
    await rerender({ def: 'A' });
    expect(result.current.walletId).toBe('A');
    await rerender({ def: 'B' });
    expect(result.current.walletId).toBe('B');
  });

  it('بعد freeze (كتابة) ← فاضل على اللي المستخدم شافه حتى لو الافتراضي اتغيّر', async () => {
    const { result, rerender } = await setup({ def: 'A' });
    await act(async () => { result.current.freeze(); });
    await rerender({ def: 'B' });
    expect(result.current.walletId).toBe('A');
  });

  it('freeze قبل ما أي محفظة توصل ← مفيش محفظة بتتختار من وراه (المستخدم ما شافش اختيار)', async () => {
    const { result, rerender } = await setup({ def: undefined });
    await act(async () => { result.current.freeze(); });
    await rerender({ def: 'A' });
    expect(result.current.walletId).toBeUndefined();
  });

  it('freeze مرتين مش بيغيّر اللي اتثبّت', async () => {
    const { result, rerender } = await setup({ def: 'A' });
    await act(async () => { result.current.freeze(); });
    await rerender({ def: 'B' });
    await act(async () => { result.current.freeze(); });
    expect(result.current.walletId).toBe('A');
  });

  it('المستخدم اختار A وبعدين الافتراضي اتغيّر ← A', async () => {
    const { result, rerender } = await setup({ def: 'B' });
    await act(async () => { result.current.pickWallet('A'); });
    expect(result.current.walletId).toBe('A');
    await rerender({ def: 'C' });
    expect(result.current.walletId).toBe('A');
  });

  it('reopen ← بيفك التثبيت ويرجع للافتراضي الحالي', async () => {
    const { result, rerender } = await setup({ def: 'A' });
    await act(async () => { result.current.pickWallet('X'); });
    await rerender({ def: 'B' });
    expect(result.current.walletId).toBe('X');
    await act(async () => { result.current.reopen(); });
    expect(result.current.walletId).toBe('B');
    await rerender({ def: 'C' });
    expect(result.current.walletId).toBe('C');
  });

  it('معطّل (تعديل): بيرجّع محفظة السجل مش الافتراضي، ومبيتبعش الافتراضي', async () => {
    const { result, rerender } = await setup({ def: 'A', enabled: false, own: 'Z' });
    expect(result.current.walletId).toBe('Z');
    await rerender({ def: 'B', enabled: false, own: 'Z' });
    expect(result.current.walletId).toBe('Z');
  });

  it('معطّل: pickWallet بيغيّر القيمة زي أي اختيار', async () => {
    const { result } = await setup({ def: 'A', enabled: false, own: 'Z' });
    await act(async () => { result.current.pickWallet('Y'); });
    expect(result.current.walletId).toBe('Y');
  });
});
