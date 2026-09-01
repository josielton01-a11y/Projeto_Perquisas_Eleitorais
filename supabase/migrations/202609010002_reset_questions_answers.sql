update public.pulso_state
set value = '[]'::jsonb, updated_at = now()
where key = 'questions';

update public.pulso_state
set value = coalesce((
  select jsonb_agg((research - 'interviews') || jsonb_build_object('interviews','[]'::jsonb,'responses',0))
  from jsonb_array_elements(value) research
), '[]'::jsonb), updated_at = now()
where key = 'researches';
