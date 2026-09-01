create extension if not exists pgcrypto;

create table if not exists public.pulso_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.pulso_admins (username text primary key, password_hash text not null);
create table if not exists public.pulso_sessions (token_hash text primary key, expires_at timestamptz not null);
create table if not exists public.pulso_agent_accesses (login text primary key, password_hash text not null, research_id bigint not null, agent_id text not null, blocked boolean not null default false);
create index if not exists idx_pulso_agent_research on public.pulso_agent_accesses(research_id,agent_id);

alter table public.pulso_state enable row level security;
alter table public.pulso_admins enable row level security;
alter table public.pulso_sessions enable row level security;
alter table public.pulso_agent_accesses enable row level security;
revoke all on public.pulso_state, public.pulso_admins, public.pulso_sessions, public.pulso_agent_accesses from anon, authenticated;

create or replace function public.pulso_admin_login(p_username text,p_password text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_token text;
begin
  if not exists(select 1 from pulso_admins where username=p_username and password_hash=crypt(p_password,password_hash)) then return null; end if;
  v_token:=encode(gen_random_bytes(32),'hex');
  insert into pulso_sessions values(encode(digest(v_token,'sha256'),'hex'),now()+interval '30 days');
  return jsonb_build_object('token',v_token);
end $$;

create or replace function public.pulso_admin_get_state(p_token text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now()) then raise exception 'unauthorized'; end if;
  return jsonb_build_object('researches',coalesce((select value from pulso_state where key='researches'),'[]'::jsonb),'questions',coalesce((select value from pulso_state where key='questions'),'[]'::jsonb));
end $$;

create or replace function public.pulso_admin_sync_state(p_token text,p_researches jsonb,p_questions jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r jsonb; a jsonb; safe_researches jsonb;
begin
  if not exists(select 1 from pulso_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now()) then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(r-'agents'||jsonb_build_object('agents',coalesce((select jsonb_agg(a-'password') from jsonb_array_elements(coalesce(r->'agents','[]')) a),'[]'::jsonb))),'[]'::jsonb) into safe_researches from jsonb_array_elements(p_researches) r;
  insert into pulso_state values('researches',safe_researches,now()) on conflict(key) do update set value=excluded.value,updated_at=now();
  insert into pulso_state values('questions',p_questions,now()) on conflict(key) do update set value=excluded.value,updated_at=now();
  for r in select * from jsonb_array_elements(p_researches) loop for a in select * from jsonb_array_elements(coalesce(r->'agents','[]')) loop
    if coalesce(a->>'login','')<>'' and coalesce(a->>'password','')<>'' then insert into pulso_agent_accesses values(a->>'login',crypt(a->>'password',gen_salt('bf')),(r->>'id')::bigint,a->>'id',coalesce((a->>'blocked')::boolean,false)) on conflict(login) do update set password_hash=excluded.password_hash,research_id=excluded.research_id,agent_id=excluded.agent_id,blocked=excluded.blocked; end if;
  end loop; end loop;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.pulso_agent_login(p_login text,p_password text) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare access pulso_agent_accesses; researches jsonb; research jsonb; agent jsonb; questions jsonb;
begin
  select * into access from pulso_agent_accesses where login=p_login and password_hash=crypt(p_password,password_hash) and not blocked; if not found then return null; end if;
  select value into researches from pulso_state where key='researches'; select value into questions from pulso_state where key='questions';
  select x into research from jsonb_array_elements(researches) x where (x->>'id')::bigint=access.research_id; select x into agent from jsonb_array_elements(research->'agents') x where x->>'id'=access.agent_id;
  return jsonb_build_object('research',research,'agent',agent,'questions',coalesce(questions,'[]'::jsonb));
end $$;

grant execute on function public.pulso_admin_login(text,text),public.pulso_admin_get_state(text),public.pulso_admin_sync_state(text,jsonb,jsonb),public.pulso_agent_login(text,text) to anon,authenticated;

-- Execute separadamente no SQL Editor, trocando a senha:
-- insert into public.pulso_admins(username,password_hash) values ('admin',crypt('SUA_SENHA',gen_salt('bf')));
