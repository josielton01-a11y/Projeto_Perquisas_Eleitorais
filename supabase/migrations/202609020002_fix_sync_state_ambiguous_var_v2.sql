-- A correção anterior (202609020001) só renomeou a variável PL/pgSQL, mas
-- manteve o mesmo nome como alias de tabela em jsonb_array_elements(...) alias,
-- o que continua ambíguo qualquer que seja o nome escolhido (o Postgres permite
-- usar o alias de uma função de saída única diretamente como o valor, e isso
-- colide com uma variável PL/pgSQL de mesmo nome). A correção definitiva é
-- referenciar a coluna real "value" em vez desse atalho.

create or replace function public.pulso_admin_sync_state(p_token text,p_researches jsonb,p_questions jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_research jsonb; v_agent jsonb; safe_researches jsonb;
begin
  if not exists(select 1 from pulso_sessions where token_hash=encode(digest(p_token,'sha256'),'hex') and expires_at>now()) then raise exception 'unauthorized'; end if;

  select coalesce(jsonb_agg(
    (x.value - 'agents') || jsonb_build_object(
      'agents',
      coalesce((select jsonb_agg(y.value - 'password') from jsonb_array_elements(coalesce(x.value->'agents','[]')) as y), '[]'::jsonb)
    )
  ), '[]'::jsonb)
  into safe_researches
  from jsonb_array_elements(p_researches) as x;

  insert into pulso_state values('researches',safe_researches,now()) on conflict(key) do update set value=excluded.value,updated_at=now();
  insert into pulso_state values('questions',p_questions,now()) on conflict(key) do update set value=excluded.value,updated_at=now();

  for v_research in select value from jsonb_array_elements(p_researches) loop
    for v_agent in select value from jsonb_array_elements(coalesce(v_research->'agents','[]')) loop
      if coalesce(v_agent->>'login','')<>'' and coalesce(v_agent->>'password','')<>'' then
        insert into pulso_agent_accesses values(v_agent->>'login',crypt(v_agent->>'password',gen_salt('bf')),(v_research->>'id')::bigint,v_agent->>'id',coalesce((v_agent->>'blocked')::boolean,false))
        on conflict(login) do update set password_hash=excluded.password_hash,research_id=excluded.research_id,agent_id=excluded.agent_id,blocked=excluded.blocked;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.pulso_admin_sync_state(text,jsonb,jsonb) to anon,authenticated;
