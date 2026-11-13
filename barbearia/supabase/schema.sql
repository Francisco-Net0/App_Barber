-- Rode no SQL Editor do Supabase.
create extension if not exists btree_gist;

create table shop (
    id int primary key default 1 check (id = 1),
    name text,
    address text,
    phone text,
    whatsapp text,
    instagram text,
    about text
);

create table services (
    id bigint generated always as identity primary key,
    name text not null,
    description text,
    price numeric(10, 2) not null check (price >= 0),
    duration int not null check (duration > 0),
    active boolean not null default true
);

create table business_hours (
    weekday int primary key check (weekday between 0 and 6),
    open boolean not null default true,
    open_time time,
    close_time time,
    lunch_start time,
    lunch_end time,
    constraint business_hours_opening_hours_check check (
        (not open)
        or (
            open_time is not null
            and close_time is not null
            and close_time > open_time
            and (
                (lunch_start is null and lunch_end is null)
                or (
                    lunch_start is not null
                    and lunch_end is not null
                    and lunch_start >= open_time
                    and lunch_end > lunch_start
                    and lunch_end <= close_time
                )
            )
        )
    )
);

create table blocks (
    id bigint generated always as identity primary key,
    day date not null,
    from_time time,
    to_time time,
    all_day boolean not null default false,
    note text,
    constraint blocks_time_range_check check (
        all_day
        or (
            from_time is not null
            and to_time is not null
            and to_time > from_time
        )
    )
);

create table clients (
    id bigint generated always as identity primary key,
    name text not null,
    phone text not null unique,
    email text,
    created_at timestamptz default now()
);

create table admins (
    user_id uuid primary key references auth.users on delete cascade
);

create table appointments (
    id bigint generated always as identity primary key,
    client_id bigint not null references clients (id),
    service_ids bigint[] not null,
    day date not null,
    start_time time not null,
    duration int not null,
    total numeric(10, 2) not null,
    status text not null default 'Agendado' check (
        status in (
            'Agendado',
            'Confirmado',
            'Concluído',
            'Cancelado',
            'Não compareceu'
        )
    ),
    token uuid not null default gen_random_uuid (),
    notification_claimed_at timestamptz,
    notified_at timestamptz,
    created_at timestamptz default now(),
    slot tsrange generated always as (
        tsrange (
            day + start_time,
            day + start_time + make_interval(mins => duration)
        )
    ) stored,
    -- regras 1 e 8: o banco impede dois agendamentos sobrepostos, mesmo com cliques simultâneos
    constraint no_overlap exclude using gist (
        slot
        with
            &&
    )
    where (status <> 'Cancelado')
);

create index appointments_day_idx on appointments(day) where status <> 'Cancelado';
create index blocks_day_idx on blocks(day);

create function is_admin() returns boolean language sql security definer stable set search_path=''
as $$ select exists(select 1 from public.admins where user_id = auth.uid()) $$;

alter table shop enable row level security;

alter table services enable row level security;

alter table business_hours enable row level security;

alter table blocks enable row level security;

alter table clients enable row level security;

alter table appointments enable row level security;

alter table admins enable row level security;

create policy pub_shop on shop for select using (true);

create policy pub_services on services for
select using (
        active
        or is_admin ()
    );

create policy pub_hours on business_hours for select using (true);

create policy adm_shop on shop for all using (is_admin ())
with
    check (is_admin ());

create policy adm_services on services for all using (is_admin ())
with
    check (is_admin ());

create policy adm_hours on business_hours for all using (is_admin ())
with
    check (is_admin ());

create policy adm_blocks on blocks for all using (is_admin ())
with
    check (is_admin ());

create policy adm_clients on clients for all using (is_admin ())
with
    check (is_admin ());

create policy adm_appts on appointments for all using (is_admin ())
with
    check (is_admin ());
-- clientes anônimos NÃO leem clients/appointments: só usam as funções abaixo.

create function public_blocks(d_from date, d_to date)
returns table(day date, from_time time, to_time time, all_day boolean)
language sql security definer stable set search_path=''
as $$
    select b.day, b.from_time, b.to_time, b.all_day
    from public.blocks b
    where d_from <= d_to
      and d_from >= (now() at time zone 'America/Sao_Paulo')::date
      and d_to <= (now() at time zone 'America/Sao_Paulo')::date + 90
      and b.day between d_from and d_to
$$;

create function busy_slots(d_from date, d_to date)
returns table(day date, start_time time, duration int)
language sql security definer stable set search_path=''
as $$
    select a.day, a.start_time, a.duration
    from public.appointments a
    where d_from <= d_to
      and d_from >= (now() at time zone 'America/Sao_Paulo')::date
      and d_to <= (now() at time zone 'America/Sao_Paulo')::date + 90
      and a.day between d_from and d_to
      and a.status <> 'Cancelado'
$$;

create function create_booking(p_name text, p_phone text, p_email text, p_service_ids bigint[], p_day date, p_start time)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_dur int;
  v_total numeric;
  v_n int;
  h public.business_hours;
  v_client bigint;
  v_id bigint;
  v_tok uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_s numeric := extract(epoch from p_start)/60;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if length(trim(coalesce(p_name, ''))) < 3
     or length(trim(coalesce(p_name, ''))) > 100
     or length(v_phone) not between 10 and 11
     or (
         p_email is not null
         and (
             length(trim(p_email)) > 254
             or (trim(p_email) <> '' and trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
         )
     )
     or p_day is null
     or p_start is null
     or coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'dados_invalidos';
  end if;
  if p_day < v_today or p_day > v_today + 90 then raise exception 'data_indisponivel'; end if;
  if extract(second from p_start) <> 0 then raise exception 'horario_indisponivel'; end if;
  select count(*),sum(s.duration),sum(s.price) into v_n,v_dur,v_total
    from public.services s where s.id=any(p_service_ids) and s.active;
  if v_n=0 or v_n<>cardinality(p_service_ids) then raise exception 'servico_invalido'; end if;
  select * into h from public.business_hours where weekday=extract(dow from p_day);
  if not found or not h.open or h.open_time is null or h.close_time is null
     or p_start<h.open_time or v_s+v_dur>extract(epoch from h.close_time)/60 then
    raise exception 'fora_do_expediente';
  end if;
  if mod(v_s - extract(epoch from h.open_time)/60, 30) <> 0 then raise exception 'horario_indisponivel'; end if;
  if (h.lunch_start is null) <> (h.lunch_end is null) then raise exception 'intervalo'; end if;
  if h.lunch_start is not null and h.lunch_end is not null
     and p_start<h.lunch_end and v_s+v_dur>extract(epoch from h.lunch_start)/60 then
    raise exception 'intervalo';
  end if;
  if exists(select 1 from public.blocks b where b.day=p_day and (
      b.all_day or (b.from_time is not null and b.to_time is not null
      and p_start<b.to_time and v_s+v_dur>extract(epoch from b.from_time)/60))) then
    raise exception 'bloqueado';
  end if;
  if p_day+p_start <= (now() at time zone 'America/Sao_Paulo') then raise exception 'horario_passado'; end if;
  insert into public.clients(name,phone,email) values (trim(p_name),v_phone,nullif(trim(coalesce(p_email,'')),''))
    on conflict(phone) do nothing returning id into v_client;
  if v_client is null then
    select c.id into v_client from public.clients c where c.phone = v_phone;
  end if;
  begin
    insert into public.appointments(client_id,service_ids,day,start_time,duration,total)
    values (v_client,p_service_ids,p_day,p_start,v_dur,v_total) returning id,token into v_id,v_tok;
  exception when exclusion_violation then raise exception 'horario_ocupado'; end;
  return jsonb_build_object('id',v_id,'token',v_tok,'duration',v_dur,'total',v_total);
end $$;

revoke all on function public_blocks(date, date) from public;
revoke all on function busy_slots(date, date) from public;
revoke all on function create_booking(text, text, text, bigint[], date, time) from public;

grant
execute on function public_blocks (date, date),
busy_slots (date, date),
create_booking (
    text,
    text,
    text,
    bigint[],
    date,
    time
) to anon,
authenticated;

    -- Dados iniciais
    insert into shop (id) values (1);

    insert into business_hours (weekday, open, open_time, close_time)
    select g, false, '09:00', '19:00'
    from generate_series(0, 6) g;

-- Depois de criar o usuário do barbeiro em Authentication > Users:
insert into admins(user_id) select id from auth.users where email='SEU_EMAIL';