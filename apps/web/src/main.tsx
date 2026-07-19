import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@flux/shared-ui/components/theme-provider';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="flux-ui-theme">
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
