-- Pulse : schéma initial
-- Tables : users, conversations, conversation_members, messages, attachments

create table public.users (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null default '',
    username text unique,
    avatar text,
    status text not null default 'Disponible' check (char_length(status) <= 100),
    online boolean not null default false,
    created_at timestamptz not null default now()
);

create table public.conversations (
    id uuid primary key default gen_random_uuid(),
    type text not null default 'direct' check (type in ('direct', 'group', 'ai')),
    name text not null default '' check (char_length(name) <= 120),
    created_at timestamptz not null default now()
);

create table public.conversation_members (
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    joined_at timestamptz not null default now(),
    last_read_at timestamptz,
    primary key (conversation_id, user_id)
);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    sender_id uuid references public.users (id) on delete set null,
    content text not null check (char_length(content) <= 4000),
    type text not null default 'text' check (type in ('text', 'image', 'file', 'audio', 'ai')),
    status text not null default 'sent' check (status in ('sent', 'delivered', 'read')),
    created_at timestamptz not null default now()
);

create table public.attachments (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.messages (id) on delete cascade,
    url text not null,
    mime_type text,
    size_bytes bigint check (size_bytes is null or size_bytes >= 0),
    created_at timestamptz not null default now()
);

-- Index
create index conversation_members_user_id_idx on public.conversation_members (user_id);
create index messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_id_idx on public.messages (sender_id);
create index attachments_message_id_idx on public.attachments (message_id);

-- Profil créé automatiquement à l'inscription
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    base_username text;
begin
    base_username := split_part(new.email, '@', 1);
    insert into public.users (id, name, username)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'name', base_username),
        base_username || '_' || substr(new.id::text, 1, 6)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Helper : appartenance à une conversation (security invoker, s'appuie sur la RLS de conversation_members)
create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
stable
as $$
    select exists (
        select 1
        from public.conversation_members
        where conversation_id = conv_id
          and user_id = (select auth.uid())
    );
$$;

-- RLS
alter table public.users enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;

create policy "users_select_authenticated" on public.users
    for select to authenticated
    using (true);

create policy "users_insert_own" on public.users
    for insert to authenticated
    with check ((select auth.uid()) = id);

create policy "users_update_own" on public.users
    for update to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

create policy "conversations_select_member" on public.conversations
    for select to authenticated
    using (public.is_conversation_member(id));

create policy "conversations_insert_authenticated" on public.conversations
    for insert to authenticated
    with check (true);

create policy "conversations_update_member" on public.conversations
    for update to authenticated
    using (public.is_conversation_member(id))
    with check (public.is_conversation_member(id));

create policy "members_select" on public.conversation_members
    for select to authenticated
    using ((select auth.uid()) = user_id);

create policy "members_insert_authenticated" on public.conversation_members
    for insert to authenticated
    with check ((select auth.uid()) = user_id or public.is_conversation_member(conversation_id));

create policy "members_update_own" on public.conversation_members
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy "members_delete_own" on public.conversation_members
    for delete to authenticated
    using ((select auth.uid()) = user_id);

create policy "messages_select_member" on public.messages
    for select to authenticated
    using (public.is_conversation_member(conversation_id));

-- sender_id null autorisé pour les réponses de l'assistant IA (route /api/chat avec la session utilisateur)
create policy "messages_insert_member" on public.messages
    for insert to authenticated
    with check (
        public.is_conversation_member(conversation_id)
        and (sender_id = (select auth.uid()) or sender_id is null)
    );

create policy "messages_update_sender" on public.messages
    for update to authenticated
    using ((select auth.uid()) = sender_id)
    with check ((select auth.uid()) = sender_id);

create policy "messages_delete_sender" on public.messages
    for delete to authenticated
    using ((select auth.uid()) = sender_id);

create policy "attachments_select_member" on public.attachments
    for select to authenticated
    using (
        exists (
            select 1 from public.messages m
            where m.id = message_id
              and public.is_conversation_member(m.conversation_id)
        )
    );

create policy "attachments_insert_member" on public.attachments
    for insert to authenticated
    with check (
        exists (
            select 1 from public.messages m
            where m.id = message_id
              and public.is_conversation_member(m.conversation_id)
        )
    );

-- Exposition Data API (au cas où les privilèges par défaut ne couvrent pas les nouvelles tables)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on function public.is_conversation_member(uuid) to anon, authenticated;

-- Realtime
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.users;
