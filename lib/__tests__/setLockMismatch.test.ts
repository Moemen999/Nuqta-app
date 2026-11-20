import fs from 'fs';
import path from 'path';
import { codesMismatch, CODES_MISMATCH } from '@/components/SetLockModal';

// ملاحظة مؤمن على 1.0.0.036: مفيش رسالة لما الرقمين مش زي بعض
describe('SetLockModal — الكودين مش زي بعض', () => {
  it('بيبان أول ما التأكيد يوصل لطول الأول ويختلف', () => {
    expect(codesMismatch('1234', '12')).toBe(false);
    expect(codesMismatch('1234', '1235')).toBe(true);
    expect(codesMismatch('1234', '1234')).toBe(false);
    expect(codesMismatch('', '1')).toBe(false);
    expect(codesMismatch('abcd', 'abcde')).toBe(true);
  });

  it('رسالة الخطأ برّه الـScrollView (كانت بتقع تحت الكيبورد)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/SetLockModal.tsx'), 'utf8');
    expect(src.indexOf('testID="setlock_error"')).toBeGreaterThan(src.indexOf('</ScrollView>'));
    expect(src).toContain('setError(CODES_MISMATCH)');
    expect(CODES_MISMATCH).toMatch(/مش زي بعض/);
  });
});
