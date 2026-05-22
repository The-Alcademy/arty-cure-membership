import React from 'react';
import { createRoot } from 'react-dom/client';
import ManagePage from './pages/manage';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ManagePage />
  </React.StrictMode>,
);
