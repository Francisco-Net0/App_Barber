import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useShop, slotsFor, R, addD, br, DN, pad, weekdayFor, waLink, BOOKING_DAYS, clearBookingDraft } from '../lib';
import Icon from '../Icon';

const ERROS = {
  horario_ocupado: 'Esse horário acabou de ser reservado. Escolha outro.',
  horario_passado: 'Esse horário já passou. Escolha outro.',
  horario_indisponivel: 'Escolha um dos horários disponíveis.',
  data_indisponivel: 'Essa data não está mais disponível. Escolha outra.',
  fora_do_expediente: 'Esse horário está fora do expediente.',
  intervalo: 'Esse horário coincide com o intervalo.',
  bloqueado: 'Esse horário não está disponível.',
  dados_invalidos: 'Confira seu nome e WhatsApp.',
  perfil_incompleto: 'Complete seus dados na área do cliente antes de confirmar.',
  servico_invalido: 'Um dos serviços não está mais disponível. Revise sua seleção.',
  barbeiro_invalido: 'Esse barbeiro não está mais disponível. Escolha outro.',
};
const STEPS = ['Serviços e barbeiro', 'Data', 'Horário', 'Seus dados', 'Revisão'];
const readDraft = () => {
  try {
    const saved = localStorage.getItem('booking-draft');
    if (saved) return JSON.parse(saved);
    const previous = sessionStorage.getItem('booking-draft');
    if (!previous) return {};
    localStorage.setItem('booking-draft', previous);
    return JSON.parse(previous);
  } catch { return {}; }
};

export default function Book() {
  const location = useLocation();
  const navigate = useNavigate();
  const shop = useShop();
  const autoConfirmRequested = new URLSearchParams(location.search).get('confirm') === '1';
  const resumeRequested = new URLSearchParams(location.search).get('resume') === '1';
  const [draft] = useState(() => {
    if (!autoConfirmRequested && !resumeRequested) clearBookingDraft();
    return readDraft();
  });
  const [step, setStep] = useState(Number.isInteger(draft.step) && draft.step >= 1 && draft.step <= 5 ? draft.step : 1);
  const [sel, setSel] = useState(Array.isArray(draft.sel) ? draft.sel : []);
  const [barberId, setBarberId] = useState(draft.barberId || '');
  const [date, setDate] = useState(draft.date || '');
  const [calendarMonth, setCalendarMonth] = useState(() => (draft.date || addD(0)).slice(0, 7));
  const [time, setTime] = useState(draft.time || '');
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [notification, setNotification] = useState('pending');
  const autoConfirmAttempted = useRef(false);
  const bookingRef = useRef(false);
  const notificationRef = useRef(false);

  useEffect(() => {
    if (!barberId && shop.barbers?.length) setBarberId(shop.barbers[0].id);
  }, [barberId, shop.barbers]);

  useEffect(() => {
    localStorage.setItem('booking-draft', JSON.stringify({ step, sel, barberId, date, time }));
  }, [step, sel, barberId, date, time]);

  useEffect(() => {
    if (step === 3) shop.reload();
  }, [step, shop.reload]);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return;
      const { data: profile } = await supabase.from('clients').select('name,phone').eq('user_id', data.user.id).maybeSingle();
      if (active && profile) setF({ name: profile.name, phone: profile.phone, email: data.user.email || '' });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const name = shop.shop?.name || 'Agendamento online';
    document.title = done ? `${name} — Agendamento confirmado` : `${name} — Agendar horário`;
  }, [done, shop.shop?.name]);

  useEffect(() => {
    if (!done) return undefined;
    const timeout = window.setTimeout(() => navigate('/cliente', { replace: true }), 30_000);
    return () => window.clearTimeout(timeout);
  }, [done, navigate]);

  useEffect(() => {
    if (!autoConfirmRequested && !resumeRequested) navigate('/agendar?resume=1', { replace: true });
  }, [autoConfirmRequested, navigate, resumeRequested]);

  useEffect(() => {
    if (!autoConfirmRequested || shop.loading || shop.error || step !== 5 || !sel.length || !date || !time || autoConfirmAttempted.current) return;
    autoConfirmAttempted.current = true;
    navigate('/agendar?resume=1', { replace: true });
    confirm();
  }, [autoConfirmRequested, date, navigate, sel.length, shop.error, shop.loading, step, time]);

  if (shop.loading) return <p className="wrap mut" role="status">Carregando horários…</p>;
  if (shop.error) return <main className="wrap"><p role="alert">Não foi possível carregar os horários. Tente de novo.</p><button className="btn" onClick={shop.reload}>Tentar novamente</button></main>;

  const chosen = shop.services.filter((s) => sel.includes(s.id));
  const dur = chosen.reduce((a, s) => a + s.duration, 0);
  const total = chosen.reduce((a, s) => a + Number(s.price), 0);
  const names = chosen.map((s) => s.name).join(' + ');
  const free = (d) => slotsFor(d, dur, shop.hours, shop.blocks, shop.busy, barberId);
  const openDates = Array.from({ length: BOOKING_DAYS + 1 }, (_, i) => addD(i))
    .filter((d) => shop.hours.some((h) => h.weekday === weekdayFor(d) && h.open));
  const availableDates = new Set(openDates.filter((day) => free(day).length > 0));
  const firstDay = `${calendarMonth}-01`;
  const gridStart = new Date(Date.UTC(
    Number(calendarMonth.slice(0, 4)),
    Number(calendarMonth.slice(5, 7)) - 1,
    1 - weekdayFor(firstDay),
  ));
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setUTCDate(gridStart.getUTCDate() + index);
    return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
  });
  const calendarTitle = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${firstDay}T12:00:00Z`));
  const minimumMonth = addD(0).slice(0, 7);
  const maximumMonth = addD(BOOKING_DAYS).slice(0, 7);

  const toggle = (id) => {
    setSel((previous) => previous.includes(id) ? previous.filter((x) => x !== id) : [...previous, id]);
    setDate('');
    setTime('');
    setErr({});
  };

  async function sendNotification(id, token) {
    if (notificationRef.current) return;
    notificationRef.current = true;
    setNotification('sending');
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, token }),
      });
      if (response.ok) {
        setNotification('sent');
      } else if (response.status === 503) {
        setNotification('unconfigured');
      } else {
        setNotification('failed');
      }
    } catch {
      setNotification('failed');
    }
  }

  async function confirm() {
    if (bookingRef.current || !sel.length || !date || !time) return;
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      setErr({ slot: 'Não foi possível verificar seu acesso. Confira sua conexão e tente novamente.' });
      return;
    }
    if (!authData.user) {
      navigate(`/login?returnTo=${encodeURIComponent('/agendar?confirm=1')}`);
      return;
    }

    bookingRef.current = true;
    setBusy(true);
    setErr({});
    try {
      const { data, error } = await supabase.rpc('create_booking', {
        p_service_ids: sel,
        p_day: date,
        p_start: time,
        p_barber_id: barberId,
      });
      if (error) {
        const key = Object.keys(ERROS).find((code) => error.message.includes(code));
        setErr({ slot: ERROS[key] || 'Não foi possível confirmar. Tente novamente.' });
        bookingRef.current = false;
        if (key === 'horario_ocupado' || key === 'horario_passado' || key === 'horario_indisponivel' || key === 'bloqueado' || key === 'intervalo') {
          await shop.reload();
          setTime('');
          setStep(3);
        } else if (key === 'data_indisponivel') {
          await shop.reload();
          setDate('');
          setTime('');
          setStep(2);
        } else if (key === 'servico_invalido') {
          await shop.reload();
          setStep(1);
        }
        return;
      }

      const booking = {
        name: f.name.trim(),
        barber: shop.barbers.find((barber) => String(barber.id) === String(barberId))?.name || 'Barbeiro',
        services: chosen.map((service) => service.name),
        date,
        time,
        total: data.total,
        duration: data.duration,
        id: data.id,
        token: data.token,
      };
      clearBookingDraft();
      setDone(booking);
      await sendNotification(data.id, data.token);
    } catch {
      bookingRef.current = false;
      setErr({ slot: 'Ocorreu um erro ao salvar. Verifique sua conexão e tente novamente.' });
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <>
      <div className="pole" />
      <header className="top wrap booking-header">
        <Link to="/" aria-label="Página inicial" onClick={clearBookingDraft}><img className="brand-logo" src="/barberia-logo.svg" alt="" /></Link>
        <b>{shop.shop.name}</b>
      </header>
    </>
  );
  const goBack = () => {
    setErr({});
    setStep((current) => current - 1);
  };

  if (done) {
    const startMinutes = done.time.split(':').map(Number).reduce((hours, minutes) => hours * 60 + minutes, 0);
    const endMinutes = startMinutes + done.duration;
    const day = done.date.replace(/-/g, '');
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${shop.shop.name} — ${done.services.join(' + ')}`)}&dates=${day}T${done.time.replace(':', '')}00/${day}T${pad(Math.floor(endMinutes / 60))}${pad(endMinutes % 60)}00&ctz=America%2FSao_Paulo&details=${encodeURIComponent(`Agendamento para ${done.name} na ${shop.shop.name}.`)}`;
    const message = notification === 'sent'
      ? 'A confirmação foi enviada pelo WhatsApp.'
      : notification === 'unconfigured'
        ? 'Seu horário está reservado. O envio automático pelo WhatsApp ainda não está configurado.'
        : notification === 'failed'
          ? 'Seu horário está reservado, mas não foi possível confirmar o envio pelo WhatsApp. Entre em contato conosco se precisar.'
          : 'Seu horário está reservado. Estamos verificando o envio da confirmação…';
    return (
      <>{head}<main className="wrap confirmation">
        <div className="step-meta"><span>ETAPA 6 DE 6</span><span>Confirmação</span></div>
        <div className="prog" role="progressbar" aria-label="Progresso do agendamento" aria-valuemin="1" aria-valuemax="6" aria-valuenow="6">
          {[1, 2, 3, 4, 5, 6].map((current) => <i key={current} className="on" />)}
        </div>
        <div className="success-icon" aria-hidden="true"><Icon name="check" size={34} /></div>
        <p className="eyebrow">AGENDAMENTO CONFIRMADO</p>
        <h1>Até breve, {done.name.split(/\s+/)[0]}.</h1>
        <p className="mut" role="status">{message}</p>
        <p className="mut">Você será direcionado para a área do cliente em 30 segundos.</p>
        <section className="card booking-summary">
          <h2>{shop.shop.name}</h2>
          <p><b>Barbeiro</b><br />{done.barber}</p>
          <p><b>Serviços</b><br />{done.services.join(' + ')}</p>
          <p><b>Data e horário</b><br />{br(done.date)} às {done.time}</p>
          <p><b>Valor total</b><br />{R(done.total)} · {done.duration} min</p>
        </section>
        <a className="btn" target="_blank" rel="noopener noreferrer" href={calendarUrl}><Icon name="calendar" /> Adicionar ao calendário</a>
        {shop.shop.whatsapp
          ? <a className="btn ghost confirmation-action" target="_blank" rel="noopener noreferrer" href={waLink(shop.shop.whatsapp)}><Icon name="whatsapp" /> Falar pelo WhatsApp</a>
          : <p className="mut">O contato pelo WhatsApp ainda não está configurado.</p>}
        <Link className="text-link confirmation-home" to="/">Voltar à página inicial</Link>
      </main></>
    );
  }

  return (
    <>{head}
      <main className="wrap booking">
        <div className="step-meta"><span>ETAPA {step} DE 5</span><span>{STEPS[step - 1]}</span></div>
        <div className="prog" role="progressbar" aria-label="Progresso do agendamento" aria-valuemin="1" aria-valuemax="5" aria-valuenow={step}>
          {[1, 2, 3, 4, 5].map((current) => <i key={current} className={current <= step ? 'on' : ''} />)}
        </div>
        {err.slot && <div className="err" role="alert">{err.slot}</div>}
        {step === 1 && <>
          <h1 className="booking-title"><Icon name="scissors" size={27} /> Escolha o barbeiro e os serviços</h1>
          <label htmlFor="booking-barber">Barbeiro</label>
          <select id="booking-barber" value={barberId} onChange={(event) => { setBarberId(event.target.value); setDate(''); setTime(''); }}>
            {!shop.barbers.length && <option value="">Nenhum barbeiro disponível</option>}
            {shop.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
          </select>
          <p className="mut">Você pode selecionar mais de um serviço.</p>
          {shop.services.map((service) => (
            <button type="button" key={service.id} className={`sv ${sel.includes(service.id) ? 'on' : ''}`} aria-pressed={sel.includes(service.id)} onClick={() => toggle(service.id)}>
              <span className="row"><b>{service.name}</b><b className="gold">{R(service.price)}</b></span>
              <span className="mut service-description">{service.description}</span>
              <span className="service-duration">{service.duration} min</span>
            </button>
          ))}
          {!shop.services.length && <p className="card">No momento não há serviços disponíveis para agendamento.</p>}
        </>}

        {step === 2 && <>
          <h1 className="booking-title"><Icon name="calendar" size={27} /> Escolha a data</h1>
          <p className="mut">Mostramos apenas os dias de funcionamento com horários disponíveis.</p>
          <section className="calendar" aria-label="Calendário para escolher uma data">
            <header className="calendar-header">
              <h2>{calendarTitle}</h2>
              <div className="calendar-nav">
                <button type="button" className="calendar-nav-button" aria-label="Mês anterior" disabled={calendarMonth <= minimumMonth} onClick={() => {
                  const [year, month] = calendarMonth.split('-').map(Number);
                  setCalendarMonth(`${month === 1 ? year - 1 : year}-${pad(month === 1 ? 12 : month - 1)}`);
                }}><Icon name="arrowLeft" /></button>
                <button type="button" className="calendar-nav-button" aria-label="Próximo mês" disabled={calendarMonth >= maximumMonth} onClick={() => {
                  const [year, month] = calendarMonth.split('-').map(Number);
                  setCalendarMonth(`${month === 12 ? year + 1 : year}-${pad(month === 12 ? 1 : month + 1)}`);
                }}><Icon name="arrowRight" /></button>
              </div>
            </header>
            <div className="calendar-grid" role="grid" aria-label={calendarTitle}>
              {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((weekday, index) => (
                <span className="calendar-weekday" role="columnheader" key={`${weekday}-${index}`} aria-label={DN[index]}>{weekday}</span>
              ))}
              {calendarDays.map((day) => {
                const inMonth = day.slice(0, 7) === calendarMonth;
                const inRange = day >= addD(0) && day <= addD(BOOKING_DAYS);
                const available = inRange && availableDates.has(day);
                return <button
                  type="button"
                  role="gridcell"
                  key={day}
                  className={`calendar-day${inMonth ? '' : ' outside'}${date === day ? ' selected' : ''}${available ? ' available' : ''}`}
                  disabled={!available}
                  aria-pressed={date === day}
                  aria-label={`${day} — ${available ? 'disponível' : 'indisponível'}`}
                  onClick={() => { setDate(day); setTime(''); setErr({}); }}
                >{Number(day.slice(8, 10))}</button>;
              })}
            </div>
          </section>
          {availableDates.size === 0 && <p className="card">Não há datas disponíveis nos próximos {BOOKING_DAYS} dias.</p>}
        </>}

        {step === 3 && <>
          <h1 className="booking-title"><Icon name="clock" size={27} /> Escolha o horário</h1>
          <p className="mut">{br(date)} · {dur} min reservados</p>
          <div className="slots">
            {free(date).map((slot) => <button type="button" key={slot} className={`chip slot-chip ${time === slot ? 'on' : ''}`} aria-pressed={time === slot} onClick={() => { setTime(slot); setErr({}); }}>{slot}</button>)}
          </div>
          {!free(date).length && <p className="card">Não há mais horários livres para esta data. Volte e escolha outro dia.</p>}
        </>}

        {step === 4 && <>
          <h1 className="booking-title"><Icon name="user" size={27} /> Seus dados</h1>
          {f.name ? <div className="card"><b>{f.name}</b><br /><span className="mut">{f.phone} · {f.email}</span></div>
            : <p className="card">Entre ou crie sua conta para preencher seus dados e confirmar o horário.</p>}
          <Link className="text-link" to={`/login?returnTo=${encodeURIComponent('/agendar?resume=1')}`}>Entrar ou atualizar dados da conta <Icon name="arrowRight" /></Link>
        </>}

        {step === 5 && <>
          <h1 className="booking-title">Revise seu agendamento</h1>
          <p className="mut">Confira os detalhes antes de confirmar.</p>
          <section className="card booking-summary">
            <h2>{shop.shop.name}</h2>
            <p><b>Barbeiro</b><br />{shop.barbers.find((barber) => String(barber.id) === String(barberId))?.name}</p>
            <p><b>Serviços</b><br />{names}</p>
            <p><b>Data e horário</b><br />{br(date)} às {time}</p>
            <p><b>Cliente</b><br />{f.name || 'Entrar para identificar cliente'}{f.phone ? ` · ${f.phone}` : ''}</p>
            <p><b>Duração</b><br />{dur} min</p>
            <p className="summary-total"><b>Total</b><strong>{R(total)}</strong></p>
          </section>
          {err.slot === ERROS.perfil_incompleto && <Link className="text-link" to="/cliente">Completar dados da conta <Icon name="arrowRight" /></Link>}
          <p className="mut privacy-note">Ao confirmar, você autoriza o uso dos seus dados para gerenciar este agendamento e enviar a confirmação.</p>
        </>}
      </main>
      <div className="sticky"><div>
        {step === 1 && <><div className="row sticky-total"><span>{sel.length ? `${dur} min` : 'Selecione um serviço'}</span><b>{R(total)}</b></div>        <button className="btn" disabled={!sel.length || !barberId} onClick={() => setStep(2)}>Continuar <Icon name="arrowRight" /></button></>}
        {step > 1 && <div className="booking-actions">
        <button className="btn ghost booking-back" onClick={goBack}><Icon name="arrowLeft" /> Voltar</button>
        {step === 2 && <button className="btn" disabled={!date} onClick={() => { setErr({}); setStep(3); }}>Continuar <Icon name="arrowRight" /></button>}
        {step === 3 && <button className="btn" disabled={!time} onClick={() => { setErr({}); setStep(4); }}>Continuar <Icon name="arrowRight" /></button>}
        {step === 4 && <button className="btn" onClick={() => { setErr({}); setStep(5); }}>Revisar agendamento <Icon name="arrowRight" /></button>}
        {step === 5 && <button className="btn" disabled={busy} onClick={confirm}><Icon name={busy ? 'clock' : 'check'} /> {busy ? 'Confirmando…' : 'Confirmar agendamento'}</button>}
        </div>}
      </div></div>
    </>
  );
}
