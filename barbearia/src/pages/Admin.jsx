import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { R, br, addD, DN, STS, t5, fone, waLink } from '../lib';
import Icon from '../Icon';
import ProfileMenu from '../ProfileMenu';

const TABS = [['painel', 'Dashboard', 'dashboard'], ['agenda', 'Agendamentos', 'calendar'], ['clientes', 'Clientes', 'users'], ['servicos', 'Serviços', 'scissors'], ['equipe', 'Equipe', 'users'], ['financeiro', 'Financeiro', 'list'], ['relatorios', 'Relatórios', 'dashboard'], ['configuracoes', 'Configurações', 'store']];
const TAB_DATA = {
  painel: ['appts', 'services', 'clients', 'shop', 'barbers'],
  agenda: ['appts', 'services', 'barbers'],
  clientes: ['clients', 'appts'],
  servicos: ['services', 'serviceCosts'],
  equipe: ['barbers'],
  financeiro: ['expenses'],
  relatorios: ['appts', 'barbers', 'services'],
  configuracoes: ['hours', 'blocks', 'shop'],
};
const live = (a) => a.status !== 'Cancelado' && a.status !== 'Não compareceu';
const nullIf = (v) => (v === '' ? null : v);
const statusClass = (status) => ({
  Agendado: 'status-pending',
  Confirmado: 'status-confirmed',
  Concluído: 'status-complete',
  Cancelado: 'status-cancelled',
  'Não compareceu': 'status-no-show',
}[status] || '');
const shiftDay = (day, offset) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const sum = (items) => items.reduce((total, item) => total + Number(item.total || item.amount || 0), 0);
const completed = (appointments) => appointments.filter((appointment) => appointment.status === 'Concluído');
const monthStart = (day) => `${day.slice(0, 7)}-01`;
const monthEnd = (day) => {
  const date = new Date(`${monthStart(day)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
};
const fail = (r) => {
  if (!r.error) return false;
  const message = r.error.message;
  const conflict = ['no_overlap', 'horario_ocupado'].some((code) => message.includes(code));
  const scheduleError = {
    fora_do_expediente: 'O horário está fora do expediente.',
    intervalo: 'O horário coincide com o intervalo.',
    bloqueado: 'O horário está bloqueado.',
  };
  const detail = Object.entries(scheduleError).find(([code]) => message.includes(code))?.[1];
  alert(conflict ? 'Conflito: já existe um agendamento nesse horário.' : detail || `Não foi possível salvar: ${message}`);
  return true;
};

export default function Admin() {
  const [ok, setOk] = useState(null);
  const [err, setErr] = useState('');
  const [loadError, setLoadError] = useState('');
  const [retryScope, setRetryScope] = useState('all');
  const [loadedData, setLoadedData] = useState(() => new Set());
  const [tab, setTab] = useState('painel');
  const [D, setD] = useState(null);

  const check = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setErr('Não foi possível verificar sua sessão. Tente entrar novamente.');
        setOk(false);
        return;
      }
      if (!data.session) return setOk(false);
      const r = await supabase.rpc('is_admin');
      if (r.error) {
        setErr('Não foi possível verificar o acesso administrativo.');
        setOk(false);
        return;
      }
      setOk(!!r.data);
    } catch {
      setErr('Não foi possível verificar sua sessão. Tente entrar novamente.');
      setOk(false);
    }
  }, []);
  useEffect(() => { check(); }, [check]);

  const reload = useCallback(async (scope = 'all') => {
    setLoadError('');
    const queries = {
      appts: () => supabase.from('appointments')
        .select('id,client_id,service_ids,day,start_time,duration,total,status,barber_id,clients(name,phone,email)')
        .order('day').order('start_time'),
      services: () => supabase.from('services').select('id,name,description,price,duration,active').order('id'),
      hours: () => supabase.from('business_hours').select('weekday,open,open_time,close_time,lunch_start,lunch_end').order('weekday'),
      blocks: () => supabase.from('blocks').select('id,day,from_time,to_time,all_day,note').order('day'),
      clients: () => supabase.from('clients').select('id,name,phone,email').order('name'),
      shop: () => supabase.from('shop').select('id,name,address,phone,whatsapp,instagram,about').single(),
      barbers: () => supabase.from('barbers').select('id,name,active').order('name'),
      expenses: () => supabase.from('expenses').select('id,amount,spent_on').order('spent_on', { ascending: false }).order('id', { ascending: false }),
      serviceCosts: () => supabase.from('service_costs').select('service_id,direct_cost'),
    };
    const keys = scope === 'all' ? Object.keys(queries) : Array.isArray(scope) ? scope : [scope];
    try {
      const results = await Promise.all(keys.map((key) => queries[key]()));
      const failedIndex = results.findIndex((result) => result.error);
      if (failedIndex !== -1) {
        const failed = results[failedIndex];
        const missingFinanceTable = ['expenses', 'serviceCosts'].includes(keys[failedIndex])
          && /relation .*expenses.* does not exist|could not find the table .*expenses.* schema cache|relation .*service_costs.* does not exist|could not find the table .*service_costs.* schema cache/i.test(failed.error.message);
        setD((previous) => scope === 'all' ? null : previous);
        setRetryScope(scope);
        setLoadError(missingFinanceTable
          ? 'A atualização do módulo financeiro ainda não está no banco. Execute novamente supabase/finance.sql no SQL Editor do Supabase e tente de novo.'
          : `Não foi possível carregar os dados do painel: ${failed.error.message}`);
        return;
      }
      setLoadedData((previous) => new Set([...previous, ...keys]));
      setD((previous) => ({
        appts: [],
        services: [],
        hours: [],
        blocks: [],
        clients: [],
        shop: null,
        barbers: [],
        expenses: [],
        serviceCosts: [],
        ...previous,
        ...Object.fromEntries(keys.map((key, index) => [
          key,
          key === 'shop' ? results[index].data : results[index].data || [],
        ])),
      }));
      setRetryScope('all');
    } catch (error) {
      setD((previous) => scope === 'all' ? null : previous);
      setRetryScope(scope);
      setLoadError('Não foi possível carregar os dados do painel. Verifique sua conexão e tente novamente.');
    }
  }, []);
  useEffect(() => { if (ok) reload(TAB_DATA.painel); }, [ok, reload]);
  useEffect(() => {
    if (!ok || !D) return;
    const missing = TAB_DATA[tab].filter((key) => !loadedData.has(key));
    if (missing.length) reload(missing);
  }, [D, loadedData, ok, reload, tab]);

  async function login(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
      if (error) return setErr('E-mail ou senha incorretos.');
      const r = await supabase.rpc('is_admin');
      if (r.error) { await supabase.auth.signOut(); return setErr('Não foi possível verificar o acesso administrativo.'); }
      if (!r.data) { await supabase.auth.signOut(); return setErr('Este usuário não tem acesso ao painel.'); }
      setErr('');
      setOk(true);
    } catch {
      setErr('Não foi possível entrar. Verifique sua conexão e tente novamente.');
    }
  }
  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        alert('Não foi possível encerrar sua sessão. Tente novamente.');
        return;
      }
      setOk(false);
      setD(null);
      setLoadedData(new Set());
    } catch {
      alert('Não foi possível encerrar sua sessão. Tente novamente.');
    }
  };

  if (ok === null) return <p className="wrap mut">Carregando…</p>;
  if (!ok) return (
    <><div className="pole" /><div className="wrap"><div className="top"><img className="brand-logo" src="/barberia-logo.svg" alt="" /><b>Painel do barbeiro</b></div>
      <h2 style={{ margin: '20px 0' }}>Entrar</h2>
      <form onSubmit={login}><label>E-mail</label><input name="email" type="email" required autoComplete="username" />
        <label>Senha</label><input name="password" type="password" required autoComplete="current-password" />
        {err && <div className="err">{err}</div>}<button className="btn">Entrar <Icon name="arrowRight" /></button></form>
      <p><Link to="/" className="mut"><Icon name="arrowLeft" /> Voltar ao site</Link></p></div></>
  );
  if (!D) return <div className="wrap"><p className={loadError ? 'err' : 'mut'}>{loadError || 'Carregando…'}</p>{loadError && <button className="btn" onClick={() => reload(retryScope)}>Tentar novamente</button>}</div>;
  const P = { D, reload };
  const tabReady = TAB_DATA[tab].every((key) => loadedData.has(key));
  return (
    <><div className="pole" /><div className="wrap wide admin">
      <div className="row top admin-header"><div className="admin-brand"><img className="brand-logo" src="/barberia-logo.svg" alt="" /><b style={{ fontSize: 18 }}>{D.shop?.name}</b></div><span><ProfileMenu options={[
        { label: 'Ver site', icon: 'external', href: '/' },
        { label: 'Sair', icon: 'logout', onSelect: logout },
      ]} /></span></div>
      {loadError && <p className="err" role="alert">{loadError} <button type="button" className="inline-button" onClick={() => reload(retryScope)}>Tentar novamente</button></p>}
      <div className="tabs">{TABS.map(([k, l, icon]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon name={icon} /> {l}</button>)}</div>
      {!tabReady && !loadError && <p className="mut" role="status">Carregando dados da seção…</p>}
      {tabReady && tab === 'painel' && <Painel {...P} />}
      {tabReady && tab === 'agenda' && <Agenda {...P} />}
      {tabReady && tab === 'clientes' && <Clientes {...P} />}
      {tabReady && tab === 'servicos' && <Servicos {...P} />}
      {tabReady && tab === 'equipe' && <Equipe {...P} />}
      {tabReady && tab === 'financeiro' && <Financeiro {...P} />}
      {tabReady && tab === 'relatorios' && <Relatorios {...P} />}
      {tabReady && tab === 'configuracoes' && <><Horarios {...P} /><Loja {...P} /></>}
    </div></>
  );
}

const svNames = (D, ids) => ids.map((i) => D.services.find((s) => s.id === i)?.name || '—').join(' + ');

function Lista({ D, reload, list }) {
  const [editing, setEditing] = useState(null);
  const upd = async (id, patch) => { if (!fail(await supabase.from('appointments').update(patch).eq('id', id))) reload('appts'); };
  if (!list.length) return <p className="mut">Nenhum agendamento neste período.</p>;
  const beginEdit = (appointment) => setEditing({
    id: appointment.id,
    name: appointment.clients?.name || '',
    phone: appointment.clients?.phone || '',
    email: appointment.clients?.email || '',
    serviceIds: [...appointment.service_ids],
    day: appointment.day,
    start: t5(appointment.start_time),
  });
  const saveEdit = async (event) => {
    event.preventDefault();
    const phone = editing.phone.replace(/\D/g, '');
    if (editing.name.trim().length < 3 || phone.length < 10 || phone.length > 11 || !editing.day || !editing.start || !editing.serviceIds.length) {
      return alert('Confira nome, WhatsApp, data e horário.');
    }
    if (editing.email && !/^\S+@\S+\.\S+$/.test(editing.email)) return alert('Informe um e-mail válido ou deixe o campo vazio.');
    const result = await supabase.rpc('admin_update_booking', {
      p_appointment_id: editing.id,
      p_name: editing.name.trim(),
      p_phone: editing.phone,
      p_email: editing.email,
      p_service_ids: editing.serviceIds,
      p_day: editing.day,
      p_start: editing.start,
    });
    if (fail(result)) return;
    setEditing(null);
    reload(['appts', 'clients']);
  };
  return (
    <>
    {editing && <form className="card" onSubmit={saveEdit}>
      <h3>Editar agendamento</h3>
      <div className="grid">
        <div><label>Nome do cliente</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></div>
        <div><label>WhatsApp</label><input type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} required /></div>
        <div><label>E-mail</label><input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
        <div><label>Data</label><input type="date" value={editing.day} onChange={(e) => setEditing({ ...editing, day: e.target.value })} required /></div>
        <div><label>Horário</label><input type="time" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} required /></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
        <button className="btn">Salvar alterações</button>
      </div>
    </form>}
    <div className="tw appointments-list"><table className="appointments-table"><thead><tr><th>Data</th><th>Hora</th><th>Profissional</th><th>Cliente</th><th>Serviços</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {list.map((a) => (
        <tr key={a.id}>
          <td data-label="Data">{br(a.day)}</td>
          <td data-label="Hora">{t5(a.start_time)}</td>
          <td data-label="Profissional">{D.barbers.find((barber) => String(barber.id) === String(a.barber_id))?.name || '—'}</td>
          <td data-label="Cliente">{a.clients?.name || '—'}<br />{a.clients?.phone && <a className="mut" target="_blank" rel="noopener noreferrer" href={waLink(a.clients.phone)}>{fone(a.clients.phone)}</a>}</td>
          <td data-label="Serviços">{svNames(D, a.service_ids)}</td><td data-label="Valor">{R(a.total)}</td>
          <td data-label="Status"><select className={`appointment-status ${statusClass(a.status)}`} value={a.status} onChange={(e) => {
            if (e.target.value === 'Cancelado' && !window.confirm('Cancelar este agendamento e liberar o horário?')) return;
            upd(a.id, { status: e.target.value });
          }}>{STS.map((s) => <option key={s}>{s}</option>)}</select></td>
          <td data-label="Ações"><button className="btn ghost sm" onClick={() => beginEdit(a)}>Editar</button></td>
        </tr>))}
    </tbody></table></div>
    </>
  );
}

function Painel(P) {
  const { D } = P, today = addD(0), thisMonth = monthStart(today);
  const revenueByDay = new Map();
  const serviceCounts = new Map();
  const todayAppointments = [];
  let todayCount = 0;
  let upcomingCount = 0;
  let todayRevenue = 0;
  let monthRevenue = 0;
  for (const appointment of D.appts) {
    if (appointment.day === today) {
      todayAppointments.push(appointment);
      if (appointment.status !== 'Cancelado') todayCount += 1;
    }
    if (appointment.day > today && live(appointment)) upcomingCount += 1;
    if (appointment.status !== 'Concluído') continue;

    const amount = Number(appointment.total || appointment.amount || 0);
    if (appointment.day === today) todayRevenue += amount;
    if (appointment.day >= thisMonth && appointment.day <= today) monthRevenue += amount;
    const daily = revenueByDay.get(appointment.day) || { count: 0, amount: 0 };
    daily.count += 1;
    daily.amount += amount;
    revenueByDay.set(appointment.day, daily);
    appointment.service_ids.forEach((serviceId) => {
      serviceCounts.set(serviceId, (serviceCounts.get(serviceId) || 0) + 1);
    });
  }
  const stats = [
    ['Agendamentos hoje', todayCount],
    ['Próximos agendamentos', upcomingCount],
    ['Clientes cadastrados', D.clients.length],
    ['Receita concluída hoje', R(todayRevenue)],
    ['Receita concluída no mês', R(monthRevenue)],
  ];
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(today, index - 6));
  const bars = days.map((day) => ({
    day,
    count: revenueByDay.get(day)?.count || 0,
    amount: revenueByDay.get(day)?.amount || 0,
  }));
  const maxAmount = Math.max(1, ...bars.map((bar) => bar.amount));
  const popular = D.services.map((service) => ({
    id: service.id,
    name: service.name,
    count: serviceCounts.get(service.id) || 0,
  })).filter((service) => service.count).sort((a, b) => b.count - a.count).slice(0, 5);
  return <section className="admin-dashboard">
    <div className="grid dashboard-stats">{stats.map(([label, value]) => <div key={label} className={`card stat${label.startsWith('Receita') ? ' stat-revenue' : ''}`}><span className="mut">{label}</span><b>{value}</b></div>)}</div>
    <div className="dashboard-insights">
      <section className="card dashboard-chart">
        <div className="row"><div><p className="eyebrow">ÚLTIMOS 7 DIAS</p><h2>Receita realizada</h2></div><span className="mut">Atendimentos concluídos</span></div>
        <div className="revenue-bars" role="img" aria-label="Receita diária nos últimos sete dias">
          {bars.map((bar) => <div className="revenue-bar-column" key={bar.day} title={`${br(bar.day)}: ${R(bar.amount)}`}>
            <span className="revenue-bar-value">{bar.amount ? R(bar.amount) : '—'}</span>
            <div className="revenue-bar-track"><i style={{ height: `${bar.amount ? Math.max(4, (bar.amount / maxAmount) * 100) : 2}%` }} /></div>
            <span>{br(bar.day).slice(0, 5)}</span>
          </div>)}
        </div>
      </section>
      <section className="card dashboard-popular">
        <p className="eyebrow">DESEMPENHO</p><h2>Serviços mais realizados</h2>
        {popular.length ? <ol>{popular.map((service) => <li key={service.id}><span>{service.name}</span><b>{service.count} {service.count === 1 ? 'atendimento' : 'atendimentos'}</b></li>)}</ol>
          : <p className="mut">Ainda não há atendimentos concluídos no período.</p>}
      </section>
    </div>
    <h3 className="dashboard-agenda-title">Agenda de hoje</h3><Lista {...P} list={todayAppointments} />
  </section>;
}

function Agenda(P) {
  const [view, setView] = useState('semana');
  const [anchor, setAnchor] = useState(addD(0));
  const [selectedDay, setSelectedDay] = useState(addD(0));
  const [barberId, setBarberId] = useState('');
  const start = view === 'mes' ? monthStart(anchor)
    : view === 'semana' ? shiftDay(anchor, -((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7))
      : anchor;
  const end = view === 'mes' ? monthEnd(anchor) : view === 'semana' ? shiftDay(start, 6) : start;
  const days = Array.from({ length: Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1 }, (_, index) => shiftDay(start, index));
  const calendarDays = view === 'mes'
    ? [...Array((new Date(`${start}T12:00:00Z`).getUTCDay() + 6) % 7).fill(null), ...days]
    : days;
  const filtered = P.D.appts.filter((appointment) => appointment.day >= start && appointment.day <= end
    && (!barberId || String(appointment.barber_id) === barberId));
  const appointmentsByDay = filtered.reduce((byDay, appointment) => {
    const dayAppointments = byDay.get(appointment.day) || [];
    dayAppointments.push(appointment);
    byDay.set(appointment.day, dayAppointments);
    return byDay;
  }, new Map());
  const selectedIsInRange = selectedDay >= start && selectedDay <= end;
  const selected = selectedIsInRange ? selectedDay : start;
  const visible = appointmentsByDay.get(selected) || [];
  const selectView = (value) => {
    setView(value);
    setSelectedDay(anchor);
  };
  return <section className="agenda-page">
    <div className="agenda-toolbar">
      <div className="agenda-view-switch" role="group" aria-label="Visualização da agenda">
        {[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([value, label]) => <button key={value} type="button" className={`agenda-view-button${view === value ? ' active' : ''}`} aria-pressed={view === value} onClick={() => selectView(value)}>{label}</button>)}
      </div>
      <label>Data de referência<input type="date" value={anchor} onChange={(event) => { setAnchor(event.target.value); setSelectedDay(event.target.value); }} /></label>
      <label>Profissional<select value={barberId} onChange={(event) => setBarberId(event.target.value)}><option value="">Toda a equipe</option>{P.D.barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label>
    </div>
    {view !== 'dia' && <div className={`agenda-calendar ${view === 'semana' ? 'weekly' : 'monthly'}`} aria-label={`Agenda de ${br(start)} a ${br(end)}`}>
      {calendarDays.map((day, index) => {
        if (!day) return <span className="agenda-date-empty" key={`empty-${index}`} aria-hidden="true" />;
        const appointments = appointmentsByDay.get(day) || [];
        return <button type="button" key={day} className={`agenda-date${selected === day ? ' selected' : ''}${appointments.length ? ' has-appointments' : ''}`} aria-pressed={selected === day} onClick={() => setSelectedDay(day)}>
          <span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</span>
          <b>{Number(day.slice(8, 10))}</b>
          <small>{appointments.length ? `${appointments.length} ${appointments.length === 1 ? 'horário' : 'horários'}` : 'Livre'}</small>
        </button>;
      })}
    </div>}
    <div className="agenda-day-heading"><h2>{br(selected)}</h2><span className="mut">{visible.length} agendamento(s) no dia</span></div>
    <Lista {...P} list={view === 'dia' ? filtered : visible} />
    <p className="mut" style={{ fontSize: 14 }}>Use “Editar” para alterar data, horário ou serviços. Cancelar libera o horário para novos clientes.</p>
  </section>;
}

function Financeiro({ D }) {
  const [period, setPeriod] = useState('mes');
  const [anchor, setAnchor] = useState(addD(0));
  const start = period === 'mes' ? monthStart(anchor)
    : period === 'semana' ? shiftDay(anchor, -((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7))
      : anchor;
  const end = period === 'mes' ? monthEnd(anchor) : period === 'semana' ? shiftDay(start, 6) : start;
  const income = completed(D.appts).filter((appointment) => appointment.day >= start && appointment.day <= end);
  const expenses = D.expenses.filter((expense) => expense.spent_on >= start && expense.spent_on <= end);
  const incomeTotal = sum(income);
  const expenseTotal = sum(expenses);
  const days = Array.from({ length: Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1 }, (_, index) => shiftDay(start, index));
  const bars = days.map((day) => ({
    day,
    income: sum(income.filter((appointment) => appointment.day === day)),
    expenses: sum(expenses.filter((expense) => expense.spent_on === day)),
  }));
  const maxAmount = Math.max(1, ...bars.flatMap((bar) => [bar.income, bar.expenses]));

  return <section className="finance-page">
    <div className="finance-toolbar">
      <label>Período<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="dia">Diário</option><option value="semana">Semanal</option><option value="mes">Mensal</option></select></label>
      <label>Data de referência<input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} /></label>
      <p className="mut">{br(start)}{end !== start ? ` a ${br(end)}` : ''}</p>
    </div>
    <div className="grid dashboard-stats finance-stats">
      <div className="card stat"><span className="mut">Receita concluída</span><b>{R(incomeTotal)}</b></div>
      <div className="card stat"><span className="mut">Despesas registradas</span><b>{R(expenseTotal)}</b></div>
      <div className="card stat"><span className="mut">Resultado estimado</span><b>{R(incomeTotal - expenseTotal)}</b></div>
      <div className="card stat"><span className="mut">Ticket médio concluído</span><b>{R(income.length ? incomeTotal / income.length : 0)}</b></div>
    </div>
    <section className="card finance-chart">
      <div><p className="eyebrow">RECEITA REALIZADA</p><h2>Atendimentos concluídos por dia</h2></div>
      {(income.length || expenses.length) ? <>
        <div className="finance-legend"><span><i className="legend-income" />Receita de atendimentos concluídos</span><span><i className="legend-expense" />Despesas registradas</span></div>
        <div className={`revenue-bars finance-bars ${days.length > 10 ? 'dense' : ''}`} role="img" aria-label="Comparação diária entre receita de atendimentos concluídos e despesas registradas">
        {bars.map((bar) => <div className="revenue-bar-column" key={bar.day} title={`${br(bar.day)} · receita ${R(bar.income)} · despesas ${R(bar.expenses)}`}>
          <span className="revenue-bar-value">{bar.income ? R(bar.income) : '—'}</span>
          <div className="revenue-bar-track">
            <i style={{ height: `${bar.income ? Math.max(4, (bar.income / maxAmount) * 100) : 2}%` }} />
            <i className="outflow" style={{ height: `${bar.expenses ? Math.max(4, (bar.expenses / maxAmount) * 100) : 2}%` }} />
          </div>
          <span>{br(bar.day).slice(0, 5)}</span>
        </div>)}
        </div>
      </> : <p className="mut">Não há receitas de atendimentos concluídos nem despesas neste período.</p>}
    </section>
  </section>;
}

function Relatorios({ D }) {
  const [from, setFrom] = useState(monthStart(addD(0)));
  const [to, setTo] = useState(addD(0));
  const inRange = completed(D.appts).filter((appointment) => appointment.day >= from && appointment.day <= to);
  const revenue = sum(inRange);
  const barberTotals = D.barbers.map((barber) => ({
    id: barber.id,
    name: barber.name,
    amount: sum(inRange.filter((appointment) => String(appointment.barber_id) === String(barber.id))),
    visits: inRange.filter((appointment) => String(appointment.barber_id) === String(barber.id)).length,
  })).sort((a, b) => b.amount - a.amount);
  const serviceTotals = D.services.map((service) => ({
    id: service.id,
    name: service.name,
    count: inRange.filter((appointment) => appointment.service_ids.includes(service.id)).length,
  })).filter((service) => service.count).sort((a, b) => b.count - a.count);
  return <section className="reports-page">
    <div className="finance-toolbar">
      <label>De<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Até<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
      <p className="mut">Dados baseados em atendimentos concluídos · {inRange.length} atendimentos</p>
    </div>
    <div className="grid dashboard-stats"><div className="card stat"><span className="mut">Receita realizada</span><b>{R(revenue)}</b></div><div className="card stat"><span className="mut">Ticket médio</span><b>{R(inRange.length ? revenue / inRange.length : 0)}</b></div></div>
    <div className="reports-grid">
      <section className="card"><p className="eyebrow">EQUIPE</p><h2>Receita por profissional</h2>
        {barberTotals.length ? <ol className="report-ranking">{barberTotals.map((item) => <li key={item.id}><span>{item.name}<small>{item.visits} atendimentos</small></span><b>{R(item.amount)}</b></li>)}</ol> : <p className="mut">Nenhum dado no período selecionado.</p>}
      </section>
      <section className="card"><p className="eyebrow">SERVIÇOS</p><h2>Mais realizados</h2>
        {serviceTotals.length ? <ol className="report-ranking">{serviceTotals.map((item) => <li key={item.id}><span>{item.name}</span><b>{item.count} {item.count === 1 ? 'atendimento' : 'atendimentos'}</b></li>)}</ol> : <p className="mut">Nenhum dado no período selecionado.</p>}
      </section>
    </div>
  </section>;
}

function Servicos({ D, reload }) {
  const empty = { name: '', description: '', price: '', duration: 30, direct_cost: '' };
  const [f, setF] = useState(empty);
  const save = async () => {
    if (!f.name.trim() || !(+f.price >= 0) || f.price === '' || !(+f.duration > 0)) return alert('Preencha nome, preço e duração.');
    const directCost = f.direct_cost === '' || f.direct_cost == null ? null : Number(f.direct_cost);
    if (directCost !== null && (!Number.isFinite(directCost) || directCost < 0 || directCost > 99999999.99)) return alert('Informe um custo direto válido ou deixe o campo vazio.');
    const row = { name: f.name.trim(), description: f.description, price: +f.price, duration: +f.duration };
    const serviceResult = f.id
      ? await supabase.from('services').update(row).eq('id', f.id).select('id').single()
      : await supabase.from('services').insert(row).select('id').single();
    if (fail(serviceResult)) return;
    const serviceId = f.id || serviceResult.data.id;
    const costResult = directCost === null
      ? await supabase.from('service_costs').delete().eq('service_id', serviceId)
      : await supabase.from('service_costs').upsert({ service_id: serviceId, direct_cost: directCost }, { onConflict: 'service_id' });
    if (costResult.error) {
      alert('O serviço foi salvo, mas o custo direto não foi atualizado. Revise o custo e tente salvar novamente.');
      reload(['services', 'serviceCosts']);
      return;
    }
    setF(empty);
    reload(['services', 'serviceCosts']);
  };
  const toggle = async (s) => { if (!fail(await supabase.from('services').update({ active: !s.active }).eq('id', s.id))) reload(['services', 'serviceCosts']); };
  const del = async (s) => {
    if (!confirm(`Excluir “${s.name}”?`)) return;
    if (!fail(await supabase.from('services').delete().eq('id', s.id))) reload(['services', 'serviceCosts']);
  };
  return <>
    {!D.services.length && <p className="card mut">Nenhum serviço cadastrado. Adicione os serviços reais da barbearia para liberar o agendamento.</p>}
    {D.services.map((s) => {
      const cost = D.serviceCosts.find((item) => String(item.service_id) === String(s.id))?.direct_cost;
      return <div key={s.id} className="card row"><div><b>{s.name}</b> <span className="st">{s.active ? 'Ativo' : 'Inativo'}</span><br /><span className="mut">{R(s.price)} · {s.duration} min{cost != null ? ` · custo direto ${R(cost)}` : ''}</span></div>
        <div><button className="btn ghost sm" onClick={() => setF({ ...s, direct_cost: cost ?? '' })}>Editar</button><button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Desativar' : 'Ativar'}</button><button className="btn ghost sm" onClick={() => del(s)}>Excluir</button></div></div>;
    })}
    <div className="card"><h3>{f.id ? 'Editar serviço' : 'Novo serviço'}</h3>
      <div className="inl"><div><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label>Preço (R$)</label><input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div><label>Duração (min)</label><input type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></div>
        <div><label>Custo direto unitário (R$)</label><input type="number" min="0" max="99999999.99" step="0.01" value={f.direct_cost ?? ''} onChange={(e) => setF({ ...f, direct_cost: e.target.value })} placeholder="Opcional" /></div></div>
      <label>Descrição</label><input value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <button className="btn sm" onClick={save}>Salvar serviço</button>{f.id && <button className="btn ghost sm" onClick={() => setF(empty)}>Cancelar</button>}</div>
    <p className="mut" style={{ fontSize: 14 }}>Serviços que já têm agendamentos devem ser desativados em vez de excluídos, para manter o histórico.</p></>;
}

function Horarios({ D, reload }) {
  const [hours, setHours] = useState(D.hours);
  const [b, setB] = useState({ day: '', from_time: '09:00', to_time: '10:00', all_day: false, note: '' });
  useEffect(() => { setHours(D.hours); }, [D.hours]);
  const upd = (weekday, patch) => setHours((current) => current.map((h) => h.weekday === weekday ? { ...h, ...patch } : h));
  const saveHours = async (h) => {
    if (h.open && (!h.open_time || !h.close_time || h.close_time <= h.open_time)) {
      return alert('Informe um horário de abertura e fechamento válido.');
    }
    if (h.open && (!!h.lunch_start !== !!h.lunch_end || (h.lunch_start && (h.lunch_start < h.open_time || h.lunch_end <= h.lunch_start || h.lunch_end > h.close_time)))) {
      return alert('Confira o intervalo: preencha início e fim, dentro do expediente.');
    }
    const result = await supabase.from('business_hours').update({
      open: h.open,
      open_time: nullIf(h.open_time),
      close_time: nullIf(h.close_time),
      lunch_start: nullIf(h.lunch_start),
      lunch_end: nullIf(h.lunch_end),
    }).eq('weekday', h.weekday);
    if (!fail(result)) reload('hours');
  };
  const addB = async () => {
    if (!b.day) return alert('Escolha uma data.');
    if (!b.all_day && (!b.from_time || !b.to_time || b.to_time <= b.from_time)) return alert('Informe um intervalo de bloqueio válido.');
    const r = await supabase.from('blocks').insert({ day: b.day, from_time: b.all_day ? null : b.from_time, to_time: b.all_day ? null : b.to_time, all_day: b.all_day, note: b.note });
    if (!fail(r)) { setB({ ...b, day: '', note: '' }); reload('blocks'); }
  };
  const delB = async (id) => {
    if (!window.confirm('Remover este bloqueio de agenda?')) return;
    if (!fail(await supabase.from('blocks').delete().eq('id', id))) reload('blocks');
  };
  const tin = (h, k) => <input type="time" value={t5(h[k])} onChange={(e) => upd(h.weekday, { [k]: nullIf(e.target.value) })} />;
  return <>
    <h3>Funcionamento e almoço</h3>
    {hours.map((h) => <div key={h.weekday} className="card inl"><div style={{ flex: '0 0 120px' }}><b>{DN[h.weekday]}</b><br /><label><input type="checkbox" checked={h.open} onChange={(e) => upd(h.weekday, { open: e.target.checked })} />Aberto</label></div>
      {h.open ? <><div><label>Abre</label>{tin(h, 'open_time')}</div><div><label>Fecha</label>{tin(h, 'close_time')}</div><div><label>Almoço de</label>{tin(h, 'lunch_start')}</div><div><label>até</label>{tin(h, 'lunch_end')}</div></> : <span className="mut">Dia de folga</span>}
      <button className="btn ghost sm" onClick={() => saveHours(h)}>Salvar horário</button></div>)}
    <h3 style={{ marginTop: 18 }}>Bloqueios, férias e indisponibilidade</h3>
    {D.blocks.map((x) => <div key={x.id} className="card row"><span>{br(x.day)} · {x.all_day ? 'dia todo' : `${t5(x.from_time)}–${t5(x.to_time)}`}{x.note ? ` · ${x.note}` : ''}</span><button className="btn ghost sm" onClick={() => delB(x.id)}>Remover</button></div>)}
    <div className="card"><div className="inl"><div><label>Data</label><input type="date" min={addD(0)} value={b.day} onChange={(e) => setB({ ...b, day: e.target.value })} /></div>
      <div><label>De</label><input type="time" value={b.from_time} onChange={(e) => setB({ ...b, from_time: e.target.value })} /></div>
      <div><label>Até</label><input type="time" value={b.to_time} onChange={(e) => setB({ ...b, to_time: e.target.value })} /></div></div>
      <label><input type="checkbox" checked={b.all_day} onChange={(e) => setB({ ...b, all_day: e.target.checked })} />Bloquear o dia todo (para férias, cadastre um dia por vez)</label>
      <label style={{ display: 'block', marginTop: 10 }}>Motivo</label><input value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} />
      <button className="btn sm" onClick={addB}>Adicionar bloqueio</button></div></>;
}

function Clientes({ D }) {
  const appointmentsByClient = D.appts.reduce((byClient, appointment) => {
    const key = String(appointment.client_id);
    const history = byClient.get(key) || [];
    history.push(appointment);
    byClient.set(key, history);
    return byClient;
  }, new Map());
  return <div className="tw"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Visitas concluídas</th><th>Valor gasto</th><th>Último atendimento</th><th>Histórico</th></tr></thead><tbody>
    {D.clients.map((c) => {
      const history = appointmentsByClient.get(String(c.id)) || [];
      const visits = completed(history);
      const lastVisit = visits.reduce((latest, appointment) => appointment.day > latest ? appointment.day : latest, '');
      return (
        <tr key={c.id}><td>{c.name}</td><td><a target="_blank" rel="noopener noreferrer" href={waLink(c.phone)}>{fone(c.phone)}</a></td><td>{c.email || '—'}</td>
          <td>{visits.length}</td><td>{R(sum(visits))}</td><td>{lastVisit ? br(lastVisit) : '—'}</td>
          <td>{history.length ? history.map((appointment) => `${br(appointment.day).slice(0, 5)} ${appointment.status}`).map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>) : 'Sem histórico'}</td></tr>);
    })}
  </tbody></table></div>;
}

function Equipe({ D, reload }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
      setError('Informe um nome entre 2 e 100 caracteres.');
      return;
    }
    const result = await supabase.from('barbers').insert({ name: cleanName });
    if (fail(result)) return;
    setName('');
    setError('');
    reload('barbers');
  };
  const toggle = async (barber) => {
    if (!fail(await supabase.from('barbers').update({ active: !barber.active }).eq('id', barber.id))) reload('barbers');
  };
  return <>
    <h3>Equipe de barbeiros</h3>
    <p className="mut">Barbeiros inativos deixam de receber novos agendamentos; os horários existentes permanecem no histórico.</p>
    {D.barbers.map((barber) => <div className="card row" key={barber.id}>
      <span><b>{barber.name}</b> <span className="st">{barber.active ? 'Ativo' : 'Inativo'}</span></span>
      <button className="btn ghost sm" onClick={() => toggle(barber)}>{barber.active ? 'Desativar' : 'Ativar'}</button>
    </div>)}
    <form className="card team-form" onSubmit={save}>
      <label htmlFor="barber-name">Adicionar barbeiro</label>
      <input id="barber-name" value={name} onChange={(event) => setName(event.target.value)} maxLength="100" required />
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn sm">Adicionar à equipe</button>
    </form>
  </>;
}

function Loja({ D, reload }) {
  const [f, setF] = useState(D.shop);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (!fail(await supabase.from('shop').update({ name: f.name, address: f.address, phone: f.phone, whatsapp: f.whatsapp, instagram: f.instagram, about: f.about }).eq('id', 1))) { alert('Dados salvos.'); reload('shop'); } };
  return <div className="card" style={{ maxWidth: 520 }}>
    {[['name', 'Nome'], ['address', 'Endereço'], ['phone', 'Telefone exibido'], ['whatsapp', 'WhatsApp (só números, com 55)'], ['instagram', 'Instagram (sem @)']].map(([k, l]) => <div key={k}><label>{l}</label><input value={f[k] || ''} onChange={set(k)} /></div>)}
    <label>Apresentação</label><textarea rows="3" value={f.about || ''} onChange={set('about')} /><button className="btn sm" onClick={save}>Salvar dados</button></div>;
}
