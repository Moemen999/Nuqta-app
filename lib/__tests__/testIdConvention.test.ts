import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * الـtestIDs هي العمود الفقري لأي اختبارات E2E جاية (الأداة المختارة
 * Maestro بتلاقي العناصر بـ`id:` اللي بيتطابق مع `testID` بتاع React
 * Native كـ`resource-id` في شجرة الوصول).
 *
 * الاختبار ده مش بيتأكد إن الشاشة شغالة — بيتأكد إن **الاتفاق متحفظ عليه**:
 * الأسماء بصيغة واحدة، والأدوات الأساسية ليها IDs ومحدش شالها.
 *
 * الاتفاق: `<شاشة>_<عنصر>` أو `<شاشة>_<عنصر>_<معرّف>`، حروف صغيرة
 * إنجليزية وشرطة سفلية بس. إنجليزي مش عربي عن قصد — الـtestID بيروح
 * `resource-id` في أندرويد، والعربي هناك بيتلخبط مع اتجاه النص في أدوات
 * الفحص. النص العربي مكانه التأكيدات (`assertVisible`) مش المعرّفات.
 */


/**
 * كل الملفات تحت الفولدرات دي، بـ Node مش بـ `grep`: `execSync` على ويندوز
 * بيشغّل cmd.exe، ومفيهوش `grep` ولا `|` لـ `sed` — فالاختبار كان بيقع
 * على اللاب بس وينجح في الكلاود.
 */
function walk(dirs: string[], ext?: RegExp): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (!ext || ext.test(e.name)) out.push(p);
    }
  };
  dirs.forEach(visit);
  return out;
}

const SOURCES = () => walk(['app', 'components']).map(p => readFileSync(p, 'utf-8'));

function allTestIds(): string[] {
  return SOURCES().flatMap(src => [...src.matchAll(/testID="([^"]*)"/g)].map(m => m[1].trim())).filter(Boolean);
}

/** الـIDs المبنية بقالب — بنستخرج الجزء الثابت قبل `${` */
function templateTestIdPrefixes(): string[] {
  return SOURCES()
    .flatMap(src => [...src.matchAll(/testID={`([^`]*)`}/g)].map(m => m[1]))
    .map(s => s.split('${')[0])
    .map(s => s.trim())
    .filter(Boolean);
}

describe('اتفاق تسمية الـtestID', () => {
  it('كل الأسماء الثابتة بحروف صغيرة إنجليزية وشرطة سفلية', () => {
    const bad = allTestIds().filter(id => !/^[a-z][a-z0-9_]*$/.test(id));
    expect(bad).toEqual([]);
  });

  it('وكل بادئات القوالب كمان', () => {
    const bad = templateTestIdPrefixes().filter(p => !/^[a-z][a-z0-9_]*$/.test(p));
    expect(bad).toEqual([]);
  });

  it('مفيش اسم متكرر على عنصرين مختلفين', () => {
    const ids = allTestIds();
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });
});

describe('الأدوات الأساسية ليها testID — ومحدش يشيلها', () => {
  /**
   * القايمة دي هي أقل حاجة لازمة عشان اختبار دخان E2E يمشي في المسارات
   * الحرجة: دخول، عملية، قفل، إعدادات، دين، اشتراك، جمعية، أرشيف.
   */
  const REQUIRED_EXACT = [
    // دخول
    'auth_email_input', 'auth_password_input', 'auth_submit_button', 'auth_reset_button',
    // عملية
    'tx_add_button', 'tx_amount_input', 'tx_save_button',
    // قفل
    'lock_forgot_button', 'lock_submit_button', 'lock_password_input',
    'lock_enable_button', 'lock_change_button', 'lock_disable_button',
    'setlock_submit', 'setlock_cancel', 'setlock_code1', 'setlock_code2',
    // محافظ وفئات
    'wallet_add_input', 'wallet_add_button', 'wallets_empty',
    'category_add_input', 'category_add_button', 'categories_empty',
    // إشعارات
    'notifications_switch', 'notifications_status', 'notifications_daily_switch',
    // ديون واشتراكات وجمعية
    'debt_add_button', 'debt_edit_save', 'debt_edit_cancel',
    'debt_payment_save', 'debt_payment_amount', 'debt_increase_save', 'debt_add_save',
    'subscription_add_button', 'subscription_add_save', 'subscription_edit_save',
    'gamiya_add_button', 'gamiya_add_save', 'gamiya_edit_save',
    // تبويبات وأرشيف
    'debts_tab_subscriptions', 'debts_tab_gamiya',
    'planning_tab_budget', 'planning_tab_shakhbata',
    'archive_export_button', 'archive_date_from', 'archive_date_to',
    // رأي وعن التطبيق
    'feedback_text_input', 'feedback_send_button', 'about_version',
  ];

  const REQUIRED_TEMPLATES = [
    'settings_row_', 'settings_section_',
    'wallet_row_', 'wallet_name_input_', 'wallet_delete_',
    'wallet_opening_input_', 'wallet_alert_input_',
    'category_row_', 'category_name_input_', 'category_delete_',
    'notifications_hour_', 'archive_preset_', 'reports_preset_',
    'tx_type_', 'feedback_type_', 'lock_grace_', 'home_tx_',
  ];

  it('كل الأدوات الأساسية موجودة', () => {
    const have = new Set(allTestIds());
    expect(REQUIRED_EXACT.filter(id => !have.has(id))).toEqual([]);
  });

  it('وكل قوالب الأسماء موجودة', () => {
    const have = new Set(templateTestIdPrefixes());
    expect(REQUIRED_TEMPLATES.filter(p => !have.has(p))).toEqual([]);
  });
});
