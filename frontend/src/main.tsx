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
      <header className="border-b bg-white"><div className="mx-auto max-w-7xl px-4 py-3"><Link to="/" className="font-bold text-indigo-700">RFQ · British Auction</Link></div></header>
      <main className="mx-auto max-w-7xl p-4">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/new" element={<CreatePage />} />
          <Route path="/rfq/:id" element={<DetailsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  </React.StrictMode>,
);
