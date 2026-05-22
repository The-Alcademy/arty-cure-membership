import React from 'react';
import { createRoot } from 'react-dom/client';
import WelcomePage from './pages/welcome';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WelcomePage />
  </React.StrictMode>,
);
