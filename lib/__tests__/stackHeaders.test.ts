import fs from 'fs';
import path from 'path';

/**
 * مفيش شاشة بيطلع فوقها هيدر النظام (اسم المسار بالإنجليزي وسهم إنجليزي). "مسح الحساب" كان ناسية سطرها في الـStack
 * واتلقى بالعين على الجهاز 2026-11-06. الجذر بقى `screenOptions={{ headerShown: false }}`، والجرد ده بيتأكد إنه فاضل
 * **وإن كل شاشة في `settings-screens` ليها سطر** (عشان أي شاشة جديدة متتنسيش لو حد شال الافتراضي).
 */
const ROOT = path.join(__dirname, '..', '..');
const layout = fs.readFileSync(path.join(ROOT, 'app', '_layout.tsx'), 'utf8');

it('الـStack الجذر من غير هيدر افتراضيًا', () => {
  expect(layout).toMatch(/<Stack screenOptions={{ headerShown: false }}>/);
});

it('كل شاشة في settings-screens ليها Stack.Screen', () => {
  const screens = fs.readdirSync(path.join(ROOT, 'app', 'settings-screens')).filter(f => f.endsWith('.tsx')).map(f => f.replace('.tsx', ''));
  const missing = screens.filter(n => !layout.includes(`name="settings-screens/${n}"`));
  expect(missing).toEqual([]);
});
