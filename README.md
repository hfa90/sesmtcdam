# DDS – Diálogo Diário de Segurança · SESMT CD Drogasil Manaus

Sistema web para o SESMT publicar os temas semanais de DDS, os supervisores conduzirem as reuniões e os colaboradores **assinarem eletronicamente a lista de presença** (modelo FO-COR-SEG-001).

**Tecnologia:** HTML + CSS + JavaScript puro (sem build) · Supabase (PostgreSQL + API RPC).

## Perfis de acesso

| Perfil | Quem | Acesso |
|---|---|---|
| **SESMT (admin)** | Gisele Vieira Lopes – mat. 347436 | Painel de entregas com gráficos, temas, evidências, colaboradores (importação Excel), equipes e relatórios |
| **Supervisor** | Cargos com "Supervisor" ou "Coordenador" (automático) | Inicia o DDS, exibe código/QR Code, modo quiosque, encerra com visto do instrutor, imprime a evidência |
| **Colaborador** | Todos | Lê o tema da semana e assina a presença com o código do DDS |

Login de todos: **usuário = matrícula**, **senha = CPF** (com ou sem pontuação).

## Como funciona o DDS

1. O SESMT cadastra o **tema da semana** (conteúdo, objetivo, tipo, carga horária, material de apoio).
2. O supervisor clica em **Iniciar DDS** → o sistema gera um **código de 6 dígitos + QR Code**.
3. Cada colaborador entra pelo celular (ou escaneia o QR), lê o conteúdo, marca a declaração e **assina na tela**.
   Sem celular? O supervisor usa o **modo quiosque**: o colaborador digita matrícula + CPF e assina no dispositivo do supervisor.
4. O supervisor **encerra** o DDS assinando o visto do instrutor.
5. A evidência é gerada no formato **FO-COR-SEG-001** (lista de presença, atividades e registro eletrônico com hash SHA-256) para imprimir ou salvar em PDF.

## Proteção das evidências

- Assinaturas são **imutáveis** (gatilho no banco bloqueia UPDATE/DELETE).
- Colaboradores **nunca são excluídos** – apenas desligados (acesso bloqueado, histórico mantido).
- Cada assinatura guarda uma "fotografia" de nome, matrícula, cargo e setor **no momento da assinatura**; mudanças posteriores de setor não alteram evidências antigas.
- Temas com assinaturas têm o conteúdo congelado.
- CPF armazenado apenas como hash bcrypt; bloqueio após 5 tentativas de login erradas em 15 min.
- Tabelas com RLS ativo e sem políticas públicas: a chave anon só executa funções que validam a sessão e o perfil.

## Atualização da base (contratações, desligamentos, mudanças de setor)

Painel SESMT → **Colaboradores → Importar Excel**, usando o mesmo modelo da *Listagem_Funcionarios_WorkArea* (colunas Funcionário, Matrícula, CPF, Cargo, Setor). Antes de aplicar, o sistema mostra a prévia: novos, alterados, readmitidos e ausentes (possíveis desligamentos). Tudo fica registrado no **Histórico de alterações**.

## Instalação

### 1. Banco (Supabase)
No painel do Supabase → **SQL Editor**:
1. Execute `supabase/01_schema.sql` (estrutura, segurança e funções – pode ser reexecutado sem perda de dados).
2. Execute o arquivo **`02_seed_colaboradores_CONFIDENCIAL.sql`** (entregue separadamente, **não está neste repositório** porque contém CPFs). Ele cadastra os 107 colaboradores, define a Gisele como admin, vincula supervisores aos setores e cria um tema de exemplo.

### 2. Frontend (GitHub Pages)
Repositório → **Settings → Pages** → *Deploy from a branch* → `main` / `/ (root)`.
O endereço será `https://hfa90.github.io/sesmtcdam/`.

A URL e a chave anon do Supabase ficam em `assets/js/config.js`.

## Estrutura

```
index.html          Login (matrícula + CPF)
colaborador.html    Tema da semana, assinatura e histórico
supervisor.html     Conduzir DDS, QR Code, quiosque, encerramento
admin.html          Painel SESMT (gráficos, temas, evidências, colaboradores, relatórios)
evidencia.html      Lista de presença FO-COR-SEG-001 para impressão/PDF
assets/css/app.css
assets/js/          config, app (núcleo), colaborador, supervisor, admin, relatorios
supabase/01_schema.sql
```
