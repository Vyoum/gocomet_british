import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './index.css';
import ListPage from './pages/ListPage';
import CreatePage from './pages/CreatePage';
import DetailsPage from './pages/DetailsPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center px-4"><Link to="/" className="inline-flex min-h-[48px] items-center font-bold text-indigo-700">RFQ · British Auction</Link></div></header>
      <main className="mx-auto max-w-7xl p-3 sm:p-4">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/new" element={<CreatePage />} />
          <Route path="/rfq/:id" element={<DetailsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  </React.StrictMode>,
);

// Print/PDF: expand collapsed <details> so all data is printed, restore afterwards.
let openedForPrint: HTMLDetailsElement[] = [];
window.addEventListener('beforeprint', () => {
  openedForPrint = Array.from(document.querySelectorAll('details:not([open])')) as HTMLDetailsElement[];
  openedForPrint.forEach((d) => (d.open = true));
});
window.addEventListener('afterprint', () => { openedForPrint.forEach((d) => (d.open = false)); openedForPrint = []; });
