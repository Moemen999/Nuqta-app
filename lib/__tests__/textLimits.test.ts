import { readFileSync } from 'fs';
import { join } from 'path';
import { NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '@/lib/textLimits';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// الحدود في الخانات لازم تفضل هي هي اللي في القواعد — لو القاعدة اتغيّرت والخانة لأ، الرفض بيطلع «الكتابة ما وصلتش» مفاجأة
it('حدود الخانات = حدود firestore.rules', () => {
  const rules = read('firestore.rules');
  expect(rules).toContain(`optText(request.resource.data, 'note', ${NOTE_MAX_LENGTH})`);
  expect(rules).toContain(`data[k].size() <= ${NAME_MAX_LENGTH}`);
});

it.each([
  'app/modal.tsx', 'app/(tabs)/debts.tsx', 'components/DebtEntryModals.tsx',
])('كل خانة ملاحظة في %s عليها NOTE_MAX_LENGTH', (file) => {
  const inputs = read(file).split('<TextInput').slice(1).map(s => s.slice(0, s.indexOf('/>')));
  const notes = inputs.filter(s => s.includes('value={note}'));
  expect(notes.length).toBeGreaterThan(0);
  for (const n of notes) expect(n).toContain('maxLength={NOTE_MAX_LENGTH}');
});
