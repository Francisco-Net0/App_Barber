-- Aplicar uma vez em instalações existentes; o schema inicial já deve ter sido executado.
create or replace function admin_update_booking(
    p_appointment_id bigint,
    p_name text,
    p_phone text,
    p_email text,
    p_service_ids bigint[],
    p_day date,
    p_start time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_client bigint;
    v_duration int;
    v_total numeric;
    v_count int;
    v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    v_start numeric := extract(epoch from p_start) / 60;
    h public.business_hours;
begin
    if not public.is_admin() then
        raise exception 'acesso_negado';
    end if;
    if length(trim(coalesce(p_name, ''))) < 3
       or length(trim(coalesce(p_name, ''))) > 100
       or length(v_phone) not between 10 and 11
       or p_day is null
       or p_start is null
       or coalesce(cardinality(p_service_ids), 0) = 0
       or (
           p_email is not null
           and (
               length(trim(p_email)) > 254
               or (trim(p_email) <> '' and trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
           )
       ) then
        raise exception 'dados_invalidos';
    end if;
    if extract(second from p_start) <> 0 then
        raise exception 'horario_indisponivel';
    end if;
    if p_day + p_start <= (now() at time zone 'America/Sao_Paulo') then
        raise exception 'horario_passado';
    end if;

    select client_id into v_client
    from public.appointments
    where id = p_appointment_id
    for update;
    if not found then
        raise exception 'agendamento_nao_encontrado';
    end if;

    select count(*), sum(duration), sum(price)
    into v_count, v_duration, v_total
    from public.services
    where id = any(p_service_ids);
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

    update public.clients
    set name = trim(p_name),
        phone = v_phone,
        email = nullif(trim(coalesce(p_email, '')), '')
    where id = v_client;

    update public.appointments
    set service_ids = p_service_ids,
        day = p_day,
        start_time = p_start,
        duration = v_duration,
        total = v_total
    where id = p_appointment_id;
end;
$$;

revoke all on function admin_update_booking(bigint, text, text, text, bigint[], date, time) from public;
grant execute on function admin_update_booking(bigint, text, text, text, bigint[], date, time) to authenticated;
