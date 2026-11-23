import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api';
import App from './App';
import './style.css';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) =>
        !(error instanceof ApiError && error.status < 500) && attempt < 1,
      staleTime: 3000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
