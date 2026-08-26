# F49 — Kiosk seguro, provisionamento e sessão efêmera

**Data:** 25/08/2026 · **Fatia:** F49 · **Spec:** SPEC-049 · **Slice:** 3.5.1 do MVP 3.5
**Issue:** [#150](https://github.com/RodReis/arenahub/issues/150)
**Fontes:** [ADR-042](../../DECISIONS.md#adr-042) (Decisões 0, 5, 6, 8) ·
[`MVP-04` §7 Slice 4.5](../../prd/academia/MVP-04-app-totem.md) ·
`M4-FR-015` a `019`, `M4-BR-004` a `006` · [`DS-TOTEM.md`](../../design/DS-TOTEM.md) v2.0

---

## 0. Decisões do PI tomadas em 25/08/2026

Esta fatia nasce de quatro decisões do PI durante o brainstorming. Elas **restringem** o que o
`DS-TOTEM.md` §5.1 desenha, e uma delas contraria um `BR` do PRD. Estão registradas aqui e viram
**ADR próprio** (§8) — não ficam no corpo de um PR.

| # | decisão | consequência |
|---|---|---|
| 1 | **Reconhecimento facial vai para o backlog** | dos três caminhos do DS §5.1, sobra um |
| 2 | **QR Code nesta superfície é PIX (pagamento), não carteirinha do app** | o QR do DS §5.1 (identificação) não existe na F49 |
| 3 | **Login é CPF sozinho** — sem data de nascimento, sem segundo fator | contraria `M4-BR-004`; risco aceito pelo PI |
| 4 | **Falha de identificação usa mensagem única e neutra, sem limite de tentativas** | enumeração de CPF é barata; risco aceito pelo PI |

Decisões anteriores da mesma conversa, que o resultado final tornou **inertes** — registradas para
que ninguém as reintroduza achando que valem:

- O PI escolheu restringir dado de saúde a autenticação forte (avaliação, evolução 3D, histórico
  de avaliações e **ranking**), deixando pagamento e histórico de pagamentos no nível fraco.
  **Com a decisão 1, não existe autenticação forte nesta fatia** — os quatro módulos ficam
  inalcançáveis por qualquer caminho até a F52 / MVP 4.
- Pagamento e histórico de pagamentos **também** não entram na F49: são o aceite da F52
  (decisão do PI, opção B da pergunta 4). A área interna da F49 é casca.

**Resultado: a área interna entrega zero dos seis módulos do DS §5.2.** Isso é correto e
intencional — o aceite desta fatia é **isolamento e limpeza de sessão**, não funcionalidade.

---

## 1. Escopo

### Entra

- Provisionamento de dispositivo kiosk com identidade própria (`M4-FR-015`)
- Escopo `/api/v1/kiosk` com superfície mínima (`M4-FR-018`)
- Identificação do aluno por CPF (`M4-FR-016`, com a ressalva da decisão 3)
- Sessão curta, limitada a aluno e dispositivo (`M4-FR-017`)
- Encerramento por ação, timeout, erro ou perda de foco (`M4-FR-019`)
- Superfície `apps/kiosk` — hoje um diretório vazio no monorepo
- `KioskConfiguration` **lida desde o primeiro commit** (ADR-042, Decisão 0)
- `POST /api/v1/kiosk/heartbeat` **já devolvendo `configVersion`** (exigência da F50)

### Não entra

| fora | dono |
|---|---|
| Painel *Personalização do totem*, rascunho, publicação versionada | **F50** |
| Blocos públicos, mídia, faixa de patrocinadores | **F51** |
| Pagamento PIX, histórico de pagamentos, desbloqueio | **F52** |
| Avaliação, evolução 3D, histórico de avaliações | F52 / MVP 4 |
| Ranking e gamificação | **F33** (MVP 5) — ADR-042, Decisão 5, trava 2 |
| Reconhecimento facial no totem | **backlog** (decisão 1) |
| QR Code de identificação pelo app | **MVP 4** |

### Ordem

O ADR-042 fixa **F49 → F50 → F51/F52**. O PI levantou em 25/08 se a F50 não deveria vir antes,
já que é ela que personaliza o totem. A ordem foi **mantida**, pelo motivo que o próprio ADR-042
já registra na Decisão 0: quem carrega o peso da configuração é a F49 (que **lê**), não a F50
(que **escreve**). Inverter deixaria a F50 sem aceite verificável — o aceite dela é *"o gerente
publica e o totem reflete a mudança"*, e sem totem provisionado não há o que refletir.

**Consequência para esta fatia:** a F49 desenha o **contrato inteiro** de `KioskConfiguration` —
incluindo o que o `DS-TOTEM.md` §7.2 lista e a F50 vai escrever — e entrega apenas o leitor mais
o registro do seed. A F50 não reabre a tabela.

---

## 2. Modelo de dados

Quatro modelos em `packages/database/prisma/schema.prisma`. Os dois primeiros são **cópia
estrutural** de `EdgeNode` / `EdgeCredential`: mesma HMAC, mesma janela de relógio, mesma
revogação imediata, mesmo `ReplayNonce`. Não se inventa provisionamento novo — o do `edge-auth`
foi provado em campo na F8/F11.

```
KioskDevice
  id, tenantId, gymUnitId, code, status,
  agentVersion?, lastHeartbeat?, clockOffsetMs?,
  bootConfigVersion?          ← versão carregada no boot (Decisão 3 da F50)
  @@unique([tenantId, code])

KioskCredential
  id, tenantId, kioskDeviceId, keyId @unique,
  encryptedSecret, activeFrom, expiresAt?, revokedAt?

KioskConfiguration
  id, tenantId, gymUnitId?, kioskDeviceId?,
  version, publishedAt?, payload Json
  @@unique([tenantId, gymUnitId, kioskDeviceId, version])

KioskSession
  id, tenantId, kioskDeviceId, studentId,
  tokenHash, expiresAt, endedAt?, endedReason?
  @@index([kioskDeviceId, endedAt])
```

**Notas de desenho que não são óbvias:**

- **`gym_unit_id` é obrigatório em `KioskDevice`** — totem é dado físico (Regra de arquitetura 2).
- **`KioskConfiguration` já nasce com `version` e `publishedAt`** mesmo sem a F50 usá-los.
  Rascunho é a versão sem `publishedAt` (contrato da F50). Acrescentar coluna depois obrigaria
  migração de dado já publicado.
- **As três camadas da Decisão 8** vivem na nulabilidade: linha de tenant tem `gymUnitId` e
  `kioskDeviceId` nulos; linha de unidade tem só `kioskDeviceId` nulo; linha de dispositivo tem
  os dois preenchidos. A mais específica vence na resolução.
- **`KioskSession.tokenHash`, não `token`.** Sessão de 60 s que precisa morrer na hora não
  combina com JWT auto-contido, que continua válido até expirar mesmo depois do *Encerrar*.
  O token opaco vai para o cliente; o banco guarda o hash. `endedAt` preenchido encerra de fato.

---

## 3. Autenticação — duas camadas distintas

Misturar as duas é o erro clássico desta superfície. São mecanismos separados.

### 3.1 Dispositivo — HMAC assinado

Idêntico ao `edge-auth`: headers `X-Kiosk-Key-Id`, `X-Kiosk-Timestamp`, `X-Kiosk-Nonce`,
`X-Kiosk-Signature`. Mesma ordem de checagem, e a ordem **não é estética** (ver
`edge-auth.service.ts`): formato e janela de relógio → credencial ativa → assinatura → nonce por
último, dentro de transação.

**`tenantId` e `gymUnitId` saem da credencial, nunca do corpo** (Regra de arquitetura 2). Um
totem não consegue afirmar ser de outra unidade nem mandando o id certo no payload.

### 3.2 Aluno — CPF, dentro de dispositivo já autenticado

Lookup por `calcularHashDeCpf(tenantId, cpf)`, com o `tenantId` **vindo da credencial do
dispositivo**.

Isto entrega o aceite da fatia **por construção, não por checagem**: o hash de CPF é escopado por
tenant, então o totem da unidade X não consegue nem *formular a pergunta* sobre o aluno do tenant
Y. Não existe caminho de código onde dado do aluno A chegue ao totem do aluno B — a chave de
busca é diferente.

**Sem segundo fator** (decisão 3 do PI). O que a sessão expõe: nome do aluno, estado do plano e
valor da fatura em aberto.

### 3.3 Falha de identificação

Mensagem **única e neutra** para todos os casos — CPF inexistente, aluno cancelado, erro interno:

> *"Não foi possível entrar. Procure a recepção."*

Mesma disciplina da frase pública única de `DENY` (ADR-024, `DS-TOTEM.md` §8), que o produto já
usa na catraca. **Sem limite de tentativas** (decisão 4 do PI).

---

## 4. Endpoints

```
POST   /api/v1/kiosk/heartbeat            → { configVersion, serverTime }
GET    /api/v1/kiosk/config               → configuração resolvida (3 camadas)
POST   /api/v1/kiosk/sessions             → { cpf } → { token, nome, plano }
POST   /api/v1/kiosk/sessions/:id/extend  → +30 s, teto 99 s
DELETE /api/v1/kiosk/sessions/:id         → encerra e limpa
```

**Superfície mínima (`M4-FR-018`).** `POST /sessions` devolve nome, estado do plano e valor da
fatura em aberto. **Não** devolve endereço, contato, documento, avaliação, biometria — nada além
da jornada. Campo que a tela não usa não trafega.

**Módulo desligado responde 404 para aquele dispositivo** (ADR-042, Decisão 5, trava 1) —
desligar é no servidor, nunca no cliente. Kiosk com devtools aberto não reabilita nada.

Nesta fatia **todos** os módulos estão desligados (§0), então a regra vale para todos eles. O
mecanismo nasce pronto e testado aqui em vez de chegar junto com o primeiro módulo ligado —
mesma lógica da Decisão 0 aplicada à autorização.

**`heartbeat` já nasce com `configVersion`** — a F50 declara o endpoint como pré-existente, então
ele precisa sair daqui com o campo que ela vai comparar.

---

## 5. Superfície `apps/kiosk`

Next.js PWA em modo quiosque, 1080×1920 retrato. Hoje `apps/kiosk/` está vazio.

### 5.1 Telas

| tela | conteúdo | referência DS |
|---|---|---|
| **Atrator** (pública) | cabeçalho de marca, hero, CTA "Entrar na minha área", assinatura ArenaHub | §4, §3.2, §3.3, §3.8 |
| **CPF** | teclado numérico, máscara `000.000.000-00`, CTA travado até 11 dígitos | §3.19 |
| **Minha área** | saudação, faixa de estado do plano, barra e rodapé de sessão | §5.2, §3.11, §3.18 |

O atrator sai **sem blocos e sem faixa de patrocínio** (F51). O `DS-TOTEM.md` §4 já cobre esse
estado: *"se todos os blocos opcionais estiverem desligados, hero e CTA se distribuem com o
espaço restante — a tela não fica vazia nem quebra."*

A grade de módulos da "Minha área" fica **vazia** nesta fatia (§0). Módulo sem fatia entregue
**não aparece** — não aparece cinza, não aparece desabilitado (ADR-042, Decisão 5, trava 2).

### 5.2 Tokens — nunca hex colado

O `Totem.dc.html` é protótipo visual, **não código a instalar** (ADR-026). Colar `#0A0B0D` ou
`#4D7CFF` produz o hex literal que a lint proíbe.

Os tokens do totem entram em `packages/ui/tokens`. O accent sai de
`resolveAccent(seed, surface)` — que **já parametriza superfície escura**
(`packages/ui/src/accent.ts:182`: *"fica como parâmetro porque o app e o totem são dark"*).

**O que falta acrescentar:** o alvo de contraste **7:1** do `DS-TOTEM.md` §11.3. O resolvedor hoje
mira `AA_TEXT` (4.5), que serve o painel. É uma constante nova em `contrast.ts`, não um pipeline
novo.

**Alto contraste:** o interruptor na tela do totem é do aluno, vale só para a sessão dele e
**sempre vence** o padrão de boot da unidade (ADR-042, Decisão 6). Remove glow, gradiente, forma
angular e ponto pulsante; texto secundário passa a branco.

---

## 6. Sessão efêmera e limpeza — o aceite mora aqui

| regra | valor | origem |
|---|---|---|
| Duração | 60 s, reiniciados a cada toque | DS §6 |
| Extensão | "Preciso de mais tempo" soma 30 s, teto 99 s | DS §6, §3.18 |
| Visibilidade | barra superior + contador no rodapé, **sempre visíveis** | DS §11.5, WCAG 2.2 AA *Timing Adjustable* |
| Encerramento | ação, timeout, erro ou perda de foco | `M4-FR-019` |
| Limpeza | memória, `sessionStorage`, `localStorage`, cache visual, clipboard, autofill, fila de impressão | aceite da Slice 4.5 |
| PII durável | **nenhuma** — nem CPF, nem nome | `M4-BR-006` |

*"Preciso de mais tempo"* **não é configurável** — é requisito de acessibilidade, não preferência
de gerente.

**Encerrar chama `DELETE` na API.** A linha morre no servidor, não só na tela: uma sessão que
some do DOM mas continua válida no banco é exatamente o buraco que esta fatia existe para fechar.

---

## 7. Testes

Estratégia e classificação em [`docs/TESTING.md`](../../TESTING.md).

### Unit

- Cálculo de expiração e extensão — funções puras, **"agora" entra por parâmetro**
- Máscara e validação de CPF
- Resolução das três camadas de configuração (tenant → unidade → dispositivo)
- Derivação de accent com alvo 7:1 sobre `bg/base`

### Integração

- HMAC do dispositivo: assinatura válida, assinatura inválida, timestamp fora da janela,
  nonce repetido, credencial revogada, credencial vencida
- **Isolamento A/B** — totem do tenant X consulta CPF de aluno do tenant Y e não encontra
- Sessão expirada não autoriza
- Sessão encerrada por `DELETE` não autoriza (mesmo com token em mãos)
- Módulo desligado devolve 404 para o dispositivo

### E2E (Playwright)

- Jornada: atrator → CPF → minha área → encerrar
- **Asserção de limpeza:** após o encerramento, `sessionStorage` e `localStorage` vazios e
  nenhum dado do aluno no DOM
- Contagem regressiva visível e "Preciso de mais tempo" somando 30 s

### Guarda de regressão

O aceite literal da Slice 4.5: **dado do aluno A não aparece para o aluno B**. Teste nomeado,
não implícito.

---

## 8. Documentos a atualizar nesta entrega

| documento | o que muda |
|---|---|
| **`docs/DECISIONS.md`** | **ADR novo** — regime de identificação do totem: CPF sozinho sem segundo fator, mensagem neutra sem limite de tentativas, riscos aceitos pelo PI, emenda a `M4-BR-004`, facial em backlog |
| `docs/DEVELOPMENT.md` | reordenar a fila — totem antes do mobile (tarefa que o ADR-042 atribui à F49) e acrescentar F49–F56, que hoje param em F41 |
| `docs/STATUS.md` | corrigir o defasado (F53/F54/F56 estão finalizados e a §2 os lista como em andamento/em revisão) e mover F49 |
| `docs/TESTING.md` | evidência por SPEC/issue |

---

## 9. Riscos registrados

| risco | origem | mitigação |
|---|---|---|
| **CPF sozinho autentica** — quem sabe o número vê nome, plano e valor da fatura | decisão 3 do PI | nenhuma. Aceito e registrado em ADR. Contraria `M4-BR-004` |
| **Enumeração de CPF é barata** — um por vez, sem limite, descobre quem é aluno e quanto deve | decisão 4 do PI | mensagem neutra não confirma nem nega; sem limite de tentativas |
| **Fatia magra** — área interna com zero módulos | decisões 1 e 4 (pergunta 4) | correto pelo aceite: a fatia prova isolamento e limpeza, não funcionalidade |
| **Contrato de config desenhado sem o painel existir** | ordem F49 → F50 | o contrato cobre o `DS-TOTEM.md` §7.2 inteiro para a F50 não reabrir a tabela |
