import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { clearBookingDraft } from '../lib';
import { useAuth } from '../auth';
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
  if (field === 'confirmPassword' && !value) {
    return 'Confirme sua nova senha.';
  }
  return '';
};

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const [signup, setSignup] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const { user: authenticatedUser, loading: authLoading } = useAuth();
  const completingUser = useRef('');
  const params = new URLSearchParams(location.search);
  const recoveryCallback = params.get('recovery') === '1';
  const requestedPath = params.get('returnTo') || '/';
  const isSameOriginPath = requestedPath.startsWith('/')
    && !requestedPath.startsWith('//')
    && !requestedPath.includes('\\')
    && !/%5c/i.test(requestedPath)
    && new URL(requestedPath, window.location.origin).origin === window.location.origin;
  const returnTo = isSameOriginPath ? requestedPath : '/';
  const isBookingReturn = returnTo === '/agendar' || returnTo.startsWith('/agendar?');
  const abandonBooking = () => {
    if (isBookingReturn) clearBookingDraft();
  };

  useEffect(() => {
    if (recoveryCallback || authLoading || !authenticatedUser || completingUser.current === authenticatedUser.id) return;
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
          setError(errorText(authError));
        }
      } finally {
        if (active) setBusy(false);
      }
    }

    continueAfterAuthentication();
    return () => { active = false; };
  }, [authLoading, authenticatedUser, navigate, recoveryCallback, returnTo]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim();
    const password = String(form.get('password'));
    const confirmPassword = String(form.get('confirmPassword') || '');
    const values = {
      name: String(form.get('name') || ''),
      phone: String(form.get('phone') || ''),
      email,
      password,
      confirmPassword,
    };
    const fields = recoveryCallback
      ? ['password', 'confirmPassword']
      : forgot ? ['email'] : signup ? ['name', 'phone', 'email', 'password'] : ['email', 'password'];
    const validationErrors = Object.fromEntries(fields
      .map((field) => [field, fieldValidation(field, values[field], signup || recoveryCallback)])
      .filter(([, message]) => message));
    if (recoveryCallback && password && confirmPassword && password !== confirmPassword) {
      validationErrors.confirmPassword = 'As senhas não coincidem.';
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      document.getElementById(`auth-${Object.keys(validationErrors)[0]}`)?.focus();
      return;
    }

    setBusy(true);
    try {
      if (recoveryCallback) {
        if (!authenticatedUser) throw new Error('recovery_session_missing');
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        navigate(returnTo, { replace: true });
        return;
      }

      if (forgot) {
        const redirectTo = `${window.location.origin}/login?recovery=1&returnTo=${encodeURIComponent(returnTo)}`;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetError) throw resetError;
        setNotice('Se houver uma conta com esse e-mail, enviaremos um link para redefinir sua senha.');
        return;
      }

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
        setNotice('Cadastro confirmado. Continuando…');
        return;
      }

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      setNotice('Acesso confirmado. Continuando…');
    } catch (submitError) {
      const message = submitError?.message?.toLowerCase() || '';
      if (recoveryCallback) {
        setError(message.includes('recovery_session_missing') || message.includes('session')
          ? 'Este link de recuperação é inválido ou expirou. Solicite um novo link.'
          : 'Não foi possível atualizar sua senha. Solicite um novo link e tente novamente.');
      } else if (forgot) {
        setError('Não foi possível solicitar a recuperação agora. Confira o e-mail e tente novamente.');
      } else if (signup && (message.includes('already registered') || message.includes('already exists'))) {
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
    const message = fieldValidation(field, value, signup || recoveryCallback);
    setFieldErrors((current) => {
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
    setError('');
  }

  if (authLoading) return <p className="wrap mut" role="status">Verificando sua sessão…</p>;

  const invalidRecovery = recoveryCallback && !authenticatedUser;

  return (
    <>
      <div className="pole" />
      <main className="wrap auth-page">
        <header className="top">
          <Link to="/" aria-label="Página inicial" onClick={abandonBooking}><img className="brand-logo" src="/barberia-logo.svg" alt="" /></Link>
          <b>Área do cliente</b>
        </header>
        <div className="auth-content">
          {(signup || forgot || recoveryCallback) && <p className="eyebrow">{recoveryCallback ? 'RECUPERAÇÃO DE ACESSO' : forgot ? 'RECUPERE SUA CONTA' : 'CRIE SUA CONTA'}</p>}
          <h1 className="auth-title">{recoveryCallback ? 'Redefinir senha' : forgot ? 'Recuperar senha' : signup ? 'Cadastro' : 'Entrar'}</h1>
          <p className="mut">{recoveryCallback
            ? 'Escolha uma nova senha para acessar sua conta.'
            : forgot ? 'Informe o e-mail da sua conta para receber um link de recuperação.'
              : signup ? 'Acompanhe e gerencie seus horários.' : 'Entre para continuar seu agendamento ou acessar sua conta.'}</p>
          {invalidRecovery ? <>
            <p className="err" role="alert">Este link de recuperação é inválido ou expirou.</p>
            <button type="button" className="inline-button" onClick={() => {
              navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
              setForgot(true);
              setError('');
              setNotice('');
            }}>Solicitar outro link</button>
          </> : <form className="auth-form" noValidate onSubmit={submit}>
            {!recoveryCallback && !forgot && signup && <>
              <label htmlFor="auth-name">Nome completo</label>
              <input id="auth-name" name="name" autoComplete="name" maxLength="100" required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'auth-name-error' : undefined} onChange={(event) => updateFieldError('name', event.target.value)} />
              {fieldErrors.name && <p id="auth-name-error" className="field-error" role="alert">{fieldErrors.name}</p>}
              <label htmlFor="auth-phone">WhatsApp com DDD</label>
              <input id="auth-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" required aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'auth-phone-error' : undefined} onChange={(event) => updateFieldError('phone', event.target.value)} />
              {fieldErrors.phone && <p id="auth-phone-error" className="field-error" role="alert">{fieldErrors.phone}</p>}
            </>}
            {!recoveryCallback && <>
              <label htmlFor="auth-email">E-mail</label>
              <input id="auth-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined} onChange={(event) => updateFieldError('email', event.target.value)} />
              {fieldErrors.email && <p id="auth-email-error" className="field-error" role="alert">{fieldErrors.email}</p>}
            </>}
            {!forgot && <>
              <label htmlFor="auth-password">{recoveryCallback ? 'Nova senha' : 'Senha'}</label>
              <input id="auth-password" name="password" type="password" minLength={signup || recoveryCallback ? 6 : undefined} autoComplete={signup || recoveryCallback ? 'new-password' : 'current-password'} required aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined} onChange={(event) => updateFieldError('password', event.target.value)} />
              {fieldErrors.password && <p id="auth-password-error" className="field-error" role="alert">{fieldErrors.password}</p>}
            </>}
            {recoveryCallback && <>
              <label htmlFor="auth-confirm-password">Confirmar nova senha</label>
              <input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? 'auth-confirm-password-error' : undefined} onChange={(event) => updateFieldError('confirmPassword', event.target.value)} />
              {fieldErrors.confirmPassword && <p id="auth-confirm-password-error" className="field-error" role="alert">{fieldErrors.confirmPassword}</p>}
            </>}
            {error && <p className="err" role="alert">{error}</p>}
            {notice && <p className="card" role="status">{notice}</p>}
            <button className="btn" disabled={busy}>{busy ? 'Aguarde…' : recoveryCallback ? 'Salvar nova senha' : forgot ? 'Enviar link de recuperação' : signup ? 'Criar conta' : 'Entrar'} <Icon name="arrowRight" /></button>
          </form>}
          {!recoveryCallback && !invalidRecovery && <p className="auth-switch">
            {forgot ? 'Lembrou sua senha? ' : signup ? 'Já tem uma conta? ' : 'Ainda não tem uma conta? '}
            <button type="button" className="inline-button" onClick={() => {
              if (forgot) setSignup(false);
              else setSignup(!signup);
              setForgot(false);
              setError('');
              setNotice('');
              setFieldErrors({});
            }}>
              {forgot ? 'Entrar' : signup ? 'Entrar' : 'Cadastre-se'}
            </button>
          </p>}
          {!signup && !forgot && !recoveryCallback && <button type="button" className="inline-button" onClick={() => {
            setForgot(true);
            setError('');
            setNotice('');
            setFieldErrors({});
          }}>Esqueci minha senha</button>}
          <Link to="/" className="text-link" onClick={abandonBooking}><Icon name="arrowLeft" /> Voltar ao site</Link>
        </div>
      </main>
    </>
  );
}
