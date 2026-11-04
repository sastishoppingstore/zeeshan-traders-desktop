/** ERP shell + auth + route map (Part 5.6, ERP-01..38). */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from './app-state.js';
import { api } from './api.js';
import { Button, TextField, CheckField, Chip, Skeleton, Sheet, OfflineBanner } from './components.js';
import { Mark } from './ui/marks.js';
import { NavIcon } from './ui/icons.js';
import { AuroraBg, GoldDust } from './ui/particles.js';
import { Reveal } from './ui/motion.js';
import { IMAGES } from './images.js';
import { usePinState, PinGate, lockPin } from './offline-security.js';
import { BOOKS, MONEY_ACCOUNTS } from '@zt/shared';
import { passkeysSupported, loginWithPasskey } from './passkeys.js';
import {
  Dashboard, GenericList, ProductForm, ProductImport, HubScreen, CropPage, KhataCentre,
  PartyKhata, ReportsGallery, DocumentsCentre, SyncCentre, BackupScreen, SettingsScreen,
  AuditScreen, StatusScreen, WebsiteCms, EnquiriesInbox, AccountingScreen, UsersScreen,
  InventoryScreen, AccountsHub, AccountPage, EmployeesScreen, ReturnsScreen,
  OrdersScreen, PaymentMethodsScreen,
} from './erpScreens.js';
import { DocumentForm, GrainForm, SimpleForm } from './erpForms.js';

type NavItem = { to: string; ur: string; en?: string; icon: string; perm?: string };
const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  { group: 'مرکزی', items: [
    { to: '/erp', ur: 'ڈیش بورڈ', en: 'Dashboard', icon: 'dashboard', perm: 'dashboard.view' },
    { to: '/erp/sales', ur: 'فروخت', en: 'Sales', icon: 'sales', perm: 'sales.read' },
    { to: '/erp/purchases', ur: 'خرید', en: 'Purchases', icon: 'purchases', perm: 'purchases.read' },
    { to: '/erp/inventory', ur: 'اسٹاک', en: 'Inventory', icon: 'inventory', perm: 'stock.read' },
  ] },
  { group: 'کاروباری کتابیں', items: BOOKS.filter((b) => b.kind === 'goods').map((b) => ({
    to: b.code === 'FERT' ? '/erp/fertilizer' : b.code === 'PEST' ? '/erp/pesticide' : `/erp/goods/${b.code}`,
    ur: b.ur, en: b.en, icon: b.code, perm: 'sales.read',
  })) },
  { group: 'اجناس (7)', items: BOOKS.filter((b) => b.kind === 'grain').map((b) => ({
    to: `/erp/grains/${b.code}`, ur: b.ur, en: b.en, icon: b.code, perm: 'grains.read',
  })) },
  { group: 'رقم اور کھاتہ', items: [
    { to: '/erp/khata', ur: 'کھاتہ', en: 'Khata', icon: 'khata', perm: 'khata.read' },
    { to: '/erp/accounts', ur: 'اکاؤنٹس', en: 'Accounts', icon: 'accounts', perm: 'accounts.read' },
    { to: '/erp/parties', ur: 'فریق', en: 'Parties', icon: 'parties', perm: 'parties.read' },
    { to: '/erp/expenses', ur: 'اخراجات', en: 'Expenses', icon: 'expenses', perm: 'expenses.read' },
    { to: '/erp/employees', ur: 'ملازمین', en: 'Employees', icon: 'employees', perm: 'employees.read' },
  ] },
  { group: 'نظام', items: [
    { to: '/erp/products', ur: 'مصنوعات', en: 'Products', icon: 'products', perm: 'products.read' },
    { to: '/erp/catalogue/categories', ur: 'زمرے', en: 'Catalogue', icon: 'catalogue', perm: 'catalogue.read' },
    { to: '/erp/website', ur: 'ویب سائٹ', en: 'Website', icon: 'website', perm: 'cms.read' },
    { to: '/erp/orders', ur: 'آرڈرز', en: 'Orders', icon: 'orders', perm: 'orders.read' },
    { to: '/erp/payment-methods', ur: 'ادائیگی کے طریقے', en: 'Payment methods', icon: 'payments', perm: 'payments.methods.write' },
    { to: '/erp/enquiries', ur: 'پوچھ گچھ', en: 'Enquiries', icon: 'enquiries', perm: 'enquiries.read' },
    { to: '/erp/documents', ur: 'دستاویزات', en: 'Documents', icon: 'documents', perm: 'documents.read' },
    { to: '/erp/reports', ur: 'رپورٹس', en: 'Reports', icon: 'reports', perm: 'reports.view' },
    { to: '/erp/accounting', ur: 'اکاؤنٹنگ', en: 'Accounting', icon: 'accounting', perm: 'accounting.read' },
    { to: '/erp/users', ur: 'صارفین', en: 'Users', icon: 'users', perm: 'users.read' },
    { to: '/erp/sync', ur: 'سنک', en: 'Sync', icon: 'sync', perm: 'sync.read' },
    { to: '/erp/backup', ur: 'بیک اپ', en: 'Backup', icon: 'backup', perm: 'backup.read' },
    { to: '/erp/settings', ur: 'ترتیبات', en: 'Settings', icon: 'settings', perm: 'settings.read' },
    { to: '/erp/audit', ur: 'آڈٹ لاگ', en: 'Audit', icon: 'audit', perm: 'audit.read' },
    { to: '/erp/status', ur: 'سسٹم کی حالت', en: 'System status', icon: 'status', perm: 'dashboard.view' },
  ] },
];

/** The nav mirrors the permission matrix; requirePerm() on every route stays the real gate (H5). */
function navGroups(can: (perm: string) => boolean) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length);
}

const BOTTOM_NAV: NavItem[] = [
  { to: '/erp', ur: 'ڈیش بورڈ', icon: 'dashboard', perm: 'dashboard.view' },
  { to: '/erp/sales', ur: 'فروخت', icon: 'sales', perm: 'sales.read' },
  { to: '/erp/purchases', ur: 'خرید', icon: 'purchases', perm: 'purchases.read' },
  { to: '/erp/khata', ur: 'کھاتہ', icon: 'khata', perm: 'khata.read' },
  { to: '/erp/more', ur: 'مزید', icon: 'menu' },
];

const QUICK_TILES = [
  { label: 'کھاد خرید', kind: 'purchase', book: 'FERT', perm: 'purchases.post' },
  { label: 'کھاد فروخت', kind: 'sale', book: 'FERT', perm: 'sales.post' },
  { label: 'پیسٹی خرید', kind: 'purchase', book: 'PEST', perm: 'purchases.post' },
  { label: 'پیسٹی فروخت', kind: 'sale', book: 'PEST', perm: 'sales.post' },
  { label: 'اجناس', kind: 'grain', book: 'WHEAT', perm: 'grains.read' },
  { label: 'رقم وصول', kind: 'receipt', book: '', perm: 'receipts.post' },
  { label: 'رقم ادا', kind: 'payment', book: '', perm: 'payments.post' },
  { label: 'خرچہ', kind: 'expense', book: '', perm: 'expenses.post' },
] as const;

function TopBar({ title }: { title: string }) {
  const { lang, setLang, online, pending, conflicts, syncing, syncNow, session, logout, t } = useApp();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const pin = usePinState();
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const state = !online ? 'آف لائن' : conflicts ? `${conflicts} تضاد` : syncing ? 'سنک ہو رہا ہے' : pending ? `${pending} باقی` : 'سنک شدہ';
  return <>
    <header className="erp-topbar">
      <Link to="/" className="brand" style={{ display: 'flex', gap: 8, alignItems: 'center' }} aria-label="عوامی ویب سائٹ">
        <img src="/icons/icon-192.png" alt="" width={32} height={32} style={{ borderRadius: 6 }} />
      </Link>
      <div className="title">{title}</div>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setSearch(true)} aria-label="تلاش"><Mark kind="search" /></button>
      <button className={`chip ${online ? (conflicts ? 'danger' : 'success') : 'warning'}`} onClick={() => nav('/erp/sync')}
        title="Sync Centre" style={{ cursor: 'pointer', border: 'none' }}>{state}</button>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => void syncNow()} aria-label="ابھی سنک کریں"><Mark kind="sync" /></button>
      {pin.enabled && pin.unlocked && <button className="btn btn-ghost btn-sm no-print" onClick={() => { lockPin(); }} title="آف لائن کیش مقفل کریں" aria-label="کیش مقفل کریں"><Mark kind="lock" /></button>}
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')}>{lang === 'ur' ? 'EN' : 'UR'}</button>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setMenu(!menu)} aria-label="صارف مینو"><Mark kind="user" /></button>
    </header>
    {menu && <div className="card" style={{ position: 'fixed', insetInlineEnd: 8, top: 58, zIndex: 45, minWidth: 210 }}>
      <div className="small">{session?.user.name}</div>
      <div className="small">{session?.user.roles.join(', ')}</div>
      <Link className="btn btn-ghost btn-sm btn-block" to="/erp/settings">ترتیبات</Link>
      <Link className="btn btn-ghost btn-sm btn-block" to="/erp/status">سسٹم کی حالت</Link>
      <button className="btn btn-ghost btn-sm btn-block" onClick={() => void logout()}>لاگ آؤٹ</button>
    </div>}
    <Sheet open={search} onClose={() => setSearch(false)} title="عالمی تلاش (Ctrl+K)">
      <TextField label="تلاش" value="" onChange={() => {}} placeholder="مصنوعات، فریق، دستاویز…" />
      <div className="link-list"><Link to="/erp/products" onClick={() => setSearch(false)}>مصنوعات</Link>
        <Link to="/erp/parties" onClick={() => setSearch(false)}>فریق</Link>
        <Link to="/erp/documents" onClick={() => setSearch(false)}>دستاویزات</Link></div>
      <div className="notice info small">عالمی سرچ انڈیکس INCOMPLETE — اوپر کے روابط کام کرتے ہیں۔</div>
    </Sheet>
  </>;
}

function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useApp();
  const tiles = QUICK_TILES.filter((x) => can(x.perm));
  const go = (k: string, book: string) => {
    onClose();
    if (k === 'purchase' || k === 'sale') nav(`/erp/${book === 'FERT' ? 'fertilizer' : 'pesticide'}/${k}/new?quick=1`);
    else if (k === 'grain') nav('/erp/grains');
    else if (k === 'receipt') nav('/erp/receipts/new');
    else if (k === 'payment') nav('/erp/payments/new');
    else nav('/erp/expenses/new');
  };
  return <Sheet open={open} onClose={onClose} title="نیا اندراج / تیز اندراج">
    <div className="quick-grid">{tiles.map((x) => <button key={x.label} className="tile" onClick={() => go(x.kind, x.book)}>
      <span className="ico"><Mark kind="plus" /></span><strong>{x.label}</strong></button>)}</div>
    {!tiles.length && <div className="notice small">اس صارف کے پاس اندراج پوسٹ کرنے کی اجازت نہیں — ڈیش بورڈ سے رپورٹس دیکھیں۔</div>}
    <div className="notice small" style={{ marginBlockStart: 12 }}>تیز اندراج: نام، تعداد، رقم اور نقد/ادھار — باقی تفصیلات اختیاری۔</div>
  </Sheet>;
}

function Sidebar() {
  const { can } = useApp();
  return <aside className="sidebar" aria-label="ERP روابط">
    {navGroups(can).map((g) => <React.Fragment key={g.group}>
      <div className="group">{g.group}</div>
      {g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/erp'} className={({ isActive }) => isActive ? 'active' : ''} title={i.en}>
        <NavIcon icon={i.icon} label={i.ur} size={26} /><span className="label">{i.ur}</span>
      </NavLink>)}
    </React.Fragment>)}
  </aside>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const [quick, setQuick] = useState(false);
  const loc = useLocation();
  const { can } = useApp();
  const title = useMemo(() => {
    for (const g of NAV_GROUPS) for (const i of g.items) if (loc.pathname.startsWith(i.to) && i.to !== '/erp') return i.ur;
    if (loc.pathname.includes('/new') || loc.pathname.includes('/import')) return 'نیا اندراج';
    return 'ڈیش بورڈ';
  }, [loc.pathname]);
  return <div className="erp-shell">
    <div className="erp-main">
      <TopBar title={title} /><OfflineBanner />
      <main className="erp-content" id="main">{children}</main>
      <nav className="erp-bottom-nav" aria-label="نیچے والی نیویگیشن">
        {BOTTOM_NAV.filter((i) => !i.perm || can(i.perm)).map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/erp'} className={({ isActive }) => isActive ? 'active' : ''}>
          {i.icon === 'menu' ? <span className="ico"><Mark kind="menu" /></span> : <NavIcon icon={i.icon} label={i.ur} size={30} />}
          <span>{i.ur}</span></NavLink>)}
      </nav>
      {QUICK_TILES.some((x) => can(x.perm)) && <button className="fab" onClick={() => setQuick(true)} aria-label="نیا اندراج">+</button>}
      <QuickSheet open={quick} onClose={() => setQuick(false)} />
    </div>
    <Sidebar />
  </div>;
}

// --------------------------------- Login -----------------------------------
function Login() {
  const { reloadSession, setupStatus, toast, t } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [pkBusy, setPkBusy] = useState(false);
  useEffect(() => { if (setupStatus && !setupStatus.setup_complete) nav('/erp/setup'); }, [setupStatus]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/api/v1/auth/login', { method: 'POST', body: { username, password, device_id: localStorage.getItem('zt_device_id') ?? undefined } });
      await reloadSession(); nav('/erp');
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
  };
  return <div className="erp-login">
    <AuroraBg />
    <GoldDust count={14} />
    <div className="login-side">
      <Reveal>
        <img className="login-mark" src="/brand/logo-96.png" alt="ذیشان ٹریڈرز کا نشان" width={64} height={64} />
        <h1 className="h-nastaliq">ذیشان ٹریڈرز</h1>
        <p>کھاد، پیسٹی سائیڈ، چوکر، ونڈا، سیمنٹ، بیج اور سات اجناس — خرید و فروخت، کھاتہ، اسٹاک اور رپورٹس ایک ہی نظام میں۔</p>
      </Reveal>
    </div>
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <img src={IMAGES['about/about-shop'].md} alt="" width={52} height={52} />
        <span><strong>کھاتہ (ERP)</strong><small className="small">Zeeshan Traders · Ledger</small></span>
      </div>
      <h2>لاگ ان</h2>
      <TextField label={t('username')} value={username} onChange={setUsername} required autoComplete="username" />
      <TextField label={t('password')} value={password} onChange={setPassword} type={show ? 'text' : 'password'} required autoComplete="current-password" />
      <CheckField label="پاس ورڈ دکھائیں" checked={show} onChange={setShow} />
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <Button type="submit" loading={busy} className="btn-block">لاگ ان</Button>
      {passkeysSupported() && <Button type="button" variant="secondary" className="btn-block" loading={pkBusy}
        onClick={async () => {
          setPkBusy(true); setErr('');
          try { await loginWithPasskey(); await reloadSession(); nav('/erp'); }
          catch (e: any) { setErr(e.message_ur ?? String(e)); }
          finally { setPkBusy(false); }
        }}><Mark kind="key" /> فنگر پرنٹ / پاس کی سے لاگ ان</Button>}
      <div className="notice info small" style={{ marginBlockStart: 8 }}>پاس کی ڈیوائس کے اپنے بائیو میٹرک سے چیلنج پر دستخط کرتی ہے؛
        فنگر پرنٹ کبھی ویب سائٹ یا سرور تک نہیں پہنچتا۔ ڈومین تبدیل ہونے سے پہلے پاس کی رجسٹر کریں (RP ID ڈومین سے بندھا ہے)۔</div>
      {setupStatus?.local_preview && <div className="notice small">مقامی پیش نظارہ: سیٹ اپ ٹوکن سرور لاگ اور <code>/api/v1/setup/status</code> میں موجود ہے۔</div>}
    </form>
  </div>;
}

// ------------------------------- Setup wizard -------------------------------
const STEPS = ['مالک', 'کاروبار', 'یونٹس', 'ابتدائی بیلنس', 'مالی سال', 'ریگولیٹری', 'خلاصہ'];
function Setup() {
  const { setupStatus, reloadSession, reloadSetup, toast } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [name, setName] = useState(''), [username, setUsername] = useState('owner'), [mobile, setMobile] = useState('0307-7864722');
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [token, setToken] = useState(setupStatus?.setup_token ?? '');
  const [location, setLocation] = useState('مقصود چوک، ضلع لیہ، پنجاب، پاکستان');
  const [phone1, setPhone1] = useState('0307-7864722'), [phone2, setPhone2] = useState('0345-4654722');
  const [maund, setMaund] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [balances, setBalances] = useState<Record<string, string>>({ CASH: '', JAZZ: '', MEEZAN: '', UBL: '' });
  const [openingDate, setOpeningDate] = useState('2026-07-01');
  const [fiscalMonth, setFiscalMonth] = useState('7');
  const [licNo, setLicNo] = useState(''), [licExp, setLicExp] = useState(''), [fertNo, setFertNo] = useState('');
  useEffect(() => { if (setupStatus?.setup_token) setToken(setupStatus.setup_token); }, [setupStatus]);
  const pwStrength = pw.length >= 14 ? 3 : pw.length >= 10 ? 2 : pw.length ? 1 : 0;
  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const opening_balances = MONEY_ACCOUNTS.filter((a) => Number(balances[a.code]) > 0).map((a) => ({
        account_code: a.code, amount_paisa: Math.round(Number(balances[a.code]) * 100),
        as_of_date: openingDate, direction: 'DEBIT',
      }));
      await api('/api/v1/setup', { method: 'POST', body: {
        setup_token: token, owner: { name, username, mobile, password: pw },
        business: { name_ur: 'ذیشان ٹریڈرز', name_en: 'Zeeshan Traders', location_ur: location, phone1, phone2 },
        maund_kg: Number(maund), maund_confirmed: confirmed,
        fiscal_start_month: Number(fiscalMonth), opening_balances,
        regulatory: { pesticide_licence_no: licNo || undefined, pesticide_licence_expiry: licExp || undefined,
          fertilizer_authorisation_no: fertNo || undefined },
      } });
      await reloadSetup(); await reloadSession(); toast('سیٹ اپ مکمل'); nav('/erp');
    } catch (e: any) { setErr(e.message_ur ?? String(e)); } finally { setBusy(false); }
  };
  if (setupStatus?.setup_complete) return <div className="center" style={{ padding: 48 }}><h2>سیٹ اپ مکمل ہو چکا ہے</h2>
    <Button onClick={() => nav('/erp/login')}>لاگ ان</Button></div>;
  return <div style={{ maxWidth: 720, marginInline: 'auto', padding: 16 }}>
    <h1 className="h-nastaliq">سیٹ اپ وزرڈ</h1>
    <div className="wizard-steps" aria-label="progress">{STEPS.map((s, i) => <span key={s}
      className={`wizard-step${i === step ? ' wizard-step-active' : ''}`}>{i + 1}. {s}</span>)}</div>
    <div className="skeleton" style={{ height: 6, width: `${((step + 1) / STEPS.length) * 100}%`, marginBlock: 16 }} />
    <div className="card">
      {step === 0 && <><h2>1. مالک بنائیں</h2>
        <TextField label="نام" value={name} onChange={setName} required />
        <TextField label="صارف نام" value={username} onChange={setUsername} required />
        <TextField label="موبائل" value={mobile} onChange={setMobile} required />
        <TextField label="پاس ورڈ (کم از کم 10 حروف)" value={pw} onChange={setPw} type="password" required />
        <div className="small">طاقت: <span className="pw-meter" data-level={pwStrength} role="img"
          aria-label={`پاس ورڈ کی طاقت ${pwStrength} میں سے 3`} /></div>
        <TextField label="پاس ورڈ دوبارہ" value={pw2} onChange={setPw2} type="password" required error={pw2 && pw !== pw2 ? 'پاس ورڈ میل نہیں کھاتا' : undefined} />
        {!setupStatus?.setup_token && <TextField label="سیٹ اپ ٹوکن" value={token} onChange={setToken} required helper="تعیناتی کے وقت پرنٹ کیا گیا ایک بار کا ٹوکن" />}
      </>}
      {step === 1 && <><h2>2. کاروباری پروفائل</h2>
        <TextField label="پتہ" value={location} onChange={setLocation} />
        <TextField label="فون 1" value={phone1} onChange={setPhone1} /><TextField label="فون 2" value={phone2} onChange={setPhone2} />
        <div className="notice small">لوگو اپ لوڈ: ترتیبات میں بعد میں (یہاں کوئی فرضی لوگو نہیں)۔</div></>}
      {step === 2 && <><h2>3. یونٹس — مالک کی تصدیق لازمی</h2>
        <TextField label="ایک من = کتنے کلو؟" value={maund} onChange={setMaund} inputMode="numeric" required
          helper="عام طور پر 40 کلو، مگر مالک کی تصدیق کے بغیر کوئی قیمت نہیں رکھی جائے گی" />
        <CheckField label="میں اس من کی قیمت کی تصدیق کرتا ہوں" checked={confirmed} onChange={setConfirmed} />
        <div className="notice">بیگ سائز (مثلاً 50 کلو) ہر مصنوعات کے فارم میں الگ سے درج ہوتا ہے — کوئی قیاس نہیں۔</div></>}
      {step === 3 && <><h2>4. ابتدائی بیلنس (اختیاری)</h2>
        <TextField label="تاریخ" value={openingDate} onChange={setOpeningDate} type="date" />
        {MONEY_ACCOUNTS.map((a) => <TextField key={a.code} label={`${a.ur} (روپے)`} value={balances[a.code]}
          onChange={(v) => setBalances({ ...balances, [a.code]: v })} inputMode="decimal" />)}</>}
      {step === 4 && <><h2>5. مالی سال اور نمبرنگ</h2>
        <TextField label="مالی سال کا آغاز (مہینہ)" value={fiscalMonth} onChange={setFiscalMonth} inputMode="numeric" />
        <div className="small">پہلے سے طے: FS- خرید/فروخت، RC- رسید، PV- ادائیگی، EX- خرچہ، SL- تنخواہ۔ ترتیبات میں بدلا جا سکتا ہے۔</div></>}
      {step === 5 && <><h2>6. ریگولیٹری (اختیاری — کبھی نہیں بنائے جاتے)</h2>
        <TextField label="پیسٹی سائیڈ لائسنس نمبر" value={licNo} onChange={setLicNo} />
        <TextField label="لائسنس کی میعاد" value={licExp} onChange={setLicExp} type="date" />
        <TextField label="کھاد ڈیلر اجازت نمبر" value={fertNo} onChange={setFertNo} />
        <div className="notice small">سافٹ ویئر کسی سرکاری پورٹل، بینک یا JazzCash سے منسلک نہیں ہے؛ صرف ریکارڈ رکھتا ہے۔</div></>}
      {step === 6 && <><h2>7. خلاصہ</h2>
        <div className="kv"><span className="k">مالک</span><span className="v">{name || '—'}</span>
          <span className="k">من</span><span className="v">{maund || '—'} کلو {confirmed ? <Mark kind="check" /> : <Mark kind="x" />}</span>
          <span className="k">مصنوعات</span><span className="v">خالی (مالک شامل کریں گے)</span>
          <span className="k">کسٹمر / سپلائر</span><span className="v">خالی</span>
          <span className="k">لائسنس</span><span className="v">{licNo || 'درج نہیں'}</span></div></>}
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <div className="btn-row" style={{ marginBlockStart: 20 }}>
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>پچھلا</Button>}
        {step < STEPS.length - 1 ? <Button onClick={() => setStep(step + 1)}>اگلا</Button>
          : <Button loading={busy} onClick={finish} disabled={!name || !pw || pw !== pw2 || !confirmed || !maund || !token}>مکمل کریں</Button>}
      </div>
    </div>
  </div>;
}

function MoreScreen() {
  const { can } = useApp();
  return <div><h1>مزید</h1><div className="link-list">
    {navGroups(can).flatMap((g) => g.items).map((i) => <Link key={i.to} to={i.to}>{i.icon} {i.ur} <span className="small">({i.en})</span></Link>)}
  </div></div>;
}

function NotFound() {
  return <div className="center" style={{ padding: 48 }}><h1>۴۰۴</h1><p>صفحہ نہیں ملا</p><Link className="btn btn-primary" to="/erp">ڈیش بورڈ</Link></div>;
}

export function ErpApp() {
  const { session, loadingSession, setupStatus, online, t } = useApp();
  const loc = useLocation();
  const pin = usePinState();
  if (pin.enabled && !pin.unlocked && !loc.pathname.startsWith('/erp/login') && !loc.pathname.startsWith('/erp/setup'))
    return <PinGate />;
  if (loc.pathname.startsWith('/erp/login')) return <Login />;
  if (loc.pathname.startsWith('/erp/setup')) return <Setup />;
  if (loadingSession) return <Skeleton rows={5} />;
  if (!session) return <Login />;
  if (setupStatus && !setupStatus.setup_complete) return <Setup />;
  return <Shell><Routes>
    <Route index element={<Dashboard />} />
    <Route path="login" element={<Login />} />
    <Route path="setup" element={<Setup />} />
    <Route path="more" element={<MoreScreen />} />
    <Route path="sales" element={<GenericList config={LIST_CONFIG.sales} />} />
    <Route path="purchases" element={<GenericList config={LIST_CONFIG.purchases} />} />
    <Route path="products" element={<GenericList config={LIST_CONFIG.products} />} />
    <Route path="products/new" element={<ProductForm />} />
    <Route path="products/:id" element={<ProductForm />} />
    <Route path="products/import" element={<ProductImport />} />
    <Route path="catalogue/:kind" element={<CatalogueRoute />} />
    <Route path="fertilizer" element={<HubScreen book="FERT" />} />
    <Route path="fertilizer/purchase/new" element={<DocumentForm kind="purchase" book="FERT" />} />
    <Route path="fertilizer/sale/new" element={<DocumentForm kind="sale" book="FERT" />} />
    <Route path="pesticide" element={<HubScreen book="PEST" />} />
    <Route path="pesticide/purchase/new" element={<DocumentForm kind="purchase" book="PEST" />} />
    <Route path="pesticide/sale/new" element={<DocumentForm kind="sale" book="PEST" />} />
    <Route path="goods/:book" element={<GoodsRoute />} />
    <Route path="goods/:book/purchase/new" element={<BookFormRoute kind="purchase" />} />
    <Route path="goods/:book/sale/new" element={<BookFormRoute kind="sale" />} />
    <Route path="grains" element={<GrainsHub />} />
    <Route path="grains/:crop" element={<CropPage />} />
    <Route path="grains/:crop/purchase/new" element={<GrainForm kind="purchase" />} />
    <Route path="grains/:crop/sale/new" element={<GrainForm kind="sale" />} />
    <Route path="parties" element={<GenericList config={LIST_CONFIG.parties} />} />
    <Route path="parties/new" element={<SimpleForm config={FORM_CONFIG.party} />} />
    <Route path="parties/:id" element={<PartyKhata />} />
    <Route path="khata" element={<KhataCentre />} />
    <Route path="receipts/new" element={<SimpleForm config={FORM_CONFIG.receipt} />} />
    <Route path="payments/new" element={<SimpleForm config={FORM_CONFIG.payment} />} />
    <Route path="accounts" element={<AccountsHub />} />
    <Route path="accounts/:id" element={<AccountPage />} />
    <Route path="accounts/transfer" element={<SimpleForm config={FORM_CONFIG.transfer} />} />
    <Route path="returns" element={<ReturnsScreen />} />
    <Route path="expenses" element={<GenericList config={LIST_CONFIG.expenses} />} />
    <Route path="expenses/new" element={<SimpleForm config={FORM_CONFIG.expense} />} />
    <Route path="employees" element={<EmployeesScreen />} />
    <Route path="employees/new" element={<SimpleForm config={FORM_CONFIG.employee} />} />
    <Route path="payroll/:ym" element={<EmployeesScreen payroll />} />
    <Route path="inventory" element={<InventoryScreen />} />
    <Route path="website" element={<WebsiteCms />} />
    <Route path="orders" element={<OrdersScreen />} />
    <Route path="payment-methods" element={<PaymentMethodsScreen />} />
    <Route path="enquiries" element={<EnquiriesInbox />} />
    <Route path="documents" element={<DocumentsCentre />} />
    <Route path="reports" element={<ReportsGallery />} />
    <Route path="accounting" element={<AccountingScreen />} />
    <Route path="users" element={<UsersScreen />} />
    <Route path="sync" element={<SyncCentre />} />
    <Route path="backup" element={<BackupScreen />} />
    <Route path="settings" element={<SettingsScreen />} />
    <Route path="audit" element={<AuditScreen />} />
    <Route path="status" element={<StatusScreen />} />
    <Route path="*" element={<NotFound />} />
  </Routes></Shell>;
}

// Route helpers ---------------------------------------------------------------
function BookFormRoute({ kind }: { kind: 'purchase' | 'sale' }) {
  const { book = 'CHOK' } = useParams();
  return <DocumentForm kind={kind} book={book.toUpperCase()} />;
}
function GoodsRoute() { const { book = 'CHOK' } = useParams(); return <HubScreen book={book.toUpperCase()} />; }
function CatalogueRoute() {
  const { kind = 'categories' } = useParams();
  return <GenericList config={LIST_CONFIG[kind] ?? LIST_CONFIG.categories} />;
}
function GrainsHub() {
  const { can, t } = useApp();
  if (!can('grains.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><h1 className="head-icon"><NavIcon icon="grains" label="اجناس" size={34} />اجناس — سات الگ ماڈیول</h1>
    <div className="module-grid">{BOOKS.filter((b) => b.kind === 'grain').map((b) =>
      <Link key={b.code} className="module-tile" to={`/erp/grains/${b.code}`}>
        <NavIcon icon={b.code} label={b.ur} size={40} /><strong>{b.ur}</strong><span className="small">{b.en}</span></Link>)}</div></div>;
}

export const LIST_CONFIG: Record<string, any> = {
  sales: { title: 'فروخت', endpoint: '/api/v1/sales', columns: [
    { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'book_code', label: 'کتاب' },
    { key: 'total_paisa', label: 'کل', money: true }, { key: 'due_paisa', label: 'بقایا', money: true },
    { key: 'status', label: 'حالت' }], detail: (r: any) => `/erp/documents?type=SALE&q=${r.number}` },
  purchases: { title: 'خرید', endpoint: '/api/v1/purchases', columns: [
    { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'book_code', label: 'کتاب' },
    { key: 'total_paisa', label: 'کل', money: true }, { key: 'due_paisa', label: 'بقایا', money: true }], detail: (r: any) => `/erp/documents?type=PURCHASE&q=${r.number}` },
  products: { title: 'مصنوعات', endpoint: '/api/v1/products', columns: [
    { key: 'name_ur', label: 'نام' }, { key: 'sku', label: 'SKU' }, { key: 'category_ur', label: 'زمرہ' },
    { key: 'stock_milli', label: 'اسٹاک', qty: true }, { key: 'sale_rate_paisa', label: 'ریٹ', money: true },
    { key: 'is_published', label: 'ویب' }], detail: (r: any) => `/erp/products/${r.id}`,
    actions: [{ label: '+ نئی مصنوعات', to: '/erp/products/new' }, { label: 'CSV درآمد', to: '/erp/products/import' }] },
  parties: { title: 'فریق', endpoint: '/api/v1/parties', columns: [
    { key: 'name_ur', label: 'نام' }, { key: 'phone', label: 'موبائل' }, { key: 'type', label: 'قسم' },
    { key: 'balance_paisa', label: 'بیلنس', money: true }], detail: (r: any) => `/erp/parties/${r.id}`,
    actions: [{ label: '+ نیا فریق', to: '/erp/parties/new' }] },
  expenses: { title: 'اخراجات', endpoint: '/api/v1/expenses', columns: [
    { key: 'number', label: 'نمبر' }, { key: 'date', label: 'تاریخ' }, { key: 'category_ur', label: 'زمرہ' },
    { key: 'amount_paisa', label: 'رقم', money: true }, { key: 'vendor', label: 'وینڈر' }],
    actions: [{ label: '+ نیا خرچہ', to: '/erp/expenses/new' }] },
  categories: { title: 'زمرے', endpoint: '/api/v1/categories', columns: [
    { key: 'name_ur', label: 'نام' }, { key: 'code', label: 'کوڈ' }, { key: 'slug', label: 'Slug' },
    { key: 'book_code', label: 'کتاب' }, { key: 'is_active', label: 'فعال' }],
    create: { endpoint: '/api/v1/categories', slugFromName: true, fields: [
      { name: 'name_ur', label: 'نام (اردو)' }, { name: 'name_en', label: 'English' },
      { name: 'code', label: 'کوڈ' }, { name: 'sort', label: 'ترتیب', type: 'number' }] } },
  brands: { title: 'برانڈز', endpoint: '/api/v1/brands', columns: [
    { key: 'name_ur', label: 'نام' }, { key: 'name_en', label: 'English' }, { key: 'is_active', label: 'فعال' }],
    create: { endpoint: '/api/v1/brands', fields: [
      { name: 'name_ur', label: 'نام (اردو)' }, { name: 'name_en', label: 'English' }] } },
  units: { title: 'یونٹ کنورژن', endpoint: '/api/v1/units', columns: [
    { key: 'from_unit', label: 'سے' }, { key: 'to_unit', label: 'تک' }, { key: 'ratio_milli', label: 'تناسب', qty: true },
    { key: 'confirmed', label: 'تصدیق' }],
    create: { endpoint: '/api/v1/units', extra: { confirmed: true }, fields: [
      { name: 'from_unit', label: 'سے' }, { name: 'to_unit', label: 'تک' },
      { name: 'ratio_milli', label: 'تناسب (1000 = 1:1)', type: 'number' }] } },
};

export const FORM_CONFIG: Record<string, any> = {
  party: { title: 'نیا فریق', endpoint: '/api/v1/parties', back: '/erp/parties', fields: [
    { name: 'name_ur', label: 'نام', type: 'text', required: true },
    { name: 'phone', label: 'موبائل', type: 'text' }, { name: 'village', label: 'گاؤں / پتہ', type: 'text' },
    { name: 'type', label: 'قسم', type: 'select', options: [
      { value: 'CUSTOMER', label: 'گاہک' }, { value: 'SUPPLIER', label: 'سپلائر' },
      { value: 'FARMER', label: 'کاشتکار' }, { value: 'EMPLOYEE', label: 'ملازم' }], required: true },
    { name: 'opening_balance_paisa', label: 'ابتدائی بیلنس', type: 'money' },
    { name: 'opening_direction', label: 'سمت', type: 'select', options: [
      { value: 'RECEIVABLE', label: 'وہ ہمیں دیں گے' }, { value: 'PAYABLE', label: 'ہم نے دینے ہیں' }] },
    { name: 'credit_limit_paisa', label: 'کریڈٹ حد', type: 'money' },
    { name: 'notes', label: 'نوٹ', type: 'textarea' },
  ] },
  receipt: { title: 'رقم وصول', endpoint: '/api/v1/receipts', back: '/erp/khata', offline: true, fields: [
    { name: 'date', label: 'تاریخ', type: 'date', required: true },
    { name: 'party_id', label: 'گاہک', type: 'party', required: true },
    { name: 'amount_paisa', label: 'رقم', type: 'money', required: true },
    { name: 'account_id', label: 'اکاؤنٹ', type: 'account', required: true },
    { name: 'reference', label: 'حوالہ / TID', type: 'text' },
    { name: 'allocate', label: 'الاٹمنٹ', type: 'select', options: [
      { value: 'AUTO', label: 'خودکار (پرانا پہلے)' }, { value: 'ADVANCE', label: 'ایڈوانس' }, { value: 'MANUAL', label: 'دستی' }] },
    { name: 'note', label: 'نوٹ', type: 'textarea' },
  ] },
  payment: { title: 'رقم ادا', endpoint: '/api/v1/payments', back: '/erp/khata', offline: true, fields: [
    { name: 'date', label: 'تاریخ', type: 'date', required: true },
    { name: 'party_id', label: 'فریق', type: 'party', required: true },
    { name: 'amount_paisa', label: 'رقم', type: 'money', required: true },
    { name: 'account_id', label: 'اکاؤنٹ', type: 'account', required: true },
    { name: 'payee_type', label: 'قسم', type: 'select', options: [
      { value: 'SUPPLIER', label: 'سپلائر' }, { value: 'FARMER', label: 'کاشتکار' },
      { value: 'EMPLOYEE', label: 'ملازم' }, { value: 'CUSTOMER', label: 'گاہک' }] },
    { name: 'reference', label: 'حوالہ', type: 'text' }, { name: 'note', label: 'نوٹ', type: 'textarea' },
  ] },
  transfer: { title: 'رقم منتقلی', endpoint: '/api/v1/transfers', back: '/erp/accounts', fields: [
    { name: 'date', label: 'تاریخ', type: 'date', required: true },
    { name: 'from_account_id', label: 'سے', type: 'account', required: true },
    { name: 'to_account_id', label: 'تک', type: 'account', required: true },
    { name: 'amount_paisa', label: 'رقم', type: 'money', required: true },
    { name: 'note', label: 'نوٹ', type: 'text' },
  ] },
  expense: { title: 'خرچہ', endpoint: '/api/v1/expenses', back: '/erp/expenses', offline: true, fields: [
    { name: 'date', label: 'تاریخ', type: 'date', required: true },
    { name: 'category_code', label: 'زمرہ', type: 'expenseCategory', required: true },
    { name: 'vendor', label: 'وینڈر', type: 'text' },
    { name: 'amount_paisa', label: 'رقم', type: 'money', required: true },
    { name: 'account_id', label: 'ادا از', type: 'account', required: true },
    { name: 'note', label: 'نوٹ', type: 'textarea' },
  ] },
  employee: { title: 'ملازم', endpoint: '/api/v1/employees', back: '/erp/employees', fields: [
    { name: 'name', label: 'نام', type: 'text', required: true },
    { name: 'role', label: 'عہدہ', type: 'text' }, { name: 'phone', label: 'موبائل', type: 'text' },
    { name: 'join_date', label: 'تاریخِ ملازمت', type: 'date', required: true },
    { name: 'base_salary_paisa', label: 'تنخواہ', type: 'money' },
  ] },
};
