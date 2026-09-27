-- Historique d'appels : un appel (audio ou vidéo, 1:1 ou groupe) et ses participants.

create table public.calls (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    caller_id uuid not null references public.users (id) on delete cascade,
    kind text not null default 'audio' check (kind in ('audio', 'video')),
    status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed')),
    created_at timestamptz not null default now(),
    answered_at timestamptz,
    ended_at timestamptz,
    duration_seconds integer check (duration_seconds is null or duration_seconds >= 0)
);

create table public.call_participants (
    call_id uuid not null references public.calls (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    status text not null default 'invited' check (status in ('invited', 'joined', 'declined', 'missed', 'left')),
    joined_at timestamptz,
    left_at timestamptz,
    primary key (call_id, user_id)
);

create index calls_conversation_id_created_at_idx on public.calls (conversation_id, created_at desc);
create index calls_caller_id_idx on public.calls (caller_id);
create index call_participants_user_id_idx on public.call_participants (user_id);

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;

-- Appartenance à un appel. SECURITY DEFINER pour éviter la récursion RLS
-- (la politique calls_select_member s'appuie sur cette fonction, qui lit
-- call_participants). Ne révèle que l'appartenance de l'utilisateur courant.
create or replace function public.is_call_member(target_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.call_participants cp
        where cp.call_id = target_call_id
          and cp.user_id = (select auth.uid())
    );
$$;

revoke execute on function public.is_call_member(uuid) from public, anon;
grant execute on function public.is_call_member(uuid) to authenticated;

-- Chaque participant voit l'appel ; la branche caller_id couvre l'appelant
-- avant même que sa ligne participant ne soit insérée.
create policy "calls_select_member" on public.calls
    for select to authenticated
    using (public.is_call_member(id) or caller_id = (select auth.uid()));

create policy "calls_insert_caller" on public.calls
    for insert to authenticated
    with check (
        caller_id = (select auth.uid())
        and public.is_conversation_member(conversation_id)
    );

create policy "calls_update_member" on public.calls
    for update to authenticated
    using (public.is_call_member(id) or caller_id = (select auth.uid()))
    with check (public.is_call_member(id) or caller_id = (select auth.uid()));

create policy "call_participants_select_member" on public.call_participants
    for select to authenticated
    using (public.is_call_member(call_id));

-- L'appelant crée les lignes de tous les participants (statut initial "invited").
create policy "call_participants_insert_caller" on public.call_participants
    for insert to authenticated
    with check (
        exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.uid())
        )
    );

-- Chacun met à jour sa propre ligne (joined / declined / missed / left) ;
-- l'appelant peut clore les lignes restées sans réponse.
create policy "call_participants_update_member" on public.call_participants
    for update to authenticated
    using (
        (select auth.uid()) = user_id
        or exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.uid())
        )
    )
    with check (
        (select auth.uid()) = user_id
        or exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.uid())
        )
    );

-- Durée calculée à la clôture, de la réponse (answered_at) à la fin (ended_at).
create or replace function public.calls_set_duration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.answered_at is not null and new.ended_at is not null then
        new.duration_seconds := greatest(0, extract(epoch from (new.ended_at - new.answered_at))::integer);
    end if;
    return new;
end;
$$;

revoke execute on function public.calls_set_duration() from public, anon, authenticated;

create trigger calls_set_duration
    before update on public.calls
    for each row execute function public.calls_set_duration();

-- Data API : authenticated uniquement (RLS filtre les lignes), pas de suppression.
grant select, insert, update on public.calls to authenticated;
grant select, insert, update on public.call_participants to authenticated;
revoke all on public.calls from anon;
revoke all on public.call_participants from anon;

-- Realtime : l'historique se rafraîchit en direct.
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_participants;
