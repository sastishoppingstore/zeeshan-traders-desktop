import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from './app-state.js';
import { PublicApp } from './public.js';
import { ToastHost } from './components.js';
import { InstallPrompt } from './ui/install.js';
import './styles.css';

/** The ERP (screens, forms, print templates) is a separate chunk: a customer browsing the shop
 *  never downloads or parses the back office. */
const ErpApp = lazy(() => import('./erp.js').then((m) => ({ default: m.ErpApp })));

function ErpLoading() {
  const { t, lang } = useApp();
  return <div className="route-loading" role="status" aria-live="polite" lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
    <div className="route-loading-bar" />
    <span>{t('erpLoading')}</span>
  </div>;
}

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } });

function Root() {
  return <QueryClientProvider client={qc}>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/erp/*" element={<Suspense fallback={<ErpLoading />}><ErpApp /></Suspense>} />
          <Route path="*" element={<PublicApp />} />
        </Routes>
        <ToastHost />
        <InstallPrompt />
      </AppProvider>
    </BrowserRouter>
  </QueryClientProvider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>);
