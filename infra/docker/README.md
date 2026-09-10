# Ambiente local — Postgres, Redis e MinIO

Desenvolvimento é local (`CLAUDE.md` → *Regras de trabalho*). Estes três serviços são o que o
`docker-compose.yml` sobe. Nada de negócio é pré-criado: sem bucket, sem schema, sem fila.

## Subir

```bash
cp .env.example .env                                   # uma vez, na raiz do repo
docker compose -f infra/docker/docker-compose.yml up -d
```

Os três têm healthcheck. Para esperar que fiquem prontos de fato:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --wait
```

## Portas

| serviço | porta | observação |
|---|---|---|
| PostgreSQL | `5432` | `POSTGRES_PORT` |
| Redis | `6379` | `REDIS_PORT` |
| MinIO — API S3 | `9000` | `MINIO_PORT` |
| MinIO — console web | `9001` | `MINIO_CONSOLE_PORT` |

Todas configuráveis por `.env`. **A da API (`3344`) não é:** por decisão registrada, se estiver
ocupada a API falha em vez de trocar de porta (`CLAUDE.md` → *Regras de trabalho*).

## Redis: provisionar não é adotar

O `CLAUDE.md` fixa que fila (Redis + BullMQ) entra **"só quando comprovadamente necessário, não
por padrão"**. O Redis está aqui para o ambiente local ficar completo — **não** para autorizar
BullMQ na primeira fatia que parecer conveniente.

Adotar fila é decisão com métrica que a justifique, não conveniência de implementação. O card
[#45](https://github.com/RodReis/arenahub/issues/45) registra isso explicitamente para não virar
dívida silenciosa.

## Imagens têm tag fixa

`postgres:17-alpine`, `redis:8-alpine`, `minio/minio:RELEASE.2025-09-07T16-13-09Z`.

Nenhuma usa `latest`. Ambiente reproduzível é requisito do MVP 0 (`M0-NFR-006`: qualquer pessoa
reproduz a bancada) — tag móvel quebra isso silenciosamente, e o bug aparece na máquina de outra
pessoa, semanas depois.

## Portas só em `127.0.0.1`

Os quatro mapeamentos fazem bind em loopback, não em `0.0.0.0`. A forma curta do Compose
(`"5432:5432"`) publicaria em **todas as interfaces** — numa rede compartilhada (coworking, café,
Wi-Fi de escritório sem isolamento), isso entrega Postgres, Redis e o console do MinIO com a senha
que está escrita neste repositório a qualquer máquina da LAN.

Custo de fechar: um prefixo por linha. Se algum dia for preciso acessar de outro host, isso é
mudança consciente no `.env`, não o padrão.

## Ordenação pt-BR vem do ICU, não do locale do sistema

A imagem do Postgres é Alpine (musl) e **não tem os dados de locale da glibc**. Definir só
`LANG: pt_BR.UTF-8` produz o pior resultado possível: o `initdb` aceita o rótulo, `pg_database`
passa a exibir `datcollate = pt_BR.UTF-8`, e a ordenação real cai em comparação por byte.

```
sem ICU:  ação, açúcar, zebra, água     ← "água" depois de "zebra"
com ICU:  ação, açúcar, água, zebra     ← correto
```

O banco **mente sobre o próprio collation** — é o tipo de bug que aparece como lista de alunos
fora de ordem, meses depois, sem ninguém ligar uma coisa à outra.

Por isso o `POSTGRES_INITDB_ARGS` usa `--locale-provider=icu --icu-locale=pt-BR`. O ICU carrega os
próprios dados e independe do SO.

> ⚠️ **`POSTGRES_INITDB_ARGS` só age quando o banco é criado.** Volume que já existe não muda de
> collation. Para aplicar numa base já criada: `pnpm docker:reset` — **apaga todo o dado local**.

## Credenciais

As do `.env.example` são de desenvolvimento e **propositalmente óbvias**. Não servem para nenhum
outro ambiente. Produção e homologação usam secret manager.

**O `.env` real está no `.gitignore` e nunca é versionado.**

## Role de runtime (RLS)

A partir da F66 (ADR-054) o Postgres tem **duas identidades**, no mesmo container:

| role | para quê |
|---|---|
| `arenahub` | dono das tabelas. Migrations, e nada mais. |
| `arenahub_app` | runtime. API, workers e seeds. `NOBYPASSRLS`, sem ownership. |

O role restrito lê e escreve em **todas** as tabelas de negócio, não só nas duas com política. O
que o separa do dono é não ter ownership, não poder alterar estrutura nem política, e não ter
`BYPASSRLS`. A única restrição de alcance é `audit_logs`, onde ele insere e lê mas não atualiza
nem apaga: trilha que a aplicação pode editar não é trilha.

A migration cria o role, mas **não a senha** — credencial não se versiona, nem em desenvolvimento.
Depois de rodar as migrations pela primeira vez, setar a senha à mão. `ALTER ROLE` vale para o
cluster inteiro, então uma vez só cobre `arenahub`, `arenahub_int` e `arenahub_e2e`:

```bash
docker exec arenahub-postgres psql -U arenahub -d arenahub \
  -c "ALTER ROLE arenahub_app WITH PASSWORD 'dev_local_arenahub_app';"
```

Depois, no `.env` local (a porta segue o `POSTGRES_PORT`):

```
RUNTIME_DATABASE_URL=postgresql://arenahub_app:dev_local_arenahub_app@localhost:5442/arenahub?schema=public
RUNTIME_INTEGRATION_DATABASE_URL=postgresql://arenahub_app:dev_local_arenahub_app@localhost:5442/arenahub_int?schema=public
```

Para conferir que o role ficou como deve — as duas colunas têm de vir `f`:

```bash
docker exec arenahub-postgres psql -U arenahub -d arenahub -tAc \
  "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname='arenahub_app';"
```

`rolbypassrls` verdadeiro faria a política virar decoração, sem nada falhar para avisar.

**Superusuário ignora RLS, sempre.** O `arenahub` deste compose é superusuário, então ele enxerga
todos os tenants sem contexto nenhum — mesmo com `FORCE ROW LEVEL SECURITY` nas tabelas. Em
desenvolvimento isso é conveniente, porque o seed roda sem precisar declarar contexto. Mas quer
dizer que a proteção real vem de a aplicação usar `RUNTIME_DATABASE_URL`, não do `FORCE` sozinho.

Em produção, o role que roda migration **não deve ser superusuário** — é o que separa a política
valer de a política ser decoração.

## Apagar tudo e recomeçar

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

O `-v` remove os volumes — **todo o dado local se perde**. É o que se quer quando o banco entra
em estado ruim; dado de desenvolvimento vem de seed e se recria.
