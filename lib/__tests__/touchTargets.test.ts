import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

/**
 * بند E (أهداف اللمس): أي زرار لازم يوصل 44 (`MIN_TOUCH`) طول وعرض، بمقاسه أو بـ`hitSlop`.
 * الفحص ثابت على الكود ومبيعرفش المقاس النهائي، فبيمسك الأنماط المعروفة:
 * - مقاس صريح (`height`/`width`) أقل من 44: لازم المقاس + الـhitSlop في الناحيتين يوصلوا 44.
 * - حشوة رأسية أقل من 10 أو زرار نص بس من غير ستايل: لازم `MIN_TOUCH` أو hitSlop فوق+تحت ≥ 12
 *   (سطر نص ~32 + 12 = 44).
 * الـhitSlop لازم يتقري: رقم، أو object مكتوب، أو ثابت في نفس الملف. أي حاجة تانية = وقع.
 */
const TARGET = 44;
const TOUCHABLE = /^(TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Pressable)$/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : tsxFiles(p);
    return f.endsWith('.tsx') ? [p] : [];
  });
}

type Slop = { top: number; bottom: number; left: number; right: number };

function parseSlop(text: string): Slop | null {
  const t = text.trim();
  if (/^[0-9]+$/.test(t)) { const n = Number(t); return { top: n, bottom: n, left: n, right: n }; }
  if (!t.startsWith('{')) return null;
  const get = (k: string) => Number(new RegExp(`${k}:\\s*([0-9]+)`).exec(t)?.[1] ?? 0);
  return { top: get('top'), bottom: get('bottom'), left: get('left'), right: get('right') };
}

/** أكبر قيمة للخاصية (رقم أو MIN_TOUCH)، أو null لو مش موجودة. */
function dim(css: string, props: string): number | null {
  const vals = [...css.matchAll(new RegExp(`(?:^|[^a-zA-Z])(?:${props}):\\s*(MIN_TOUCH|[0-9]+)`, 'g'))]
    .map(m => (m[1] === 'MIN_TOUCH' ? TARGET : Number(m[1])));
  return vals.length ? Math.max(...vals) : null;
}

export function offendersIn(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles: Record<string, string> = {};
  const consts: Record<string, string> = {};
  const found: string[] = [];
  const collect = (n: ts.Node) => {
    // الستايلات: أي `اسم: { ... }` جوه `StyleSheet.create`/`makeStyles` (أول تعريف يكسب).
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.initializer) && ts.isIdentifier(n.name)) {
      styles[n.name.text] ??= n.initializer.getText();
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts[n.name.text] = n.initializer.getText();
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const check = (n: ts.Node) => {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (opening && TOUCHABLE.test(opening.tagName.getText())) {
      const where = `${file}:${sf.getLineAndCharacterOfPosition(opening.getStart()).line + 1}`;
      let slop: Slop = { top: 0, bottom: 0, left: 0, right: 0 };
      let styleText = '';
      let hasStyle = false;
      for (const a of opening.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText();
        const expr = ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
        if (name === 'hitSlop') {
          const raw = expr ? (ts.isIdentifier(expr) ? consts[expr.text] ?? '' : expr.getText()) : '';
          const parsed = parseSlop(raw);
          if (!parsed) { found.push(`${where} (hitSlop مش مقروء)`); return; }
          slop = parsed;
        }
        if (name === 'style') {
          hasStyle = true;
          const t = a.initializer.getText();
          const refs = [...t.matchAll(/styles[.]([a-zA-Z0-9_]+)/g)].map(m => styles[m[1]] ?? '');
          styleText = `${refs.join(' ')} ${t}`;
        }
      }
      const h = dim(styleText, 'minHeight|height');
      const w = dim(styleText, 'minWidth|width');
      const vPad = dim(styleText, 'paddingVertical|padding');
      const extraH = slop.top + slop.bottom;
      const extraW = slop.left + slop.right;
      if (h !== null && h < TARGET && h + extraH < TARGET) found.push(`${where} (طول ${h}+${extraH})`);
      else if (w !== null && w < TARGET && w + extraW < TARGET && !/width:\s*['"]/.test(styleText)) found.push(`${where} (عرض ${w}+${extraW})`);
      else if (h === null && vPad !== null && vPad < 10 && extraH < 12) found.push(`${where} (حشوة ${vPad}+${extraH})`);
      else if (h === null && !hasStyle && ts.isJsxElement(n) && extraH < 12) {
        // زرار نص بس: كل اللي جواه Text (من غير View بيدّي طول).
        const kids = n.children.filter(c => !(ts.isJsxText(c) && c.getText().trim() === ''));
        const textOnly = kids.length > 0 && kids.every(c =>
          (ts.isJsxElement(c) && c.openingElement.tagName.getText() === 'Text') ||
          (ts.isJsxSelfClosingElement(c) && c.tagName.getText() === 'Text'));
        if (textOnly) found.push(`${where} (نص بس من غير hitSlop كفاية)`);
      }
    }
    ts.forEachChild(n, check);
  };
  check(sf);
  return found;
}

const offenders = (file: string) => offendersIn(file, readFileSync(file, 'utf8'));

it('مفيش زرار أصغر من 44 من غير MIN_TOUCH أو hitSlop كفاية', () => {
  expect([...tsxFiles('app'), ...tsxFiles('components')].flatMap(offenders)).toEqual([]);
});

describe('الفحص نفسه بيمسك اللي المفروض يمسكه', () => {
  const wrap = (jsx: string, css = '') =>
    `const SLOP = { top: 2, bottom: 2 };\nconst styles = { ${css} };\nexport const X = () => (${jsx});`;
  it.each([
    ['زرار نص بس من غير hitSlop', wrap('<TouchableOpacity onPress={f}><Text>x</Text></TouchableOpacity>')],
    ['hitSlop صغير على مقاس 32', wrap('<TouchableOpacity hitSlop={SLOP} style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { width: 32, height: 32 }')],
    ['hitSlop={0}', wrap('<TouchableOpacity hitSlop={0}><Text>x</Text></TouchableOpacity>')],
    ['عرض صغير', wrap('<TouchableOpacity style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { width: 30, minHeight: MIN_TOUCH }')],
    ['minWidth بس مش طول', wrap('<TouchableOpacity style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { minWidth: MIN_TOUCH, height: 30 }')],
    ['حشوة صغيرة', wrap('<TouchableOpacity style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { paddingVertical: 6 }')],
    ['hitSlop مش مقروء', wrap('<TouchableOpacity hitSlop={getSlop()}><Text>x</Text></TouchableOpacity>')],
  ])('%s', (_name, src) => {
    expect(offendersIn('t.tsx', src)).toHaveLength(1);
  });
  it.each([
    ['نص بـhitSlop 12+12', wrap('<TouchableOpacity hitSlop={{ top: 12, bottom: 12 }}><Text>x</Text></TouchableOpacity>')],
    ['32 + 6 + 6', wrap('<TouchableOpacity hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { width: 32, height: 32 }')],
    ['MIN_TOUCH في الناحيتين', wrap('<TouchableOpacity style={styles.b}><Text>x</Text></TouchableOpacity>', 'b: { width: MIN_TOUCH, minHeight: MIN_TOUCH }')],
    ['كارت فيه View', wrap('<TouchableOpacity onPress={f}><View><Text>x</Text></View></TouchableOpacity>')],
  ])('%s مقبول', (_name, src) => {
    expect(offendersIn('t.tsx', src)).toEqual([]);
  });
});
