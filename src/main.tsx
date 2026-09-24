import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from './api/queries';
import { App } from './ui/App';
import { startMockServer } from './mocks/browser';
import { installTestHooks } from './testing/testHooks';
import './ui/styles.css';

const queryClient = createQueryClient();
installTestHooks(queryClient);

// The mock API is part of the product demo: it runs in dev, tests and the
// published build. Rendering waits for it so the first queries are mocked.
await startMockServer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
