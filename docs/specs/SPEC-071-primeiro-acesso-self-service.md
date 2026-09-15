# SPEC-071 — Primeiro acesso self-service e exibição de dados cadastrais no app

| campo | valor |
|---|---|
| **Fatia** | F71 |
| **Slice do PRD** | — (sem Slice correspondente; escopo mora nesta spec, como nas F49–F70) |
| **MVP** | 4 |
| **Plano de apoio** | — |
| **Status** | `rascunho` |
| **Criada em** | 2026-09-15 |
| **Aprovada pelo PI em** | — |
| **Card** | [#333](https://github.com/RodReis/arenahub/issues/333) |

---

## 1. Objetivo em uma frase

Aluno sem convite ativo cria a própria senha informando CPF e data de nascimento, e os dados que
aparecem na jornada (CPF, data de nascimento, plano, unidade/local e data de início) ficam
formatados e mascarados em vez de exibidos em cru.

---

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP | MVP 4 aprovado para planejamento em 14/08/2026 (`MVP-04-app-totem.md` §1) |
| ADRs que bloqueiam | **ADR-057** — decidido pelo PI em 15/09/2026 nesta conversa; ainda não commitado em `docs/DECISIONS.md` (ver nota abaixo) |
| Fatias anteriores | F23 (Identidade e shell mobile) — ✅ entregue, aguardando aceite |
| Decisões dos PRDs | `M4-FR-001`, `M4-FR-002` — atendidas por desenho (ver §3) |

> **Nota de processo:** a ADR-057 e a linha F71 do Índice Fatia↔SPEC (`docs/STATUS.md` §5) foram
> redigidas nesta sessão mas **não foram commitadas** — os dois arquivos passam de 150 KB e
> 260 KB, e reescrevê-los por inteiro nesta sessão arriscava corromper conteúdo histórico sem
> possibilidade de revisão por diff. O texto integral da ADR-057 está pronto (entregue nesta
> conversa) para ser aplicado na próxima escrita em `docs/DECISIONS.md`, junto com a linha
> `| F71 | SPEC-071 | 4 | — | ... | rascunho |` logo após a linha F70 em `docs/STATUS.md` §5.

---

## 3. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | Consulta por CPF + data de nascimento é um passo separado da criação de senha — dois endpoints, não um | consulta e criação num único request | erro ao criar a senha não deveria obrigar redigitar CPF e data; e é a consulta sozinha que precisa da mensagem neutra do `M4-FR-002` |
| 2 | Campos exibidos usam as máscaras já convencionadas no `CLAUDE.md` (CPF, datas) — não é decisão nova, é aplicação da convenção existente | criar máscara própria para esta tela | duas implementações da mesma máscara de CPF divergem na primeira mudança |
| 3 | "Primeiro acesso" não desativa nem substitui o convite por e-mail da F23 | migrar todo mundo para o novo caminho | decisão de operação fora do escopo desta fatia — ver Pergunta 1 |

Decisões com efeito além desta fatia estão na **ADR-057** (texto no fim deste arquivo, §11 —
pendente de commit em `docs/DECISIONS.md`, ver nota da §2).

---

## 4. Escopo negativo

| não faz | vai para |
|---|---|
| Rebuild da carteirinha completa (QR, frequência) | F24 — Slice 4.2, ainda `planejada` |
| Throttling ou segundo fator na consulta por CPF+data | backlog — reabre se o gatilho de revisão da ADR-057 disparar |
| Descontinuar o convite por e-mail | decisão de operação futura, não desta fatia |
| Autenticação recorrente por CPF (login do dia a dia) | fora de escopo — CPF+data só localiza a conta no primeiro acesso; login subsequente é sempre por senha |
| CPF como autenticador no totem | já resolvido, de forma diferente, pela ADR-045 — superfície distinta, não reaberta aqui |

---

## 5. Invariantes que esta fatia precisa preservar

- **Resposta que não distingue identificador existente de inexistente** (`M4-FR-002`) — a consulta
  por CPF+data devolve a mesma forma de resposta para "não encontrado", "cancelado" e erro interno.
- **Nunca logar CPF, data de nascimento, senha ou hash em claro** — mesma regra da `SPEC-023` §4.
- **`tenant_id` vindo da identidade autenticada** não se aplica à consulta (ela é pré-autenticação)
  — a busca por CPF é escopada pelo `tenantSlug` do build do app, nunca por um tenant informado no
  corpo da requisição.

---

## 6. Contrato

**Endpoints** (novos, prefixo `/api/v1/mobile/activation`):

- `POST .../lookup` — body `{ cpf, dataNascimento }`; sucesso devolve
  `{ nomeCompleto, activationRef }` (referência opaca de curta duração, nunca o `studentId`);
  falha devolve o mesmo formato/status para não encontrado, cancelado ou erro, com mensagem
  genérica.
- `POST .../self-service` — body `{ activationRef, senha, confirmacaoSenha }`; cria a senha e
  ativa a conta; mesmas regras de força de senha já usadas na `SPEC-023`.

**Eventos** — reaproveita o evento de ativação de conta já emitido pela F23, com um campo indicando
o canal (`INVITE` | `SELF_SERVICE`) para permitir auditoria de qual caminho cada aluno usou.

**Migrações** — nenhuma tabela nova; reaproveita `student_accounts`. Se `activationRef` precisar de
persistência com expiração, cabe em `account_activation_tokens` (já existe — `SPEC-023` / PRD §11),
com um tipo `SELF_SERVICE_LOOKUP`.

---

## 7. Critérios de aceite

- [ ] AC-1 — aluno com CPF e data de nascimento cadastrados, sem convite ativo, informa os dois e
      vê o próprio nome completo, sem mais nenhum dado sensível na tela de consulta.
- [ ] AC-2 — aluno informa CPF ou data que não localizam ninguém e vê a mesma mensagem genérica
      pedindo para procurar a administração — indistinguível de "encontrado e cancelado".
- [ ] AC-3 — aluno cria senha após localizado e consegue entrar no app com ela.
- [ ] AC-4 — CPF, data de nascimento, plano, unidade e data de início aparecem formatados (CPF
      mascarado, datas em dd/mm/aaaa) em toda tela onde já aparecem hoje.
- [ ] AC-5 — convite por e-mail (F23) continua funcionando sem alteração de comportamento.

Mapeia para `M4-AC-001` (aluno ativa conta sem intervenção administrativa sobre senha).

---

## 8. Riscos e o que pode dar errado

| risco | sinal de que aconteceu | o que fazer |
|---|---|---|
| Alguém ativa a conta de outro aluno sabendo CPF+data (ADR-057, Decisão 2 — risco aceito) | aluno reclama que a conta "já tinha senha" na primeira tentativa dele | suporte trata como incidente pontual; se recorrente, reabre ADR-057 (throttling/segundo fator) |
| `activationRef` vaza ou é reaproveitado fora da janela de validade | tentativa de `self-service` com `activationRef` expirado ou de outro CPF | endpoint recusa e exige novo `lookup`; nunca aceita `activationRef` sem checar vínculo com o CPF que o gerou |
| Corrida entre convite pendente e self-service concluído | token de convite usado depois da conta já ativada por self-service | token responde "já ativada", não erro genérico (ADR-057, Decisão 5) |

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | "Primeiro acesso" e o convite por e-mail coexistem indefinidamente, ou o self-service deve virar o caminho padrão e o convite vira exceção operacional? | — | — |
| 2 | Os campos Plano, Local e Data de Início citados para formatação — já aparecem hoje na Home entregue pela F23, ou é tela nova desta fatia? Não foi possível confirmar contra o código nesta sessão (ponte com o computador do PI indisponível — falha conhecida do Windows desde 08/09). | — | — |

---

## 10. Fora de dúvida

- **CPF no totem continua CPF puro (ADR-045)** — esta spec não reabre aquela decisão; são
  superfícies e mecanismos diferentes (login recorrente no totem vs. ativação única no app).
- **O risco de account takeover por antecipação foi apresentado e aceito pelo PI** (ADR-057,
  Decisão 2) — não é omissão, é decisão registrada.

---

## 11. ADR-057 (texto pronto — pendente de commit em `docs/DECISIONS.md`)

## ADR-057 — Primeiro acesso self-service por CPF + data de nascimento (F71)

**Data:** 15/09/2026
**Status:** aceito *(decisão nova — decidida pelo PI em 15/09/2026)*
**Decisor:** Rodrigo Reis (PI)
**Contexto:** a F23 (SPEC-023, Slice 4.1) entregou ativação de conta por convite/token de uso
único enviado por e-mail (`M4-FR-001`) — é o único caminho de ativação em produção hoje. O PI
pediu, em 15/09/2026, um segundo caminho na tela de login do app: o aluno sem convite ativo
informa CPF e data de nascimento, o sistema localiza o cadastro e devolve o nome completo;
encontrado, libera dois campos para criar a senha; não encontrado, mostra mensagem única pedindo
para procurar a administração da academia.

**Por que é ADR:** introduz um segundo mecanismo de prova de identidade para criar credencial de
aluno, ao lado do que a F23 já entregou e já está em produção — não é ajuste de tela, é um caminho
novo de acesso que, uma vez comunicado a alunos, é caro de desfazer (quem usou uma vez espera que
continue existindo). E fixa um precedente de segurança da mesma família do ADR-045 (CPF como parte
de um mecanismo de autenticação/ativação, com risco de enumeração aceito conscientemente) —
precedente que outra fatia vai citar.

### Decisões

1. **CPF + data de nascimento autenticam a CONSULTA, não abrem sessão.** Localizam o cadastro e
   liberam a tela de criação de senha; só a senha, uma vez criada, autentica dali em diante.
   Diferente do ADR-045 (CPF sozinho abre sessão no totem a cada uso), aqui o par é usado uma
   única vez, no primeiro acesso.
2. **Risco aceito, sem throttling nem segundo fator nesta fatia.** CPF e data de nascimento não
   são segredo — circulam em contratos, grupos de turma, redes sociais — e quem souber os dois de
   outro aluno consegue chegar primeiro à tela de criar senha daquela conta. **O PI foi confrontado
   com o risco de antecipação de conta e decidiu aceitar como está** — sem limite de tentativas,
   sem confirmação por segundo canal (e-mail/telefone) nesta fatia. Fica registrado aqui porque
   risco aceito que mora em corpo de PR some.
3. **Mensagem única e neutra para qualquer falha de localização** — CPF inexistente, aluno
   cancelado, erro interno — mesma frase, sem distinguir motivo, disciplina já usada nas ADR-024 e
   ADR-045. Mesmo com o segundo fator (data de nascimento) reduzindo a enumeração em relação ao
   totem (ADR-045), a mensagem única segue obrigatória: é a defesa que resta depois que o par
   CPF+data é aceito como suficiente.
4. **O convite por e-mail da F23 não é revogado.** Os dois caminhos coexistem: quem recebeu
   convite ativa por ele; quem não recebeu, perdeu ou cuja recepção não disparou o convite usa
   "Primeiro acesso". Qual caminho passa a ser o padrão nas telas da recepção é decisão de
   operação, não desta ADR — fica como pergunta aberta na SPEC-071 §9.
5. **Se a mesma conta for ativada pelos dois caminhos em corrida**, o primeiro a definir a senha
   vence — o token de convite, se ainda não consumido, passa a apontar para uma conta já ativada e
   falha como "já ativada" ao ser usado depois. Nenhum dos dois caminhos invalida o outro
   proativamente; a corrida se resolve pelo estado da conta, não por um cancelando o outro.

### Consequências

| # | consequência | onde |
|---|---|---|
| 1 | Novo endpoint de consulta por CPF+data de nascimento e endpoint de definição de senha por esse caminho, além do já existente `POST /api/v1/mobile/activation/confirm` (token) | `MVP-04-app-totem.md` §10, `SPEC-071` |
| 2 | `M4-FR-001` ganha um segundo modo de ativação; `M4-FR-002` (não revelar identificador existente) se aplica também a este caminho | `MVP-04-app-totem.md` §8 |
| 3 | Enumeração de CPF+data de nascimento é risco vivo e aceito nesta fatia | `SPEC-071` §8 |
| 4 | Convite por e-mail (F23) permanece ativo; nenhuma fatia futura pode assumir que ele foi descontinuado sem nova decisão | `SPEC-023` |

### Gatilho de revisão

Qualquer indício de uso do "Primeiro acesso" para ativar conta de aluno diferente do que a
solicitou (queixa de aluno que não conseguiu mais ativar a própria conta, ou suporte reportando
padrão de tentativas) reabre a Decisão 2 — throttling e/ou segundo fator deixam de ser opcionais.
