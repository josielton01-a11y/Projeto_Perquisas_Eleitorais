-- Gestão de contas de administrador (aba "Permissões" > Administradores).
-- Só adiciona colunas/funções novas — não altera nenhuma linha existente
-- além de dar o default (active=true, created_at=now()) pro admin já
-- cadastrado, pra ele continuar logando normalmente.

alter table public.pulso_admins
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

-- pulso_sessions não sabia a qual admin cada sessão pertencia — precisa
-- saber isso pra "quem sou eu" (ex.: não deixar o próprio admin se
-- desativar) e pra listar sessões por usuário no futuro.
alter table public.pulso_sessions
  add column if not exists username text;

-- Login passa a: (1) checar active=true, (2) gravar o username na sessão.
create or replace function public.pulso_admin_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not exists(
    select 1 from pulso_admins
    where username = p_username and active and password_hash = crypt(p_password, password_hash)
  ) then
    return null;
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into pulso_sessions values (encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days', p_username);
  return jsonb_build_object('token', v_token);
end $$;

-- Quem sou eu, dado o token da sessão atual.
create or replace function public.pulso_admin_whoami(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_username text;
begin
  select username into v_username from pulso_sessions
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now();
  if v_username is null then raise exception 'unauthorized'; end if;
  return jsonb_build_object('username', v_username);
end $$;

-- Lista os admins (nunca o hash da senha).
create or replace function public.pulso_admin_list_admins(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('username', username, 'active', active, 'createdAt', created_at) order by created_at)
     from pulso_admins),
    '[]'::jsonb
  );
end $$;

-- Cria um novo admin.
create or replace function public.pulso_admin_create_admin(p_token text, p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if coalesce(trim(p_username), '') = '' or coalesce(p_password, '') = '' then
    raise exception 'username and password are required';
  end if;
  if exists(select 1 from pulso_admins where username = p_username) then
    raise exception 'username already exists';
  end if;
  insert into pulso_admins(username, password_hash, active) values (p_username, crypt(p_password, gen_salt('bf')), true);
  return jsonb_build_object('ok', true);
end $$;

-- Ativa/desativa um admin — nunca deixa zerar o último admin ativo, pra
-- ninguém se trancar pra fora da administração sem querer.
create or replace function public.pulso_admin_set_active(p_token text, p_username text, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_self text; v_active_count int;
begin
  select username into v_self from pulso_sessions
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now();
  if v_self is null then raise exception 'unauthorized'; end if;
  if not p_active then
    select count(*) into v_active_count from pulso_admins where active and username <> p_username;
    if v_active_count = 0 then
      raise exception 'cannot deactivate the last active admin';
    end if;
  end if;
  update pulso_admins set active = p_active where username = p_username;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  public.pulso_admin_whoami(text),
  public.pulso_admin_list_admins(text),
  public.pulso_admin_create_admin(text, text, text),
  public.pulso_admin_set_active(text, text, boolean)
  to anon, authenticated;
