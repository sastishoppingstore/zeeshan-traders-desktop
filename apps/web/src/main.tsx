import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from './app-state.js';
import { ToastHost } from './components.js';
import { InstallPrompt } from './ui/install.js';
import { isDesktop } from './desktop.js';
import './styles.css';

/** True only for `npm run build:desktop` / `dev:desktop`; the web build compiles it to `false`.
 *  It has to be a build constant, not just the runtime probe, because deleting the storefront from
 *  the desktop *package* (rather than hiding it at runtime) needs the bundler to fold these reads. */
declare const __ZT_DESKTOP__: boolean;

/** The ERP (screens, forms, print templates) is a separate chunk: a customer browsing the shop
 *  never downloads or parses the back office. */
const ErpApp = lazy(() => import('./erp.js').then((m) => ({ default: m.ErpApp })));
/** Split out for the same reason as the ERP chunk: on desktop there is no storefront to parse.
 *  Written as a conditional on the build constant rather than an unused `lazy()` binding, because
 *  Rollup keeps a bare `lazy(...)` call as a side effect and would ship the catalogue anyway. */
const PublicApp: React.LazyExoticComponent<React.ComponentType> | null =
  __ZT_DESKTOP__ ? null : lazy(() => import('./public.js').then((m) => ({ default: m.PublicApp })));

// Web only: fetch the storefront chunk while the entry still runs, so splitting it out of the
// bundle does not cost the shop a second round trip before its first paint.
if (!__ZT_DESKTOP__ && !isDesktop) void import('./public.js');

function ErpLoading() {
  const { t, lang } = useApp();
  return <div className="route-loading" role="status" aria-live="polite" lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
    <div className="route-loading-bar" />
    <span>{t('erpLoading')}</span>
  </div>;
}

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } });

function WebRoot() {
  return <QueryClientProvider client={qc}>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/erp/*" element={<Suspense fallback={<ErpLoading />}><ErpApp /></Suspense>} />
          {/* The storefront route exists only in the web build; on desktop PublicApp folded to null
              and this route (with its chunk) is gone from the package. No ERP wording in the
              fallback: the warm-up above already put the shop's chunk on the wire. */}
          {PublicApp && <Route path="*" element={<Suspense fallback={null}><PublicApp /></Suspense>} />}
        </Routes>
        <ToastHost />
        <InstallPrompt />
      </AppProvider>
    </BrowserRouter>
  </QueryClientProvider>;
}

/** The desktop app is the ERP and nothing else: no storefront route, no install sheet, no
 *  service worker to register. */
function DesktopRoot() {
  return <QueryClientProvider client={qc}>
    {/* file:// refuses history.pushState to another path, so the route table has to live in the
        hash. The /erp prefix is kept because every ERP link, redirect and nav() uses an absolute
        /erp URL; a bare launch or a stale hash is bounced onto the ERP dashboard. */}
    <HashRouter>
      <AppProvider>
        <Routes>
          <Route path="/erp/*" element={<Suspense fallback={<ErpLoading />}><ErpApp /></Suspense>} />
          <Route path="*" element={<Navigate to="/erp" replace />} />
        </Routes>
        <ToastHost />
      </AppProvider>
    </HashRouter>
  </QueryClientProvider>;
}

function Root() {
  if (__ZT_DESKTOP__) return <DesktopRoot />;
  // A web bundle opened inside Electron's window still has to be ERP-only and hash-routed.
  if (isDesktop) return <DesktopRoot />;
  return <WebRoot />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
