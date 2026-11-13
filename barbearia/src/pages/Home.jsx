import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useShop, DN, t5, R, waLink, clearBookingDraft } from '../lib';
import Icon from '../Icon';

export default function Home() {
  const { loading, error, shop, hours, services, reload } = useShop();
  useEffect(() => {
    if (shop?.name) document.title = `${shop.name} — Agende seu horário`;
    return () => { document.title = 'Agendamento online para barbearia'; };
  }, [shop?.name]);
  if (loading) return <p className="wrap mut" role="status">Carregando informações…</p>;
  if (error) return <main className="wrap"><p role="alert">Não foi possível carregar a barbearia. Tente de novo em instantes.</p><button className="btn" onClick={reload}>Tentar novamente</button></main>;

  return (
    <>
      <div className="pole" />
      <main className="wrap home">
        <header className="top">
          <img className="brand-logo" src="/barberia-logo.svg" alt="" />
          <b className="shop-name">{shop.name || 'Agendamento online'}</b>
          <Link className="text-link account-link" to="/cliente"><Icon name="user" /> Minha conta</Link>
        </header>
        <section className="hero">
          <img className="hero-banner" src="/barberia-hero.svg" alt="Interior elegante de uma barbearia" />
          <div className="hero-copy">
            <p className="eyebrow"><Icon name="sparkles" size={15} /> CUIDADO EM CADA DETALHE</p>
            <h1>Corte, barba e hora marcada.</h1>
            <p className="mut">Escolha o serviço, o dia e o horário. Seu próximo visual começa aqui.</p>
          </div>
        </section>

        {shop.about && <section className="home-section">
          <h2>Um tempo para você.</h2>
          <p className="mut">{shop.about}</p>
        </section>}

        <section className="home-section" aria-labelledby="services-title">
          <div className="section-heading">
            <div><p className="eyebrow">SERVIÇOS</p><h2 id="services-title">Escolha seu cuidado</h2></div>
          </div>
          {services.length ? <div className="service-list">
            {services.map((service) => (
              <article className="service-card" key={service.id}>
                <div className="service-info"><span className="icon-tile"><Icon name="scissors" /></span><div><h3>{service.name}</h3>{service.description && <p className="mut">{service.description}</p>}</div></div>
                <div className="service-price"><b>{R(service.price)}</b><span className="mut">{service.duration} min</span></div>
              </article>
            ))}
          </div> : <p className="mut">Os serviços estarão disponíveis em breve.</p>}
        </section>

        <section className="home-details">
          <div className="card">
            <p className="eyebrow"><Icon name="clock" size={15} /> FUNCIONAMENTO</p><h2>Horários</h2>
            {hours.slice().sort((a, b) => a.weekday - b.weekday).map((h) => (
              <div className="hours-row" key={h.weekday}>
                <b>{DN[h.weekday][0].toUpperCase() + DN[h.weekday].slice(1)}</b>
                <span>{h.open ? `${t5(h.open_time)} às ${t5(h.close_time)}${h.lunch_start ? ` · intervalo ${t5(h.lunch_start)}–${t5(h.lunch_end)}` : ''}` : 'Fechado'}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <p className="eyebrow"><Icon name="pin" size={15} /> ENCONTRE A GENTE</p><h2>Visite a barbearia</h2>
            {shop.address && <>
              <p>{shop.address}</p>
              <a className="btn ghost sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/${encodeURIComponent(shop.address)}`}><Icon name="pin" /> Abrir no mapa</a>
            </>}{!shop.address && <p className="mut">Endereço ainda não informado.</p>}
            {(shop.whatsapp || shop.instagram) && <div className="contact-links">
              {shop.whatsapp && <a className="text-link" target="_blank" rel="noopener noreferrer" href={waLink(shop.whatsapp)}><Icon name="whatsapp" /> WhatsApp <Icon name="external" size={15} /></a>}
              {shop.instagram && <a className="text-link" target="_blank" rel="noopener noreferrer" href={`https://instagram.com/${encodeURIComponent(shop.instagram)}`}><Icon name="instagram" /> Instagram <Icon name="external" size={15} /></a>}
            </div>}
            {shop.phone && <p className="mut">{shop.phone}</p>}
          </div>
        </section>
        <footer className="home-footer"><span>{shop.name}</span><span>Atendimento com hora marcada</span></footer>
      </main>
      <div className="sticky"><div><Link className="btn" to="/agendar" onClick={clearBookingDraft}>Agendar horário <Icon name="arrowRight" /></Link></div></div>
    </>
  );
}
