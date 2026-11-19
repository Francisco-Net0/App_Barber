import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShop, DN, t5, R, waLink, clearBookingDraft } from '../lib';
import { useAuth } from '../auth';
import Icon from '../Icon';

const STEPS = [
  ['Escolha o serviço', 'Corte, barba ou combo: selecione o que você precisa e o profissional.'],
  ['Marque dia e horário', 'Veja somente os horários realmente livres, em tempo real.'],
  ['Confirme e pronto', 'Receba a confirmação e gerencie tudo na sua conta.'],
];

const prefetchBook = () => import('./Book');

export default function Home() {
  const { loading, error, shop, hours, services, reload } = useShop({ loadAvailability: false, loadBarbers: false });
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return undefined;
    const esc = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [menu]);
  useEffect(() => {
    if (shop?.name) document.title = `${shop.name} — Agende seu horário`;
    return () => { document.title = 'Agendamento online para barbearia'; };
  }, [shop?.name]);

  if (error) return <main className="hm-in hm-sec"><p role="alert">Não foi possível carregar a barbearia. Tente de novo em instantes.</p><button className="btn" onClick={reload}>Tentar novamente</button></main>;
  if (loading) return <main className="hm-in hm-sec" role="status" aria-label="Carregando"><div className="hm-grid"><div className="hm-skel" /><div className="hm-skel" /><div className="hm-skel" /></div></main>;

  const name = shop.name || 'Barbearia';
  const book = <Link className="btn" to="/agendar" onPointerEnter={prefetchBook} onFocus={prefetchBook} onClick={clearBookingDraft}>Agendar horário <Icon name="arrowRight" /></Link>;

  return (
    <>
      <a className="skip" href="#topo">Pular para o conteúdo</a>
      <header className="hm-head">
        <div className="hm-in">
          <a className="hm-brand" href="#topo"><img className="brand-logo" src="/barberia-logo.svg" alt="" />{name}</a>
          <nav id="hm-nav" className={`hm-nav${menu ? ' open' : ''}`} aria-label="Seções" onClick={() => setMenu(false)}>
            <a href="#servicos">Serviços</a><a href="#como-funciona">Como funciona</a><a href="#horarios">Horários</a><a href="#contato">Contato</a>
          </nav>
          <button type="button" className="hm-burger" aria-label="Menu" aria-expanded={menu} aria-controls="hm-nav" onClick={() => setMenu(!menu)}><span /><span /><span /></button>
          <Link className="profile-menu-trigger" to={user ? '/cliente' : '/login'} aria-label="Minha conta" title="Minha conta"><Icon name="user" size={20} /></Link>
        </div>
      </header>

      <main id="topo">
        <section className="hm-hero">
          <div className="hm-in">
            <p className="eyebrow">Barbearia · Cuidado em cada detalhe</p>
            <h1>Seu melhor <em>visual</em>, na hora certa.</h1>
            <p className="lead">{shop.about || 'Corte, barba e atendimento sob medida. Escolha o serviço, o dia e o horário em poucos toques.'}</p>
            <div className="hm-actions">
              {book}
              <a className="btn ghost" href="#servicos">Ver serviços e preços</a>
            </div>
          </div>
        </section>

        <div className="hm-strip">
          <div className="hm-in">
            <span><Icon name="calendar" /> Agendamento online 24h</span>
            <span><Icon name="clock" /> Horários em tempo real</span>
            <span><Icon name="check" /> Confirmação imediata</span>
          </div>
        </div>

        <section className="hm-sec" id="servicos" aria-labelledby="servicos-t">
          <div className="hm-in">
            <p className="eyebrow">Serviços</p>
            <h2 id="servicos-t">Escolha seu cuidado</h2>
            <p className="sub">Preços transparentes e duração estimada para você planejar o seu dia.</p>
            {services.length ? <div className="hm-grid">
              {services.map((s) => (
                <article className="hm-svc" key={s.id}>
                  <div><h3>{s.name}</h3>{s.description && <p>{s.description}</p>}</div>
                  <div className="hm-price"><b>{R(s.price)}</b><span>{s.duration} min</span></div>
                </article>
              ))}
            </div> : <p className="sub">Os serviços estarão disponíveis em breve.</p>}
          </div>
        </section>

        <section className="hm-sec alt" id="como-funciona" aria-labelledby="como-t">
          <div className="hm-in">
            <p className="eyebrow">Passo a passo</p>
            <h2 id="como-t">Agendar é simples</h2>
            <p className="sub">Em menos de um minuto o seu horário está garantido.</p>
            <div className="hm-steps">
              {STEPS.map(([t, d]) => <div className="hm-step" key={t}><h3>{t}</h3><p>{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="hm-sec" id="horarios" aria-label="Horários e contato">
          <div className="hm-in hm-two">
            <div className="hm-box">
              <p className="eyebrow">Funcionamento</p><h2>Horários</h2>
              {hours.length ? hours.slice().sort((a, b) => a.weekday - b.weekday).map((h) => (
                <div className="hours-row" key={h.weekday}>
                  <b>{DN[h.weekday][0].toUpperCase() + DN[h.weekday].slice(1)}</b>
                  <span>{h.open ? `${t5(h.open_time)} às ${t5(h.close_time)}${h.lunch_start ? ` · intervalo ${t5(h.lunch_start)}–${t5(h.lunch_end)}` : ''}` : 'Fechado'}</span>
                </div>
              )) : <p className="mut">Horários em breve.</p>}
            </div>
            <div className="hm-box" id="contato">
              <p className="eyebrow">Contato</p><h2>Visite a barbearia</h2>
              {shop.address ? <>
                <p>{shop.address}</p>
                <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/${encodeURIComponent(shop.address)}`}><Icon name="pin" /> Abrir no mapa</a>
              </> : <p className="mut">Endereço ainda não informado.</p>}
              {(shop.whatsapp || shop.instagram) && <div className="contact-links">
                {shop.whatsapp && <a className="text-link" target="_blank" rel="noopener noreferrer" href={waLink(shop.whatsapp)}><Icon name="whatsapp" /> WhatsApp <Icon name="external" size={15} /></a>}
                {shop.instagram && <a className="text-link" target="_blank" rel="noopener noreferrer" href={`https://instagram.com/${encodeURIComponent(shop.instagram)}`}><Icon name="instagram" /> Instagram <Icon name="external" size={15} /></a>}
              </div>}
              {shop.phone && <p className="mut">{shop.phone}</p>}
            </div>
          </div>
        </section>

        <section className="hm-sec alt hm-cta">
          <div className="hm-in">
            <h2>Pronto para renovar o visual?</h2>
            <p className="sub" style={{ margin: '0 auto 28px' }}>Garanta o seu horário agora mesmo.</p>
            <div className="hm-actions">{book}</div>
          </div>
        </section>
      </main>

      <footer className="hm-foot">
        <div className="hm-in">
          <b>{name}</b>
          <span>© {new Date().getFullYear()} {name}. Todos os direitos reservados.</span>
          <Link to="/cliente">Área do cliente</Link>
        </div>
      </footer>
    </>
  );
}
