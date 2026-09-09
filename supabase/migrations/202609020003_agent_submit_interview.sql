-- Até agora, quando um agente terminava uma entrevista no Pulso Campo, ela só
-- era salva no localStorage do próprio dispositivo (persistResearches), nunca
-- chegava ao Supabase — por isso o painel admin nunca mostrava as entrevistas
-- reais feitas em campo. Esta função permite que o próprio agente (com login
-- e senha, sem precisar de token de admin) grave sua entrevista no servidor.

create or replace function public.pulso_agent_submit_interview(
  p_login text,
  p_password text,
  p_interview jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare
  v_access pulso_agent_accesses;
  v_researches jsonb;
  v_updated jsonb;
begin
  select * into v_access from pulso_agent_accesses
    where login = p_login and password_hash = crypt(p_password, password_hash) and not blocked;
  if not found then raise exception 'unauthorized'; end if;

  select value into v_researches from pulso_state where key = 'researches';

  select coalesce(jsonb_agg(
    case
      when (x.value->>'id')::bigint = v_access.research_id then
        (x.value
          || jsonb_build_object('responses', coalesce((x.value->>'responses')::int, 0) + 1)
          || jsonb_build_object('interviews', coalesce(x.value->'interviews', '[]'::jsonb) || jsonb_build_array(p_interview))
          || jsonb_build_object('agents', (
               select coalesce(jsonb_agg(
                 case when a.value->>'id' = v_access.agent_id
                   then a.value || jsonb_build_object(
                     'completed', coalesce((a.value->>'completed')::int, 0) + 1,
                     'updatedAt', to_char(now(), 'DD/MM/YYYY HH24:MI:SS')
                   )
                   else a.value
                 end
               ), '[]'::jsonb)
               from jsonb_array_elements(coalesce(x.value->'agents', '[]'::jsonb)) a
             ))
        )
      else x.value
    end
  ), '[]'::jsonb)
  into v_updated
  from jsonb_array_elements(coalesce(v_researches, '[]'::jsonb)) x;

  update pulso_state set value = v_updated, updated_at = now() where key = 'researches';

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.pulso_agent_submit_interview(text, text, jsonb) to anon, authenticated;
