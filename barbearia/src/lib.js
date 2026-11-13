import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export const R = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pad = (n) => String(n).padStart(2, '0');
const saoPauloDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateParts = (date) => Object.fromEntries(saoPauloDateTime.formatToParts(date).map(({ type, value }) => [type, value]));
export const iso = (date) => {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const addD = (n) => {
  const [year, month, day] = iso(new Date()).split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + n));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
};
export const weekdayFor = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};
export const tm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const t5 = (s) => (s ? s.slice(0, 5) : '');
export const mn = (s) => { const [a, b] = t5(s).split(':'); return +a * 60 + +b; };
export const br = (s) => s.split('-').reverse().join('/');
export const DN = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const STS = ['Agendado', 'Confirmado', 'Concluído', 'Cancelado', 'Não compareceu'];
export const BOOKING_DAYS = 90;
export const clearBookingDraft = () => {
  localStorage.removeItem('booking-draft');
  sessionStorage.removeItem('booking-draft');
};
export const fone = (p) => { const d = String(p).replace(/\D/g, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p; };
export const waLink = (p) => `https://wa.me/${String(p).replace(/\D/g, '').replace(/^(\d{10,11})$/, '55$1')}`;

/** Horários livres de um dia (a validação final é refeita no banco). */
export function slotsFor(date, dur, hours, blocks, busy, barberId, ignoreAppointmentId) {
  const h = hours.find((x) => x.weekday === weekdayFor(date));
  if (!h || !h.open || blocks.some((b) => b.day === date && b.all_day)) return [];
  if (!!h.lunch_start !== !!h.lunch_end) return [];
  const now = dateParts(new Date());
  const today = `${now.year}-${now.month}-${now.day}`;
  const currentMinute = Number(now.hour) * 60 + Number(now.minute);
  const out = [];
  for (let t = mn(h.open_time); t + dur <= mn(h.close_time); t += 30) {
    if (h.lunch_start && t < mn(h.lunch_end) && t + dur > mn(h.lunch_start)) continue;
    if (date < today || (date === today && t <= currentMinute)) continue;
    if (busy.some((a) => String(a.appointment_id) !== String(ignoreAppointmentId)
      && (barberId == null || String(a.barber_id) === String(barberId))
      && a.day === date && t < mn(a.start_time) + a.duration && t + dur > mn(a.start_time))) continue;
    if (blocks.some((b) => b.day === date && !b.all_day && t < mn(b.to_time) && t + dur > mn(b.from_time))) continue;
    out.push(tm(t));
  }
  return out;
}

/** Dados públicos da barbearia + horários ocupados (sem dados pessoais). */
export function useShop() {
  const [s, setS] = useState({ loading: true, services: [], barbers: [], hours: [], blocks: [], busy: [] });
  const reload = useCallback(async () => {
    setS((previous) => ({ ...previous, loading: !previous.shop, error: null }));
    try {
      const [shop, sv, barbers, hr, bl, bz] = await Promise.all([
        supabase.from('shop').select('*').single(),
        supabase.from('services').select('*').eq('active', true).order('id'),
        supabase.from('barbers').select('*').eq('active', true).order('name'),
        supabase.from('business_hours').select('*'),
        supabase.rpc('public_blocks', { d_from: addD(0), d_to: addD(BOOKING_DAYS) }),
        supabase.rpc('barber_busy_slots', { p_barber_id: null, d_from: addD(0), d_to: addD(BOOKING_DAYS) })]);
      const error = [shop, sv, barbers, hr, bl, bz].find((result) => result.error)?.error;
      setS({ loading: false, error, shop: shop.data, services: sv.data || [], barbers: barbers.data || [], hours: hr.data || [], blocks: bl.data || [], busy: bz.data || [] });
    } catch (error) {
      setS((previous) => ({ ...previous, loading: false, error }));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...s, reload };
}
