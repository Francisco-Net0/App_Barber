-- Execute depois de schema.sql, admin_booking_update.sql e production_hardening.sql.
alter table public.clients
    add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.clients
    drop constraint if exists clients_phone_key;

create index if not exists clients_user_id_idx on public.clients(user_id);
create unique index if not exists clients_user_id_unique on public.clients(user_id);

create table if not exists public.barbers (
    id bigint generated always as identity primary key,
    name text not null check (length(trim(name)) between 2 and 100),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.barbers enable row level security;

drop policy if exists pub_barbers on public.barbers;
create policy pub_barbers on public.barbers for select using (active or public.is_admin());
drop policy if exists adm_barbers on public.barbers;
create policy adm_barbers on public.barbers for all using (public.is_admin())
with check (public.is_admin());

insert into public.barbers(name)
select 'Barbeiro principal'
where not exists (select 1 from public.barbers);

alter table public.appointments
    add column if not exists barber_id bigint references public.barbers(id);

update public.appointments
set barber_id = (select id from public.barbers order by id limit 1)
where barber_id is null;

alter table public.appointments
    alter column barber_id set not null;

alter table public.appointments
    drop constraint if exists no_overlap;

alter table public.appointments
    add constraint no_overlap exclude using gist (
        barber_id with =,
        slot with &&
    ) where (status <> 'Cancelado');

drop policy if exists client_read_own on public.clients;
create policy client_read_own on public.clients for select
using (user_id = (select auth.uid()));
drop policy if exists client_insert_own on public.clients;
create policy client_insert_own on public.clients for insert
with check (user_id = (select auth.uid()));
drop policy if exists client_update_own on public.clients;
create policy client_update_own on public.clients for update
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists client_read_own_appointments on public.appointments;
create policy client_read_own_appointments on public.appointments for select
using (
    exists (
        select 1 from public.clients c
        where c.id = appointments.client_id
          and c.user_id = (select auth.uid())
    )
);

create or replace function public.save_client_profile(p_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
    if v_user is null then raise exception 'autenticacao_necessaria'; end if;
    if length(trim(coalesce(p_name, ''))) < 3
       or length(trim(p_name)) > 100
       or length(v_phone) not between 10 and 11 then
        raise exception 'dados_invalidos';
    end if;

    insert into public.clients(user_id, name, phone, email)
    values (v_user, trim(p_name), v_phone, (select email from auth.users where id = v_user))
    on conflict (user_id) do update
    set name = excluded.name, phone = excluded.phone, email = excluded.email;
end;
$$;

drop function if exists public.create_booking(text, text, text, bigint[], date, time);
create function public.create_booking(
    p_service_ids bigint[],
    p_day date,
    p_start time,
    p_barber_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_client bigint;
    v_duration int;
    v_total numeric;
    v_count int;
    v_id bigint;
    v_token uuid;
    v_start numeric := extract(epoch from p_start) / 60;
    v_today date := (now() at time zone 'America/Sao_Paulo')::date;
    h public.business_hours;
begin
    if v_user is null then raise exception 'autenticacao_necessaria'; end if;
    select id into v_client from public.clients where user_id = v_user;
    if not found then raise exception 'perfil_incompleto'; end if;
    if p_day is null or p_start is null or p_barber_id is null
       or coalesce(cardinality(p_service_ids), 0) = 0 then
        raise exception 'dados_invalidos';
    end if;
    if p_day < v_today or p_day > v_today + 90 then raise exception 'data_indisponivel'; end if;
    if extract(second from p_start) <> 0 then raise exception 'horario_indisponivel'; end if;
    if not exists (select 1 from public.barbers where id = p_barber_id and active) then
        raise exception 'barbeiro_invalido';
    end if;

    select count(*), sum(s.duration), sum(s.price)
    into v_count, v_duration, v_total
    from public.services s
    where s.id = any(p_service_ids) and s.active;
    if v_count = 0 or v_count <> cardinality(p_service_ids) then raise exception 'servico_invalido'; end if;

    select * into h from public.business_hours where weekday = extract(dow from p_day);
    if not found or not h.open or h.open_time is null or h.close_time is null
       or p_start < h.open_time or v_start + v_duration > extract(epoch from h.close_time) / 60 then
        raise exception 'fora_do_expediente';
    end if;
    if mod(v_start - extract(epoch from h.open_time) / 60, 30) <> 0 then raise exception 'horario_indisponivel'; end if;
    if (h.lunch_start is null) <> (h.lunch_end is null) then raise exception 'intervalo'; end if;
    if h.lunch_start is not null and p_start < h.lunch_end
       and v_start + v_duration > extract(epoch from h.lunch_start) / 60 then raise exception 'intervalo'; end if;
    if exists (
        select 1 from public.blocks b where b.day = p_day and (
            b.all_day or (b.from_time is not null and b.to_time is not null
            and p_start < b.to_time and v_start + v_duration > extract(epoch from b.from_time) / 60)
        )
    ) then raise exception 'bloqueado'; end if;
    if p_day + p_start <= (now() at time zone 'America/Sao_Paulo') then raise exception 'horario_passado'; end if;

    begin
        insert into public.appointments(client_id, barber_id, service_ids, day, start_time, duration, total)
        values (v_client, p_barber_id, p_service_ids, p_day, p_start, v_duration, v_total)
        returning id, token into v_id, v_token;
    exception when exclusion_violation then raise exception 'horario_ocupado'; end;
    return jsonb_build_object('id', v_id, 'token', v_token, 'duration', v_duration, 'total', v_total);
end;
$$;

create or replace function public.update_my_booking(
    p_appointment_id bigint,
    p_service_ids bigint[],
    p_day date,
    p_start time,
    p_barber_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_duration int;
    v_total numeric;
    v_count int;
    v_start numeric := extract(epoch from p_start) / 60;
    v_today date := (now() at time zone 'America/Sao_Paulo')::date;
    h public.business_hours;
begin
    if v_user is null then raise exception 'autenticacao_necessaria'; end if;
    if not exists (
        select 1 from public.appointments a join public.clients c on c.id = a.client_id
        where a.id = p_appointment_id and c.user_id = v_user
          and a.status in ('Agendado', 'Confirmado')
          and a.day + a.start_time > (now() at time zone 'America/Sao_Paulo')
    ) then raise exception 'agendamento_nao_encontrado'; end if;
    if p_day is null or p_start is null or p_barber_id is null
       or coalesce(cardinality(p_service_ids), 0) = 0 then raise exception 'dados_invalidos'; end if;
    if p_day < v_today or p_day > v_today + 90 then raise exception 'data_indisponivel'; end if;
    if extract(second from p_start) <> 0 then raise exception 'horario_indisponivel'; end if;
    if not exists (select 1 from public.barbers where id = p_barber_id and active) then raise exception 'barbeiro_invalido'; end if;

    select count(*), sum(s.duration), sum(s.price)
    into v_count, v_duration, v_total
    from public.services s where s.id = any(p_service_ids) and s.active;
    if v_count = 0 or v_count <> cardinality(p_service_ids) then raise exception 'servico_invalido'; end if;

    select * into h from public.business_hours where weekday = extract(dow from p_day);
    if not found or not h.open or h.open_time is null or h.close_time is null
       or p_start < h.open_time or v_start + v_duration > extract(epoch from h.close_time) / 60 then
        raise exception 'fora_do_expediente';
    end if;
    if mod(v_start - extract(epoch from h.open_time) / 60, 30) <> 0 then raise exception 'horario_indisponivel'; end if;
    if (h.lunch_start is null) <> (h.lunch_end is null) then raise exception 'intervalo'; end if;
    if h.lunch_start is not null and p_start < h.lunch_end
       and v_start + v_duration > extract(epoch from h.lunch_start) / 60 then raise exception 'intervalo'; end if;
    if exists (
        select 1 from public.blocks b where b.day = p_day and (
            b.all_day or (b.from_time is not null and b.to_time is not null
            and p_start < b.to_time and v_start + v_duration > extract(epoch from b.from_time) / 60)
        )
    ) then raise exception 'bloqueado'; end if;
    if p_day + p_start <= (now() at time zone 'America/Sao_Paulo') then raise exception 'horario_passado'; end if;

    begin
        update public.appointments
        set barber_id = p_barber_id, service_ids = p_service_ids, day = p_day,
            start_time = p_start, duration = v_duration, total = v_total
        where id = p_appointment_id;
    exception when exclusion_violation then raise exception 'horario_ocupado'; end;
end;
$$;

create or replace function public.cancel_my_booking(p_appointment_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.appointments a
    set status = 'Cancelado'
    from public.clients c
    where a.id = p_appointment_id
      and c.id = a.client_id
      and c.user_id = auth.uid()
      and a.status in ('Agendado', 'Confirmado')
      and a.day + a.start_time > (now() at time zone 'America/Sao_Paulo');
    if not found then raise exception 'agendamento_nao_encontrado'; end if;
end;
$$;

create or replace function public.barber_busy_slots(p_barber_id bigint, d_from date, d_to date)
returns table(appointment_id bigint, barber_id bigint, day date, start_time time, duration int)
language sql
security definer
stable
set search_path = ''
as $$
    select a.id, a.barber_id, a.day, a.start_time, a.duration
    from public.appointments a
    where d_from <= d_to
      and d_from >= (now() at time zone 'America/Sao_Paulo')::date
      and d_to <= (now() at time zone 'America/Sao_Paulo')::date + 90
      and a.day between d_from and d_to
      and (p_barber_id is null or a.barber_id = p_barber_id)
      and a.status <> 'Cancelado'
$$;

revoke all on function public.save_client_profile(text, text) from public;
revoke all on function public.create_booking(bigint[], date, time, bigint) from public;
revoke all on function public.update_my_booking(bigint, bigint[], date, time, bigint) from public;
revoke all on function public.cancel_my_booking(bigint) from public;
revoke all on function public.barber_busy_slots(bigint, date, date) from public;

grant execute on function public.save_client_profile(text, text) to authenticated;
grant execute on function public.create_booking(bigint[], date, time, bigint) to authenticated;
grant execute on function public.update_my_booking(bigint, bigint[], date, time, bigint) to authenticated;
grant execute on function public.cancel_my_booking(bigint) to authenticated;
grant execute on function public.barber_busy_slots(bigint, date, date) to anon, authenticated;
