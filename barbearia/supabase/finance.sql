-- Executar uma vez em projetos existentes para habilitar o controle de despesas.
create table if not exists public.expenses (
    id bigint generated always as identity primary key,
    description text not null check (length(trim(description)) between 2 and 120),
    category text not null check (length(trim(category)) between 2 and 60),
    amount numeric(10, 2) not null check (amount > 0),
    spent_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
    notes text check (notes is null or length(notes) <= 500),
    created_at timestamptz not null default now()
);

create index if not exists expenses_spent_on_idx on public.expenses(spent_on);

alter table public.expenses enable row level security;

drop policy if exists admin_expenses on public.expenses;
create policy admin_expenses on public.expenses
    for all
    using (public.is_admin())
    with check (public.is_admin());

grant select, insert, update, delete on public.expenses to authenticated;
grant usage, select on sequence public.expenses_id_seq to authenticated;

create table if not exists public.service_costs (
    service_id bigint primary key references public.services(id) on delete cascade,
    direct_cost numeric(10, 2) not null check (direct_cost >= 0),
    updated_at timestamptz not null default now()
);

alter table public.service_costs enable row level security;

drop policy if exists admin_service_costs on public.service_costs;
create policy admin_service_costs on public.service_costs
    for all
    using (public.is_admin())
    with check (public.is_admin());

grant select, insert, update, delete on public.service_costs to authenticated;

create table if not exists public.appointment_service_snapshots (
    appointment_id bigint not null references public.appointments(id) on delete cascade,
    service_id bigint not null,
    service_name text not null,
    sale_amount numeric(10, 2) not null check (sale_amount >= 0),
    direct_cost numeric(10, 2) check (direct_cost is null or direct_cost >= 0),
    captured_at timestamptz not null default now(),
    cost_captured_at timestamptz,
    primary key (appointment_id, service_id)
);

create index if not exists appointment_service_snapshots_service_idx
    on public.appointment_service_snapshots(service_id);

alter table public.appointment_service_snapshots enable row level security;

drop policy if exists admin_appointment_service_snapshots
    on public.appointment_service_snapshots;
create policy admin_appointment_service_snapshots
    on public.appointment_service_snapshots
    for select
    using (public.is_admin());

grant select on public.appointment_service_snapshots to authenticated;

create or replace function public.capture_appointment_service_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_item record;
    v_item_count integer;
    v_price_total numeric;
    v_allocated numeric := 0;
    v_sale_amount numeric;
begin
    if coalesce(cardinality(new.service_ids), 0) = 0 then
        return new;
    end if;

    select count(*), coalesce(sum(s.price), 0)
    into v_item_count, v_price_total
    from unnest(new.service_ids) as selected(service_id)
    join public.services s on s.id = selected.service_id;

    if v_item_count = 0 then
        return new;
    end if;

    delete from public.appointment_service_snapshots snapshot
    where snapshot.appointment_id = new.id
      and not (snapshot.service_id = any(new.service_ids));

    for v_item in
        select s.id, s.name, s.price, costs.direct_cost,
               row_number() over (order by selected.ordinality) as item_number
        from unnest(new.service_ids) with ordinality as selected(service_id, ordinality)
        join public.services s on s.id = selected.service_id
        left join public.service_costs costs on costs.service_id = s.id
        order by selected.ordinality
    loop
        if v_item.item_number = v_item_count then
            v_sale_amount := new.total - v_allocated;
        elsif v_price_total > 0 then
            v_sale_amount := round(new.total * v_item.price / v_price_total, 2);
        else
            v_sale_amount := round(new.total / v_item_count, 2);
        end if;

        insert into public.appointment_service_snapshots (
            appointment_id, service_id, service_name, sale_amount, direct_cost, captured_at, cost_captured_at
        )
        values (
            new.id, v_item.id, v_item.name, v_sale_amount, v_item.direct_cost, now(),
            case when v_item.direct_cost is null then null else now() end
        )
        on conflict (appointment_id, service_id) do update
        set service_name = excluded.service_name,
            sale_amount = excluded.sale_amount,
            direct_cost = excluded.direct_cost,
            captured_at = excluded.captured_at,
            cost_captured_at = excluded.cost_captured_at;

        v_allocated := v_allocated + v_sale_amount;
    end loop;

    return new;
end;
$$;

revoke all on function public.capture_appointment_service_snapshots() from public;

drop trigger if exists capture_appointment_service_snapshots
    on public.appointments;
create trigger capture_appointment_service_snapshots
    after insert or update of service_ids, total
    on public.appointments
    for each row
    when (new.status <> 'Concluído')
    execute function public.capture_appointment_service_snapshots();

create or replace function public.capture_completed_service_costs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.appointment_service_snapshots snapshot
    set direct_cost = (
            select costs.direct_cost
            from public.service_costs costs
            where costs.service_id = snapshot.service_id
        ),
        cost_captured_at = (
            select now()
            from public.service_costs costs
            where costs.service_id = snapshot.service_id
        )
    where snapshot.appointment_id = new.id;

    return new;
end;
$$;

revoke all on function public.capture_completed_service_costs() from public;

drop trigger if exists capture_completed_service_costs
    on public.appointments;
create trigger capture_completed_service_costs
    after update of status
    on public.appointments
    for each row
    when (new.status = 'Concluído' and old.status is distinct from new.status)
    execute function public.capture_completed_service_costs();
