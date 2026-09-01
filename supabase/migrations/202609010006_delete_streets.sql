create or replace function public.pulso_admin_delete_street(
  p_token text,
  p_id bigint
) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
begin
  if not exists(
    select 1 from pulso_sessions
    where token_hash=encode(digest(p_token,'sha256'),'hex')
      and expires_at>now()
  ) then
    raise exception 'unauthorized';
  end if;

  delete from pulso_ruas where id=p_id;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.pulso_admin_delete_street(text,bigint) to anon,authenticated;
