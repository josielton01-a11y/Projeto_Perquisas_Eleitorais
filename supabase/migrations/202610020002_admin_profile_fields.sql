-- Campos de exibição (nome/e-mail), último acesso, redefinição de senha e
-- exclusão de conta pra tabela de Administradores. Só colunas novas e
-- funções novas — nenhuma linha existente é alterada além do default null.

alter table public.pulso_admins
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists last_login_at timestamptz;

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
  update pulso_admins set last_login_at = now() where username = p_username;
  return jsonb_build_object('token', v_token);
end $$;

create or replace function public.pulso_admin_list_admins(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
        'username', username, 'name', name, 'email', email,
        'active', active, 'createdAt', created_at, 'lastLoginAt', last_login_at
      ) order by created_at)
     from pulso_admins),
    '[]'::jsonb
  );
end $$;

-- Atualiza nome/e-mail de exibição de um admin (não mexe em login/senha).
create or replace function public.pulso_admin_update_profile(p_token text, p_username text, p_name text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  update pulso_admins set name = nullif(trim(p_name), ''), email = nullif(trim(p_email), '') where username = p_username;
  return jsonb_build_object('ok', true);
end $$;

-- Redefine a senha de um admin (qualquer admin logado pode redefinir a de
-- outro — mesmo modelo de confiança já usado pra criar/ativar/desativar).
create or replace function public.pulso_admin_reset_password(p_token text, p_username text, p_new_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if coalesce(p_new_password, '') = '' then raise exception 'password is required'; end if;
  update pulso_admins set password_hash = crypt(p_new_password, gen_salt('bf')) where username = p_username;
  return jsonb_build_object('ok', true);
end $$;

-- Exclui definitivamente um admin — mesma trava de "não pode ser o último
-- ativo" e "não pode ser você mesmo" usada pra desativar.
create or replace function public.pulso_admin_delete_admin(p_token text, p_username text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_self text; v_active_count int;
begin
  select username into v_self from pulso_sessions
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now();
  if v_self is null then raise exception 'unauthorized'; end if;
  if v_self = p_username then raise exception 'cannot delete your own account'; end if;
  select count(*) into v_active_count from pulso_admins where active and username <> p_username;
  if v_active_count = 0 then raise exception 'cannot delete the last active admin'; end if;
  delete from pulso_admins where username = p_username;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  public.pulso_admin_update_profile(text, text, text, text),
  public.pulso_admin_reset_password(text, text, text),
  public.pulso_admin_delete_admin(text, text)
  to anon, authenticated;
