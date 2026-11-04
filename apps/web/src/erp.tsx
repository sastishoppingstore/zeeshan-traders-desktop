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
  OrdersScreen, PaymentMethodsScreen, UniversalCreateScreen,
} from './erpScreens.js';
import { DocumentForm, GrainForm, SimpleForm } from './erpForms.js';

type NavItem = { to: string; ur: string; en: string; icon: string; perm?: string };
const NAV_GROUPS: { group: string; group_en: string; items: NavItem[] }[] = [
  { group: 'مرکزی', group_en: 'Main', items: [
    { to: '/erp', ur: 'ڈیش بورڈ', en: 'Dashboard', icon: 'dashboard', perm: 'dashboard.view' },
    { to: '/erp/create', ur: 'نیا اندراج / واؤچر', en: 'New Voucher / Invoice', icon: 'documents', perm: 'sales.read' },
    { to: '/erp/sales', ur: 'فروخت', en: 'Sales', icon: 'sales', perm: 'sales.read' },
    { to: '/erp/purchases', ur: 'خرید', en: 'Purchases', icon: 'purchases', perm: 'purchases.read' },
    { to: '/erp/inventory', ur: 'اسٹاک', en: 'Inventory', icon: 'inventory', perm: 'stock.read' },
  ] },
  { group: 'کاروباری کھاتے', group_en: 'Business Ledgers', items: BOOKS.filter((b) => b.kind === 'goods').map((b) => ({
    to: b.code === 'FERT' ? '/erp/fertilizer' : b.code === 'PEST' ? '/erp/pesticide' : `/erp/goods/${b.code}`,
    ur: b.ur, en: b.en, icon: b.code, perm: 'sales.read',
  })) },
  { group: 'اجناس (7)', group_en: 'Grains (7)', items: BOOKS.filter((b) => b.kind === 'grain').map((b) => ({
    to: `/erp/grains/${b.code}`, ur: b.ur, en: b.en, icon: b.code, perm: 'grains.read',
  })) },
  { group: 'رقم اور کھاتہ', group_en: 'Accounts & Khata', items: [
    { to: '/erp/khata', ur: 'کھاتہ', en: 'Khata', icon: 'khata', perm: 'khata.read' },
    { to: '/erp/accounts', ur: 'اکاؤنٹس', en: 'Accounts', icon: 'accounts', perm: 'accounts.read' },
    { to: '/erp/parties', ur: 'فریق', en: 'Parties', icon: 'parties', perm: 'parties.read' },
    { to: '/erp/expenses', ur: 'اخراجات', en: 'Expenses', icon: 'expenses', perm: 'expenses.read' },
    { to: '/erp/employees', ur: 'ملازمین', en: 'Employees', icon: 'employees', perm: 'employees.read' },
  ] },
  { group: 'نظام', group_en: 'System', items: [
    { to: '/erp/products', ur: 'مصنوعات', en: 'Products', icon: 'products', perm: 'products.read' },
    { to: '/erp/catalogue/categories', ur: 'زمرے', en: 'Categories', icon: 'catalogue', perm: 'catalogue.read' },
    { to: '/erp/website', ur: 'ویب سائٹ', en: 'Website', icon: 'website', perm: 'cms.read' },
    { to: '/erp/orders', ur: 'آرڈرز', en: 'Orders', icon: 'orders', perm: 'orders.read' },
    { to: '/erp/payment-methods', ur: 'ادائیگی کے طریقے', en: 'Payment Methods', icon: 'payments', perm: 'payments.methods.write' },
    { to: '/erp/enquiries', ur: 'پوچھ گچھ', en: 'Enquiries', icon: 'enquiries', perm: 'enquiries.read' },
    { to: '/erp/documents', ur: 'دستاویزات', en: 'Documents', icon: 'documents', perm: 'documents.read' },
    { to: '/erp/reports', ur: 'رپورٹس', en: 'Reports', icon: 'reports', perm: 'reports.view' },
    { to: '/erp/accounting', ur: 'اکاؤنٹنگ', en: 'Accounting', icon: 'accounting', perm: 'accounting.read' },
    { to: '/erp/users', ur: 'صارفین', en: 'Users', icon: 'users', perm: 'users.read' },
    { to: '/erp/sync', ur: 'سنک', en: 'Sync', icon: 'sync', perm: 'sync.read' },
    { to: '/erp/backup', ur: 'بیک اپ', en: 'Backup', icon: 'backup', perm: 'backup.read' },
    { to: '/erp/settings', ur: 'ترتیبات', en: 'Settings', icon: 'settings', perm: 'settings.read' },
    { to: '/erp/audit', ur: 'آڈٹ لاگ', en: 'Audit Log', icon: 'audit', perm: 'audit.read' },
    { to: '/erp/status', ur: 'سسٹم کی حالت', en: 'System Status', icon: 'status', perm: 'dashboard.view' },
  ] },
];

/** The nav mirrors the permission matrix; requirePerm() on every route stays the real gate (H5). */
function navGroups(can: (perm: string) => boolean) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length);
}

const BOTTOM_NAV: NavItem[] = [
  { to: '/erp', ur: 'ڈیش بورڈ', en: 'Dashboard', icon: 'dashboard', perm: 'dashboard.view' },
  { to: '/erp/sales', ur: 'فروخت', en: 'Sales', icon: 'sales', perm: 'sales.read' },
  { to: '/erp/purchases', ur: 'خرید', en: 'Purchases', icon: 'purchases', perm: 'purchases.read' },
  { to: '/erp/khata', ur: 'کھاتہ', en: 'Khata', icon: 'khata', perm: 'khata.read' },
  { to: '/erp/more', ur: 'مزید', en: 'More', icon: 'menu' },
];

const QUICK_TILES = [
  { label: 'کھاد خرید', en: 'Fertilizer Purchase', kind: 'purchase', book: 'FERT', perm: 'purchases.post' },
  { label: 'کھاد فروخت', en: 'Fertilizer Sale', kind: 'sale', book: 'FERT', perm: 'sales.post' },
  { label: 'پیسٹی خرید', en: 'Pesticide Purchase', kind: 'purchase', book: 'PEST', perm: 'purchases.post' },
  { label: 'پیسٹی فروخت', en: 'Pesticide Sale', kind: 'sale', book: 'PEST', perm: 'sales.post' },
  { label: 'اجناس', en: 'Grains', kind: 'grain', book: 'WHEAT', perm: 'grains.read' },
  { label: 'رقم وصول', en: 'Receive Money', kind: 'receipt', book: '', perm: 'receipts.post' },
  { label: 'رقم ادا', en: 'Pay Money', kind: 'payment', book: '', perm: 'payments.post' },
  { label: 'خرچہ', en: 'Expense', kind: 'expense', book: '', perm: 'expenses.post' },
  { label: 'تنخواہ واؤچر', en: 'Salary / Payroll', kind: 'payroll', book: '', perm: 'employees.read' },
  { label: 'رقم منتقلی', en: 'Transfer Money', kind: 'transfer', book: '', perm: 'accounts.read' },
  { label: 'نئی پروڈکٹ', en: 'New Product', kind: 'product', book: '', perm: 'products.read' },
  { label: 'نیا فریق', en: 'New Party', kind: 'party', book: '', perm: 'parties.read' },
] as const;

function TopBar({ title }: { title: string }) {
  const { lang, setLang, online, pending, conflicts, syncing, syncNow, session, logout, t } = useApp();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const pin = usePinState();
  const nav = useNavigate();
  const loc = useLocation();
  const canGoBack = loc.pathname !== '/erp';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const state = !online ? (lang === 'ur' ? 'آف لائن' : 'Offline') : conflicts ? (lang === 'ur' ? `${conflicts} تضاد` : `${conflicts} conflicts`) : syncing ? (lang === 'ur' ? 'سنک ہو رہا ہے' : 'Syncing...') : pending ? (lang === 'ur' ? `${pending} باقی` : `${pending} pending`) : (lang === 'ur' ? 'سنک شدہ' : 'Synced');
  return <>
    <header className="erp-topbar">
      {canGoBack && (
        <button
          type="button"
          className="btn btn-ghost btn-sm no-print erp-back-btn"
          onClick={() => nav(-1)}
          aria-label={lang === 'ur' ? 'پیچھے جائیں' : 'Go back'}
          title={lang === 'ur' ? 'پیچھے جائیں' : 'Back'}
        >
          <span className="back-arrow" aria-hidden="true">{lang === 'ur' ? '›' : '‹'}</span>
          <span className="back-text">{lang === 'ur' ? 'واپس' : 'Back'}</span>
        </button>
      )}
      <Link to="/" className="brand" style={{ display: 'flex', gap: 8, alignItems: 'center' }} aria-label={lang === 'ur' ? 'عوامی ویب سائٹ' : 'Public Website'}>
        <img src="/icons/icon-192.png" alt="" width={32} height={32} style={{ borderRadius: 6 }} />
      </Link>
      <div className="title">{title}</div>
      <Link to="/erp/create" className="btn btn-primary btn-sm no-print" style={{ marginInline: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }} aria-label={lang === 'ur' ? 'نیا واؤچر / انوائس' : 'New Voucher / Invoice'} title={lang === 'ur' ? 'نیا واؤچر / انوائس' : 'New Voucher / Invoice'}>
        <Mark kind="plus" /> <span className="topbar-btn-text">{lang === 'ur' ? 'نیا واؤچر' : '+ Create'}</span>
      </Link>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setSearch(true)} aria-label={lang === 'ur' ? 'تلاش' : 'Search'}><Mark kind="search" /></button>
      <button className={`chip ${online ? (conflicts ? 'danger' : 'success') : 'warning'}`} onClick={() => nav('/erp/sync')}
        title="Sync Centre" style={{ cursor: 'pointer', border: 'none' }}>{state}</button>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => void syncNow()} aria-label={lang === 'ur' ? 'ابھی سنک کریں' : 'Sync Now'}><Mark kind="sync" /></button>
      {pin.enabled && pin.unlocked && <button className="btn btn-ghost btn-sm no-print" onClick={() => { lockPin(); }} title={lang === 'ur' ? 'آف لائن کیش مقفل کریں' : 'Lock Offline Cache'} aria-label={lang === 'ur' ? 'کیش مقفل کریں' : 'Lock Cache'}><Mark kind="lock" /></button>}
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')}>{lang === 'ur' ? 'EN' : 'UR'}</button>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setMenu(!menu)} aria-label={lang === 'ur' ? 'صارف مینو' : 'User Menu'}><Mark kind="user" /></button>
    </header>
    {menu && <div className="card" style={{ position: 'fixed', insetInlineEnd: 8, top: 58, zIndex: 45, minWidth: 210 }}>
      <div className="small">{session?.user.name}</div>
      <div className="small">{session?.user.roles.join(', ')}</div>
      <Link className="btn btn-ghost btn-sm btn-block" to="/erp/settings">{lang === 'ur' ? 'ترتیبات' : 'Settings'}</Link>
      <Link className="btn btn-ghost btn-sm btn-block" to="/erp/status">{lang === 'ur' ? 'سسٹم کی حالت' : 'System Status'}</Link>
      <button className="btn btn-ghost btn-sm btn-block" onClick={() => void logout()}>{lang === 'ur' ? 'لاگ آؤٹ' : 'Logout'}</button>
    </div>}
    <Sheet open={search} onClose={() => setSearch(false)} title={lang === 'ur' ? 'عالمی تلاش (Ctrl+K)' : 'Global Search (Ctrl+K)'}>
      <TextField label={lang === 'ur' ? 'تلاش' : 'Search'} value="" onChange={() => {}} placeholder={lang === 'ur' ? 'مصنوعات، فریق، دستاویز…' : 'Products, parties, documents...'} />
      <div className="link-list"><Link to="/erp/products" onClick={() => setSearch(false)}>{lang === 'ur' ? 'مصنوعات' : 'Products'}</Link>
        <Link to="/erp/parties" onClick={() => setSearch(false)}>{lang === 'ur' ? 'فریق' : 'Parties'}</Link>
        <Link to="/erp/documents" onClick={() => setSearch(false)}>{lang === 'ur' ? 'دستاویزات' : 'Documents'}</Link></div>
      <div className="notice info small">عالمی سرچ انڈیکس INCOMPLETE — اوپر کے روابط کام کرتے ہیں۔</div>
    </Sheet>
  </>;
}

function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { can, lang } = useApp();
  const tiles = QUICK_TILES.filter((x) => can(x.perm));
  const go = (k: string, book: string) => {
    onClose();
    if (k === 'purchase' || k === 'sale') nav(`/erp/${book === 'FERT' ? 'fertilizer' : 'pesticide'}/${k}/new?quick=1`);
    else if (k === 'grain') nav('/erp/grains');
    else if (k === 'receipt') nav('/erp/receipts/new');
    else if (k === 'payment') nav('/erp/payments/new');
    else if (k === 'payroll') nav('/erp/employees');
    else if (k === 'transfer') nav('/erp/accounts/transfer');
    else if (k === 'product') nav('/erp/products/new');
    else if (k === 'party') nav('/erp/parties/new');
    else nav('/erp/expenses/new');
  };
  return <Sheet open={open} onClose={onClose} title={lang === 'ur' ? 'نیا اندراج / تیز اندراج' : 'Quick / New Entry'}>
    <div className="quick-grid">{tiles.map((x) => <button key={x.label} className="tile" onClick={() => go(x.kind, x.book)}>
      <span className="ico"><Mark kind="plus" /></span><strong>{lang === 'ur' ? x.label : x.en}</strong></button>)}</div>
    {!tiles.length && <div className="notice small">اس صارف کے پاس اندراج پوسٹ کرنے کی اجازت نہیں — ڈیش بورڈ سے رپورٹس دیکھیں۔</div>}
    <div className="notice small" style={{ marginBlockStart: 12 }}>تیز اندراج: نام، تعداد، رقم اور نقد/ادھار — باقی تفصیلات اختیاری۔</div>
  </Sheet>;
}

function Sidebar() {
  const { can, lang } = useApp();
  return <aside className="sidebar" aria-label={lang === 'ur' ? 'ERP روابط' : 'ERP Navigation'}>
    {navGroups(can).map((g) => <React.Fragment key={g.group}>
      <div className="group">{lang === 'ur' ? g.group : (g.group_en || g.group)}</div>
      {g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/erp'} className={({ isActive }) => isActive ? 'active' : ''} title={lang === 'ur' ? i.ur : (i.en || i.ur)}>
        <NavIcon icon={i.icon} label={lang === 'ur' ? i.ur : (i.en || i.ur)} size={26} /><span className="label">{lang === 'ur' ? i.ur : (i.en || i.ur)}</span>
      </NavLink>)}
    </React.Fragment>)}
  </aside>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const [quick, setQuick] = useState(false);
  const loc = useLocation();
  const { can, lang } = useApp();
  const title = useMemo(() => {
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        if (loc.pathname === i.to || (i.to !== '/erp' && loc.pathname.startsWith(i.to))) {
          return lang === 'ur' ? i.ur : (i.en || i.ur);
        }
      }
    }
    if (loc.pathname.includes('/new') || loc.pathname.includes('/import')) {
      return lang === 'ur' ? 'نیا اندراج' : 'New Entry';
    }
    return lang === 'ur' ? 'ڈیش بورڈ' : 'Dashboard';
  }, [loc.pathname, lang]);
  return <div className="erp-shell">
    <div className="erp-main">
      <TopBar title={title} /><OfflineBanner />
      <main className="erp-content" id="main">{children}</main>
      <nav className="erp-bottom-nav" aria-label={lang === 'ur' ? 'نیچے والی نیویگیشن' : 'Bottom Navigation'}>
        {BOTTOM_NAV.filter((i) => !i.perm || can(i.perm)).map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/erp'} className={({ isActive }) => isActive ? 'active' : ''}>
          {i.icon === 'menu' ? <span className="ico"><Mark kind="menu" /></span> : <NavIcon icon={i.icon} label={lang === 'ur' ? i.ur : (i.en || i.ur)} size={30} />}
          <span>{lang === 'ur' ? i.ur : (i.en || i.ur)}</span></NavLink>)}
      </nav>
      {QUICK_TILES.some((x) => can(x.perm)) && <button className="fab" onClick={() => setQuick(true)} aria-label={lang === 'ur' ? 'نیا اندراج' : 'New Entry'}>+</button>}
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
        <img className="login-mark" src="/brand/logo-96.webp" alt="ذیشان ٹریڈرز کا نشان" width={64} height={64} />
        <h1 className="h-nastaliq">ذیشان ٹریڈرز</h1>
        <p className="login-tag">کھاد، اجناس اور کھاتہ — مقصود چوک، ضلع لیہ</p>
      </Reveal>
    </div>
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <img src={IMAGES['about/about-shop'].md} alt="" width={52} height={52} />
        <span><strong>کھاتہ (ERP)</strong><small className="small">Zeeshan Traders · Ledger</small></span>
      </div>
      <h2>خوش آمدید</h2>
      <TextField label={t('username')} value={username} onChange={setUsername} required autoComplete="username" />
      <TextField label={t('password')} value={password} onChange={setPassword} type={show ? 'text' : 'password'} required autoComplete="current-password" />
      <CheckField label="پاس ورڈ دکھائیں" checked={show} onChange={setShow} />
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <Button type="submit" loading={busy} className="btn-block">لاگ ان</Button>
      {passkeysSupported() && <>
        <div className="login-split" aria-hidden="true"><span>یا</span></div>
        <Button type="button" variant="secondary" className="btn-block" loading={pkBusy}
          onClick={async () => {
            setPkBusy(true); setErr('');
            try { await loginWithPasskey(); await reloadSession(); nav('/erp'); }
            catch (e: any) { setErr(e.message_ur ?? String(e)); }
            finally { setPkBusy(false); }
          }}><Mark kind="key" /> فنگر پرنٹ سے لاگ ان</Button>
        <p className="login-note">بائو میٹرک اسی ڈیوائس پر رہتا ہے — سرور تک کچھ نہیں جاتا۔</p>
      </>}
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
  const { can, lang } = useApp();
  return <div><h1>{lang === 'ur' ? 'مزید' : 'More'}</h1><div className="link-list">
    {navGroups(can).flatMap((g) => g.items).map((i) => <Link key={i.to} to={i.to}>
      <NavIcon icon={i.icon} label={lang === 'ur' ? i.ur : (i.en || i.ur)} size={22} /> {lang === 'ur' ? i.ur : (i.en || i.ur)} <span className="small">({lang === 'ur' ? i.en : i.ur})</span>
    </Link>)}
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
    <Route path="create" element={<UniversalCreateScreen />} />
    <Route path="invoices/new" element={<UniversalCreateScreen />} />
    <Route path="more" element={<MoreScreen />} />
    <Route path="sales" element={<GenericList config={LIST_CONFIG.sales} />} />
    <Route path="sales/new" element={<DocumentForm kind="sale" book="FERT" />} />
    <Route path="purchases" element={<GenericList config={LIST_CONFIG.purchases} />} />
    <Route path="purchases/new" element={<DocumentForm kind="purchase" book="FERT" />} />
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
  const { can, t, lang } = useApp();
  if (!can('grains.read')) return <div className="permission"><Mark kind="ban" /> {t('permissionDenied')}</div>;
  return <div><h1 className="head-icon"><NavIcon icon="grains" label={lang === 'ur' ? 'اجناس' : 'Grains'} size={34} />{lang === 'ur' ? 'اجناس — سات الگ ماڈیول' : 'Grains — Seven Modules'}</h1>
    <div className="module-grid">{BOOKS.filter((b) => b.kind === 'grain').map((b) =>
      <Link key={b.code} className="module-tile" to={`/erp/grains/${b.code}`}>
        <NavIcon icon={b.code} label={lang === 'ur' ? b.ur : (b.en || b.ur)} size={40} /><strong>{lang === 'ur' ? b.ur : (b.en || b.ur)}</strong><span className="small">{lang === 'ur' ? b.en : b.ur}</span></Link>)}</div></div>;
}

export const LIST_CONFIG: Record<string, any> = {
  sales: { title: 'فروخت', title_en: 'Sales', endpoint: '/api/v1/sales', columns: [
    { key: 'number', label: 'نمبر', label_en: 'Number' }, { key: 'date', label: 'تاریخ', label_en: 'Date' }, { key: 'book_code', label: 'کھاتہ', label_en: 'Ledger' },
    { key: 'total_paisa', label: 'کل', label_en: 'Total', money: true }, { key: 'due_paisa', label: 'بقایا', label_en: 'Due', money: true },
    { key: 'status', label: 'حالت', label_en: 'Status' }], detail: (r: any) => `/erp/documents?type=SALE&q=${r.number}`,
    actions: [
      { label: '+ نئی فروخت', label_en: '+ New Sale', to: '/erp/sales/new' },
      { label: '+ کھاد فروخت', label_en: '+ Fertilizer Sale', to: '/erp/fertilizer/sale/new' },
      { label: '+ پیسٹی فروخت', label_en: '+ Pesticide Sale', to: '/erp/pesticide/sale/new' },
    ] },
  purchases: { title: 'خرید', title_en: 'Purchases', endpoint: '/api/v1/purchases', columns: [
    { key: 'number', label: 'نمبر', label_en: 'Number' }, { key: 'date', label: 'تاریخ', label_en: 'Date' }, { key: 'book_code', label: 'کھاتہ', label_en: 'Ledger' },
    { key: 'total_paisa', label: 'کل', label_en: 'Total', money: true }, { key: 'due_paisa', label: 'بقایا', label_en: 'Due', money: true }], detail: (r: any) => `/erp/documents?type=PURCHASE&q=${r.number}`,
    actions: [
      { label: '+ نئی خرید', label_en: '+ New Purchase', to: '/erp/purchases/new' },
      { label: '+ کھاد خرید', label_en: '+ Fertilizer Purchase', to: '/erp/fertilizer/purchase/new' },
      { label: '+ پیسٹی خرید', label_en: '+ Pesticide Purchase', to: '/erp/pesticide/purchase/new' },
    ] },
  products: { title: 'مصنوعات', title_en: 'Products', endpoint: '/api/v1/products', columns: [
    { key: 'name_ur', label: 'نام', label_en: 'Name' }, { key: 'sku', label: 'SKU', label_en: 'SKU' }, { key: 'category_ur', label: 'زمرہ', label_en: 'Category' },
    { key: 'stock_milli', label: 'اسٹاک', label_en: 'Stock', qty: true }, { key: 'sale_rate_paisa', label: 'ریٹ', label_en: 'Rate', money: true },
    { key: 'is_published', label: 'ویب', label_en: 'Web' }], detail: (r: any) => `/erp/products/${r.id}`,
    actions: [{ label: '+ نئی مصنوعات', label_en: '+ New Product', to: '/erp/products/new' }, { label: 'CSV درآمد', label_en: 'Import CSV', to: '/erp/products/import' }] },
  parties: { title: 'فریق', title_en: 'Parties', endpoint: '/api/v1/parties', columns: [
    { key: 'name_ur', label: 'نام', label_en: 'Name' }, { key: 'phone', label: 'موبائل', label_en: 'Phone' }, { key: 'type', label: 'قسم', label_en: 'Type' },
    { key: 'balance_paisa', label: 'بیلنس', label_en: 'Balance', money: true }], detail: (r: any) => `/erp/parties/${r.id}`,
    actions: [{ label: '+ نیا فریق', label_en: '+ New Party', to: '/erp/parties/new' }] },
  expenses: { title: 'اخراجات', title_en: 'Expenses', endpoint: '/api/v1/expenses', columns: [
    { key: 'number', label: 'نمبر', label_en: 'Number' }, { key: 'date', label: 'تاریخ', label_en: 'Date' }, { key: 'category_ur', label: 'زمرہ', label_en: 'Category' },
    { key: 'amount_paisa', label: 'رقم', label_en: 'Amount', money: true }, { key: 'vendor', label: 'وینڈر', label_en: 'Vendor' }],
    actions: [{ label: '+ نیا خرچہ', label_en: '+ New Expense', to: '/erp/expenses/new' }] },
  categories: { title: 'زمرے', title_en: 'Categories', endpoint: '/api/v1/categories', columns: [
    { key: 'name_ur', label: 'نام', label_en: 'Name' }, { key: 'code', label: 'کوڈ', label_en: 'Code' }, { key: 'slug', label: 'Slug', label_en: 'Slug' },
    { key: 'book_code', label: 'کھاتہ', label_en: 'Ledger' }, { key: 'is_active', label: 'فعال', label_en: 'Active' }],
    create: { endpoint: '/api/v1/categories', slugFromName: true, fields: [
      { name: 'name_ur', label: 'نام (اردو)' }, { name: 'name_en', label: 'English' },
      { name: 'code', label: 'کوڈ' }, { name: 'sort', label: 'ترتیب', type: 'number' }] } },
  brands: { title: 'برانڈز', title_en: 'Brands', endpoint: '/api/v1/brands', columns: [
    { key: 'name_ur', label: 'نام', label_en: 'Name' }, { key: 'name_en', label: 'English', label_en: 'English' }, { key: 'is_active', label: 'فعال', label_en: 'Active' }],
    create: { endpoint: '/api/v1/brands', fields: [
      { name: 'name_ur', label: 'نام (اردو)' }, { name: 'name_en', label: 'English' }] } },
  units: { title: 'یونٹ کنورژن', title_en: 'Unit Conversions', endpoint: '/api/v1/units', columns: [
    { key: 'from_unit', label: 'سے', label_en: 'From' }, { key: 'to_unit', label: 'تک', label_en: 'To' }, { key: 'ratio_milli', label: 'تناسب', label_en: 'Ratio', qty: true },
    { key: 'confirmed', label: 'تصدیق', label_en: 'Confirmed' }],
    create: { endpoint: '/api/v1/units', extra: { confirmed: true }, fields: [
      { name: 'from_unit', label: 'سے' }, { name: 'to_unit', label: 'تک' },
      { name: 'ratio_milli', label: 'تناسب (1000 = 1:1)', type: 'number' }] } },
};

export const FORM_CONFIG: Record<string, any> = {
  party: { title: 'نیا فریق', title_en: 'New Party', endpoint: '/api/v1/parties', back: '/erp/parties', fields: [
    { name: 'name_ur', label: 'نام', label_en: 'Name', type: 'text', required: true },
    { name: 'phone', label: 'موبائل', label_en: 'Phone', type: 'text' }, { name: 'village', label: 'گاؤں / پتہ', label_en: 'Address / Village', type: 'text' },
    { name: 'type', label: 'قسم', label_en: 'Type', type: 'select', options: [
      { value: 'CUSTOMER', label: 'گاہک', label_en: 'Customer' }, { value: 'SUPPLIER', label: 'سپلائر', label_en: 'Supplier' },
      { value: 'FARMER', label: 'کاشتکار', label_en: 'Farmer' }, { value: 'EMPLOYEE', label: 'ملازم', label_en: 'Employee' }], required: true },
    { name: 'opening_balance_paisa', label: 'ابتدائی بیلنس', label_en: 'Opening Balance', type: 'money' },
    { name: 'opening_direction', label: 'سمت', label_en: 'Direction', type: 'select', options: [
      { value: 'RECEIVABLE', label: 'وہ ہمیں دیں گے', label_en: 'Receivable' }, { value: 'PAYABLE', label: 'ہم نے دینے ہیں', label_en: 'Payable' }] },
    { name: 'credit_limit_paisa', label: 'کریڈٹ حد', label_en: 'Credit Limit', type: 'money' },
    { name: 'notes', label: 'نوٹ', label_en: 'Notes', type: 'textarea' },
  ] },
  receipt: { title: 'رقم وصول', title_en: 'Receive Money', endpoint: '/api/v1/receipts', back: '/erp/khata', offline: true, fields: [
    { name: 'date', label: 'تاریخ', label_en: 'Date', type: 'date', required: true },
    { name: 'party_id', label: 'گاہک', label_en: 'Customer', type: 'party', required: true },
    { name: 'amount_paisa', label: 'رقم', label_en: 'Amount', type: 'money', required: true },
    { name: 'account_id', label: 'اکاؤنٹ', label_en: 'Account', type: 'account', required: true },
    { name: 'reference', label: 'حوالہ / TID', label_en: 'Reference / TID', type: 'text' },
    { name: 'allocate', label: 'الاٹمنٹ', label_en: 'Allocation', type: 'select', options: [
      { value: 'AUTO', label: 'خودکار (پرانا پہلے)', label_en: 'Auto' }, { value: 'ADVANCE', label: 'ایڈوانس', label_en: 'Advance' }, { value: 'MANUAL', label: 'دستی', label_en: 'Manual' }] },
    { name: 'note', label: 'نوٹ', label_en: 'Note', type: 'textarea' },
  ] },
  payment: { title: 'رقم ادا', title_en: 'Pay Money', endpoint: '/api/v1/payments', back: '/erp/khata', offline: true, fields: [
    { name: 'date', label: 'تاریخ', label_en: 'Date', type: 'date', required: true },
    { name: 'party_id', label: 'فریق', label_en: 'Party', type: 'party', required: true },
    { name: 'amount_paisa', label: 'رقم', label_en: 'Amount', type: 'money', required: true },
    { name: 'account_id', label: 'اکاؤنٹ', label_en: 'Account', type: 'account', required: true },
    { name: 'payee_type', label: 'قسم', label_en: 'Type', type: 'select', options: [
      { value: 'SUPPLIER', label: 'سپلائر', label_en: 'Supplier' }, { value: 'FARMER', label: 'کاشتکار', label_en: 'Farmer' },
      { value: 'EMPLOYEE', label: 'ملازم', label_en: 'Employee' }, { value: 'CUSTOMER', label: 'گاہک', label_en: 'Customer' }] },
    { name: 'reference', label: 'حوالہ', label_en: 'Reference', type: 'text' }, { name: 'note', label: 'نوٹ', label_en: 'Note', type: 'textarea' },
  ] },
  transfer: { title: 'رقم منتقلی', title_en: 'Transfer Money', endpoint: '/api/v1/transfers', back: '/erp/accounts', fields: [
    { name: 'date', label: 'تاریخ', label_en: 'Date', type: 'date', required: true },
    { name: 'from_account_id', label: 'سے', label_en: 'From', type: 'account', required: true },
    { name: 'to_account_id', label: 'تک', label_en: 'To', type: 'account', required: true },
    { name: 'amount_paisa', label: 'رقم', label_en: 'Amount', type: 'money', required: true },
    { name: 'note', label: 'نوٹ', label_en: 'Note', type: 'text' },
  ] },
  expense: { title: 'خرچہ', title_en: 'Expense', endpoint: '/api/v1/expenses', back: '/erp/expenses', offline: true, fields: [
    { name: 'date', label: 'تاریخ', label_en: 'Date', type: 'date', required: true },
    { name: 'category_code', label: 'زمرہ', label_en: 'Category', type: 'expenseCategory', required: true },
    { name: 'vendor', label: 'وینڈر', label_en: 'Vendor', type: 'text' },
    { name: 'amount_paisa', label: 'رقم', label_en: 'Amount', type: 'money', required: true },
    { name: 'account_id', label: 'ادا از', label_en: 'Paid From', type: 'account', required: true },
    { name: 'note', label: 'نوٹ', label_en: 'Note', type: 'textarea' },
  ] },
  employee: { title: 'ملازم', title_en: 'Employee', endpoint: '/api/v1/employees', back: '/erp/employees', fields: [
    { name: 'name', label: 'نام', label_en: 'Name', type: 'text', required: true },
    { name: 'role', label: 'عہدہ', label_en: 'Designation / Role', type: 'text' },
    { name: 'phone', label: 'موبائل', label_en: 'Mobile / Phone', type: 'text' },
    { name: 'join_date', label: 'تاریخِ ملازمت', label_en: 'Joining Date', type: 'date', required: true },
    { name: 'base_salary_paisa', label: 'تنخواہ', label_en: 'Base Salary', type: 'money' },
  ] },
};
