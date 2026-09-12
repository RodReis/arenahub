# SPEC-023 — Identidade e shell mobile

| campo | valor |
|---|---|
| **Fatia** | F23 |
| **MVP** | 4 |
| **Slice do PRD** | **4.1** — `docs/prd/academia/MVP-04-app-totem.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-04-01-mobile-identity-shell.md` |
| **Status** | ✅ **entregue** em 12/09/2026 — aguardando aceite |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M4-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 4.1. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Executada em 12/09/2026.** O gate abriu em 11/09, quando o PI mandou fazer F43 e F23 e escolheu a ordem: design system primeiro, identidade em seguida.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-04-app-totem.md` §7, Slice 4.1, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

1. **O aluno é um sujeito autenticável NOVO, em tabela própria** (`student_accounts`) — não um
   `User` com papel "aluno". Três razões que a reutilização não resolveria: `User.email` é único
   **global**, e a mesma pessoa matriculada em duas academias colidiria (multi-tenant é a premissa
   do produto); o aluno nunca terá papel, permissão, MFA nem elevação de suporte, então toda
   consulta do painel passaria a filtrar "e não é aluno"; e a conta do aluno morre com a matrícula,
   a do funcionário não. Decidido pelo PI em 11/09/2026.

2. **A sessão reusa o modelo de FAMÍLIA do painel**, em tabela separada. Rotação cria elo novo com
   o mesmo `familyId`; replay revoga a família inteira. Divergir aqui criaria duas semânticas de
   sessão no mesmo produto — quem consertasse uma esqueceria a outra. A tabela é separada porque
   `Session.userId` aponta para `User`, e não existe join entre sessão de aluno e usuário de painel.

3. **A ORDEM DAS CHECAGENS é a regra, nas duas funções puras.** No token de uso único, estado antes
   de validade: um token já consumido responde "já usado" hoje e daqui a um ano; invertido, o mesmo
   token daria respostas diferentes conforme o relógio. Na sessão, **replay antes de expiração** — e
   essa é contraintuitiva: um elo já rotacionado que reaparece é cópia, e continua sendo cópia
   depois de vencer. Se a expiração viesse primeiro, o replay tardio sairia como recusa banal, sem
   revogar a família e sem rastro de que houve cópia; bastaria ao atacante esperar.

4. **O claim `canal` separa os dois canais nos DOIS guards.** Os tokens de aluno e de painel são
   assinados pela mesma chave, então a verificação de assinatura aprova ambos. Até esta fatia, o
   único obstáculo entre um token de aluno e uma rota de painel era o **transporte** (header vs.
   cookie) — acidente, não garantia. Ausente significa PAINEL, nunca coringa: token emitido antes da
   F23 não tem o campo, e tratar ausência como curinga daria a ele acesso ao canal do aluno.

5. **O convite chega por e-mail, reusando o Resend** (decisão do PI em 11/09/2026). O link é deep
   link do app (`arenahub://`), não URL do painel: quem abre é o aluno no celular, e o token só vale
   dentro do aplicativo.

6. **Step-up aplicado em revogar sessão e trocar senha** (decisão do PI). As demais telas sensíveis
   — pagar, saúde — são das Slices seguintes e reusam o mecanismo.

7. **Módulo raso** (controller + service + repository), como o resto do repositório — e **não** a
   estrutura `application/infrastructure/ports` que o plano de apoio de 14/08/2026 pedia. Nenhum
   módulo da API usa aquele formato; seguir o plano criaria uma ilha.

## 3. Escopo negativo

- **Dado de negócio na Home** — plano, fatura e frequência são das Slices 4.2 e 4.3. Antecipá-los
  criaria um contrato que aquelas fatias teriam de honrar ou quebrar.
- **Notificação push** — Slice 4.7, e o PRD §6 já a transfere formalmente se o gate do provedor não
  for atendido.
- **Biometria do aparelho como identidade** — escopo negativo explícito do PRD §6.
- **Seleção de academia na tela** — o `tenantSlug` vem da configuração do build. Pedir ao aluno o
  identificador técnico da própria academia transferiria um detalhe de implementação; quando houver
  mais de um cliente, a escolha entre build próprio e tela de seleção é decisão de produto.
- **Configuração da versão mínima por tenant** — a fatia entrega o *mecanismo* (`versionPolicy`); a
  operação de defini-la é de quem publica.

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde aparece |
|---|---|
| `tenant_id` em toda entidade de negócio, vindo da identidade autenticada | os três modelos novos; o guard monta o contexto a partir da **linha do banco**, não do claim |
| Todo efeito externo é idempotente | logout repetido não é erro; consumo do token é `updateMany` condicionado |
| Nunca logar token, senha, hash ou PII | o token em claro existe só entre gerar e enviar; o JWT carrega só identificadores opacos |
| Resposta que não distingue identificador existente de inexistente | `M4-FR-002`, e o hash descartável garante o mesmo **tempo**, não só a mesma mensagem |
| Ausência de dado não é dado antigo | `M4-NFR-002` — indisponível mostra o shell, nunca o valor anterior como atual |
| O cliente não recalcula estado | `M4-BR-008` — a Home renderiza o enum do backend |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| — | — | — | — |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] Os ADRs listados acima estão resolvidos
- [ ] O gate de entrada do MVP tem evidência registrada
