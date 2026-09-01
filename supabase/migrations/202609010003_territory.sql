create table if not exists public.pulso_cidades (
  id bigint primary key,
  nome text not null,
  uf char(2) not null,
  created_at timestamptz not null default now(),
  unique (nome, uf)
);

create table if not exists public.pulso_ruas (
  id bigint primary key,
  cidade_id bigint not null references public.pulso_cidades(id),
  nome text not null,
  cep text,
  distrito text,
  bairro text,
  loteamento text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_pulso_ruas_cidade on public.pulso_ruas(cidade_id);
create index if not exists idx_pulso_ruas_nome on public.pulso_ruas(nome);
create index if not exists idx_pulso_ruas_cep on public.pulso_ruas(cep);
create index if not exists idx_pulso_ruas_bairro on public.pulso_ruas(bairro);

alter table public.pulso_cidades enable row level security;
alter table public.pulso_ruas enable row level security;
revoke insert, update, delete on public.pulso_cidades, public.pulso_ruas from anon, authenticated;
grant select on public.pulso_cidades, public.pulso_ruas to anon, authenticated;

drop policy if exists pulso_cidades_leitura on public.pulso_cidades;
create policy pulso_cidades_leitura on public.pulso_cidades for select to anon, authenticated using (true);
drop policy if exists pulso_ruas_leitura on public.pulso_ruas;
create policy pulso_ruas_leitura on public.pulso_ruas for select to anon, authenticated using (true);

insert into public.pulso_cidades(id,nome,uf)
values (1,'Bonito','PE')
on conflict (id) do update set nome=excluded.nome,uf=excluded.uf;
