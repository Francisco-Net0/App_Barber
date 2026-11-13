import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { clearBookingDraft } from '../lib';
import Icon from '../Icon';

const errorText = (error) => {
  if (error?.message?.includes('dados_invalidos')) return 'O nome completo ou WhatsApp do cadastro está inválido. Revise esses campos e tente novamente.';
  if (error?.message?.includes('clients_user_id_unique')) return 'Não foi possível salvar os dados da conta. Entre em contato com a barbearia.';
  return 'Não foi possível concluir. Confira os dados e tente novamente.';
};

const fieldValidation = (field, value, signup) => {
  if (field === 'name' && signup) {
    const name = value.trim();
    if (!name) return 'Informe seu nome completo.';
    if (name.length < 3 || name.length > 100) return 'Use entre 3 e 100 caracteres.';
  }
  if (field === 'phone' && signup) {
    const digits = value.replace(/\D/g, '');
    if (!digits) return 'Informe seu WhatsApp com DDD.';
    if (digits.length !== 10 && digits.length !== 11) return 'Use DDD e número: 10 ou 11 dígitos.';
  }
  if (field === 'email') {
    const email = value.trim();
    if (!email) return 'Informe seu e-mail.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Digite um e-mail válido, como nome@dominio.com.';
  }
  if (field === 'password') {
    if (!value) return 'Informe sua senha.';
    if (signup && value.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  }
  return '';
};

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authenticatedUser, setAuthenticatedUser] = useState(null);
  const completingUser = useRef('');
  const params = new URLSearchParams(location.search);
  const requestedPath = params.get('returnTo') || '/cliente';
  const returnTo = requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/cliente';
  const isBookingReturn = returnTo === '/agendar' || returnTo.startsWith('/agendar?');
  const abandonBooking = () => {
    if (isBookingReturn) clearBookingDraft();
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
        setAuthenticatedUser((current) => current?.id === session.user.id ? current : session.user);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authenticatedUser || completingUser.current === authenticatedUser.id) return;
    completingUser.current = authenticatedUser.id;
    let active = true;

    async function continueAfterAuthentication() {
      setBusy(true);
      setError('');
      const name = authenticatedUser.user_metadata?.full_name;
      const phone = authenticatedUser.user_metadata?.phone;
      try {
        if (name && phone) {
          const { error: profileError } = await supabase.rpc('save_client_profile', { p_name: name, p_phone: phone });
          if (profileError) throw profileError;
        }
        if (active) navigate(returnTo, { replace: true });
      } catch (authError) {
        completingUser.current = '';
        if (active) {
          setAuthenticatedUser(null);
          setError(errorText(authError));
        }
      } finally {
        if (active) setBusy(false);
      }
    }

    continueAfterAuthentication();
    return () => { active = false; };
  }, [authenticatedUser, navigate, returnTo]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim();
    const password = String(form.get('password'));
    const values = {
      name: String(form.get('name') || ''),
      phone: String(form.get('phone') || ''),
      email,
      password,
    };
    const fields = signup ? ['name', 'phone', 'email', 'password'] : ['email', 'password'];
    const validationErrors = Object.fromEntries(fields
      .map((field) => [field, fieldValidation(field, values[field], signup)])
      .filter(([, message]) => message));
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      document.getElementById(`auth-${Object.keys(validationErrors)[0]}`)?.focus();
      return;
    }

    setBusy(true);
    try {
      if (signup) {
        const name = values.name.trim();
        const phone = values.phone;
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name, phone },
            emailRedirectTo: `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`,
          },
        });
        if (authError) throw authError;
        if (!data.session) {
          setNotice('Cadastro criado. Confirme seu e-mail; depois da confirmação, você será redirecionado automaticamente.');
          return;
        }
        setAuthenticatedUser((current) => current?.id === data.user.id ? current : data.user);
        setNotice('Cadastro confirmado. Continuando…');
        return;
      }

      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      setAuthenticatedUser((current) => current?.id === data.user.id ? current : data.user);
      setNotice('Acesso confirmado. Continuando…');
    } catch (submitError) {
      const message = submitError?.message?.toLowerCase() || '';
      if (signup && (message.includes('already registered') || message.includes('already exists'))) {
        setFieldErrors({ email: 'Este e-mail já tem uma conta. Entre ou informe outro e-mail.' });
        document.getElementById('auth-email')?.focus();
      } else if (message.includes('invalid email') || message.includes('email address')) {
        setFieldErrors({ email: 'Digite um e-mail válido.' });
        document.getElementById('auth-email')?.focus();
      } else if (signup && message.includes('password') && (message.includes('weak') || message.includes('least') || message.includes('short'))) {
        setFieldErrors({ password: 'Escolha uma senha mais forte ou mais longa.' });
        document.getElementById('auth-password')?.focus();
      } else if (!signup && message.includes('invalid login credentials')) {
        setError('E-mail ou senha incorretos. Confira esses dois campos.');
      } else {
        setError(errorText(submitError));
      }
    } finally {
      setBusy(false);
    }
  }

  function updateFieldError(field, value) {
    const message = fieldValidation(field, value, signup);
    setFieldErrors((current) => {
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
    setError('');
  }

  return (
    <>
      <div className="pole" />
      <main className="wrap auth-page">
        <header className="top">
          <Link to="/" aria-label="Página inicial" onClick={abandonBooking}><img className="brand-logo" src="/barberia-logo.svg" alt="" /></Link>
          <b>Área do cliente</b>
        </header>
        <p className="eyebrow">{signup ? 'CRIE SUA CONTA' : 'BEM-VINDO DE VOLTA'}</p>
        <h1 className="auth-title">{signup ? 'Cadastro' : 'Entrar'}</h1>
        <p className="mut">{signup ? 'Acompanhe e gerencie seus horários.' : 'Entre para continuar seu agendamento ou acessar sua conta.'}</p>
        <form className="auth-form" noValidate onSubmit={submit}>
          {signup && <>
            <label htmlFor="auth-name">Nome completo</label>
            <input id="auth-name" name="name" autoComplete="name" maxLength="100" required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'auth-name-error' : undefined} onChange={(event) => updateFieldError('name', event.target.value)} />
            {fieldErrors.name && <p id="auth-name-error" className="field-error" role="alert">{fieldErrors.name}</p>}
            <label htmlFor="auth-phone">WhatsApp com DDD</label>
            <input id="auth-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" required aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'auth-phone-error' : undefined} onChange={(event) => updateFieldError('phone', event.target.value)} />
            {fieldErrors.phone && <p id="auth-phone-error" className="field-error" role="alert">{fieldErrors.phone}</p>}
          </>}
          <label htmlFor="auth-email">E-mail</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} onChange={(event) => updateFieldError('email', event.target.value)} />
          {fieldErrors.email && <p id="auth-email-error" className="field-error" role="alert">{fieldErrors.email}</p>}
          <label htmlFor="auth-password">Senha</label>
          <input id="auth-password" name="password" type="password" minLength={signup ? 6 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} required aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} onChange={(event) => updateFieldError('password', event.target.value)} />
          {fieldErrors.password && <p id="auth-password-error" className="field-error" role="alert">{fieldErrors.password}</p>}
          {error && <p className="err" role="alert">{error}</p>}
          {notice && <p className="card" role="status">{notice}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Aguarde…' : signup ? 'Criar conta' : 'Entrar'} <Icon name="arrowRight" /></button>
        </form>
        <p className="auth-switch">
          {signup ? 'Já tem uma conta? ' : 'Ainda não tem uma conta? '}
          <button type="button" className="inline-button" onClick={() => { setSignup(!signup); setError(''); setNotice(''); setFieldErrors({}); }}>
            {signup ? 'Entrar' : 'Cadastre-se'}
          </button>
        </p>
        <Link to="/" className="text-link" onClick={abandonBooking}><Icon name="arrowLeft" /> Voltar ao site</Link>
      </main>
    </>
  );
}
