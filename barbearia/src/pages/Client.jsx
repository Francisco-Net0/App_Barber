import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { useShop, slotsFor, R, addD, br, t5, iso } from '../lib';
import Icon from '../Icon';
import ProfileMenu from '../ProfileMenu';

const appointmentKey = (appointment) => `${appointment.day}T${t5(appointment.start_time)}`;
const prioritizedAppointments = (appointments) => {
  const now = new Date();
  const today = iso(now);
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const currentMinute = Number(currentTime.slice(0, 2)) * 60 + Number(currentTime.slice(3));
  const current = [];
  const upcoming = [];
  const past = [];

  appointments.forEach((appointment) => {
    const key = appointmentKey(appointment);
    const startMinute = Number(t5(appointment.start_time).slice(0, 2)) * 60
      + Number(t5(appointment.start_time).slice(3));
    const isInProgress = ['Agendado', 'Confirmado'].includes(appointment.status)
      && appointment.day === today
      && startMinute <= currentMinute
      && startMinute + Number(appointment.duration) > currentMinute;

    if (isInProgress) current.push(appointment);
    else if (key >= `${today}T${currentTime}`) upcoming.push(appointment);
    else past.push(appointment);
  });

  upcoming.sort((a, b) => appointmentKey(a).localeCompare(appointmentKey(b)));
  past.sort((a, b) => appointmentKey(b).localeCompare(appointmentKey(a)));
  return [...current, ...upcoming, ...past];
};

const editable = (appointment) => {
  const today = iso(new Date());
  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return ['Agendado', 'Confirmado'].includes(appointment.status)
    && (appointment.day > today || (appointment.day === today && t5(appointment.start_time) > currentTime));
};

export default function Client() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const shop = useShop();
  const [profile, setProfile] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [showAllAppointments, setShowAllAppointments] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', phone: '', email: '' });
  const [notice, setNotice] = useState('');
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const accountSectionRef = useRef(null);

  useEffect(() => {
    if (showAccountDetails) accountSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [showAccountDetails]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const load = useCallback(async (currentUser) => {
    setError('');
    try {
      const [clientResult, appointmentResult] = await Promise.all([
        supabase.from('clients').select('name,phone,email').eq('user_id', currentUser.id).maybeSingle(),
        supabase.from('appointments')
          .select('id,day,start_time,status,service_ids,total,duration,barber_id,barbers(name)')
          .order('day', { ascending: false }).order('start_time'),
      ]);
      if (clientResult.error || appointmentResult.error) {
        setError('Não foi possível carregar sua conta e seus agendamentos. Tente novamente.');
        return;
      }
      setProfile(clientResult.data);
      setProfileForm({
        name: clientResult.data?.name || currentUser.user_metadata?.full_name || '',
        phone: clientResult.data?.phone || currentUser.user_metadata?.phone || '',
        email: currentUser.email || '',
      });
      setAppointments(appointmentResult.data || []);
    } catch {
      setError('Não foi possível carregar sua conta e seus agendamentos. Tente novamente.');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    load(user).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, load]);

  useEffect(() => {
    if (shop.shop?.name) document.title = `${shop.shop.name} — Área do cliente`;
  }, [shop.shop?.name]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const { error: saveError } = await supabase.rpc('save_client_profile', {
      p_name: profileForm.name.trim(),
      p_phone: profileForm.phone,
    });
    if (saveError) {
      setSaving(false);
      setError(saveError.message.includes('dados_invalidos') ? 'Informe nome completo e um WhatsApp válido com DDD.' : 'Não foi possível atualizar seus dados. Tente novamente.');
      return;
    }
    let emailUpdateFailed = false;
    if (profileForm.email.trim() !== user.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: profileForm.email.trim() });
      if (emailError) {
        emailUpdateFailed = true;
      } else {
        setNotice('Confirme a alteração pelo link enviado ao seu novo e-mail.');
      }
    } else {
      setNotice('Seus dados foram atualizados.');
    }
    await load(user);
    setSaving(false);
    if (emailUpdateFailed) setError('Seus dados foram salvos, mas não foi possível alterar o e-mail. Tente novamente.');
    else setShowAccountDetails(false);
  }

  async function cancel(appointment) {
    if (!window.confirm('Deseja cancelar este agendamento? Esta ação libera o horário para outras pessoas.')) return;
    const { error: cancelError } = await supabase.rpc('cancel_my_booking', { p_appointment_id: appointment.id });
    if (cancelError) {
      setError(cancelError.message.includes('agendamento_nao_encontrado')
        ? 'Este agendamento não pode mais ser cancelado.'
        : 'Não foi possível cancelar o agendamento. Atualize a página e tente novamente.');
      return;
    }
    await load(user);
  }

  async function saveAppointment(event) {
    event.preventDefault();
    if (!editing.serviceIds.length || !editing.barberId || !editing.day || !editing.time) {
      setError('Escolha o barbeiro, pelo menos um serviço, a data e o horário.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase.rpc('update_my_booking', {
      p_appointment_id: editing.id,
      p_service_ids: editing.serviceIds,
      p_day: editing.day,
      p_start: editing.time,
      p_barber_id: editing.barberId,
    });
    setSaving(false);
    if (updateError) {
      const code = ['horario_ocupado', 'horario_indisponivel', 'horario_passado', 'fora_do_expediente', 'intervalo', 'bloqueado', 'data_indisponivel', 'servico_invalido', 'barbeiro_invalido']
        .find((value) => updateError.message.includes(value));
      setError(code === 'horario_ocupado' ? 'Esse horário acabou de ser reservado. Escolha outro.'
        : code === 'data_indisponivel' ? 'Essa data não está mais disponível.'
          : code ? 'A seleção não está mais disponível. Atualize as opções e tente novamente.'
            : 'Não foi possível atualizar o agendamento. Tente novamente.');
      return;
    }
    setEditing(null);
    await load(user);
  }

  async function logout() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError('Não foi possível encerrar sua sessão. Tente novamente.');
      return;
    }
    navigate('/');
  }

  if (loading || shop.loading) return <p className="wrap mut" role="status">Carregando sua área…</p>;
  if (shop.error) return <main className="wrap"><p role="alert">Não foi possível carregar os horários disponíveis.</p><button className="btn" onClick={shop.reload}>Tentar novamente</button></main>;
  if (error && !user) return <main className="wrap"><p className="err" role="alert">{error}</p><Link className="btn" to="/login?returnTo=%2Fcliente">Entrar</Link></main>;

  const services = shop.services;
  const selectedServices = services.filter((service) => editing?.serviceIds.includes(service.id));
  const duration = selectedServices.reduce((sum, service) => sum + service.duration, 0);
  const availableSlots = editing?.day && editing?.barberId
    ? slotsFor(editing.day, duration, shop.hours, shop.blocks, shop.busy, editing.barberId, editing.id)
    : [];
  const namesFor = (ids) => ids.map((id) => services.find((service) => service.id === id)?.name || 'Serviço indisponível').join(' + ');
  const visibleAppointments = prioritizedAppointments(appointments);
  const renderedAppointments = showAllAppointments ? visibleAppointments : visibleAppointments.slice(0, 3);

  return (
    <>
      <div className="pole" />
      <main className="wrap client-page">
        <header className="row top">
          <Link to="/" aria-label="Página inicial"><img className="brand-logo" src="/barberia-logo.svg" alt="" /></Link>
          <b>Minha conta</b>
          <ProfileMenu options={[
            { label: 'Dados da conta', icon: 'user', onSelect: () => setShowAccountDetails(true) },
            { label: 'Sair', icon: 'logout', onSelect: logout },
          ]} />
        </header>
        <div className="row client-heading"><div><p className="eyebrow">ÁREA DO CLIENTE</p><h1 className="client-title">Olá, {profile?.name?.split(/\s+/)[0] || 'cliente'}.</h1></div><Link className="btn sm" to="/agendar">Novo agendamento</Link></div>
        {error && <p className="err" role="alert">{error}</p>}
        {notice && !showAccountDetails && <p className="card" role="status">{notice}</p>}

        {editing && <form className="card booking-editor" onSubmit={saveAppointment}>
          <div className="row"><h2>Editar agendamento</h2><button type="button" className="inline-button" onClick={() => setEditing(null)}>Fechar</button></div>
          <label htmlFor="edit-barber">Barbeiro</label>
          <select id="edit-barber" value={editing.barberId} onChange={(event) => setEditing({ ...editing, barberId: event.target.value, time: '' })}>
            {shop.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
          </select>
          <fieldset className="service-options"><legend>Serviços</legend>
            {services.map((service) => <label key={service.id} className="service-option">
              <input type="checkbox" checked={editing.serviceIds.includes(service.id)} onChange={() => {
                const serviceIds = editing.serviceIds.includes(service.id)
                  ? editing.serviceIds.filter((id) => id !== service.id)
                  : [...editing.serviceIds, service.id];
                setEditing({ ...editing, serviceIds, time: '' });
              }} />
              {service.name} · {R(service.price)} · {service.duration} min
            </label>)}
          </fieldset>
          <label htmlFor="edit-date">Data</label>
          <input id="edit-date" type="date" min={addD(0)} max={addD(90)} value={editing.day}
            onChange={(event) => setEditing({ ...editing, day: event.target.value, time: '' })} required />
          <label>Horário disponível</label>
          <div className="slots">
            {availableSlots.map((slot) => <button type="button" key={slot} className={`chip slot-chip${editing.time === slot ? ' on' : ''}`} aria-pressed={editing.time === slot} onClick={() => setEditing({ ...editing, time: slot })}>{slot}</button>)}
          </div>
          {!availableSlots.length && <p className="mut">Não há horários disponíveis para esta seleção.</p>}
          <button className="btn" disabled={saving || !editing.time}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
        </form>}

        <section className="client-section">
          <h2>Meus agendamentos</h2>
          {!appointments.length && <div className="card mut">Você ainda não tem agendamentos. <Link to="/agendar">Agende seu primeiro horário.</Link></div>}
          <div className="client-bookings" id="client-bookings-list">
            {renderedAppointments.map((appointment) => (
              <article className="card client-booking" key={appointment.id}>
                <div className="row"><div><p className="eyebrow">{br(appointment.day)} · {t5(appointment.start_time)}</p><h3>{appointment.barbers?.name || 'Barbeiro'}</h3></div><span className="st">{appointment.status}</span></div>
                <p>{namesFor(appointment.service_ids)}</p>
                <p className="mut">{R(appointment.total)} · {appointment.duration} min</p>
                {editable(appointment) && <div className="client-actions">
                  <button type="button" className="btn ghost sm" onClick={() => {
                    const barberId = shop.barbers.some((barber) => String(barber.id) === String(appointment.barber_id))
                      ? appointment.barber_id
                      : shop.barbers[0]?.id;
                    setEditing({
                      id: appointment.id,
                      serviceIds: appointment.service_ids.filter((id) => services.some((service) => service.id === id)),
                      day: appointment.day,
                      time: t5(appointment.start_time),
                      barberId,
                    });
                    setError('');
                  }}><Icon name="clock" /> Editar</button>
                  <button type="button" className="btn ghost sm" onClick={() => cancel(appointment)}>Cancelar agendamento</button>
                </div>}
              </article>
            ))}
          </div>
          {appointments.length > 3 && <button
            type="button"
            className="inline-button client-bookings-toggle"
            aria-expanded={showAllAppointments}
            aria-controls="client-bookings-list"
            onClick={() => setShowAllAppointments((shown) => !shown)}
          ><Icon name="arrowRight" />{showAllAppointments ? 'Mostrar menos' : 'Ver todos os agendamentos'}</button>}
        </section>

        {showAccountDetails && <section className="client-section" id="dados-da-conta" ref={accountSectionRef}>
          <h2>Dados da conta</h2>
          {notice && <p className="card" role="status">{notice}</p>}
          <form className="card account-form" onSubmit={saveProfile}>
            <label htmlFor="profile-name">Nome completo</label>
            <input id="profile-name" autoComplete="name" minLength="3" maxLength="100" required value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} />
            <label htmlFor="profile-phone">WhatsApp com DDD</label>
            <input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" required value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} />
            <label htmlFor="profile-email">E-mail</label>
            <input id="profile-email" type="email" autoComplete="email" required value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} />
            <button className="btn sm" disabled={saving}>{saving ? 'Salvando…' : 'Atualizar dados'}</button>
          </form>
        </section>}
      </main>
    </>
  );
}
