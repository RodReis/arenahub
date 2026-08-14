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

## Credenciais

As do `.env.example` são de desenvolvimento e **propositalmente óbvias**. Não servem para nenhum
outro ambiente. Produção e homologação usam secret manager.

**O `.env` real está no `.gitignore` e nunca é versionado.**

## Apagar tudo e recomeçar

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

O `-v` remove os volumes — **todo o dado local se perde**. É o que se quer quando o banco entra
em estado ruim; dado de desenvolvimento vem de seed e se recria.
