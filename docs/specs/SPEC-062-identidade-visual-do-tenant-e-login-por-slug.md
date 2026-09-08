# SPEC-062 — Identidade visual do tenant e login por slug

| campo | valor |
|---|---|
| **Fatia** | F62 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-052 §9–§10 |
| **Superfície** | `admin-web` · `api` · object storage · `docs/design/DS-PAINEL.md` |
| **Card** | [#285](https://github.com/RodReis/arenahub/issues/285) |
| **Status** | aprovada-pi — 08/09/2026 |

---

## 1. O que esta fatia entrega

A tela de login e o painel mostram a marca da academia: logo, ícone na aba, nome, missão e diferenciais — configurados pelo Super Admin no cadastro do tenant. A URL `/{slug}/login` diz de que tenant é a tela.

---

## 2. Escopo

- Campos no tenant: `logo_object_key`, `icon_object_key` (SVG), `display_name` (já existe), `mission_text`, `highlights_text`.
- Upload para o object storage privado (Bucket em produção, MinIO em dev), servido por URL assinada ou rota da API — nunca URL pública do bucket.
- **SVG é sanitizado no upload** (sem `<script>`, sem `on*`, sem `<foreignObject>`) e servido com `Content-Type: image/svg+xml` e CSP; PNG aceito como alternativa. SVG cru é vetor de XSS.
- Login: `/{slug}/login` carrega a marca do tenant pelo slug (rota pública, só leitura de branding); `/login` sem slug mostra ArenaHub. O hero da esquerda (marcado pelo PI na tela) recebe missão e diferenciais no espaço hoje vazio.
- Accent pelo pipeline do Carbono Adaptativo (`DESIGN-UI.md`), sem hex literal.

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| domínio próprio / CNAME | fora (ADR-052 §9) |
| tema completo por tenant | fora — só accent |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-052 §9–§10 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
