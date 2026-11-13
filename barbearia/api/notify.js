// Função de servidor (Vercel). Usa chaves privadas, que nunca chegam ao navegador.
import { createClient } from '@supabase/supabase-js';

const phoneNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length <= 11 ? `55${digits}` : digits;
};

async function send(to, template, params) {
  const version = process.env.WHATSAPP_API_VERSION || 'v24.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phoneNumber(to),
      type: 'template',
      template: {
        name: template,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  if (!response.ok) throw new Error(`WhatsApp Cloud API retornou HTTP ${response.status}.`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id, token } = req.body || {};
  if (!/^\d+$/.test(String(id || '')) || !/^[0-9a-f-]{36}$/i.test(String(token || ''))) {
    return res.status(400).json({ ok: false, error: 'Dados do agendamento inválidos.' });
  }

  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'WHATSAPP_PHONE_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'WA_TEMPLATE_CLIENT',
    'WA_TEMPLATE_BARBER',
    'BARBER_WHATSAPP',
  ];
  const hasPlaceholder = required.some((key) => /SEU_PROJETO|SUA_|SEU_|YOUR_|token-|id-do-/i.test(process.env[key] || ''));
  if (
    required.some((key) => !process.env[key])
    || hasPlaceholder
    || process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')
  ) {
    console.error('Configuração de notificação do WhatsApp incompleta.');
    return res.status(503).json({ ok: false, error: 'O envio pelo WhatsApp não está configurado.' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const sb = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: appointment, error: appointmentError } = await sb.from('appointments')
      .select('*, clients(name,phone)')
      .eq('id', id)
      .eq('token', token)
      .maybeSingle();
    if (appointmentError) throw appointmentError;
    if (!appointment) return res.status(404).json({ ok: false, error: 'Agendamento não encontrado.' });
    if (appointment.notified_at) return res.status(200).json({ ok: true, alreadyNotified: true });

    const [{ data: services, error: servicesError }, { data: shop, error: shopError }] = await Promise.all([
      sb.from('services').select('name').in('id', appointment.service_ids),
      sb.from('shop').select('name').single(),
    ]);
    if (servicesError) throw servicesError;
    if (shopError) throw shopError;

    const claimedAt = new Date().toISOString();
    const { data: claim, error: claimError } = await sb.from('appointments')
      .update({ notification_claimed_at: claimedAt })
      .eq('id', id)
      .eq('token', token)
      .is('notification_claimed_at', null)
      .is('notified_at', null)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claim) {
      const { data: current, error: currentError } = await sb.from('appointments')
        .select('notified_at')
        .eq('id', id)
        .eq('token', token)
        .maybeSingle();
      if (currentError) throw currentError;
      if (current?.notified_at) return res.status(200).json({ ok: true, alreadyNotified: true });
      return res.status(409).json({ ok: false, error: 'A notificação já está em processamento ou foi tentada.' });
    }

    const serviceNames = services.map((service) => service.name).join(' + ');
    const date = appointment.day.split('-').reverse().join('/');
    const time = appointment.start_time.slice(0, 5);
    const price = Number(appointment.total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    await send(appointment.clients.phone, process.env.WA_TEMPLATE_CLIENT, [
      appointment.clients.name, serviceNames, date, time, price, shop.name,
    ]);
    await send(process.env.BARBER_WHATSAPP, process.env.WA_TEMPLATE_BARBER, [
      appointment.clients.name, serviceNames, date, time, price,
    ]);

    const { error: updateError } = await sb.from('appointments')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', id)
      .eq('token', token)
      .eq('notification_claimed_at', claimedAt);
    if (updateError) throw updateError;
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Falha ao notificar agendamento:', error);
    return res.status(502).json({ ok: false, error: 'Não foi possível enviar a notificação.' });
  }
}
