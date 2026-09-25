import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProvedorDeSessao } from './shared/hooks/useSessao';
import { registrarServiceWorker } from './shared/pwa';
import './reset.scss';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento #root não encontrado no index.html');

registrarServiceWorker();

createRoot(raiz).render(
  <StrictMode>
    <ProvedorDeSessao>
      <App />
    </ProvedorDeSessao>
  </StrictMode>,
);
