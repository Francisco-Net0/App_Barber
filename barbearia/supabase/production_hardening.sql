-- Rode uma vez em projetos já configurados. Não reaplique o schema.sql.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
    select exists(select 1 from public.admins where user_id = auth.uid())
$$;

alter table appointments
    add column if not exists notification_claimed_at timestamptz;

create index if not exists appointments_day_idx
    on appointments(day)
    where status <> 'Cancelado';
create index if not exists blocks_day_idx on blocks(day);

alter table business_hours
    drop constraint if exists business_hours_opening_hours_check,
    add constraint business_hours_opening_hours_check check (
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
    ) not valid;

alter table blocks
    drop constraint if exists blocks_time_range_check,
    add constraint blocks_time_range_check check (
        all_day
        or (
            from_time is not null
            and to_time is not null
            and to_time > from_time
        )
    ) not valid;

drop policy if exists pub_blocks on blocks;

create or replace function public_blocks(d_from date, d_to date)
returns table(day date, from_time time, to_time time, all_day boolean)
language sql
security definer
stable
set search_path = ''
as $$
    select b.day, b.from_time, b.to_time, b.all_day
    from public.blocks b
    where d_from <= d_to
      and d_from >= (now() at time zone 'America/Sao_Paulo')::date
      and d_to <= (now() at time zone 'America/Sao_Paulo')::date + 90
      and b.day between d_from and d_to
$$;

create or replace function busy_slots(d_from date, d_to date)
returns table(day date, start_time time, duration int)
language sql
security definer
stable
set search_path = ''
as $$
    select a.day, a.start_time, a.duration
    from public.appointments a
    where d_from <= d_to
      and d_from >= (now() at time zone 'America/Sao_Paulo')::date
      and d_to <= (now() at time zone 'America/Sao_Paulo')::date + 90
      and a.day between d_from and d_to
      and a.status <> 'Cancelado'
$$;

create or replace function create_booking(
    p_name text,
    p_phone text,
    p_email text,
    p_service_ids bigint[],
    p_day date,
    p_start time
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_duration int;
    v_total numeric;
    v_count int;
    v_client bigint;
    v_id bigint;
    v_token uuid;
    v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    v_start numeric := extract(epoch from p_start) / 60;
    v_today date := (now() at time zone 'America/Sao_Paulo')::date;
    h public.business_hours;
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

    if p_day < v_today or p_day > v_today + 90 then
        raise exception 'data_indisponivel';
    end if;
    if extract(second from p_start) <> 0 then
        raise exception 'horario_indisponivel';
    end if;

    select count(*), sum(s.duration), sum(s.price)
    into v_count, v_duration, v_total
    from public.services s
    where s.id = any(p_service_ids)
      and s.active;
    if v_count = 0 or v_count <> cardinality(p_service_ids) then
        raise exception 'servico_invalido';
    end if;

    select * into h
    from public.business_hours
    where weekday = extract(dow from p_day);
    if not found or not h.open
       or h.open_time is null or h.close_time is null
       or p_start < h.open_time
       or v_start + v_duration > extract(epoch from h.close_time) / 60 then
        raise exception 'fora_do_expediente';
    end if;
    if mod(v_start - extract(epoch from h.open_time) / 60, 30) <> 0 then
        raise exception 'horario_indisponivel';
    end if;
    if (h.lunch_start is null) <> (h.lunch_end is null) then
        raise exception 'intervalo';
    end if;
    if h.lunch_start is not null and h.lunch_end is not null
       and p_start < h.lunch_end
       and v_start + v_duration > extract(epoch from h.lunch_start) / 60 then
        raise exception 'intervalo';
    end if;
    if exists (
        select 1
        from public.blocks b
        where b.day = p_day
          and (
              b.all_day
              or (
                  b.from_time is not null
                  and b.to_time is not null
                  and p_start < b.to_time
                  and v_start + v_duration > extract(epoch from b.from_time) / 60
              )
          )
    ) then
        raise exception 'bloqueado';
    end if;
    if p_day + p_start <= (now() at time zone 'America/Sao_Paulo') then
        raise exception 'horario_passado';
    end if;

    insert into public.clients(name, phone, email)
    values (trim(p_name), v_phone, nullif(trim(coalesce(p_email, '')), ''))
    on conflict (phone) do nothing
    returning id into v_client;
    if v_client is null then
        select c.id into v_client
        from public.clients c
        where c.phone = v_phone;
    end if;

    begin
        insert into public.appointments(client_id, service_ids, day, start_time, duration, total)
        values (v_client, p_service_ids, p_day, p_start, v_duration, v_total)
        returning id, token into v_id, v_token;
    exception when exclusion_violation then
        raise exception 'horario_ocupado';
    end;

    return jsonb_build_object('id', v_id, 'token', v_token, 'duration', v_duration, 'total', v_total);
end;
$$;

revoke all on function public_blocks(date, date) from public;
revoke all on function busy_slots(date, date) from public;
revoke all on function create_booking(text, text, text, bigint[], date, time) from public;

grant execute on function public_blocks(date, date) to anon, authenticated;
grant execute on function busy_slots(date, date) to anon, authenticated;
grant execute on function create_booking(text, text, text, bigint[], date, time) to anon, authenticated;
