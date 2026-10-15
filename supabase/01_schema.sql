-- =====================================================================
--  DDS - Diálogo Diário de Segurança | SESMT - CD Drogasil Manaus
--  Script 01: estrutura do banco (tabelas, segurança, funções RPC)
--  Execute no Supabase: Dashboard > SQL Editor > New query > Run
--  O script é idempotente: pode ser executado novamente sem perder dados.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.colaboradores (
  id             uuid primary key default gen_random_uuid(),
  matricula      text not null unique,
  nome           text not null,
  cpf_hash       text not null,                 -- CPF nunca é salvo em texto puro (bcrypt)
  cargo          text,
  setor          text,
  perfil         text not null default 'colaborador'
                 check (perfil in ('colaborador','supervisor','admin')),
  perfil_manual  boolean not null default false, -- true = perfil definido pelo SESMT, a importação não altera
  ativo          boolean not null default true,
  incluido_em    timestamptz not null default now(),
  desligado_em   timestamptz,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.colaboradores_historico (
  id              bigint generated always as identity primary key,
  colaborador_id  uuid not null references public.colaboradores(id) on delete restrict,
  evento          text not null,   -- admissao | desligamento | readmissao | mudanca_setor | mudanca_cargo | mudanca_nome | mudanca_cpf | mudanca_perfil
  valor_anterior  text,
  valor_novo      text,
  origem          text not null default 'manual',  -- importacao | manual | sistema
  registrado_por  uuid references public.colaboradores(id) on delete restrict,
  registrado_em   timestamptz not null default now()
);
create index if not exists idx_hist_colab on public.colaboradores_historico(colaborador_id);

create table if not exists public.importacoes (
  id             bigint generated always as identity primary key,
  arquivo        text,
  realizado_por  uuid references public.colaboradores(id) on delete restrict,
  realizado_em   timestamptz not null default now(),
  resumo         jsonb not null default '{}'::jsonb
);

create table if not exists public.sessoes (
  token          text primary key,
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  criado_em      timestamptz not null default now(),
  expira_em      timestamptz not null,
  user_agent     text
);
create index if not exists idx_sessoes_colab on public.sessoes(colaborador_id);

create table if not exists public.tentativas_login (
  id         bigint generated always as identity primary key,
  matricula  text,
  sucesso    boolean not null,
  em         timestamptz not null default now()
);
create index if not exists idx_tent_mat on public.tentativas_login(matricula, em);

create table if not exists public.supervisor_setores (
  supervisor_id uuid not null references public.colaboradores(id) on delete restrict,
  setor         text not null,
  primary key (supervisor_id, setor)
);

create table if not exists public.temas (
  id               uuid primary key default gen_random_uuid(),
  titulo           text not null,
  conteudo         text not null,
  objetivo         text,
  publico_alvo     text default 'Todos os colaboradores do CD AM',
  tipo             text not null default 'comportamental'
                   check (tipo in ('tecnico','comportamental','tecnico_comportamental')),
  carga_horaria_min integer not null default 15,
  material_url     text,
  semana_inicio    date not null,
  semana_fim       date not null,
  status           text not null default 'publicado' check (status in ('rascunho','publicado','arquivado')),
  criado_por       uuid references public.colaboradores(id) on delete restrict,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (semana_fim >= semana_inicio)
);

create table if not exists public.reunioes (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null,
  tema_id               uuid not null references public.temas(id) on delete restrict,
  supervisor_id         uuid not null references public.colaboradores(id) on delete restrict,
  supervisor_nome       text not null,      -- "fotografia" no momento da reunião
  supervisor_matricula  text not null,
  supervisor_cargo      text,
  supervisor_setor      text,
  data                  date not null,
  horario               time,
  local                 text,
  observacoes           text,
  status                text not null default 'aberta' check (status in ('aberta','encerrada')),
  assinatura_instrutor  text,
  encerrada_em          timestamptz,
  criado_em             timestamptz not null default now(),
  unique (data, codigo)
);
create index if not exists idx_reunioes_tema on public.reunioes(tema_id);
create index if not exists idx_reunioes_sup on public.reunioes(supervisor_id);

create table if not exists public.assinaturas (
  id                uuid primary key default gen_random_uuid(),
  reuniao_id        uuid not null references public.reunioes(id) on delete restrict,
  tema_id           uuid not null references public.temas(id) on delete restrict,
  colaborador_id    uuid not null references public.colaboradores(id) on delete restrict,
  matricula         text not null,          -- "fotografia" do colaborador no momento da assinatura
  nome              text not null,
  cargo             text,
  setor             text,
  assinatura        text not null,          -- imagem PNG (data URL) da assinatura desenhada
  metodo            text not null check (metodo in ('proprio_dispositivo','quiosque')),
  assinado_em       timestamptz not null default now(),
  user_agent        text,
  hash_integridade  text not null,
  unique (tema_id, colaborador_id)
);
create index if not exists idx_ass_reuniao on public.assinaturas(reuniao_id);
create index if not exists idx_ass_colab on public.assinaturas(colaborador_id);

-- ---------------------------------------------------------------------
-- PROTEÇÃO DAS EVIDÊNCIAS
--  * assinaturas não podem ser alteradas nem apagadas
--  * colaboradores nunca são apagados (apenas desligados)
-- ---------------------------------------------------------------------
create or replace function public._bloquear_alteracao() returns trigger
language plpgsql as $$
begin
  raise exception 'EVIDENCIA_PROTEGIDA: registros de % não podem ser alterados/excluídos', tg_table_name;
end $$;

drop trigger if exists trg_assinaturas_imutaveis on public.assinaturas;
create trigger trg_assinaturas_imutaveis before update or delete on public.assinaturas
  for each row execute function public._bloquear_alteracao();

drop trigger if exists trg_colaboradores_sem_delete on public.colaboradores;
create trigger trg_colaboradores_sem_delete before delete on public.colaboradores
  for each row execute function public._bloquear_alteracao();

drop trigger if exists trg_historico_imutavel on public.colaboradores_historico;
create trigger trg_historico_imutavel before update or delete on public.colaboradores_historico
  for each row execute function public._bloquear_alteracao();

-- Reunião encerrada com assinaturas não pode ser excluída (FK restrict já garante)

-- ---------------------------------------------------------------------
-- SEGURANÇA: RLS ligado e SEM políticas -> a chave anon não lê nem grava
-- tabelas diretamente. Todo acesso passa pelas funções abaixo, que
-- validam o token de sessão e o perfil do usuário.
-- ---------------------------------------------------------------------
alter table public.colaboradores            enable row level security;
alter table public.colaboradores_historico  enable row level security;
alter table public.importacoes              enable row level security;
alter table public.sessoes                  enable row level security;
alter table public.tentativas_login         enable row level security;
alter table public.supervisor_setores       enable row level security;
alter table public.temas                    enable row level security;
alter table public.reunioes                 enable row level security;
alter table public.assinaturas              enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
-- FUNÇÕES AUXILIARES (internas)
-- ---------------------------------------------------------------------
create or replace function public._hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Manaus')::date $$;

create or replace function public._so_digitos(p text) returns text
language sql immutable as $$ select regexp_replace(coalesce(p,''), '\D', '', 'g') $$;

create or replace function public._norm_cpf(p text) returns text
language sql immutable as $$ select lpad(public._so_digitos(p), 11, '0') $$;

create or replace function public._norm_mat(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p,''), '\s', '', 'g'), '\.0+$', '')
$$;

create or replace function public._perfil_por_cargo(p_cargo text) returns text
language sql immutable as $$
  select case when p_cargo ilike '%supervisor%' or p_cargo ilike '%coordenador%'
              then 'supervisor' else 'colaborador' end
$$;

create or replace function public._sessao(p_token text, p_perfis text[] default null)
returns public.colaboradores
language plpgsql security definer set search_path = public, extensions as $$
declare c public.colaboradores;
begin
  select col.* into c
    from public.sessoes s join public.colaboradores col on col.id = s.colaborador_id
   where s.token = p_token and s.expira_em > now() and col.ativo;
  if not found then
    raise exception 'SESSAO_INVALIDA';
  end if;
  if p_perfis is not null and not (c.perfil = any(p_perfis)) then
    raise exception 'ACESSO_NEGADO';
  end if;
  return c;
end $$;

create or replace function public._log(p_colab uuid, p_evento text, p_ant text, p_novo text, p_origem text, p_por uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.colaboradores_historico(colaborador_id, evento, valor_anterior, valor_novo, origem, registrado_por)
  values (p_colab, p_evento, p_ant, p_novo, p_origem, p_por);
$$;

-- Equipe (ativos no período) de um supervisor
create or replace function public._equipe(p_sup uuid, p_ini date, p_fim date)
returns setof public.colaboradores
language sql stable security definer set search_path = public as $$
  select c.* from public.colaboradores c
   where c.setor in (select setor from public.supervisor_setores where supervisor_id = p_sup)
     and c.id <> p_sup
     and c.incluido_em::date <= p_fim
     and (c.desligado_em is null or c.desligado_em::date >= p_ini)
$$;

-- Base total de participantes (colaboradores ativos no período, exceto supervisores/SESMT que conduzem o DDS)
create or replace function public._base(p_ini date, p_fim date)
returns setof public.colaboradores
language sql stable security definer set search_path = public as $$
  select c.* from public.colaboradores c
   where c.perfil = 'colaborador'
     and c.incluido_em::date <= p_fim
     and (c.desligado_em is null or c.desligado_em::date >= p_ini)
$$;

create or replace function public._colab_json(c public.colaboradores) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', c.id, 'matricula', c.matricula, 'nome', c.nome, 'cargo', c.cargo,
                            'setor', c.setor, 'perfil', c.perfil, 'ativo', c.ativo)
$$;

-- Inserção / atualização de um colaborador (usado na importação e no cadastro manual)
create or replace function public._upsert_colaborador(p jsonb, p_origem text, p_por uuid)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_mat   text := public._norm_mat(p->>'matricula');
  v_nome  text := nullif(trim(p->>'nome'), '');
  v_cpf   text := public._norm_cpf(p->>'cpf');
  v_cargo text := nullif(trim(p->>'cargo'), '');
  v_setor text := nullif(trim(p->>'setor'), '');
  c public.colaboradores;
  v_acao text := 'sem_alteracao';
begin
  if v_mat = '' or v_nome is null or public._so_digitos(p->>'cpf') = '' then
    return 'invalido';
  end if;

  select * into c from public.colaboradores where matricula = v_mat;

  if not found then
    insert into public.colaboradores(matricula, nome, cpf_hash, cargo, setor, perfil)
    values (v_mat, v_nome, crypt(v_cpf, gen_salt('bf', 8)), v_cargo, v_setor, public._perfil_por_cargo(v_cargo))
    returning * into c;
    perform public._log(c.id, 'admissao', null, coalesce(v_setor,'') || ' / ' || coalesce(v_cargo,''), p_origem, p_por);
    return 'novo';
  end if;

  if not c.ativo then
    update public.colaboradores set ativo = true, desligado_em = null, atualizado_em = now() where id = c.id;
    perform public._log(c.id, 'readmissao', null, coalesce(v_setor,''), p_origem, p_por);
    v_acao := 'readmitido';
  end if;

  if coalesce(c.setor,'') <> coalesce(v_setor,'') then
    update public.colaboradores set setor = v_setor, atualizado_em = now() where id = c.id;
    perform public._log(c.id, 'mudanca_setor', c.setor, v_setor, p_origem, p_por);
    if v_acao = 'sem_alteracao' then v_acao := 'atualizado'; end if;
  end if;

  if coalesce(c.cargo,'') <> coalesce(v_cargo,'') then
    update public.colaboradores set cargo = v_cargo, atualizado_em = now() where id = c.id;
    perform public._log(c.id, 'mudanca_cargo', c.cargo, v_cargo, p_origem, p_por);
    if not c.perfil_manual and c.perfil <> 'admin' and c.perfil <> public._perfil_por_cargo(v_cargo) then
      update public.colaboradores set perfil = public._perfil_por_cargo(v_cargo) where id = c.id;
      perform public._log(c.id, 'mudanca_perfil', c.perfil, public._perfil_por_cargo(v_cargo), 'sistema', p_por);
    end if;
    if v_acao = 'sem_alteracao' then v_acao := 'atualizado'; end if;
  end if;

  if c.nome <> v_nome then
    update public.colaboradores set nome = v_nome, atualizado_em = now() where id = c.id;
    perform public._log(c.id, 'mudanca_nome', c.nome, v_nome, p_origem, p_por);
    if v_acao = 'sem_alteracao' then v_acao := 'atualizado'; end if;
  end if;

  if c.cpf_hash <> crypt(v_cpf, c.cpf_hash) then
    update public.colaboradores set cpf_hash = crypt(v_cpf, gen_salt('bf', 8)), atualizado_em = now() where id = c.id;
    perform public._log(c.id, 'mudanca_cpf', null, '(CPF atualizado)', p_origem, p_por);
    if v_acao = 'sem_alteracao' then v_acao := 'atualizado'; end if;
  end if;

  return v_acao;
end $$;

create or replace function public._registrar_assinatura(c public.colaboradores, p_reuniao_id uuid,
  p_assinatura text, p_metodo text, p_user_agent text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r public.reunioes; v_now timestamptz := now(); v_hash text; v_id uuid;
begin
  select * into r from public.reunioes where id = p_reuniao_id;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if r.status <> 'aberta' then raise exception 'REUNIAO_ENCERRADA'; end if;
  if r.data <> public._hoje() then raise exception 'REUNIAO_FORA_DO_DIA'; end if;
  if p_assinatura is null or left(p_assinatura, 22) <> 'data:image/png;base64,' or length(p_assinatura) > 300000 then
    raise exception 'ASSINATURA_INVALIDA';
  end if;
  if exists (select 1 from public.assinaturas where tema_id = r.tema_id and colaborador_id = c.id) then
    raise exception 'JA_ASSINOU';
  end if;

  v_hash := encode(digest(concat_ws('|', r.id::text, r.tema_id::text, c.id::text, c.matricula, c.nome,
                   extract(epoch from v_now)::text, p_assinatura), 'sha256'), 'hex');

  insert into public.assinaturas(reuniao_id, tema_id, colaborador_id, matricula, nome, cargo, setor,
                                 assinatura, metodo, assinado_em, user_agent, hash_integridade)
  values (r.id, r.tema_id, c.id, c.matricula, c.nome, c.cargo, c.setor,
          p_assinatura, p_metodo, v_now, left(p_user_agent, 300), v_hash)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'nome', c.nome, 'matricula', c.matricula,
                            'assinado_em', v_now, 'hash', v_hash);
end $$;

-- ---------------------------------------------------------------------
-- RPC: AUTENTICAÇÃO
-- ---------------------------------------------------------------------
create or replace function public.login(p_matricula text, p_cpf text, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_mat text := public._norm_mat(p_matricula);
  v_cpf text := public._norm_cpf(p_cpf);
  v_falhas int; v_token text; c public.colaboradores;
begin
  select count(*) into v_falhas from public.tentativas_login
   where matricula = v_mat and not sucesso and em > now() - interval '15 minutes';
  if v_falhas >= 5 then
    return jsonb_build_object('erro', 'BLOQUEADO');
  end if;

  select * into c from public.colaboradores where matricula = v_mat;
  if not found or c.cpf_hash <> crypt(v_cpf, c.cpf_hash) then
    insert into public.tentativas_login(matricula, sucesso) values (v_mat, false);
    return jsonb_build_object('erro', 'CREDENCIAIS_INVALIDAS');
  end if;
  if not c.ativo then
    return jsonb_build_object('erro', 'DESLIGADO');
  end if;

  insert into public.tentativas_login(matricula, sucesso) values (v_mat, true);
  delete from public.sessoes where expira_em < now();
  delete from public.tentativas_login where em < now() - interval '30 days';

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessoes(token, colaborador_id, expira_em, user_agent)
  values (v_token, c.id, now() + interval '12 hours', left(p_user_agent, 300));

  return jsonb_build_object('token', v_token, 'usuario', public._colab_json(c));
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.sessoes where token = p_token;
$$;

create or replace function public.me(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token);
begin
  return public._colab_json(c);
end $$;

-- ---------------------------------------------------------------------
-- RPC: COLABORADOR
-- ---------------------------------------------------------------------
create or replace function public.tema_semana(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'titulo', t.titulo, 'conteudo', t.conteudo, 'objetivo', t.objetivo,
      'tipo', t.tipo, 'material_url', t.material_url, 'semana_inicio', t.semana_inicio,
      'semana_fim', t.semana_fim, 'carga_horaria_min', t.carga_horaria_min,
      'assinado_em', (select a.assinado_em from public.assinaturas a where a.tema_id = t.id and a.colaborador_id = c.id)
    ) order by t.semana_inicio desc)
    from public.temas t
    where t.status = 'publicado' and public._hoje() between t.semana_inicio and t.semana_fim
  ), '[]'::jsonb);
end $$;

create or replace function public.buscar_reuniao(p_token text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token); r public.reunioes; t public.temas;
begin
  select * into r from public.reunioes
   where codigo = public._so_digitos(p_codigo) and data = public._hoje() and status = 'aberta';
  if not found then raise exception 'CODIGO_INVALIDO'; end if;
  select * into t from public.temas where id = r.tema_id;
  return jsonb_build_object(
    'reuniao', jsonb_build_object('id', r.id, 'codigo', r.codigo, 'data', r.data, 'horario', r.horario,
                                  'local', r.local, 'supervisor_nome', r.supervisor_nome),
    'tema', jsonb_build_object('id', t.id, 'titulo', t.titulo, 'conteudo', t.conteudo, 'objetivo', t.objetivo,
                               'material_url', t.material_url, 'tipo', t.tipo),
    'ja_assinou', exists(select 1 from public.assinaturas where tema_id = t.id and colaborador_id = c.id)
  );
end $$;

create or replace function public.assinar(p_token text, p_reuniao_id uuid, p_codigo text,
  p_assinatura text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token);
begin
  if not exists (select 1 from public.reunioes where id = p_reuniao_id and codigo = public._so_digitos(p_codigo)) then
    raise exception 'CODIGO_INVALIDO';
  end if;
  return public._registrar_assinatura(c, p_reuniao_id, p_assinatura, 'proprio_dispositivo', p_user_agent);
end $$;

create or replace function public.minhas_assinaturas(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('tema', t.titulo, 'data', r.data, 'supervisor', r.supervisor_nome,
                     'assinado_em', a.assinado_em, 'hash', a.hash_integridade) order by a.assinado_em desc)
      from public.assinaturas a join public.reunioes r on r.id = a.reuniao_id join public.temas t on t.id = a.tema_id
     where a.colaborador_id = c.id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- RPC: SUPERVISOR (perfis supervisor e admin)
-- ---------------------------------------------------------------------
create or replace function public.sup_painel(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['supervisor','admin']);
begin
  return jsonb_build_object(
    'temas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'semana_inicio', t.semana_inicio,
                 'semana_fim', t.semana_fim, 'vigente', public._hoje() between t.semana_inicio and t.semana_fim)
                 order by t.semana_inicio desc)
               from (select * from public.temas where status = 'publicado' and semana_inicio <= public._hoje() + 7
                     order by semana_inicio desc limit 12) t), '[]'::jsonb),
    'reunioes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'data', r.data,
                 'horario', r.horario, 'local', r.local, 'status', r.status, 'tema', t.titulo,
                 'assinaturas', (select count(*) from public.assinaturas a where a.reuniao_id = r.id))
                 order by r.data desc, r.criado_em desc)
               from public.reunioes r join public.temas t on t.id = r.tema_id
               where r.supervisor_id = c.id and r.data >= public._hoje() - 120), '[]'::jsonb),
    'setores', coalesce((select jsonb_agg(setor order by setor) from public.supervisor_setores where supervisor_id = c.id), '[]'::jsonb),
    'equipe_total', (select count(*) from public._equipe(c.id, public._hoje(), public._hoje()) e where e.ativo)
  );
end $$;

create or replace function public.sup_criar_reuniao(p_token text, p_tema_id uuid, p_horario text default null,
  p_local text default null, p_observacoes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['supervisor','admin']);
        v_cod text; v_id uuid; i int := 0;
begin
  if not exists (select 1 from public.temas where id = p_tema_id and status = 'publicado') then
    raise exception 'TEMA_INVALIDO';
  end if;
  loop
    v_cod := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.reunioes where data = public._hoje() and codigo = v_cod);
    i := i + 1; if i > 50 then raise exception 'FALHA_CODIGO'; end if;
  end loop;
  insert into public.reunioes(codigo, tema_id, supervisor_id, supervisor_nome, supervisor_matricula,
                              supervisor_cargo, supervisor_setor, data, horario, local, observacoes)
  values (v_cod, p_tema_id, c.id, c.nome, c.matricula, c.cargo, c.setor, public._hoje(),
          nullif(p_horario,'')::time, nullif(trim(p_local),''), nullif(trim(p_observacoes),''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $$;

create or replace function public.reuniao_detalhe(p_token text, p_reuniao_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['supervisor','admin']);
        r public.reunioes; t public.temas;
begin
  select * into r from public.reunioes where id = p_reuniao_id;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if c.perfil <> 'admin' and r.supervisor_id <> c.id then raise exception 'ACESSO_NEGADO'; end if;
  select * into t from public.temas where id = r.tema_id;
  return jsonb_build_object(
    'reuniao', to_jsonb(r),
    'tema', to_jsonb(t),
    'assinaturas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'matricula', a.matricula, 'nome', a.nome,
                    'cargo', a.cargo, 'setor', a.setor, 'assinatura', a.assinatura, 'metodo', a.metodo,
                    'assinado_em', a.assinado_em, 'hash', a.hash_integridade) order by a.assinado_em)
                    from public.assinaturas a where a.reuniao_id = r.id), '[]'::jsonb),
    'pendentes', coalesce((select jsonb_agg(jsonb_build_object('matricula', e.matricula, 'nome', e.nome,
                    'cargo', e.cargo, 'setor', e.setor) order by e.nome)
                    from public._equipe(r.supervisor_id, t.semana_inicio, t.semana_fim) e
                    where e.ativo and not exists (select 1 from public.assinaturas a
                                   where a.tema_id = t.id and a.colaborador_id = e.id)), '[]'::jsonb)
  );
end $$;

create or replace function public.sup_assinar_quiosque(p_token text, p_reuniao_id uuid, p_matricula text,
  p_cpf text, p_assinatura text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.colaboradores := public._sessao(p_token, array['supervisor','admin']);
        c public.colaboradores; r public.reunioes;
begin
  select * into r from public.reunioes where id = p_reuniao_id;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if s.perfil <> 'admin' and r.supervisor_id <> s.id then raise exception 'ACESSO_NEGADO'; end if;
  select * into c from public.colaboradores where matricula = public._norm_mat(p_matricula);
  if not found or c.cpf_hash <> crypt(public._norm_cpf(p_cpf), c.cpf_hash) then
    raise exception 'CREDENCIAIS_INVALIDAS';
  end if;
  if not c.ativo then raise exception 'DESLIGADO'; end if;
  return public._registrar_assinatura(c, p_reuniao_id, p_assinatura, 'quiosque', p_user_agent);
end $$;

create or replace function public.sup_encerrar_reuniao(p_token text, p_reuniao_id uuid, p_assinatura text)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['supervisor','admin']); r public.reunioes;
begin
  select * into r from public.reunioes where id = p_reuniao_id;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if c.perfil <> 'admin' and r.supervisor_id <> c.id then raise exception 'ACESSO_NEGADO'; end if;
  if r.status <> 'aberta' then raise exception 'REUNIAO_ENCERRADA'; end if;
  if p_assinatura is null or left(p_assinatura, 22) <> 'data:image/png;base64,' then
    raise exception 'ASSINATURA_INVALIDA';
  end if;
  update public.reunioes set status = 'encerrada', encerrada_em = now(),
         assinatura_instrutor = coalesce(assinatura_instrutor, p_assinatura)
   where id = r.id;
end $$;

create or replace function public.sup_excluir_reuniao(p_token text, p_reuniao_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['supervisor','admin']); r public.reunioes;
begin
  select * into r from public.reunioes where id = p_reuniao_id;
  if not found then raise exception 'REUNIAO_NAO_ENCONTRADA'; end if;
  if c.perfil <> 'admin' and r.supervisor_id <> c.id then raise exception 'ACESSO_NEGADO'; end if;
  if exists (select 1 from public.assinaturas where reuniao_id = r.id) then
    raise exception 'REUNIAO_COM_ASSINATURAS';
  end if;
  delete from public.reunioes where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- RPC: ADMINISTRAÇÃO SESMT (perfil admin)
-- ---------------------------------------------------------------------
create or replace function public.adm_temas(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
            'reunioes', (select count(*) from public.reunioes r where r.tema_id = t.id),
            'assinaturas', (select count(*) from public.assinaturas a where a.tema_id = t.id))
          order by t.semana_inicio desc) from public.temas t), '[]'::jsonb);
end $$;

create or replace function public.adm_tema_salvar(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']); v_id uuid := nullif(p->>'id','')::uuid;
begin
  if coalesce(trim(p->>'titulo'),'') = '' or coalesce(trim(p->>'conteudo'),'') = '' then
    raise exception 'DADOS_OBRIGATORIOS';
  end if;
  if v_id is null then
    insert into public.temas(titulo, conteudo, objetivo, publico_alvo, tipo, carga_horaria_min, material_url,
                             semana_inicio, semana_fim, status, criado_por)
    values (trim(p->>'titulo'), p->>'conteudo', p->>'objetivo', coalesce(nullif(p->>'publico_alvo',''),'Todos os colaboradores do CD AM'),
            coalesce(nullif(p->>'tipo',''),'comportamental'), coalesce(nullif(p->>'carga_horaria_min','')::int, 15),
            nullif(p->>'material_url',''), (p->>'semana_inicio')::date, (p->>'semana_fim')::date,
            coalesce(nullif(p->>'status',''),'publicado'), c.id)
    returning id into v_id;
  elsif exists (select 1 from public.assinaturas where tema_id = v_id) then
    -- Tema já assinado: o conteúdo fica congelado (evidência). Só status/período/material podem mudar.
    update public.temas set status = coalesce(nullif(p->>'status',''), status),
           semana_fim = greatest(semana_inicio, coalesce((p->>'semana_fim')::date, semana_fim)),
           material_url = nullif(p->>'material_url',''), atualizado_em = now()
     where id = v_id;
  else
    update public.temas set titulo = trim(p->>'titulo'), conteudo = p->>'conteudo', objetivo = p->>'objetivo',
           publico_alvo = coalesce(nullif(p->>'publico_alvo',''), publico_alvo),
           tipo = coalesce(nullif(p->>'tipo',''), tipo),
           carga_horaria_min = coalesce(nullif(p->>'carga_horaria_min','')::int, carga_horaria_min),
           material_url = nullif(p->>'material_url',''),
           semana_inicio = (p->>'semana_inicio')::date, semana_fim = (p->>'semana_fim')::date,
           status = coalesce(nullif(p->>'status',''), status), atualizado_em = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.adm_tema_excluir(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  if exists (select 1 from public.reunioes where tema_id = p_id) then
    raise exception 'TEMA_COM_REUNIOES';
  end if;
  delete from public.temas where id = p_id;
end $$;

create or replace function public.adm_colaboradores(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'matricula', x.matricula, 'nome', x.nome,
            'cargo', x.cargo, 'setor', x.setor, 'perfil', x.perfil, 'perfil_manual', x.perfil_manual,
            'ativo', x.ativo, 'incluido_em', x.incluido_em, 'desligado_em', x.desligado_em,
            'assinaturas', (select count(*) from public.assinaturas a where a.colaborador_id = x.id))
          order by x.nome) from public.colaboradores x), '[]'::jsonb);
end $$;

create or replace function public.adm_colaborador_salvar(p_token text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return public._upsert_colaborador(p, 'manual', c.id);
end $$;

create or replace function public.adm_colaborador_status(p_token text, p_id uuid, p_ativo boolean, p_perfil text)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']); x public.colaboradores;
begin
  select * into x from public.colaboradores where id = p_id;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if x.id = c.id and (not p_ativo or p_perfil <> 'admin') then
    raise exception 'NAO_PODE_ALTERAR_PROPRIO_ACESSO';
  end if;
  if p_perfil is not null and p_perfil <> x.perfil then
    if p_perfil not in ('colaborador','supervisor','admin') then raise exception 'PERFIL_INVALIDO'; end if;
    update public.colaboradores set perfil = p_perfil, perfil_manual = true, atualizado_em = now() where id = x.id;
    perform public._log(x.id, 'mudanca_perfil', x.perfil, p_perfil, 'manual', c.id);
  end if;
  if p_ativo is not null and p_ativo <> x.ativo then
    update public.colaboradores set ativo = p_ativo,
           desligado_em = case when p_ativo then null else now() end, atualizado_em = now() where id = x.id;
    perform public._log(x.id, case when p_ativo then 'readmissao' else 'desligamento' end, null, null, 'manual', c.id);
    if not p_ativo then delete from public.sessoes where colaborador_id = x.id; end if;
  end if;
end $$;

create or replace function public.adm_importar(p_token text, p_linhas jsonb, p_desligar_ausentes boolean,
  p_arquivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
        l jsonb; v_res text; v_mats text[] := '{}';
        n_novo int := 0; n_atu int := 0; n_read int := 0; n_igual int := 0; n_inv int := 0; n_desl int := 0;
        x record;
begin
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'PLANILHA_VAZIA';
  end if;
  for l in select * from jsonb_array_elements(p_linhas) loop
    v_res := public._upsert_colaborador(l, 'importacao', c.id);
    case v_res
      when 'novo' then n_novo := n_novo + 1;
      when 'atualizado' then n_atu := n_atu + 1;
      when 'readmitido' then n_read := n_read + 1;
      when 'invalido' then n_inv := n_inv + 1;
      else n_igual := n_igual + 1;
    end case;
    if v_res <> 'invalido' then v_mats := v_mats || public._norm_mat(l->>'matricula'); end if;
  end loop;

  if p_desligar_ausentes then
    -- segurança: só desliga ausentes se a planilha tiver pelo menos 50% da base ativa
    if array_length(v_mats, 1) < (select count(*) * 0.5 from public.colaboradores where ativo) then
      raise exception 'PLANILHA_INCOMPLETA';
    end if;
    for x in select * from public.colaboradores
              where ativo and id <> c.id and not (matricula = any(v_mats)) loop
      update public.colaboradores set ativo = false, desligado_em = now(), atualizado_em = now() where id = x.id;
      perform public._log(x.id, 'desligamento', x.setor, null, 'importacao', c.id);
      delete from public.sessoes where colaborador_id = x.id;
      n_desl := n_desl + 1;
    end loop;
  end if;

  insert into public.importacoes(arquivo, realizado_por, resumo)
  values (p_arquivo, c.id, jsonb_build_object('novos', n_novo, 'atualizados', n_atu, 'readmitidos', n_read,
          'sem_alteracao', n_igual, 'invalidos', n_inv, 'desligados', n_desl, 'linhas', jsonb_array_length(p_linhas)));

  return jsonb_build_object('novos', n_novo, 'atualizados', n_atu, 'readmitidos', n_read,
         'sem_alteracao', n_igual, 'invalidos', n_inv, 'desligados', n_desl);
end $$;

create or replace function public.adm_historico(p_token text, p_colaborador_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('evento', h.evento, 'anterior', h.valor_anterior,
            'novo', h.valor_novo, 'origem', h.origem, 'em', h.registrado_em, 'nome', x.nome, 'matricula', x.matricula,
            'por', p.nome) order by h.registrado_em desc)
          from (select * from public.colaboradores_historico
                 where p_colaborador_id is null or colaborador_id = p_colaborador_id
                 order by registrado_em desc limit 500) h
          join public.colaboradores x on x.id = h.colaborador_id
          left join public.colaboradores p on p.id = h.registrado_por), '[]'::jsonb);
end $$;

create or replace function public.adm_importacoes(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('arquivo', i.arquivo, 'em', i.realizado_em,
           'por', p.nome, 'resumo', i.resumo) order by i.realizado_em desc)
         from public.importacoes i left join public.colaboradores p on p.id = i.realizado_por), '[]'::jsonb);
end $$;

create or replace function public.adm_equipes(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return jsonb_build_object(
    'supervisores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'matricula', s.matricula,
        'cargo', s.cargo, 'setor', s.setor, 'perfil', s.perfil,
        'setores', coalesce((select jsonb_agg(ss.setor order by ss.setor) from public.supervisor_setores ss where ss.supervisor_id = s.id), '[]'::jsonb))
        order by s.nome) from public.colaboradores s where s.ativo and s.perfil in ('supervisor','admin')), '[]'::jsonb),
    'setores', coalesce((select jsonb_agg(jsonb_build_object('setor', setor, 'total', n) order by setor)
        from (select setor, count(*) n from public.colaboradores where ativo and setor is not null group by setor) z), '[]'::jsonb)
  );
end $$;

create or replace function public.adm_equipe_salvar(p_token text, p_supervisor_id uuid, p_setores text[]) returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  delete from public.supervisor_setores where supervisor_id = p_supervisor_id;
  insert into public.supervisor_setores(supervisor_id, setor)
  select distinct p_supervisor_id, s from unnest(coalesce(p_setores, '{}')) s where trim(s) <> '';
end $$;

-- Painel de entregas por supervisor para um tema
create or replace function public.adm_dashboard(p_token text, p_tema_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']); t public.temas;
begin
  select * into t from public.temas where id = p_tema_id;
  if not found then raise exception 'TEMA_INVALIDO'; end if;
  return jsonb_build_object(
    'tema', to_jsonb(t),
    'base', (select count(*) from public._base(t.semana_inicio, t.semana_fim)),
    'assinaturas', (select count(*) from public.assinaturas where tema_id = t.id),
    'reunioes', (select count(*) from public.reunioes where tema_id = t.id),
    'supervisores', coalesce((select jsonb_agg(z order by z->>'nome') from (
        select jsonb_build_object(
          'id', s.id, 'nome', s.nome, 'matricula', s.matricula, 'cargo', s.cargo,
          'setores', coalesce((select jsonb_agg(ss.setor) from public.supervisor_setores ss where ss.supervisor_id = s.id), '[]'::jsonb),
          'equipe', (select count(*) from public._equipe(s.id, t.semana_inicio, t.semana_fim)),
          'reunioes', (select count(*) from public.reunioes r where r.tema_id = t.id and r.supervisor_id = s.id),
          'assinaturas', (select count(*) from public.assinaturas a join public.reunioes r on r.id = a.reuniao_id
                           where r.tema_id = t.id and r.supervisor_id = s.id),
          'equipe_assinou', (select count(*) from public._equipe(s.id, t.semana_inicio, t.semana_fim) e
                              where exists (select 1 from public.assinaturas a where a.tema_id = t.id and a.colaborador_id = e.id)),
          'ultima_data', (select max(r.data) from public.reunioes r where r.tema_id = t.id and r.supervisor_id = s.id)
        ) z
        from public.colaboradores s
        where (s.ativo and s.perfil = 'supervisor')
           or exists (select 1 from public.reunioes r where r.tema_id = t.id and r.supervisor_id = s.id)
      ) q), '[]'::jsonb),
    'por_setor', coalesce((select jsonb_agg(jsonb_build_object('setor', b.setor, 'total', b.total, 'assinaram', b.ass) order by b.setor)
        from (select coalesce(x.setor,'(sem setor)') setor, count(*) total,
                     count(*) filter (where exists (select 1 from public.assinaturas a where a.tema_id = t.id and a.colaborador_id = x.id)) ass
                from public._base(t.semana_inicio, t.semana_fim) x group by 1) b), '[]'::jsonb)
  );
end $$;

-- Evolução da adesão ao longo dos temas
create or replace function public.adm_evolucao(p_token text, p_limite int default 16) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(z order by z->>'semana_inicio') from (
    select jsonb_build_object('id', t.id, 'titulo', t.titulo, 'semana_inicio', t.semana_inicio, 'semana_fim', t.semana_fim,
      'base', (select count(*) from public._base(t.semana_inicio, t.semana_fim)),
      'assinaturas', (select count(*) from public.assinaturas a where a.tema_id = t.id),
      'reunioes', (select count(*) from public.reunioes r where r.tema_id = t.id),
      'supervisores_total', (select count(*) from public.colaboradores s where s.perfil = 'supervisor'
                              and s.incluido_em::date <= t.semana_fim and (s.desligado_em is null or s.desligado_em::date >= t.semana_inicio)),
      'supervisores_entregaram', (select count(distinct r.supervisor_id) from public.reunioes r join public.colaboradores s on s.id = r.supervisor_id
                                   where r.tema_id = t.id and s.perfil = 'supervisor')
    ) z
    from (select * from public.temas where status <> 'rascunho' order by semana_inicio desc limit p_limite) t) q), '[]'::jsonb);
end $$;

create or replace function public.adm_reunioes(p_token text, p_tema_id uuid default null,
  p_inicio date default null, p_fim date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'codigo', r.codigo, 'data', r.data, 'horario', r.horario,
           'local', r.local, 'status', r.status, 'supervisor', r.supervisor_nome, 'supervisor_matricula', r.supervisor_matricula,
           'tema', t.titulo, 'tema_id', t.id,
           'assinaturas', (select count(*) from public.assinaturas a where a.reuniao_id = r.id))
         order by r.data desc, r.criado_em desc)
         from public.reunioes r join public.temas t on t.id = r.tema_id
        where (p_tema_id is null or r.tema_id = p_tema_id)
          and (p_inicio is null or r.data >= p_inicio)
          and (p_fim is null or r.data <= p_fim)), '[]'::jsonb);
end $$;

create or replace function public.adm_assinaturas(p_token text, p_tema_id uuid default null,
  p_inicio date default null, p_fim date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('tema', t.titulo, 'semana_inicio', t.semana_inicio,
           'data', r.data, 'horario', r.horario, 'local', r.local, 'codigo', r.codigo,
           'supervisor', r.supervisor_nome, 'supervisor_matricula', r.supervisor_matricula,
           'matricula', a.matricula, 'nome', a.nome, 'cargo', a.cargo, 'setor', a.setor,
           'metodo', a.metodo, 'assinado_em', a.assinado_em, 'hash', a.hash_integridade)
         order by r.data, r.supervisor_nome, a.nome)
         from public.assinaturas a join public.reunioes r on r.id = a.reuniao_id join public.temas t on t.id = a.tema_id
        where (p_tema_id is null or a.tema_id = p_tema_id)
          and (p_inicio is null or r.data >= p_inicio)
          and (p_fim is null or r.data <= p_fim)), '[]'::jsonb);
end $$;

create or replace function public.adm_pendentes(p_token text, p_tema_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']); t public.temas;
begin
  select * into t from public.temas where id = p_tema_id;
  if not found then raise exception 'TEMA_INVALIDO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('matricula', x.matricula, 'nome', x.nome, 'cargo', x.cargo,
            'setor', x.setor, 'ativo', x.ativo,
            'supervisor', (select string_agg(s.nome, ', ') from public.supervisor_setores ss
                            join public.colaboradores s on s.id = ss.supervisor_id where ss.setor = x.setor and s.ativo))
          order by x.setor, x.nome)
          from public._base(t.semana_inicio, t.semana_fim) x
         where x.ativo and not exists (select 1 from public.assinaturas a where a.tema_id = t.id and a.colaborador_id = x.id)), '[]'::jsonb);
end $$;

create or replace function public.adm_reabrir_reuniao(p_token text, p_reuniao_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.colaboradores := public._sessao(p_token, array['admin']);
begin
  update public.reunioes set status = 'aberta', encerrada_em = null, data = public._hoje()
   where id = p_reuniao_id and status = 'encerrada' and data = public._hoje();
  if not found then raise exception 'SO_REUNIOES_DE_HOJE'; end if;
end $$;

-- ---------------------------------------------------------------------
-- PERMISSÕES: funções internas (prefixo "_") ficam inacessíveis à API
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'login','logout','me','tema_semana','buscar_reuniao','assinar','minhas_assinaturas',
             'sup_painel','sup_criar_reuniao','reuniao_detalhe','sup_assinar_quiosque','sup_encerrar_reuniao',
             'sup_excluir_reuniao','adm_temas','adm_tema_salvar','adm_tema_excluir','adm_colaboradores',
             'adm_colaborador_salvar','adm_colaborador_status','adm_importar','adm_historico','adm_importacoes',
             'adm_equipes','adm_equipe_salvar','adm_dashboard','adm_evolucao','adm_reunioes','adm_assinaturas',
             'adm_pendentes','adm_reabrir_reuniao') loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- Recarrega o cache da API
notify pgrst, 'reload schema';
