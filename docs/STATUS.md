# STATUS.md — ArenaHub

> Kanban e roadmap. **Prosa curta mora aqui, sem detalhe** — detalhe vai para
> `docs/STATUS-ARQUIVO.md`.
>
> **Dono deste arquivo: o Cowork, por inteiro** (ADR-021 dissolveu a divisão por seção que valia
> antes). Se o Code encontrar este arquivo divergente da sua branch, **a versão da `main` vence**
> e ele reaplica o próprio progresso por cima — nunca desfaz linha do Cowork.

**Última atualização:** 18/08/2026 *(gate §15 assinado: `GO_WITH_CONSTRAINTS` — o MVP 1 começou)*
**Código:** bootstrap (#42–#47) + **F1, a primeira fatia**. A exceção de arranque morreu.

🟢 **17/08/2026 — duas janelas físicas, e o MVP 0 saiu do simulador.** A catraca girou por comando
(30 comandos, 28 giros confirmados por sensor, 0 duplas) e, na segunda janela, **o ciclo facial
rodou ponta a ponta**: leitor conecta → ArenaHub cadastra → rosto reconhecido → `sendlog` recebido
→ decisão local → catraca destrava → giro confirmado. Detalhe no field-note
`docs/field-notes/2026-08-17-ciclo-facial-ao-vivo.md` e no §9 do relatório de POC — **ambos ainda
fora da `main`**, ver o aviso abaixo. Sem link enquanto não entrarem.

🔴 **Isso não fecha o gate, e um achado é sério.** A catraca está em `acionamento1: 8`
(*liberada nos dois sentidos*): **entra-se empurrando o braço, sem reconhecimento nenhum**. Todos
os giros medidos são reais, mas teriam acontecido **sem o comando** — a garantia física de que só
quem tem direito entra **não está valendo** hoje na bancada. É config do equipamento, não código,
e só se muda pela API/SDK. **`M0-AC-004` não fecha antes disso.**

⚠️ **O código de 17/08 não está na `main` e não tem PR.** As branches `feat/f2-facial-senduser`
(fix `senduser` do firmware v2.16, `conectar` na ponte, `lab:run`) e `docs/f3-poc-fisica-17-08`
(relatório da janela da catraca) vivem só no remoto. **Elas colidem entre si** — as duas escrevem
uma seção `## 9` diferente no mesmo `docs/reports/MVP-00-relatorio-poc-topdata.md`. Resolver é do
Code; registrado aqui porque avanço fora da `main` é o *fechamento frágil* do `CLAUDE.md` §3.

🏁 **18/08/2026 — o gate §15 do MVP 0 foi assinado: `GO_WITH_CONSTRAINTS` (ADR-029). O MVP 1
começou.** O `M0-AC-010` está satisfeito pelo PI, acumulando tecnologia e operação. **Quatro
restrições são normativas:** (1) nenhuma unidade opera com aluno real enquanto a catraca girar
livre; (2) `M0-AC-004` é **condição de saída do MVP 1**, com a catraca em modo bloqueado; (3)
`M0-AC-008` real é medido na **F9** — ele era **impossível** dentro do MVP 0, porque depende da
decisão pela nuvem; (4) `M0-AC-002` roda antes de dado biométrico real entrar na bancada.
**F6–F9 e F11 estão liberadas.**

📌 **18/08/2026 — SPEC-012 a 016 marcadas `aprovada-pi` por decisão do PI (ADR-030)**, com o
ADR-013 ainda aberto. O Cowork recomendou o contrário e a divergência está registrada no ADR. O
checklist §6 dessas specs **continua desmarcado** no item dos ADRs, e **nenhum card sai do
Backlog** por isso — quem segura F13–F16 é a entrada do MVP 2.

🔴 **18/08/2026 — o bloqueio do gate §15 estava mal diagnosticado (ADR-028).** O modo de
acionamento da catraca **é código do `edge-agent`**, não configuração do equipamento: a ponte já
manda `ConfigurarAcionamento1(1, 5)` em toda conexão, e a Topdata documenta que a config do SDK
**sobrescreve** a do WebServer quando o equipamento entra online — procurar o modo no menu do
painel era caminho morto por construção. O `acionamento1: 8` lido em 15/08 era config do
**software legado**. Isso tira a pendência da fila de "próxima janela física" e põe num parâmetro
de código; falta a tabela do enum `Funcao`, que se busca no portal do integrador. **Corrige a
decisão 4 da `SPEC-002` — revisão é do PI.**

📌 **18/08/2026 — o ADR-013 foi partido em dois, por decisão do PI.** O bloqueio de F12 estava
errado: a Slice 2.1 (invoice, ledger, pagamento manual) **não chama um único método de
`PaymentProvider`**, e o `MVP-02` §5 põe o gate de homologação antes da **Slice 2.2**, não da 2.1.
O que de fato falta para F12 é o **modelo de `Payment`**, decidível sem provedor — virou o
**ADR-027**. Em 18/08 o PI **aceitou a recomendação técnica** e respondeu três das quatro
perguntas; a quarta (dupla permissão) virou **emenda ao PRD**, ainda pendente. O ADR-013 segue
`aberto` só para o provedor e as políticas de refund, bloqueando F13–F16. ⚠️ **Isso não torna F12
pegável:** a entrada do MVP 2 exige MVP 1 estável, e o MVP 1 depende do gate §15 do MVP 0.

**14/08/2026, segunda rodada — ADR-011 e ADR-008 fechados.** F4 e F8 destravadas. Restam **duas**
pendências, nenhuma no caminho crítico de hoje: ADR-013 (sai da homologação do MVP 2, não de
escolha) e ADR-007 (migrou com F10 para o MVP 1.5). Um ponto remanescente do ADR-008 mudou de
dono: bloqueia F21, não F8.

**Correção material registrada:** o ADR-008 oferecia "legítimo interesse com LIA" como base legal
alternativa. **Essa hipótese não existe para dado biométrico** — é dado sensível, e o art. 11 da
LGPD é lista fechada onde legítimo interesse não figura. Corrigido no ADR.

---

## 1. Onde estamos, em três frases

O repositório tem PRDs aprovados para planejamento, planos de implementação por slice e, desde
14/08/2026, o conjunto de documentos de governança. **O bootstrap `[INFRA]` fechou em 14/08/2026** —
os seis cards (#42 a #47): monorepo, `packages/config` com TypeScript estrito e ESLint, ambiente
Docker com Postgres/Redis/MinIO, os oito comandos que **falham com mensagem em vez de mentir**,
`packages/database` com Prisma 7 e migration inicial vazia, e o **CI com a guarda de evidência**.
As pastas de `apps/` continuam vazias — bootstrap é encanamento, não feature.

🏁 **A *exceção de arranque* morreu** com o #47. O ciclo normal do `DEVELOPMENT.md` §2 vale
inteiro: o CI decide o merge, e a guarda de evidência barra relatório que não bate com a execução.

**O gargalo agora é decisão de produto, não encanamento.** Não há mais card `[INFRA]` no caminho;
o que trava é o que sempre travou — ADR aberto e hardware do MVP 0.

Nada pode ser codificado até que: (a) a spec da fatia esteja `aprovada-pi` em `docs/specs/`,
e (b) os ADRs que a bloqueiam estejam resolvidos.

**Próximo movimento: o gargalo não é mais documento.** As 41 specs existem, e as cinco do MVP 0
estão sem ADR bloqueando. O que falta é execução em duas frentes que não dependem uma da outra:

1. **Code:** ✅ bootstrap entregue. **Resta o board no GitHub** — Projects com 5 colunas, cores e
   descrições das labels. É ação no GitHub, fora do repositório, e não bloqueia código.
2. **PI:** ✅ **o hardware existe** — a F1 documentou: catraca Topdata Inner Fit instalada e em
   teste, leitor facial `AYTI11108174` em `192.168.2.188`, tudo por **TCP/IP**. O que falta agora
   é diferente do que se supunha: **os 7 itens do gate** (PRD §4), sobretudo **consentimento dos
   participantes** — pré-requisito de qualquer captura facial — e a decisão sobre **rede
   isolada**, que o PRD exige e a bancada não tem.

> ✅ **A F1 respondeu parte do ADR-010 de graça.** Sem serial nem porta COM no caminho, o
> transporte não é refém do Windows. A dúvida sobrevive só para o SDK de captura biométrica, se
> ele existir como DLL.

> 📍 **Levantamento de campo em 15/08/2026** — `docs/field-notes/2026-08-15-hardware-arena-positiva.md`.
> Rede + **painel físico da catraca**. Inventário ao vivo: Inner serial `247000797` FW `7.05.00` no
> `.187` (DHCP), facial serial `AYTI11108174` no `.188`. **A catraca aponta para o servidor SDK
> `192.168.2.106:3570`** — e o `.106` **é o edge-agent legado, ao vivo**: PC Windows rodando
> `websocket-sharp` na 7792 (o `/pub/chat` do facial) + MySQL 5.6.25. 🔴 **A rede NÃO é isolada** —
> catraca, facial e legado no mesmo `/24` de produção, com o legado operando; rodar `lab:run` aqui
> disputa a catraca com o sistema em uso (gate §4). Os dois equipamentos têm **webserver de admin
> (porta 80) com senha de fábrica trocada** — bloqueia config (18 dígitos, `use_logphoto`).
>
> **Leitura de gate (recomendação, não decisão):** `GO_WITH_CONSTRAINTS`. Código de F1–F4 verde em
> simulador; F4 com evidência real. POC **física** (F2/F3 aceite, F5 decisão) pendente de janela no
> local com **consentimento + rede isolada/legado desligado + ponte Windows + parada de emergência**
> — pré-condições do PI, detalhadas na §8 do field-note. O gate §15 só fecha com a POC rodada e a
> assinatura do PI; **nada aqui declara o MVP 0 concluído.**

✅ **Os manuais chegaram em 14/08/2026 e destravaram F2 e F3.** Três documentos: os dois do leitor
facial e o *Manual de Integração SDK Inner Acesso*. Resumos verificáveis em
`docs/vendor/topdata/`. Os adapters saíram no mesmo dia — **85 testes**.

🔴 **O ADR-010 fechou, com resposta diferente para cada dispositivo:**

| dispositivo | transporte | roda em Node? |
|---|---|---|
| leitor facial | WebSocket + JSON, porta 7792 | **sim** |
| catraca | `EasyInner.dll` — binário proprietário, porta 3570 | **não** |

A DLL é **Windows, 32 bits, .NET 3.5+**, e o protocolo binário só sai sob **NDA**. A catraca exige
um **processo Windows** — o *"serviço nativo p/ SDK Topdata"* que o plano de apoio já previa.

✅ **A ponte existe desde 15/08/2026** — `EasyInnerBridge.exe`, .NET 4.x x86 falando **stdio**
(card [#61](https://github.com/RodReis/arenahub/issues/61), PR
[#62](https://github.com/RodReis/arenahub/pull/62)). No teste com o PI presente ela **carregou a
DLL sem GPF e escutou na 3570** — mas **a catraca não girou**, porque aponta para o servidor
legado `192.168.2.106`. O bloqueio de F3 deixou de ser técnico e virou **operacional: o cutover**.

**O que ainda trava, e nada disso é código:**

| # | o quê | trava |
|---|---|---|
| 1 | ✅ ~~decidir a forma da ponte Windows (ADR-010)~~ — **fechado em 15/08/2026**: stdio + .NET 4.x x86, card [#61](https://github.com/RodReis/arenahub/issues/61), PR [#62](https://github.com/RodReis/arenahub/pull/62) | — |
| 2 | ✅ ~~**consentimento dos participantes**~~ — **assinado e em mãos na janela de 17/08** | — |
| 3 | ✅ ~~**janela combinada + parada de emergência**~~ — **duas janelas executadas em 17/08**, com parada definida (cortar a fonte da catraca) | — |
| 4 | ✅ ~~leitor em **18 dígitos**~~ — resolvido pelo menu físico do leitor; `setuserinfo` confirmado ao vivo em 17/08 | — |
| 5 | ✅ ~~**cutover: apontar a catraca para o `edge-agent`**~~ — **feito e devolvido** em 17/08 (`.106` → `.190` → `.106`, legado religado). O mesmo vale para o leitor facial, pelo menu físico, **sem depender da senha de admin** | — |
| 6 | ✅ ~~**ligar os adapters ao `main.ts`** — fatia nova~~ — **a fatia nova morreu em 17/08, por decisão do PI**: o `lab:run` foi construído dentro da janela e absorvido por **F2/F5**, sem número novo. ⚠️ **Consequência aberta na linha 8** | — |
| 7 | 🔴 **catraca em `acionamento1: 8` — entra sem reconhecimento.** ⚠️ **Diagnóstico corrigido em 18/08 pelo ADR-028:** o modo **não** é config de equipamento nem depende do menu do painel — o `EasyInnerBridge.cs` já chama `ConfigurarAcionamento1(1, 5)` a cada `conectar`, e a Topdata documenta que a config do SDK **sobrescreve** a do WebServer ao entrar online. É **parâmetro de código**, com reversão trivial. O que falta é a **tabela do enum `Funcao`**, que está no manual do SDK / `Lab EasyInner` do portal do integrador — obtenção de documento, não janela de bancada | **`M0-AC-004`**, logo o **gate §15** |
| 8 | 🟠 **composição de PRODUÇÃO do `edge-agent` ficou sem dono.** Ordem de inicialização, o que o agente faz ao subir, o que acontece quando um dispositivo não responde — falha alto ou degrada. O `lab:run` é **bancada**; nada disso está decidido. **Precisa de número antes de F9 ir a piloto** — decisão do PI, insumo pronto em [`docs/notes/composicao-do-edge-agent.md`](notes/composicao-do-edge-agent.md) | **MVP 1** |
| 9 | 🟠 **relógio do leitor facial.** O `ocorridoEm` veio congelado em `15:47:28` em todos os reconhecimentos de 17/08 — timestamp fixo embaralha a ordem de eventos (`M0-FR-004`). Decisão do PI em 17/08: **acertar o relógio *e* o Edge carimbar `recebidoEm` como critério de ordenação quando o `ocorridoEm` for implausível**, preservando o original (`M0-BR-004`) | **F2** |
| 10 | 🟠 **consumir o `senduser` para detectar órfãos** entre leitor e nuvem — leitura de reconciliação que vira **alerta**, nunca cadastro. Decisão do PI em 17/08; **fora de F2**, fatia futura do MVP 1 **ainda sem número** | **MVP 1** |

> 📋 **Roteiro da janela pronto:** [`docs/runbooks/POC-MVP-00-roteiro-de-execucao.md`](runbooks/POC-MVP-00-roteiro-de-execucao.md)
> — pré-condições, sequência de cutover, coleta de evidência e encerramento. A §0 explica, antes
> de tudo, o que esta janela **não** consegue medir hoje.

> ⚠️ **A F3 é diferente das outras.** Testar significa **acionar fisicamente uma catraca instalada
> e em uso**. Não é acesso ao equipamento — é combinar horário e ter o procedimento de parada de
> emergência definido (item 7 do gate).

---

## 2. Quadro

| coluna | label | o que significa | quantas |
|---|---|---|---|
| Backlog | `proplan:backlog` | card criado; **estacionamento visível** — nem tudo aqui é pegável | **32** |
| A Fazer | `proplan:todo` | Code pegou | 0 |
| Em Andamento | `proplan:doing` | Code está implementando | **3** — [F2](https://github.com/RodReis/arenahub/issues/2), [F10](https://github.com/RodReis/arenahub/issues/10) e o `[INFRA]` [#68](https://github.com/RodReis/arenahub/issues/68) |
| Feito | `proplan:done` | PR mergeado com CI verde | 0 |
| Finalizado | `proplan:finalizado` | **PI aceitou e fechou a issue** | **21** |

> ⚠️ **Números conferidos na API do board às 22h de 17/08/2026** — não estimados. A linha de
> *Em Andamento* já dissera *"F2 e F3"*, mas a issue [#3](https://github.com/RodReis/arenahub/issues/3)
> não carrega `proplan:doing`. As colunas *Feito* e *Finalizado* também estavam trocadas: os cards
> do bootstrap, F1 e F4 já foram aceitos pelo PI e contam em **Finalizado**, não em *Feito*.
>
> 🔒 **A F10 está destravada e parada ao mesmo tempo.** O ADR-007 fechou e a spec é
> `aprovada-pi`, mas o **ADR-012 mantém o MVP 1.5 fechado** até o piloto produzir incidente
> medido de queda de link. Pegável tecnicamente, parada processualmente — improvisar cache
> antes disso é violar o ADR.
>
> 📌 **Leitura de 17/08, depois das janelas físicas:** F2 e F3 foram **provadas ao vivo**. A F2
> continua em *Em Andamento* — falta **PR mergeado**, o `M0-AC-002` (remoção das três identidades
> com confirmação de ausência) e o **modo bloqueado da catraca**.
>
> 🔴 **Tensão registrada, não resolvida: a [F3](https://github.com/RodReis/arenahub/issues/3) está
> `proplan:finalizado`, mas o `M0-AC-004` não fechou.** O aceite do PI é soberano e não se desfaz
> aqui — mas a catraca em `acionamento1: 8` deixa entrar sem reconhecimento (§1, linha 7), e isso
> é pré-requisito do gate §15 do MVP 0, independentemente do estado do card. **Fatia aceita ≠ gate
> fechado.** Quem for assinar a saída do MVP 0 precisa ler as duas coisas juntas.

**Definição de Backlog corrigida em 14/08/2026.** Dizia *"spec aprovada, card criado"*, o que
contradizia o **ADR-022**: *"o card de fatia passa a ser criado para **todas** as fatias, em
Backlog... o portão não se moveu, só ficou mais cedo."* O portão é a **saída** para `todo`, não a
entrada. Decisão do PI em 14/08/2026: vale o ADR-022.

**As 41 issues existem** em [`RodReis/arenahub`](https://github.com/RodReis/arenahub/issues), com
`#N` = `F<n>` — issue #8 é a fatia F8. Coincidência de numeração, não garantia: **a fonte única
continua sendo o Índice da §5**, não o número do GitHub.

**Do Backlog, 12 são pegáveis hoje** — F1–F11 (todas `aprovada-pi`, ADR-007 fechou e destravou
F10) e **F42**, assim que o card `[INFRA]` do pipeline de tokens sair. As outras 32 estão
estacionadas: **F12 não está mais parada por ADR** (o ADR-027 fechou em 18/08) — faltam a spec preenchida e a entrada do MVP 2; F13–F16 por ADR-013, F17–F41 porque o MVP ainda não foi discutido com o PI, e
**F43–F44 pelo gate do MVP 4** — as superfícies `mobile` e `kiosk` não existem.

> ⚠️ **O board (Projects) ainda não existe** — só as labels, criadas automaticamente pela API ao
> aplicar `proplan:backlog`. Elas nasceram **sem cor e sem descrição**, e as outras quatro
> (`todo`, `doing`, `done`, `finalizado`) **só existirão quando forem usadas pela primeira vez**.
> Criar o Projects com as cinco colunas e dar cor/descrição às labels continua sendo `[INFRA]`.

> ✅ **Pendência do padrão de título — resolvida em 16/08/2026 pelo ADR-025.** O `CLAUDE.md`
> definia só `[MVP0]`…`[MVP6]`, e a issue #10 (F10) ficou sem token porque o MVP 1.5 não tinha
> um. **O PI criou `[MVP1.5]` e `[MVP2.5]`.** Agora são verdade — os MVPs existem e estão
> escritos, então a regra de ouro está satisfeita. O título da #10 **já foi corrigido** para
> `[MVP1.5][SPEC-010][F10] Operação offline`.

---

## 3. Decisões abertas que bloqueiam trabalho

Ordenadas por quanto travam. Detalhe e opções em `docs/DECISIONS.md`.

### 3.1 Ainda aguardando o PI

| ADR | o que falta | bloqueia |
|---|---|---|
| **ADR-008** *(ponto remanescente)* | **transferência internacional** de dado sensível, se o provedor de IA de saúde estiver fora do Brasil. **Reapontado:** bloqueava F8 por engano — F8 não chama IA nenhuma | F21 |
| **ADR-013** | provedor de pagamento — **não é decisão sua hoje**: sai do card `[GATE]` de homologação, com a matriz de critérios já definida no ADR. O que sobrou aqui são as **duas políticas do `M2-COMPLIANCE-01`** (refund e limites). O **modelo de `Payment` saiu deste ADR em 18/08/2026** e virou o ADR-027 | F13–F16 |
| ~~**ADR-027**~~ | **FECHADO em 18/08/2026.** Modelo de `Payment`/`PaymentAttempt` decidido e `MVP-02` §7/§11 emendados. **F12 sem ADR bloqueando** — faltam a spec preenchida e a entrada do MVP 2 | — |
| ~~**ADR-007**~~ | **FECHADO em 16/08/2026.** As quatro perguntas foram respondidas: decide-sinaliza-restringe na carência; `DENY` do motor com liberação assistida do operador depois dela; conflito aceito e sinalizado, com exceção para revogação de consentimento; conexão sempre iniciada pelo Edge, stream mais polling. **F10 destravada** | — |

> 🔴 **Correção material no ADR-007, registrada em 17/08/2026.** A *"Consequência 2"* do ADR-007
> afirma que a denylist de consentimento revogado *"provavelmente altera o contrato de snapshot que
> F4 já implementou"*. **Esse contrato não existe.** A F4 entregou
> `apps/edge-agent/src/persistence/cache-de-permissoes.ts` — cache local **de laboratório** da
> Slice 0.4, com três colunas, populado à mão, **sem** `schemaVersion`, assinatura, `tenant_id`,
> `gym_unit_id` nem expiração de snapshot. O snapshot assinado e versionado de `M1-FR-025`/`026` e
> `INV-054`/`055` é **escopo virgem de F10**.
>
> **Efeito:** não há bump, migração nem compatibilidade retroativa a manter — a denylist entra como
> campo **de nascença**, em `schemaVersion: 1`. Decisão do PI em 17/08: **versiona dentro da F10**,
> registrado na `SPEC-010`; o primeiro **ADR de contrato de Edge nasce quando houver Edge instalado
> em cliente**. Mesma disciplina da correção do ADR-008: premissa errada em ADR aceito se corrige
> no lugar, não se herda.

### 3.2 Decididos em 14/08/2026 — segunda rodada

| ADR | decisão |
|---|---|
| **ADR-011** *(fecha o ADR)* | **Provisionamento por código de pareamento de uso único**, com TTL curto e vinculado a `tenant_id` + `gym_unit_id`; o agente troca por **segredo próprio por dispositivo**, guardado no DPAPI/Credential Manager. Nenhum segredo dentro do instalador. **mTLS recusado por custo de operar PKI** para uma unidade — decisão datada, reabre em escala ou por exigência enterprise |
| **ADR-011** *(fecha o ADR)* | **Rotação automática** pelo próprio agente, com credencial de uso de vida curta; **revogação imediata pelo admin do tenant no painel**, sem chamado. **Consequência que vira escopo de F11:** o alerta de heartbeat passa a ter duas causas distintas — Edge ausente e falha de renovação de credencial |
| **ADR-008** | **Base legal: consentimento específico e destacado (art. 11, I).** A alínea "g" (prevenção à fraude) foi **recusada** — hipótese estreita, com ressalva de direitos fundamentais no próprio texto, e base legal ausente foi o fundamento nº 1 da suspensão no caso PR |
| **ADR-008** | **Academia é controladora, ArenaHub é operador**, com contrato de tratamento do art. 39 como entregável de F8. **Fragilidade registrada:** definimos retenção, motor de decisão e política de log — quem define meios é controlador, e a ANPD pode reclassificar. Mitigação: virar essas decisões em parâmetro do cliente, com padrão seguro |
| **ADR-008** | **RIPD: template produzido pelo ArenaHub, adotado e assinado pela academia.** Passa por revisão jurídica antes do primeiro cliente — template errado escala o erro |

### 3.3 Decididos em 14/08/2026 — primeira rodada

| ADR | decisão |
|---|---|
| **ADR-002** | **Dois níveis** — `Tenant` = academia, `GymUnit` = unidade. Multiunidade em uso desde o dia 1; a Especificação §6 precisa de nota de emenda |
| **ADR-004** | **A nuvem decide sempre.** Reabre automaticamente se a POC medir p95 acima de 300 ms |
| **ADR-005** | `ALLOW`/`DENY`, `occurred_at`, `gym_unit_id`, `access_policies`. Eventos mantêm `AccessGranted`/`AccessDenied`, transportando `outcome` |
| **ADR-008** | Expurgo de biometria em **30 dias** após o fim do vínculo. **Há aluno menor** → consentimento por responsável legal é escopo obrigatório de F8 |
| **ADR-009** | Não opera com convênio hoje. `Entitlement.source` nasce como enum extensível; integração fica fora do roadmap |
| **ADR-011** | `edge-agent` no **PC da recepção**, compartilhado. Mitigação: serviço com início automático, alerta de heartbeat obrigatório em F11, regra escrita de não desligar, liberação manual como fallback |
| **ADR-012** | **Offline sai do MVP 1** e vira MVP 1.5 |
| **ADR-019** | Bloqueio no primeiro instante de `due_date + grace_period` (13/08 no exemplo), **configurável** em `BillingSettings`. Timezone **da unidade**, sem fallback |
| **ADR-020** | Schema Prisma em `packages/database`. **Exige emenda ao `prd/README.md` §5** |

**Também aguardando o PI** (não são ADR; **nascem nos planos**, não nos PRDs — promovê-los ao PRD ou tratá-los como apoio é decisão do PI): `M2-COMPLIANCE-01`,
`M3-CLINICAL-01` (manifest de protocolo de saúde com assinatura profissional),
`M3-STUDENT-AI-01`, `M4-DIST-01` (publicação em lojas), `M5-RULES-01` (catálogo de XP e
streak assinado por profissional) e as **8 decisões abertas de `docs/DESIGN-UI.md` §17** —
entre elas a lista canônica de razões de `DENY`, que F9 precisa.

---

## 4. Roadmap

| MVP | entrega | gate de entrada | fatias | estado |
|---|---|---|---|---|
| **0** | Hardware e protocolo Topdata comprovados em bancada | hardware + SDK + rede de laboratório | F1–F5 | ✅ **ENCERRADO em 18/08/2026** — gate §15 assinado `GO_WITH_CONSTRAINTS` (ADR-029), com quatro restrições normativas herdadas pelo MVP 1 |
| **1** | Academia operando acesso online, com assinatura manual | ✅ **atendido** — `GO_WITH_CONSTRAINTS` em 18/08/2026 (ADR-029) | F6–F9, F11 | **liberado — em execução**. Carrega as restrições 1 a 4 do ADR-029; `M0-AC-004` é condição de saída |
| **1.5** | Operação offline: snapshot, fila e reconciliação | MVP 1 em piloto, com incidente de link medido | F10 | adiado por **ADR-012**. **ADR-007 fechado em 16/08 — spec aprovada** |
| **2** | Pagamento controla entitlement automaticamente | MVP 1 estável + **provedor homologado** | F12–F16 | entrada bloqueada pelo **MVP 1** (que depende do MVP 0). Por ADR: **F12 livre** desde 18/08; F13–F16 esperam o ADR-013 |
| **2.5** | Design system: tokens, `packages/ui` e as três superfícies | **F42 sem gate** (dívida ativa: `admin-web` está na `main` sem CSS) · **F43 e F44 têm gate:** o PI priorizar o MVP 4 | F42–F44 | criado por **ADR-025**. F42 pegável assim que o card `[INFRA]` do pipeline de tokens sair |
| **3** | Evolução física rastreável + IA assistiva | identidade e frequência estáveis + protocolo clínico | F17–F22 | bloqueado por MVP 1 |
| **4** | Autosserviço: app do aluno e totem | APIs estáveis dos MVPs 1, 2 e 3 | F23–F29 | bloqueado |
| **5** | Engajamento opt-in mensurável | eventos confiáveis + app do MVP 4 | F30–F35 | bloqueado |
| **6** | Risco de churn explicável → tarefa operacional | ≥ 6 meses de histórico confiável | F36–F41 | bloqueado |

**Observação sobre o MVP 3:** o índice do plano declara que **o MVP 2 não é dependência
funcional** — MVP 3 pode andar em paralelo se o PI priorizar assim.

---

## 5. Índice Fatia ↔ SPEC

> **Fonte única da numeração.** *Nunca o número nu, sempre o par.* Escrito **só pelo Cowork**.
>
> Regra (ADR-015): `Slice N.M` = `F<n>` = `SPEC-<nnn>`, mesmo número, alocado uma vez, nunca
> reaproveitado. Planos de gate não são fatias — viram card `[GATE]`.
>
> `status` da spec: `planejada` → `rascunho` → `em-revisao` → `aprovada-pi` → `entregue`.
> Mesmo conjunto em `docs/specs/README.md` §3.
>
> **Correção de 14/08/2026:** `planejada` era definido como *"número reservado, arquivo não
> existe"*. Depois do ADR-022 os 41 arquivos-ponteiro passaram a ser criados de uma vez, e 25
> deles existem com esse status — a definição descrevia um mundo que acabou. `planejada` agora
> significa: **ponteiro criado, MVP ainda não discutido com o PI.** Não há pergunta apresentada,
> logo não há o que aprovar.

| F | SPEC | MVP | Slice | título | spec | issue | status |
|---|---|---|---|---|---|---|---|
| F1 | SPEC-001 | 0 | 0.1 | Bancada reproduzível | [`SPEC-001-bancada-reproduzivel.md`](specs/SPEC-001-bancada-reproduzivel.md) | [#1](https://github.com/RodReis/arenahub/issues/1) | aprovada-pi |
| F2 | SPEC-002 | 0 | 0.2 | Ciclo de vida facial | [`SPEC-002-ciclo-de-vida-facial.md`](specs/SPEC-002-ciclo-de-vida-facial.md) | [#2](https://github.com/RodReis/arenahub/issues/2) | aprovada-pi |
| F3 | SPEC-003 | 0 | 0.3 | Catraca e passagem | [`SPEC-003-catraca-e-passagem.md`](specs/SPEC-003-catraca-e-passagem.md) | [#3](https://github.com/RodReis/arenahub/issues/3) | aprovada-pi |
| F4 | SPEC-004 | 0 | 0.4 | Offline e reconciliação | [`SPEC-004-offline-e-reconciliacao.md`](specs/SPEC-004-offline-e-reconciliacao.md) | [#4](https://github.com/RodReis/arenahub/issues/4) | aprovada-pi |
| F5 | SPEC-005 | 0 | 0.5 | Relatório e decisão | [`SPEC-005-relatorio-e-decisao.md`](specs/SPEC-005-relatorio-e-decisao.md) | [#5](https://github.com/RodReis/arenahub/issues/5) | aprovada-pi |
| F6 | SPEC-006 | 1 | 1.1 | Core seguro e unidade | [`SPEC-006-core-seguro-e-unidade.md`](specs/SPEC-006-core-seguro-e-unidade.md) | [#6](https://github.com/RodReis/arenahub/issues/6) | aprovada-pi |
| F7 | SPEC-007 | 1 | 1.2 | Aluno, plano e entitlement manual | [`SPEC-007-aluno-plano-e-entitlement-manual.md`](specs/SPEC-007-aluno-plano-e-entitlement-manual.md) | [#7](https://github.com/RodReis/arenahub/issues/7) | aprovada-pi |
| F8 | SPEC-008 | 1 | 1.3 | Consentimento, biometria e sync de dispositivo | [`SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md`](specs/SPEC-008-consentimento-biometria-e-sync-de-dispositivo.md) | [#8](https://github.com/RodReis/arenahub/issues/8) | aprovada-pi |
| F9 | SPEC-009 | 1 | 1.4 | Decisão online e passagem | [`SPEC-009-decisao-online-e-passagem.md`](specs/SPEC-009-decisao-online-e-passagem.md) | [#9](https://github.com/RodReis/arenahub/issues/9) | aprovada-pi |
| F10 | SPEC-010 | 1.5 | 1.5 | Operação offline | [`SPEC-010-operacao-offline.md`](specs/SPEC-010-operacao-offline.md) | [#10](https://github.com/RodReis/arenahub/issues/10) | aprovada-pi |
| F11 | SPEC-011 | 1 | 1.6 | Painel operacional e prontidão | [`SPEC-011-painel-operacional-e-prontidao.md`](specs/SPEC-011-painel-operacional-e-prontidao.md) | [#11](https://github.com/RodReis/arenahub/issues/11) | aprovada-pi |
| F12 | SPEC-012 | 2 | 2.1 | Ledger operacional e invoice | [`SPEC-012-ledger-operacional-e-invoice.md`](specs/SPEC-012-ledger-operacional-e-invoice.md) | [#12](https://github.com/RodReis/arenahub/issues/12) | `aprovada-pi` |
| F13 | SPEC-013 | 2 | 2.2 | PIX e webhook idempotente | [`SPEC-013-pix-e-webhook-idempotente.md`](specs/SPEC-013-pix-e-webhook-idempotente.md) | [#13](https://github.com/RodReis/arenahub/issues/13) | `aprovada-pi` |
| F14 | SPEC-014 | 2 | 2.3 | Cartão e recorrência | [`SPEC-014-cartao-e-recorrencia.md`](specs/SPEC-014-cartao-e-recorrencia.md) | [#14](https://github.com/RodReis/arenahub/issues/14) | `aprovada-pi` |
| F15 | SPEC-015 | 2 | 2.4 | Inadimplência e acesso | [`SPEC-015-inadimplencia-e-acesso.md`](specs/SPEC-015-inadimplencia-e-acesso.md) | [#15](https://github.com/RodReis/arenahub/issues/15) | `aprovada-pi` |
| F16 | SPEC-016 | 2 | 2.5 | Estorno, conciliação e operação | [`SPEC-016-estorno-conciliacao-e-operacao.md`](specs/SPEC-016-estorno-conciliacao-e-operacao.md) | [#16](https://github.com/RodReis/arenahub/issues/16) | `aprovada-pi` |
| F17 | SPEC-017 | 3 | 3.1 | Consentimento e avaliação manual | [`SPEC-017-consentimento-e-avaliacao-manual.md`](specs/SPEC-017-consentimento-e-avaliacao-manual.md) | [#17](https://github.com/RodReis/arenahub/issues/17) | planejada |
| F18 | SPEC-018 | 3 | 3.2 | Histórico e comparativos | [`SPEC-018-historico-e-comparativos.md`](specs/SPEC-018-historico-e-comparativos.md) | [#18](https://github.com/RodReis/arenahub/issues/18) | planejada |
| F19 | SPEC-019 | 3 | 3.3 | Upload e revisão | [`SPEC-019-upload-e-revisao.md`](specs/SPEC-019-upload-e-revisao.md) | [#19](https://github.com/RodReis/arenahub/issues/19) | planejada |
| F20 | SPEC-020 | 3 | 3.4 | Metas e frequência | [`SPEC-020-metas-e-frequencia.md`](specs/SPEC-020-metas-e-frequencia.md) | [#20](https://github.com/RodReis/arenahub/issues/20) | planejada |
| F21 | SPEC-021 | 3 | 3.5 | Análise assistiva por IA | [`SPEC-021-analise-assistiva-por-ia.md`](specs/SPEC-021-analise-assistiva-por-ia.md) | [#21](https://github.com/RodReis/arenahub/issues/21) | planejada |
| F22 | SPEC-022 | 3 | 3.6 | Operação e qualidade | [`SPEC-022-operacao-e-qualidade.md`](specs/SPEC-022-operacao-e-qualidade.md) | [#22](https://github.com/RodReis/arenahub/issues/22) | planejada |
| F23 | SPEC-023 | 4 | 4.1 | Identidade e shell mobile | [`SPEC-023-identidade-e-shell-mobile.md`](specs/SPEC-023-identidade-e-shell-mobile.md) | [#23](https://github.com/RodReis/arenahub/issues/23) | planejada |
| F24 | SPEC-024 | 4 | 4.2 | Carteirinha, plano e frequência | [`SPEC-024-carteirinha-plano-e-frequencia.md`](specs/SPEC-024-carteirinha-plano-e-frequencia.md) | [#24](https://github.com/RodReis/arenahub/issues/24) | planejada |
| F25 | SPEC-025 | 4 | 4.3 | Financeiro mobile | [`SPEC-025-financeiro-mobile.md`](specs/SPEC-025-financeiro-mobile.md) | [#25](https://github.com/RodReis/arenahub/issues/25) | planejada |
| F26 | SPEC-026 | 4 | 4.4 | Avaliações e consentimentos | [`SPEC-026-avaliacoes-e-consentimentos.md`](specs/SPEC-026-avaliacoes-e-consentimentos.md) | [#26](https://github.com/RodReis/arenahub/issues/26) | planejada |
| F27 | SPEC-027 | 4 | 4.5 | Kiosk seguro | [`SPEC-027-kiosk-seguro.md`](specs/SPEC-027-kiosk-seguro.md) | [#27](https://github.com/RodReis/arenahub/issues/27) | planejada |
| F28 | SPEC-028 | 4 | 4.6 | Pagamento e desbloqueio no totem | [`SPEC-028-pagamento-e-desbloqueio-no-totem.md`](specs/SPEC-028-pagamento-e-desbloqueio-no-totem.md) | [#28](https://github.com/RodReis/arenahub/issues/28) | planejada |
| F29 | SPEC-029 | 4 | 4.7 | Piloto e distribuição | [`SPEC-029-piloto-e-distribuicao.md`](specs/SPEC-029-piloto-e-distribuicao.md) | [#29](https://github.com/RodReis/arenahub/issues/29) | planejada |
| F30 | SPEC-030 | 5 | 5.1 | Preferências e identidade pública | [`SPEC-030-preferencias-e-identidade-publica.md`](specs/SPEC-030-preferencias-e-identidade-publica.md) | [#30](https://github.com/RodReis/arenahub/issues/30) | planejada |
| F31 | SPEC-031 | 5 | 5.2 | XP e conquistas | [`SPEC-031-xp-e-conquistas.md`](specs/SPEC-031-xp-e-conquistas.md) | [#31](https://github.com/RodReis/arenahub/issues/31) | planejada |
| F32 | SPEC-032 | 5 | 5.3 | Consistência e streak | [`SPEC-032-consistencia-e-streak.md`](specs/SPEC-032-consistencia-e-streak.md) | [#32](https://github.com/RodReis/arenahub/issues/32) | planejada |
| F33 | SPEC-033 | 5 | 5.4 | Rankings privados por padrão | [`SPEC-033-rankings-privados-por-padrao.md`](specs/SPEC-033-rankings-privados-por-padrao.md) | [#33](https://github.com/RodReis/arenahub/issues/33) | planejada |
| F34 | SPEC-034 | 5 | 5.5 | Desafios e notificações | [`SPEC-034-desafios-e-notificacoes.md`](specs/SPEC-034-desafios-e-notificacoes.md) | [#34](https://github.com/RodReis/arenahub/issues/34) | planejada |
| F35 | SPEC-035 | 5 | 5.6 | Operação, moderação e experimento | [`SPEC-035-operacao-moderacao-e-experimento.md`](specs/SPEC-035-operacao-moderacao-e-experimento.md) | [#35](https://github.com/RodReis/arenahub/issues/35) | planejada |
| F36 | SPEC-036 | 6 | 6.1 | Contrato de dados e baseline analítica | [`SPEC-036-contrato-de-dados-e-baseline-analitica.md`](specs/SPEC-036-contrato-de-dados-e-baseline-analitica.md) | [#36](https://github.com/RodReis/arenahub/issues/36) | planejada |
| F37 | SPEC-037 | 6 | 6.2 | Regras explicáveis e score | [`SPEC-037-regras-explicaveis-e-score.md`](specs/SPEC-037-regras-explicaveis-e-score.md) | [#37](https://github.com/RodReis/arenahub/issues/37) | planejada |
| F38 | SPEC-038 | 6 | 6.3 | CRM de retenção | [`SPEC-038-crm-de-retencao.md`](specs/SPEC-038-crm-de-retencao.md) | [#38](https://github.com/RodReis/arenahub/issues/38) | planejada |
| F39 | SPEC-039 | 6 | 6.4 | Experimento operacional | [`SPEC-039-experimento-operacional.md`](specs/SPEC-039-experimento-operacional.md) | [#39](https://github.com/RodReis/arenahub/issues/39) | planejada |
| F40 | SPEC-040 | 6 | 6.5 | Modelo supervisionado (condicionado a M6-ML-01) | [`SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md`](specs/SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md) | [#40](https://github.com/RodReis/arenahub/issues/40) | planejada |
| F41 | SPEC-041 | 6 | 6.6 | Produção controlada e monitoramento | [`SPEC-041-producao-controlada-e-monitoramento.md`](specs/SPEC-041-producao-controlada-e-monitoramento.md) | [#41](https://github.com/RodReis/arenahub/issues/41) | planejada |
| F42 | SPEC-042 | 2.5 | 2.5.1 | Design system da superfície `admin-web` | [`SPEC-042-design-system-do-painel.md`](specs/SPEC-042-design-system-do-painel.md) | [#81](https://github.com/RodReis/arenahub/issues/81) | aprovada-pi |
| F43 | SPEC-043 | 2.5 | 2.5.2 | Design system da superfície `mobile` | [`SPEC-043-design-system-do-app.md`](specs/SPEC-043-design-system-do-app.md) | [#82](https://github.com/RodReis/arenahub/issues/82) | aprovada-pi *(gate: MVP 4)* |
| F44 | SPEC-044 | 2.5 | 2.5.3 | Design system da superfície `kiosk` | [`SPEC-044-design-system-do-totem.md`](specs/SPEC-044-design-system-do-totem.md) | [#83](https://github.com/RodReis/arenahub/issues/83) | aprovada-pi *(gate: MVP 4)* |

> **F42–F44 criadas em 16/08/2026 por ADR-025.** As Slices 2.5.1–2.5.3 são definidas **no próprio
> ADR**, não no PRD: o design system é trabalho de plataforma e não tem PRD que o descreva. O
> ADR-015 foi emendado para admitir isso. A contagem sai de 41 para **44 fatias** — nenhum número
> reaproveitado.
>
> ⚠️ **Aqui o número da fatia deixa de coincidir com o da issue — e não volta a coincidir.**
> F42, F43 e F44 são as issues **#81, #82 e #83**. O alinhamento de F1–F41 com #1–#41 foi
> acidente de calendário: as 41 issues nasceram em 14/08, antes de qualquer PR, e no GitHub issue
> e PR dividem o mesmo contador — os PRs #55–#76 consumiram a faixa. **A fonte da numeração é
> este Índice, nunca o número do GitHub.** A partir daqui a diferença é visível, o que é melhor
> do que uma coincidência que ensinava a regra errada.

**Cards `[GATE]` previstos** (não são fatias, não têm SPEC nem F): homologação de provedor de
pagamento (MVP 2), portões clínicos (MVP 3), portões de canal (MVP 4), portões de engajamento
(MVP 5), portões de retenção (MVP 6).

**Exceção registrada (ADR-015):** o índice do plano do MVP 1 divide a Slice 1.3 em duas etapas
com gates distintos. F8 permanece **uma** fatia, com a etapa de sync físico bloqueada por
`HW-GATE-01` (portão de entrada de bancada).

---

## 6. Trabalho `[INFRA]` de bootstrap

**Os seis cards foram criados em 14/08/2026** pelo Cowork, autorizado pelo **ADR-023**. Todos em
Backlog, assignee PI. Correspondem aos itens 1–6 de `docs/DEVELOPMENT.md` §4.

| card | item §4 | evidência de pronto | depende de |
|---|---|---|---|
| ✅ [#42](https://github.com/RodReis/arenahub/issues/42) Monorepo pnpm + Turborepo | 1 | `pnpm install --frozen-lockfile` passa | — |
| ✅ [#43](https://github.com/RodReis/arenahub/issues/43) TS estrito, ESLint, Prettier | 2 | `pnpm lint` e `pnpm typecheck` verdes | #42 |
| ✅ [#44](https://github.com/RodReis/arenahub/issues/44) Os 8 comandos obrigatórios | 3 | os 8 rodam e **falham com mensagem clara** | #42, #43 |
| ✅ [#45](https://github.com/RodReis/arenahub/issues/45) docker-compose local | 4 | `docker compose up` sobe Postgres, Redis e MinIO | #42 |
| ✅ [#46](https://github.com/RodReis/arenahub/issues/46) `packages/database` | 5 | `pnpm --filter database migrate dev` | #42, #45 |
| ✅ [#47](https://github.com/RodReis/arenahub/issues/47) CI | 6 | **CI verde no próprio PR** | #42, #43, #44, #46 |

**Os outros dois itens da §4 não viraram card, por motivos diferentes:**

- **Item 7 — board no GitHub.** *Não pode* ter card: não há como criar um card para criar o
  board (*exceção de arranque*, `docs/DEVELOPMENT.md` §2). Continua pendente: falta o Projects
  com as 5 colunas, as cores e descrições das labels, e as 4 labels que ainda não existem.
- **Item 8 — versionar arquivos *untracked*.** ***Já está feito.***
  `git status --untracked-files=all` retorna vazio, com 113 arquivos rastreados —
  `CLAUDE.md`, `docs/DESIGN-UI.md` e `docs/TESTING.md` incluídos. Marcar como cumprido na §4.

> ⚠️ **A ordem da §4 está errada e isso não é cosmético.** O `DEVELOPMENT.md` §2 diz que a
> exceção de arranque *"morre no item 7"* — o board — mas o board é o **penúltimo**. Na ordem
> escrita, os itens 1–6 rodam sob regime reduzido e o item 8 cai depois da exceção já morta.
> **O board deveria ser o item 1:** é ele que faz o resto virar processo normal. Reordenar é do
> Code, dono do arquivo.

**Sequência real de execução, então:** board → ✅ #42 → ✅ #43 → ✅ #45 → ✅ #44 → ✅ #46 → ✅ **#47**. O #47 (CI)
é o marco: quando ele fecha, a exceção de arranque morre e o ciclo normal vale inteiro.

> A ordem acima foi para o `DEVELOPMENT.md` §4 no PR
> [#48](https://github.com/RodReis/arenahub/pull/48), como coluna `ordem` **ao lado** do `#`
> original. Os números dos itens **não foram renumerados de propósito** — o ADR-023 e as §1/§6
> deste arquivo citam "item 7", "itens 1–6" e "itens 1–8"; renumerar tornaria um ADR aprovado
> falso, em arquivo que não é do Code.

**#42 entregue em 14/08/2026** — PR [#49](https://github.com/RodReis/arenahub/pull/49). Com ele,
**três números que não existiam em documento nenhum ficaram fixados** por decisão do PI:
**Node 22 LTS, pnpm 10, Turborepo 2**. Registro em `DEVELOPMENT.md` §4. Major não muda sem ADR.

**#43 entregue em 14/08/2026** — PR [#50](https://github.com/RodReis/arenahub/pull/50). Fixou mais
quatro versões: **TypeScript 5.9, ESLint 9, typescript-eslint 8, Prettier 3**. TS 7 e ESLint 10 já
tinham saído e foram recusados pelo mesmo critério do Node 22 — compatibilidade comprovada com
NestJS 11, Next.js 16, Prisma e Expo vale mais que velocidade de compilador.

**#45 entregue em 14/08/2026** — PR [#51](https://github.com/RodReis/arenahub/pull/51). Postgres 17,
Redis 8 e MinIO sobem com healthcheck, todas as imagens com **tag fixa** — `latest` quebraria o
`M0-NFR-006` (qualquer pessoa reproduz a bancada) em silêncio, na máquina de outra pessoa.

> ⚠️ **`docker compose` sem `--env-file .env` ignora o `.env` da raiz.** O Compose procura o
> arquivo ao lado do YAML, e o nosso vive em `infra/docker/`. Sem a flag, todas as portas caem no
> padrão sem aviso nenhum. Por isso os scripts **`pnpm docker:up | down | reset | logs`** existem
> — use-os em vez do comando cru. Descoberto ao subir de verdade, não na leitura.

> ℹ️ **Provisionar não é adotar.** O Redis está no compose para o ambiente local ficar completo.
> Isso **não** autoriza BullMQ na primeira fatia que parecer conveniente — fila entra só com
> métrica que a justifique (`CLAUDE.md` → Stack). Registrado também no `infra/docker/README.md`.

**#44 entregue em 14/08/2026** — PR [#52](https://github.com/RodReis/arenahub/pull/52). **A ressalva
que vinha desde o #42 morreu aqui.**

> ✅ **Verde agora quer dizer verificado.** `turbo run test` num repositório onde ninguém declara
> `test` imprimia `WARNING No tasks were executed` e **saía com código 0**. O aviso passa
> despercebido; o código de saída não — e quem o lê é o CI, que substitui o aceite humano no merge.
> O guarda `scripts/run-task.mjs` faz o comando **falhar com mensagem** em vez de mentir.
>
> Estado dos oito hoje: `install`, `lint` e `typecheck` **passam** porque têm o que rodar; `test`,
> `test:integration`, `test:e2e`, `build` e `dev` **falham com mensagem** — correto, nenhum
> workspace os declara ainda. Cada um passa a valer quando o workspace que o usa nascer.

> ℹ️ **A porta 3344 tem guarda** (`scripts/check-port.mjs`), mesmo sem API ainda. Se estiver
> ocupada, falha — nunca troca. Framework que cai sozinho na porta seguinte deixa dois processos
> servindo, com o operador falando com um e lendo o log do outro.

### Pendência entregue ao Code — arquivo que não é do Cowork

O `docs/DEVELOPMENT.md` ficou com **três referências obsoletas** depois da segunda rodada de
14/08/2026, e o ADR-021 **não** dá esse arquivo ao Cowork. Correção é do Code:

| linha | o que diz hoje | o que passou a valer |
|---|---|---|
| 128 (F4) | bloqueio "hardware, **ADR-011**" | só hardware — ADR-011 fechou |
| 147 (F8) | bloqueio "**ADR-008** (base legal, RIPD, papéis)" | só a etapa física por hardware — ADR-008 fechou nesses três pontos |
| 168 (F10) | "**ADR-011** (partes abertas)" | só ADR-007 |

Anotado em vez de corrigido de propósito: consertar arquivo de outro dono sem pedir é a erosão
que o ADR-021 nomeia — três exceções viram a regra real.

---

## 7. Riscos vivos

| risco | impacto | mitigação |
|---|---|---|
| SDK Topdata pode ser Windows-only / DLL nativa | muda stack e deploy do `edge-agent` | é o objeto do MVP 0; `NO_GO` é resultado válido |
| ANPD atuando sobre biometria **antes** da norma sair (caso PR, 04/08/2026) | suspensão do produto no cliente | ADR-008: base legal, comprovação de segurança, log de acesso a template, caminho alternativo |
| **Catraca depende do uptime do PC da recepção** — sem offline no MVP 1, PC desligado = catraca parada | incidente na frente do cliente | ADR-011: serviço automático, alerta de heartbeat em F11, regra escrita, liberação manual |
| Link ruim no piloto sem offline | fila na recepção em horário de pico | primeiro incidente é gatilho para priorizar o MVP 1.5 |
| **Aluno menor de idade + biometria** | agravante em fiscalização da ANPD | ADR-008: consentimento por responsável legal é escopo obrigatório de F8 |
| Quatro frontends antes do primeiro cliente | custo de release multiplicado | roadmap já sequencia; não antecipar |
| Concorrência entrega acesso facial de fábrica | diferencial não está no hardware | `docs/LANDSCAPE.md` |
| `edge-agent` roda em máquina que não controlamos | catraca para e não sabemos por quê | ADR-011 |
