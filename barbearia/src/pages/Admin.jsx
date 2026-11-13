import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { R, br, addD, DN, STS, t5, fone, waLink } from '../lib';
import Icon from '../Icon';

const TABS = [['painel', 'Painel', 'dashboard'], ['agenda', 'Agenda', 'calendar'], ['servicos', 'Serviços', 'scissors'], ['horarios', 'Horários', 'clock'], ['equipe', 'Equipe', 'users'], ['clientes', 'Clientes', 'users'], ['loja', 'Barbearia', 'store']];
const live = (a) => a.status !== 'Cancelado' && a.status !== 'Não compareceu';
const nullIf = (v) => (v === '' ? null : v);
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
  const [tab, setTab] = useState('painel');
  const [D, setD] = useState(null);

  const check = useCallback(async () => {
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
  }, []);
  useEffect(() => { check(); }, [check]);

  const reload = useCallback(async () => {
    setLoadError('');
    const q = await Promise.all([
      supabase.from('appointments').select('*, clients(name,phone,email)').order('day').order('start_time'),
      supabase.from('services').select('*').order('id'), supabase.from('business_hours').select('*').order('weekday'),
      supabase.from('blocks').select('*').order('day'), supabase.from('clients').select('*').order('name'),
      supabase.from('shop').select('*').single(), supabase.from('barbers').select('*').order('name')]);
    const failed = q.find((result) => result.error);
    if (failed) {
      setD(null);
      setLoadError(`Não foi possível carregar os dados do painel: ${failed.error.message}`);
      return;
    }
    setD({ appts: q[0].data || [], services: q[1].data || [], hours: q[2].data || [], blocks: q[3].data || [], clients: q[4].data || [], shop: q[5].data, barbers: q[6].data || [] });
  }, []);
  useEffect(() => { if (ok) reload(); }, [ok, reload]);

  async function login(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { error } = await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
    if (error) return setErr('E-mail ou senha incorretos.');
    const r = await supabase.rpc('is_admin');
    if (r.error) { await supabase.auth.signOut(); return setErr('Não foi possível verificar o acesso administrativo.'); }
    if (!r.data) { await supabase.auth.signOut(); return setErr('Este usuário não tem acesso ao painel.'); }
    setErr(''); setOk(true);
  }
  const logout = async () => { await supabase.auth.signOut(); setOk(false); setD(null); };

  if (ok === null) return <p className="wrap mut">Carregando…</p>;
  if (!ok) return (
    <><div className="pole" /><div className="wrap"><div className="top"><img className="brand-logo" src="/barberia-logo.svg" alt="" /><b>Painel do barbeiro</b></div>
      <h2 style={{ margin: '20px 0' }}>Entrar</h2>
      <form onSubmit={login}><label>E-mail</label><input name="email" type="email" required autoComplete="username" />
        <label>Senha</label><input name="password" type="password" required autoComplete="current-password" />
        {err && <div className="err">{err}</div>}<button className="btn">Entrar <Icon name="arrowRight" /></button></form>
      <p><Link to="/" className="mut"><Icon name="arrowLeft" /> Voltar ao site</Link></p></div></>
  );
  if (!D) return <div className="wrap"><p className={loadError ? 'err' : 'mut'}>{loadError || 'Carregando…'}</p>{loadError && <button className="btn" onClick={reload}>Tentar novamente</button>}</div>;
  const P = { D, reload };
  return (
    <><div className="pole" /><div className="wrap wide admin">
      <div className="row top admin-header"><b style={{ fontSize: 18 }}>{D.shop?.name}</b><span><Link to="/" className="mut"><Icon name="external" /> Ver site</Link><a href="#sair" className="mut" onClick={(e) => { e.preventDefault(); logout(); }}><Icon name="logout" /> Sair</a></span></div>
      <div className="tabs">{TABS.map(([k, l, icon]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon name={icon} /> {l}</button>)}</div>
      {tab === 'painel' && <Painel {...P} />}{tab === 'agenda' && <Agenda {...P} />}{tab === 'servicos' && <Servicos {...P} />}
      {tab === 'horarios' && <Horarios {...P} />}{tab === 'equipe' && <Equipe {...P} />}{tab === 'clientes' && <Clientes {...P} />}{tab === 'loja' && <Loja {...P} />}
    </div></>
  );
}

const svNames = (D, ids) => ids.map((i) => D.services.find((s) => s.id === i)?.name || '—').join(' + ');

function Lista({ D, reload, list }) {
  const [editing, setEditing] = useState(null);
  const upd = async (id, patch) => { if (!fail(await supabase.from('appointments').update(patch).eq('id', id))) reload(); };
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
  const toggleService = (id) => setEditing((current) => ({
    ...current,
    serviceIds: current.serviceIds.includes(id)
      ? current.serviceIds.filter((serviceId) => serviceId !== id)
      : [...current.serviceIds, id],
  }));
  const saveEdit = async (event) => {
    event.preventDefault();
    const phone = editing.phone.replace(/\D/g, '');
    if (editing.name.trim().length < 3 || phone.length < 10 || phone.length > 11 || !editing.day || !editing.start || !editing.serviceIds.length) {
      return alert('Confira nome, WhatsApp, serviço, data e horário.');
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
    reload();
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
      <p><b>Serviços</b></p>
      {D.services.map((service) => <label key={service.id} style={{ display: 'block', margin: '8px 0' }}>
        <input type="checkbox" checked={editing.serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
        {service.name} · {R(service.price)} · {service.duration} min{service.active ? '' : ' (inativo)'}
      </label>)}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
        <button className="btn">Salvar alterações</button>
      </div>
    </form>}
    <div className="tw appointments-list"><table className="appointments-table"><thead><tr><th>Data</th><th>Hora</th><th>Cliente</th><th>Serviços</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {list.map((a) => (
        <tr key={a.id}>
          <td data-label="Data">{br(a.day)}</td>
          <td data-label="Hora">{t5(a.start_time)}</td>
          <td data-label="Cliente">{a.clients?.name || '—'}<br />{a.clients?.phone && <a className="mut" target="_blank" rel="noopener" href={waLink(a.clients.phone)}>{fone(a.clients.phone)}</a>}</td>
          <td data-label="Serviços">{svNames(D, a.service_ids)}</td><td data-label="Valor">{R(a.total)}</td>
          <td data-label="Status"><select value={a.status} onChange={(e) => {
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
  const { D } = P, T = addD(0);
  const expected = D.appts.filter((a) => a.day >= T && ['Agendado', 'Confirmado'].includes(a.status)).reduce((sum, a) => sum + Number(a.total), 0);
  const received = D.appts.filter((a) => a.status === 'Concluído').reduce((sum, a) => sum + Number(a.total), 0);
  const stats = [['Hoje', D.appts.filter((a) => a.day === T && a.status !== 'Cancelado').length], ['Próximos', D.appts.filter((a) => a.day > T && live(a)).length],
  ['Agendamentos', D.appts.length], ['Faturamento previsto', R(expected)], ['Faturamento realizado', R(received)], ['Clientes', D.clients.length]];
  return <section className="admin-dashboard">
    <div className="grid dashboard-stats">{stats.map(([l, v]) => <div key={l} className={`card stat${l.startsWith('Faturamento') ? ' stat-revenue' : ''}`}><span className="mut">{l}</span><b>{v}</b></div>)}</div>
    <h3 className="dashboard-agenda-title">Agenda de hoje</h3><Lista {...P} list={D.appts.filter((a) => a.day === T)} />
  </section>;
}

function Agenda(P) {
  const [r, setR] = useState('dia'), T = addD(0), lim = { dia: T, semana: addD(6), mes: addD(29) }[r];
  return <><label>Período</label><select value={r} onChange={(e) => setR(e.target.value)} style={{ maxWidth: 260 }}>
    <option value="dia">Hoje</option><option value="semana">Próximos 7 dias</option><option value="mes">Próximos 30 dias</option></select>
    <Lista {...P} list={P.D.appts.filter((a) => a.day >= T && a.day <= lim)} />
    <p className="mut" style={{ fontSize: 14 }}>Use “Editar” para alterar data, horário ou serviços. Cancelar libera o horário para novos clientes.</p></>;
}

function Servicos({ D, reload }) {
  const empty = { name: '', description: '', price: '', duration: 30 };
  const [f, setF] = useState(empty);
  const save = async () => {
    if (!f.name.trim() || !(+f.price >= 0) || f.price === '' || !(+f.duration > 0)) return alert('Preencha nome, preço e duração.');
    const row = { name: f.name.trim(), description: f.description, price: +f.price, duration: +f.duration };
    const r = f.id ? await supabase.from('services').update(row).eq('id', f.id) : await supabase.from('services').insert(row);
    if (!fail(r)) { setF(empty); reload(); }
  };
  const toggle = async (s) => { if (!fail(await supabase.from('services').update({ active: !s.active }).eq('id', s.id))) reload(); };
  const del = async (s) => {
    if (!confirm(`Excluir “${s.name}”?`)) return;
    if (!fail(await supabase.from('services').delete().eq('id', s.id))) reload();
  };
  return <>
    {!D.services.length && <p className="card mut">Nenhum serviço cadastrado. Adicione os serviços reais da barbearia para liberar o agendamento.</p>}
    {D.services.map((s) => <div key={s.id} className="card row"><div><b>{s.name}</b> <span className="st">{s.active ? 'Ativo' : 'Inativo'}</span><br /><span className="mut">{R(s.price)} · {s.duration} min</span></div>
      <div><button className="btn ghost sm" onClick={() => setF(s)}>Editar</button><button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Desativar' : 'Ativar'}</button><button className="btn ghost sm" onClick={() => del(s)}>Excluir</button></div></div>)}
    <div className="card"><h3>{f.id ? 'Editar serviço' : 'Novo serviço'}</h3>
      <div className="inl"><div><label>Nome</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label>Preço (R$)</label><input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div><label>Duração (min)</label><input type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></div></div>
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
    if (!fail(result)) reload();
  };
  const addB = async () => {
    if (!b.day) return alert('Escolha uma data.');
    if (!b.all_day && (!b.from_time || !b.to_time || b.to_time <= b.from_time)) return alert('Informe um intervalo de bloqueio válido.');
    const r = await supabase.from('blocks').insert({ day: b.day, from_time: b.all_day ? null : b.from_time, to_time: b.all_day ? null : b.to_time, all_day: b.all_day, note: b.note });
    if (!fail(r)) { setB({ ...b, day: '', note: '' }); reload(); }
  };
  const delB = async (id) => {
    if (!window.confirm('Remover este bloqueio de agenda?')) return;
    if (!fail(await supabase.from('blocks').delete().eq('id', id))) reload();
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
  return <div className="tw"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Atendimentos</th><th>Histórico</th></tr></thead><tbody>
    {D.clients.map((c) => {
      const h = D.appts.filter((a) => a.client_id === c.id); return (
        <tr key={c.id}><td>{c.name}</td><td><a target="_blank" rel="noopener" href={waLink(c.phone)}>{fone(c.phone)}</a></td><td>{c.email || '—'}</td>
          <td>{h.filter((a) => a.status === 'Concluído').length}</td><td>{h.map((a) => `${br(a.day).slice(0, 5)} ${a.status}`).map((t, i) => <div key={i}>{t}</div>)}</td></tr>);
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
    reload();
  };
  const toggle = async (barber) => {
    if (!fail(await supabase.from('barbers').update({ active: !barber.active }).eq('id', barber.id))) reload();
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
  const save = async () => { if (!fail(await supabase.from('shop').update({ name: f.name, address: f.address, phone: f.phone, whatsapp: f.whatsapp, instagram: f.instagram, about: f.about }).eq('id', 1))) { alert('Dados salvos.'); reload(); } };
  return <div className="card" style={{ maxWidth: 520 }}>
    {[['name', 'Nome'], ['address', 'Endereço'], ['phone', 'Telefone exibido'], ['whatsapp', 'WhatsApp (só números, com 55)'], ['instagram', 'Instagram (sem @)']].map(([k, l]) => <div key={k}><label>{l}</label><input value={f[k] || ''} onChange={set(k)} /></div>)}
    <label>Apresentação</label><textarea rows="3" value={f.about || ''} onChange={set('about')} /><button className="btn sm" onClick={save}>Salvar dados</button></div>;
}
