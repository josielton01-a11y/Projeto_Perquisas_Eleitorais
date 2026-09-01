-- Remove todos os dados operacionais de pesquisas.
-- Preserva administradores, cidades e ruas.

insert into public.pulso_state (key, value, updated_at)
values
  ('researches', '[]'::jsonb, now()),
  ('questions', '[]'::jsonb, now())
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;

delete from public.pulso_agent_accesses;
