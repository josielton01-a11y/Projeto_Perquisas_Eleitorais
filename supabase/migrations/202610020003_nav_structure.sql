-- Estrutura da Plataforma (Configurações > Estrutura da Plataforma).
-- A navegação do Pulso era um array fixo no código (7 itens). Esta
-- migration cria uma tabela real pra ela — fonte única de verdade que o
-- sidebar passa a consultar — e migra os 7 itens existentes como seed,
-- sem alterar nenhum rótulo/rota que o front-end já usa pra rotear
-- (Module() continua comparando pelo mesmo texto de sempre).

create table public.pulso_nav_items (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.pulso_nav_items(id) on delete restrict,
  kind text not null check (kind in ('area','group','page','tab')),
  label text not null,
  description text,
  icon text,
  route text,
  position int not null default 0,
  status text not null default 'active' check (status in ('active','inactive','building')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pulso_nav_items_parent_idx on public.pulso_nav_items(parent_id);

insert into public.pulso_nav_items (kind, label, icon, route, position, status) values
  ('page', 'Visão geral', 'LayoutDashboard', 'Visão geral', 0, 'active'),
  ('page', 'Pesquisas', 'ClipboardList', 'Pesquisas', 1, 'active'),
  ('page', 'Banco de perguntas', 'FileText', 'Banco de perguntas', 2, 'active'),
  ('page', 'Território & cotas', 'MapPinned', 'Território & cotas', 3, 'active'),
  ('page', 'Mapa de cobertura', 'Map', 'Mapa de cobertura', 4, 'active'),
  ('page', 'Relatórios', 'ChartNoAxesCombined', 'Relatórios', 5, 'active'),
  ('page', 'Permissões', 'UserRoundCheck', 'Permissões', 6, 'active'),
  ('page', 'Estrutura da Plataforma', 'Layers3', 'Estrutura da Plataforma', 7, 'active');

-- Lista a árvore inteira (plana — o cliente monta a hierarquia).
create or replace function public.pulso_admin_list_nav_tree(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
        'id', id, 'parentId', parent_id, 'kind', kind, 'label', label,
        'description', description, 'icon', icon, 'route', route,
        'position', position, 'status', status,
        'createdAt', created_at, 'updatedAt', updated_at
      ) order by coalesce(parent_id::text, ''), position)
     from pulso_nav_items),
    '[]'::jsonb
  );
end $$;

-- Cria um item novo (área/grupo/página/aba), validando tipo de filho
-- permitido pro pai informado e duplicidade de nome entre irmãos.
create or replace function public.pulso_admin_create_nav_item(
  p_token text, p_parent_id uuid, p_kind text, p_label text,
  p_description text, p_icon text, p_route text, p_status text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_parent_kind text; v_next_position int; v_id uuid;
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label is required';
  end if;
  if p_kind not in ('area','group','page','tab') then
    raise exception 'invalid kind';
  end if;
  if p_parent_id is null then
    if p_kind not in ('area','group','page') then
      raise exception 'root items must be area, group or page';
    end if;
  else
    select kind into v_parent_kind from pulso_nav_items where id = p_parent_id;
    if v_parent_kind is null then raise exception 'parent not found'; end if;
    if v_parent_kind = 'area' and p_kind not in ('group','page') then
      raise exception 'an area can only contain groups or pages';
    elsif v_parent_kind = 'group' and p_kind not in ('group','page') then
      raise exception 'a group can only contain groups or pages';
    elsif v_parent_kind = 'page' and p_kind <> 'tab' then
      raise exception 'a page can only contain tabs';
    elsif v_parent_kind = 'tab' then
      raise exception 'a tab cannot have children';
    end if;
  end if;
  if exists(
    select 1 from pulso_nav_items
    where coalesce(parent_id::text, '') = coalesce(p_parent_id::text, '') and label = p_label
  ) then
    raise exception 'an item with this name already exists at this level';
  end if;
  select coalesce(max(position), -1) + 1 into v_next_position
  from pulso_nav_items where coalesce(parent_id::text, '') = coalesce(p_parent_id::text, '');
  insert into pulso_nav_items(parent_id, kind, label, description, icon, route, position, status)
  values (
    p_parent_id, p_kind, p_label,
    nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_icon, '')), ''),
    nullif(trim(coalesce(p_route, '')), ''),
    v_next_position, coalesce(nullif(p_status, ''), 'active')
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Edita campos de um item — nunca pai nem posição (isso é mover/reordenar).
create or replace function public.pulso_admin_update_nav_item(
  p_token text, p_id uuid, p_label text, p_description text,
  p_icon text, p_route text, p_status text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_parent_id uuid; v_found boolean;
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if coalesce(trim(p_label), '') = '' then
    raise exception 'label is required';
  end if;
  select parent_id, true into v_parent_id, v_found from pulso_nav_items where id = p_id;
  if not v_found then raise exception 'item not found'; end if;
  if exists(
    select 1 from pulso_nav_items
    where coalesce(parent_id::text, '') = coalesce(v_parent_id::text, '') and label = p_label and id <> p_id
  ) then
    raise exception 'an item with this name already exists at this level';
  end if;
  update pulso_nav_items set
    label = p_label,
    description = nullif(trim(coalesce(p_description, '')), ''),
    icon = nullif(trim(coalesce(p_icon, '')), ''),
    route = nullif(trim(coalesce(p_route, '')), ''),
    status = coalesce(nullif(p_status, ''), status),
    updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Move um item pra outro pai (ou pra raiz) — separado de reordenar, porque
-- é uma mudança estrutural mais importante. Valida ciclo e tipo de filho
-- permitido pro novo pai.
create or replace function public.pulso_admin_move_nav_item(p_token text, p_id uuid, p_new_parent_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_kind text; v_parent_kind text; v_cursor uuid; v_next_position int;
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if p_new_parent_id = p_id then
    raise exception 'an item cannot be its own parent';
  end if;
  select kind into v_kind from pulso_nav_items where id = p_id;
  if v_kind is null then raise exception 'item not found'; end if;
  v_cursor := p_new_parent_id;
  while v_cursor is not null loop
    if v_cursor = p_id then
      raise exception 'cannot move an item under its own descendant';
    end if;
    select parent_id into v_cursor from pulso_nav_items where id = v_cursor;
  end loop;
  if p_new_parent_id is null then
    if v_kind not in ('area', 'group', 'page') then
      raise exception 'root items must be area, group or page';
    end if;
  else
    select kind into v_parent_kind from pulso_nav_items where id = p_new_parent_id;
    if v_parent_kind is null then raise exception 'parent not found'; end if;
    if v_parent_kind = 'area' and v_kind not in ('group', 'page') then
      raise exception 'an area can only contain groups or pages';
    elsif v_parent_kind = 'group' and v_kind not in ('group', 'page') then
      raise exception 'a group can only contain groups or pages';
    elsif v_parent_kind = 'page' and v_kind <> 'tab' then
      raise exception 'a page can only contain tabs';
    elsif v_parent_kind = 'tab' then
      raise exception 'a tab cannot have children';
    end if;
  end if;
  select coalesce(max(position), -1) + 1 into v_next_position
  from pulso_nav_items where coalesce(parent_id::text, '') = coalesce(p_new_parent_id::text, '');
  update pulso_nav_items set parent_id = p_new_parent_id, position = v_next_position, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Reordena os irmãos de um mesmo pai (usado pelas setas ↑/↓ da árvore).
create or replace function public.pulso_admin_reorder_nav_items(p_token text, p_parent_id uuid, p_ordered_ids jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_count_given int; v_count_actual int; v_id uuid; v_idx int;
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  select jsonb_array_length(p_ordered_ids) into v_count_given;
  select count(*) into v_count_actual from pulso_nav_items where coalesce(parent_id::text, '') = coalesce(p_parent_id::text, '');
  if v_count_given is null or v_count_given <> v_count_actual then
    raise exception 'ordered id list does not match the current siblings';
  end if;
  for v_idx in 0 .. v_count_given - 1 loop
    v_id := (p_ordered_ids ->> v_idx)::uuid;
    update pulso_nav_items set position = v_idx, updated_at = now()
    where id = v_id and coalesce(parent_id::text, '') = coalesce(p_parent_id::text, '');
    if not found then
      raise exception 'item does not belong to this parent';
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- Ativa/desativa/marca "em construção" um item.
create or replace function public.pulso_admin_set_nav_status(p_token text, p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('active', 'inactive', 'building') then
    raise exception 'invalid status';
  end if;
  update pulso_nav_items set status = p_status, updated_at = now() where id = p_id;
  if not found then raise exception 'item not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Exclui um item sem filhos. Com filhos, recusa e informa a contagem (o
-- cliente traduz "has_children:N" num aviso, em vez de cascatear a exclusão.
create or replace function public.pulso_admin_delete_nav_item(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_children int;
begin
  if not exists(select 1 from pulso_sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex') and expires_at > now()) then
    raise exception 'unauthorized';
  end if;
  select count(*) into v_children from pulso_nav_items where parent_id = p_id;
  if v_children > 0 then
    raise exception 'has_children:%', v_children;
  end if;
  delete from pulso_nav_items where id = p_id;
  if not found then raise exception 'item not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  public.pulso_admin_list_nav_tree(text),
  public.pulso_admin_create_nav_item(text, uuid, text, text, text, text, text, text),
  public.pulso_admin_update_nav_item(text, uuid, text, text, text, text, text),
  public.pulso_admin_move_nav_item(text, uuid, uuid),
  public.pulso_admin_reorder_nav_items(text, uuid, jsonb),
  public.pulso_admin_set_nav_status(text, uuid, text),
  public.pulso_admin_delete_nav_item(text, uuid)
  to anon, authenticated;
