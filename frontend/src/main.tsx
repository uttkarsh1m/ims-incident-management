import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { IncidentDetail } from './pages/IncidentDetail';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/incidents/:id" element={<IncidentDetail />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
