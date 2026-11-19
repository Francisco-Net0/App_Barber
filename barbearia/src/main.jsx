import React, { Component, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/cormorant-garamond/700.css';
import { AuthProvider, RequireAuth } from './auth';
import { supabaseReady } from './supabase';
import './index.css';
import './theme.css';

const Home = lazy(() => import('./pages/Home'));
const Book = lazy(() => import('./pages/Book'));
const Admin = lazy(() => import('./pages/Admin'));
const Auth = lazy(() => import('./pages/Auth'));
const Client = lazy(() => import('./pages/Client'));

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="hm-in hm-sec"><h2>Algo deu errado</h2><p className="mut">Recarregue a página para tentar de novo.</p><button className="btn" onClick={() => window.location.reload()}>Recarregar</button></main>;
  }
}
const NotFound = () => <main className="hm-in hm-sec"><p className="eyebrow">Erro 404</p><h2>Página não encontrada</h2><p className="mut">O endereço que você abriu não existe.</p><Link className="btn" to="/">Voltar ao início</Link></main>;
const Loading = <div className="hm-in hm-sec" role="status" aria-label="Carregando"><div className="hm-skel" /></div>;

createRoot(document.getElementById('root')).render(
  supabaseReady ? (
    <Boundary><BrowserRouter><AuthProvider><Suspense fallback={Loading}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/agendar" element={<Book />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/cliente" element={<RequireAuth><Client /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense></AuthProvider></BrowserRouter></Boundary>
  ) : <main className="hm-in hm-sec"><h2>Configuração pendente</h2><p className="mut">Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja o .env.example).</p></main>
);
