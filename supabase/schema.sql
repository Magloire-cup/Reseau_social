create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text unique not null,
  avatar text,
  status text default '',
  online boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group', 'ai')),
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  content text not null check (char_length(content) between 1 and 4000),
  type text not null default 'text' check (type in ('text', 'image', 'file', 'audio')),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read')),
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;

create policy "users are visible to signed-in users" on public.users for select to authenticated using (true);
create policy "users update their own profile" on public.users for update to authenticated using (auth.uid() = id);
create policy "members can view conversations" on public.conversations for select to authenticated using (exists (select 1 from public.conversation_members where conversation_id = id and user_id = auth.uid()));
create policy "members can view membership" on public.conversation_members for select to authenticated using (user_id = auth.uid());
create policy "authenticated users can create conversations" on public.conversations for insert to authenticated with check (true);
create policy "users can add themselves to conversations" on public.conversation_members for insert to authenticated with check (user_id = auth.uid());
create policy "conversation creators can add members" on public.conversation_members for insert to authenticated with check (exists (select 1 from public.conversation_members own where own.conversation_id = conversation_id and own.user_id = auth.uid()));
create policy "members can view messages" on public.messages for select to authenticated using (exists (select 1 from public.conversation_members where conversation_id = messages.conversation_id and user_id = auth.uid()));
create policy "members can send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.conversation_members where conversation_id = messages.conversation_id and user_id = auth.uid()));
create policy "members can update message status" on public.messages for update to authenticated using (exists (select 1 from public.conversation_members where conversation_id = messages.conversation_id and user_id = auth.uid()));
create policy "members can view attachments" on public.attachments for select to authenticated using (exists (select 1 from public.messages join public.conversation_members on conversation_members.conversation_id = messages.conversation_id where messages.id = attachments.message_id and conversation_members.user_id = auth.uid()));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, name, username) values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Pulse user'), split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 6));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
