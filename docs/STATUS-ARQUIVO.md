# STATUS-ARQUIVO.md — histórico detalhado do ArenaHub

> Complemento do `docs/STATUS.md`. Lá mora a prosa curta; **aqui mora o detalhe**: por que uma
> decisão foi tomada, o que se descobriu no caminho, o que se tentou e não deu.
>
> Ordem **cronológica inversa** — o mais recente no topo. Entrada não se apaga e não se
> reescreve; corrige-se com entrada nova.
>
> **Regra de honestidade:** só entra aqui o que aconteceu. Este arquivo **não registra
> intenção, plano nem previsão** — para isso existem `DEVELOPMENT.md` e `STATUS.md`. Registro
> narrado como se fosse evidência é exatamente o defeito que motivou a reescrita do
> `TESTING.md` (ADR-016).

---

## 2026-08-19 — O provedor foi decidido, e a F14 quase cobrou o aluno duas vezes

### O gate que nunca existiu

O ADR-013 mandou a escolha do provedor sair de um card `[GATE]` com matriz comparativa. **Esse
card nunca chegou a ser criado no board** — F14, F15 e F16 ficaram paradas por um portão que não
existia em lugar nenhum.

O que destravou não foi a matriz: foi um **fato que não estava em documento nenhum**, nem no
`LANDSCAPE.md` §4.2 nem no ADR-013. O PI informou que **a Arena Positiva já recebe pela Sicoob**.

Isso muda a pergunta. O Sicoob é **banco, não adquirente**: as APIs públicas cobrem Pix
recebimentos, cobrança bancária e transferências, e **não há cartão tokenizado, cofre de tokens
nem assinatura**. O `MVP-02` §5 exige as três capacidades de um provedor único — logo, provedor
único é impossível com o Sicoob, e trocá-lo custaria à academia o relacionamento bancário que ela
já tem. Daí o **ADR-032**: Sicoob para PIX, Getnet para cartão, com emenda ao §5.

O gate virou **verificação** em vez de competição, registrada em
[`reports/MVP-02-matriz-de-homologacao-de-provedor.md`](reports/MVP-02-matriz-de-homologacao-de-provedor.md).
Nada foi verificado em sandbox — os dois portais exigem credencial —, e os itens marcados ❓
precisam de confirmação antes de virar adapter.

### O defeito crítico que a fatia produziu

A chave de idempotência da cobrança de cartão era `card:<invoice>:<tentativas já feitas>`,
**derivada de uma contagem**. Parecia certa: incluir o índice da tentativa é o que impede a segunda
tentativa de reusar a chave da primeira.

Mas **contagem muda entre a leitura e a escrita** — que é exatamente a janela que a idempotência
existe para fechar. Duas requisições concorrentes para a mesma invoice leem `0` e `1`, montam `:0`
e `:1`, e a constraint `(tenant_id, idempotency_key)` **nunca dispara**.

**Foi medido, não deduzido:** sondei com `Promise.allSettled` contra Postgres real, e o resultado
foi **2 sucessos, 2 tentativas gravadas, duas chamadas ao provedor**. Aluno cobrado em dobro, sem
erro e sem log.

A lição não é "faltou um teste de concorrência". É que **a constraint que existia protegia contra o
caso errado**: reenvio da *mesma* chave. O caso real não repete chave — gera duas diferentes. Uma
guarda pode estar presente, verde, e defendendo outra coisa.

O conserto mora **no banco**: índice parcial `UNIQUE (tenant_id, invoice_id) WHERE method = 'CARD'
AND status = 'PROCESSING'`. Um `if (jaExiste)` no código perderia a mesma corrida que tentaria
fechar — mesma tese do inbox de webhook da F13 (INV-076). O `P2002` vira 409 de domínio, porque um
500 faria a recepção clicar de novo.

A revisão de código chegou ao mesmo diagnóstico de forma independente, com veredito BLOCK.

### Um segundo bug, latente, criado pela própria decisão dos dois provedores

`criar-cobranca-pix.use-case.ts` resolvia a conta com `findFirst({ tenantId, active: true })` —
**qualquer** conta ativa. Correto com um provedor. Com Sicoob e Getnet no mesmo tenant, devolveria
a conta de **cartão** metade das vezes, conforme a ordem de inserção, e a cobrança PIX iria para o
lugar errado.

Corrigido com `ProviderAccount.capability` e um resolvedor que **pergunta pela capacidade, nunca
pela marca**: nenhum caso de uso menciona `sicoob` ou `getnet`. Trocar de PSP é escrever um adapter
e atualizar uma linha — nem migration, porque `provider` continua `String`.

**Não virou registry.** Sem config declarativa, sem fallback, sem descoberta em runtime — a
extensibilidade já mora na interface `PaymentProvider`, e maquinário a mais seria abstração
especulativa contra provedores hipotéticos. Quando o terceiro chegar, trará exigência que ninguém
previu: a Getnet exige tokenização no cliente, o Sicoob exige certificado ICP-Brasil em arquivo, e
nenhum "gateway genérico" prevê certificado digital.

### O que a verificação por mutação achou

Três guardas foram testadas plantando o defeito que elas deveriam pegar.

A **guarda de PCI** pegou o atalho real — o endpoint da Getnet que recebe `card_number` cru, mais
fácil de implementar que o Get Checkout. Mas, escrevendo-a, descobri que ela reprovava o próprio
`payment-provider.port.ts`, cujo **comentário** diz *"PAN e CVV nunca chegam aqui"*: acusava a
documentação da regra que defende, e a saída mais barata para calá-la seria apagar a frase que
ensina a próxima pessoa.

A **política de retry** teve duas de três mutações pegas. A terceira **passou limpo**, e isso
corrigiu um erro meu: eu afirmava no código que `setUTCDate` protege contra horário de verão.
**Não protege** — em UTC não existe DST, e a soma em milissegundos é equivalente por construção. O
teste passava com as duas implementações, ou seja, não provava nada. Comentário e caso reescritos
para dizer o que é verdade.

### O que ficou de fora, e por quê

**Os adapters reais não foram escritos.** Dependem de credencial e sandbox, e a matriz do gate
marcou como **não verificado** exatamente o que eles teriam de honrar — assinatura de webhook,
estorno parcial, chave estável de evento. Adapter contra documentação não confirmada produz código
que parece pronto e falha na primeira chamada real.

**A UI de cartão é do provedor** (Get Checkout) — esta fatia é de backend. **F15** é o job de
vencimento; **F16** é estorno, e ainda depende das duas políticas do `M2-COMPLIANCE-01`.

---

## 2026-08-19 — Duas guardas de CI passavam verde sem verificar o que prometiam

PR [#116](https://github.com/RodReis/arenahub/pull/116), issues
[#111](https://github.com/RodReis/arenahub/issues/111) e
[#112](https://github.com/RodReis/arenahub/issues/112). Ambas achadas na revisão da
[#110](https://github.com/RodReis/arenahub/issues/110) e deixadas de fora daquele diff **de
propósito** — mudança de guarda escondida dentro de correção de UI é o tipo de diff que ninguém
revisa direito.

### O relatório de evidência subcontava, e o self-check não pegava

`"Button.spec.tsx".endsWith(".spec.ts")` é `false` — termina em `x`. Com um sufixo único por
nível, os **17 arquivos `.spec.tsx`** não entravam em nível nenhum: os testes de componente de
`packages/ui`. O `reports/TESTS.md`, que é a guarda que barra merge (`TESTING.md` §5), afirmava
**79 arquivos** onde havia **96**. Unitários: 50 → 67.

O gerador **tinha** self-check, e ele passava. Essa é a lição que sobra: o self-check garantia que
o gerador **conta o que ele acha**, não que ele **ache tudo**. Um teste que só exercita o caminho
que o autor imaginou tem exatamente esse ponto cego.

A precedência entre níveis continua vindo do **ponto literal**, não da ordem do array:
`.int-spec.ts` não casa `.spec.ts` porque o caractere antes de `spec` é `-`. Afrouxar para
`-spec.ts` faria integração vazar para unitário — e o self-check ganhou caso para isso.

`docs/TESTING.md` §2 mandava usar `*.test.tsx` para web: sufixo que **não existe em nenhum arquivo
do repositório**. Corrigido para `*.spec.tsx`.

### O lint não carregava react-hooks nem jsx-a11y

Nenhuma das quatro configs referenciava os plugins. O `admin-web` usa `useActionState` e
`useFormStatus` em oito telas — sem `rules-of-hooks`, hook fora de ordem e dependência faltante só
apareciam em **runtime**, e a F45 já tinha mostrado que defeito de runtime nesta app sobrevive a
55 E2E verdes.

Config novo (`packages/config/eslint/react.js`) em vez de acréscimo ao `base.js`: a `api` e o
`edge-agent` não têm JSX e não devem pagar o custo de carregar plugin de React.

**O lint verde foi verificado com canário**, não aceito de cara: violação plantada com hook
condicional, dep faltante, `<img>` sem alt, label solto e `role="checkbox"` sem `aria-checked`. As
7 classes de regra dispararam. Lint verde sem canário não distingue *"nada errado"* de *"plugin
não carregou"* — e o *"não carregou"* era exatamente o estado anterior.

### Duas decisões registradas, ambas reversíveis

O `eslint-plugin-react-hooks` **v7** traz o React Compiler inteiro: 16 regras no `recommended`,
incluindo `immutability`, `purity` e `static-components`. **Ficaram de fora.** Adotar o compiler é
decisão de arquitetura com custo próprio, não efeito colateral de uma issue de lint.

O `jsx-a11y` entrou como **subconjunto nominal** (11 regras), não como preset: cada uma corresponde
a uma linha do `DS-PAINEL.md` §10. O preset completo traria regra sobre elemento que não usamos, e
o ruído faz o time desligar o plugin em vez de ler o aviso.

### A adoção acusou uma violação real, como a issue previu

`Button` passava `children` por spread, e a `anchor-has-content` não conseguia provar que o `<a>`
tinha conteúdo. `children` virou prop **explícita e obrigatória** — `ButtonHTMLAttributes` a traz
opcional, e botão sem conteúdo é anunciado pelo leitor de tela como alvo sem nome. Nenhum chamador
quebrou: não existe `<Button />` auto-fechado no repositório.

### O que a revisão de código acrescentou

Veredito APPROVE, 0 CRITICAL/HIGH/MEDIUM. Dois LOW, ambos corrigidos no próprio PR:

1. O nível **`segurança`** (`.sec-spec.ts`) está no `TESTING.md` §2 desde o bootstrap e **nunca
   esteve no classificador**. Não era regressão — mas a issue é literalmente *"o classificador não
   conta o que existe"*, e deixar de fora o único nível restante seria consertar metade do defeito.
   A linha sai zerada hoje; no dia em que o primeiro teste de isolamento de tenant for escrito, ele
   conta em vez de sumir.
2. A justificativa das regras `jsx-a11y` citava o `DS-PAINEL.md` §11, que é a lista de regras de
   lint do design system. O que o comentário descreve é o §10, *Acessibilidade WCAG 2.2 AA*.

### O `--watch` mentiu de novo, de um jeito novo

`gh pr checks 116 --watch` saiu **0** enquanto `gh pr checks` respondia **"no checks reported on
the branch"**: o rollup do PR ainda não havia populado, e o watch leu *"nenhum check"* como *"nada
falhou"*. Variante do que o PR #102 já tinha ensinado. O verde real veio de `gh run watch
<id> --exit-status` mais conferência job a job — `lint, typecheck, guardas e testes` e `integração
e E2E`, ambos `success` no SHA `1ba5b09`.

---

## 2026-08-18 — O painel foi visto pela primeira vez, e o diagnóstico não era o esperado

O PI abriu o `admin-web` e mandou os prints de seis telas: `Unidades`, `Eventos de acesso`,
`Liberação manual`, `Dispositivos`, `Alunos` e `Planos`. HTML cru, sem estilo, com dado de teste
na listagem e caixas vazias no operacional. A reação registrada foi literal: *"o projeto todo está
assim, esquisito, não é nada do que especifiquei"*, seguida de *"estou querendo deletar ele e
começar do zero"*.

**O ponto de partida da conversa foi um pedido diferente:** adicionar ao cadastro de aluno os 26
campos de uma grade de sistema legado, porque a Especificação §10 diz *"cadastro completo de
alunos"* e a F7 entregou quatro campos. A investigação do pedido é que abriu o resto.

### O que se descobriu, em ordem

**Metade dos campos pedidos já existia.** `student_addresses` foi criada na F7 com CEP,
logradouro, número, complemento, bairro, cidade e estado — e **nunca foi escrita por nada**: nem
endpoint, nem seed, nem tela. Tabela órfã desde o nascimento. `student_contacts` aceita telefone,
WhatsApp e e-mail; o formulário oferecia um contato só.

**Não existe endpoint que edite dado cadastral de aluno.** Só `PATCH /students/:id/status`. Um
cadastro em quatro passos sem edição significa que CEP digitado errado é permanente. Ninguém tinha
percebido porque a F7 satisfez o `M1-FR-006` como ele está escrito, e ele não menciona edição.

**Um terço da lista pedida não é campo.** Plano, Inc. Plano, Venc. Plano, Data Mat. e Últ. Acesso
saem de `Subscription`, `Entitlement` e `AccessEvent`. Vieram da grade de listagem do legado, e
grade de listagem não é formulário. Campo editável de vencimento de plano seria uma segunda fonte
de verdade sobre direito de acesso — e a que a catraca **não** consulta. Regra de arquitetura nº 1.

**O mockup contrariava o próprio domínio.** A tela que o PI desenhou marcava CPF, telefone e
e-mail como **obrigatórios**. INV-009 e INV-011 dizem o contrário, e a F7 foi implementada assim
de propósito: menor de idade e quem chega sem documento precisam ser cadastrados. Decisão do PI na
hora: **o mockup é corrigido, não o domínio.**

**Foto é o único campo do §11 que toca o art. 11 da LGPD.** Foto de rosto guardada ao lado de um
sistema de reconhecimento facial é candidata a reclassificação como dado biométrico pela ANPD, e
biometria é lista fechada — legítimo interesse não existe. Sai da F45 e vai para a F8, junto do
consentimento.

### As três causas do "esquisito"

Nenhuma é defeito de implementação, e é isso que importa para a decisão de não recomeçar.

**1 — A ordem do roadmap fez exatamente o que mandava.** A F42 (design system do painel) está no
MVP 2.5, depois de todo o MVP 1 e do MVP 2. Onze telas foram construídas antes de existir
superfície, porque o plano dizia para construir. O Code seguiu o plano.

**2 — O banco de desenvolvimento é o banco dos testes E2E.** O `playwright.config.ts` sobe a API
local, que usa o mesmo `DATABASE_URL` de dev (`localhost:5442/arenahub`), e os E2E não limpam o que
criam. Os testes de integração limpam. Daí `Caminho Biometria 1787060177858` e `Plano Atribuível
1786909436454` na listagem: o produto estava exibindo o resíduo da suíte.

**3 — Nunca houve seed de demonstração.** O `CLAUDE.md` prevê o seed "na primeira fatia que
precisar" e nenhuma fatia precisou, porque cada uma criava o próprio dado nos testes. O painel
operacional de um banco vazio parece um sistema morto mesmo estando correto.

### O achado lateral que valia por si

`git status` na `main` acusava **470 arquivos modificados**. Nenhum era trabalho: a árvore estava
com CRLF, os blobs com LF, sem `.gitattributes` e sem `core.autocrlf`. `git diff
--ignore-cr-at-eol` zerava tudo. Nesse estado, qualquer `commit -a` produz um commit de 470
arquivos com zero mudança semântica, todo PR nasce ilegível e os dois atores colidem em tudo.
Mitigado na hora com `core.autocrlf=input` local — caiu para 2 arquivos, ambos deste registro. A
correção definitiva é um `.gitattributes` na raiz, que é arquivo do Code.

### O que ficou decidido

F45 (cadastro completo) e F46 (design system aplicado ao painel) aprovadas, **com a ordem
invertida**: F46 primeiro, para que o PI pare de julgar o produto por telas que o roadmap mandou
deixar sem design. Mais um card `[INFRA]` para separar o banco de teste do de desenvolvimento,
criar seed de demonstração e fechar o line ending.

**A lição de método, registrada porque vai se repetir:** a Especificação enumera, o PRD é o
normativo (ADR-018), e o que o PRD não repete não vira critério de aceite. A Slice 1.2 dizia
*"cadastro e busca de aluno"* — o Code entregou exatamente isso. Fatia que dependa de lista de
campos da Especificação passa a copiar a lista para o corpo da issue.

---

## 2026-08-14 — Oito decisões novas e duas ratificações

Segunda sessão do dia. Com a base documental aprovada e commitada (`0fef95d`), o PI tomou **oito
decisões novas** (ADR-002, 004, 008, 009, 011, 012, 013 parcial, 019) e **ratificou duas**
(ADR-005 e ADR-020), em três blocos, na ordem de bloqueio.

### As decisões

| ADR | decisão | consequência que ela cria |
|---|---|---|
| **ADR-011** | `edge-agent` no **PC da recepção**, compartilhado | a catraca passa a depender do uptime de um PC compartilhado |
| **ADR-002** | **dois níveis** (`Tenant` = academia, `GymUnit` = unidade) | multiunidade em uso desde o dia 1; Especificação §6 fica errada |
| **ADR-012** | **offline sai do MVP 1** e vira MVP 1.5 | F10 muda de MVP sem mudar de número |
| **ADR-009** | não opera com convênio hoje | `Entitlement.source` nasce extensível; integração fora do roadmap |
| **ADR-013** | provedor sai da **homologação**, com matriz de critérios | MVP 2 segue bloqueado, mas agora por um gate com critério |
| **ADR-019** | bloqueio em `due_date + grace_period`, **configurável**; timezone da unidade | `BillingSettings` ganha âncora de bloqueio explícita |
| **ADR-008** | expurgo de biometria em **30 dias**; **há aluno menor** | consentimento por responsável legal vira escopo obrigatório de F8 |
| **ADR-004** | **a nuvem decide sempre**, com gatilho de reabertura na medição da POC | o orçamento de 300 ms passa a incluir a internet da academia |
| **ADR-005** | ratificado | vocabulário único; eventos mantêm `AccessGranted`/`AccessDenied` |
| **ADR-020** | ratificado | `packages/database`; **exige emenda ao `prd/README.md` §5** |

### O risco que duas decisões criaram juntas

ADR-011 (PC compartilhado) e ADR-012 (sem offline no MVP 1) combinados produzem uma consequência
que nenhum dos dois tem sozinho: **a disponibilidade da catraca passa a ser exatamente o uptime
de um PC que outras pessoas usam.** Não é modo degradado — se a máquina desligar, a catraca não
decide nada.

Foi apresentado ao PI como consequência, não como erro, e ele escolheu **mitigar por processo**:
serviço Windows com início automático, alerta obrigatório de heartbeat em F11, regra escrita de
não desligar o PC, e liberação manual pela recepção como fallback declarado. **Risco residual
aceito conscientemente:** alguém tira da tomada. O primeiro incidente desse tipo é o gatilho
para priorizar o MVP 1.5 — registrado aqui para que, quando acontecer, ninguém trate como
surpresa.

### O que ficou aberto

Quatro pendências, duas delas parciais:

- ~~**ADR-011** — provisionamento de identidade do Edge e credencial de `/api/v1/edge/*`. Bloqueia F4.~~ **Fechado na segunda rodada do mesmo dia.**
- ~~**ADR-008** — base legal, RIPD e papéis controlador/operador. Bloqueia F8.~~ **Fechado na segunda rodada.** Sobrou transferência internacional de IA, que bloqueia F21.
- **ADR-013** — o provedor em si, que sai do card `[GATE]` de homologação. Bloqueia F12–F16.
- **ADR-007** — semântica offline. **Sem urgência**: migrou com F10 para o MVP 1.5.

### Segunda rodada de 14/08/2026 — o que foi decidido e o que isso custou

O PI abriu a sessão pedindo para "continuar". A leitura do repositório mostrou que **não havia
trabalho de Cowork pendente — havia bloqueio**: 8 specs aprovadas sem board onde criar card, e 33
travadas por decisão que só o PI toma. Documentar mais não moveria nada. A sessão virou, então,
uma rodada de decisão.

**ADR-011 fechou inteiro.** Pareamento por código de uso único → segredo por dispositivo no
mecanismo seguro do Windows; rotação automática pelo agente; revogação imediata no painel. mTLS
foi considerado e **recusado por custo de operar PKI** para uma unidade piloto — decisão datada,
com gatilho de reabertura escrito (escala multi-unidade ou exigência enterprise).

**Consequência que virou escopo:** o alerta de heartbeat de F11 passa a ter duas causas
distintas — Edge ausente e falha de renovação de credencial. Tratar as duas como um alarme só faz
a recepção ligar para a pessoa errada. Sem isso, a rotação automática se torna um jeito novo de a
catraca parar em silêncio.

**ADR-008 fechou em três dos quatro pontos — e corrigiu um erro material.** O ADR oferecia
"legítimo interesse com LIA" como alternativa ao consentimento. **Essa hipótese não existe para
dado biométrico:** é dado sensível (LGPD art. 5º, II) e o art. 11 é lista fechada onde legítimo
interesse não figura. Um documento de governança afirmando o contrário é exatamente o papel que
se entrega numa fiscalização — registrar o erro vale mais que apagá-lo.

Decidido: **consentimento específico e destacado** (art. 11, I), com a alínea "g" recusada por
ser estreita e por base legal ausente ter sido o fundamento nº 1 da suspensão no caso PR.
**Academia controladora, ArenaHub operador**, com a fragilidade anotada em vez de escondida — nós
definimos retenção, motor de decisão e política de log, e quem define meios é controlador; a
mitigação é virar essas decisões em parâmetro do cliente. **RIPD por template nosso**, assinado
pela academia, com revisão jurídica antes do primeiro cliente.

**O que ficou explicitamente fora.** O ADR-013 **não** foi levado ao PI: ele já havia decidido que
o provedor sai da homologação, e pedir a escolha agora seria fazê-lo desdizer o próprio ADR. O
que sobra ali é modelagem, não fornecedor — as duas políticas do `M2-COMPLIANCE-01` e o **modelo
de `Payment`, sem campos definidos em documento nenhum**: uma invoice paga em duas tentativas
(PIX falho + cartão) não cabe no modelo atual. Fica para a rodada seguinte.

**Correção de higiene documental.** O status `planejada` era definido como *"número reservado,
arquivo não existe"* — mas o ADR-022 criou os 41 ponteiros de uma vez, e 25 arquivos existiam com
esse status. A definição descrevia um mundo que tinha acabado no dia anterior. Redefinido para
**"ponteiro criado, MVP ainda não discutido com o PI"**.

**Fronteira respeitada.** O `docs/DEVELOPMENT.md` tem três referências obsoletas a ADR-011 e
ADR-008 (linhas 128, 147, 168). **Não foram corrigidas aqui:** ADR-021 não dá esse arquivo ao
Cowork, e ele é do Code. Fica como pendência declarada, não como conserto silencioso.

### Pendências criadas pelas próprias decisões

1. **Especificação §6** precisa de nota de emenda: promete três níveis de hierarquia que o
   modelo não tem (ADR-002).
2. **`prd/README.md` §5** precisa de emenda formal acrescentando `packages/database` (ADR-020).
3. **Especificação §42** tem a conta de carência errada (10 + 3 = 13, não 14) — ADR-019 já
   registra o correto, mas o texto de origem continua errado.

### Segunda exceção de escrita no Git

O PI autorizou, também pontualmente, que o Cowork commitasse na `main` os documentos alterados
pelo registro destas decisões.

**Observação que precisa ficar escrita, porque é desconfortável:** esta é a **segunda exceção em
poucas horas**. Duas exceções seguidas deixam de ser exceção e viram padrão não declarado — que é
exatamente o tipo de erosão silenciosa que este processo existe para impedir.

Se houver uma terceira, o certo não é abrir outra exceção: é **ampliar formalmente o escopo do
Cowork por ADR**, para que a regra escrita descreva o que de fato acontece. Regra que se
contorna toda vez já não é regra — é decoração.

Nenhuma linha de código foi escrita. Nenhum card foi criado.

---

## 2026-08-14 — Configuração da governança e crítica da base documental

**O que aconteceu.** O PI pediu análise, crítica e configuração dos documentos do projeto. A
base foi lida integralmente: Especificação Completa (3.114 linhas, 128 seções), `prd/README.md`,
os 7 PRDs de MVP, os 6 índices de plano, `TESTING.md`, `DESIGN-UI.md` e `CLAUDE.md`.

### Achados que motivaram mudança

**1. Dois processos incompatíveis coexistiam.** `docs/prd/README.md` §10–12 descrevia execução
com evidência no checklist do PRD, sem qualquer menção a Git, PR, issue ou board. O `CLAUDE.md`
descrevia spec + issue + PR + labels `proplan:*`. Os vocabulários eram disjuntos: `Slice N.M`
contra `[F<n>]`; `APROVADO`/`EM_DESENVOLVIMENTO`/`CONCLUÍDO` contra `aprovada-pi` +
`proplan:done`.

Pior: **nenhum dos dois era executável**. Não existia `docs/specs/`, `STATUS.md`, numeração de
SPEC, fatia `F<n>` nem `.github/`. A regra "sem spec `aprovada-pi` → não codificar" travava o
Claude Code na primeira instrução, porque nenhum documento do repositório carregava esse rótulo
— e os PRDs estavam "APROVADOS **para planejamento**", não para implementação.

→ Resolvido por **ADR-014** (vale o `CLAUDE.md`) e **ADR-015** (Slice = Fatia = SPEC).

**2. `docs/TESTING.md` continha evidência fabricada.** O documento que governa *"evidência de
máquina, nunca narrada"* registrava como fato ocorrido: achado do PI em 22/07/2026; entregas
SPEC-027 (#103) e SPEC-022 (#106, #109) mergeadas com CI verde; "671 testes verdes"; um bug que
apagou o registro da SPEC-016 depois de "CI verde em 3 PRs seguidos"; e dois critérios de aceite
marcados `[x]`.

Nada disso pode ter ocorrido: o histórico deste repositório começa em 14/08/2026 e não há uma
linha de código. O texto era importado do produto **ProPlan**, incluindo `.proplan/` e o app
`apps/web` — que **não existe** nesta arquitetura, cujo web administrativo é `apps/admin-web`.
O arquivo ainda contradizia o PRD §9 (80% de cobertura em regras de domínio) ao declarar
"cobertura report-only, não barra o merge".

→ Resolvido por **ADR-016**: reescrito do zero.

**3. `CLAUDE.md` estava contaminado por outro projeto e apontava para o vazio.** Título
"hubarena"; duas menções a **"Brabolão"**; três seções vazias (`## O que é`, `## Regras de
arquitetura`, `## Stack`); e **nove documentos referenciados que não existiam**. Chamava
`DESIGN-SYSTEM.md` de "aprovado" quando o arquivo real (`DESIGN-UI.md`) está em `RASCUNHO`, com
8 decisões abertas na §17 — entre elas a lista canônica de razões de `DENY`, que a fatia do
motor de acesso precisa.

→ Reescrito. Documentos criados. Ponteiro corrigido para `docs/DESIGN-UI.md`, com o status real
declarado.

**4. A regra "nunca usar mock" proibia a própria estratégia de testes.** Os PRDs **exigem**
simulador contratual do leitor Topdata rodando em CI sem hardware (`M0-NFR-006`),
`FakePaymentProvider`, fakes de `MalwareScanner` e `DocumentExtractor`, e golden files
anonimizados. A regra literal do `CLAUDE.md` tornava tudo isso ilegal — ou seja, proibia o único
jeito de testar hardware de terceiro e gateway financeiro. A regra também mandava `prisma/seed.ts`
na raiz — e onde o schema Prisma deve morar (`packages/database` ou `infra/database`) **não está
definido no PRD**, o que virou ADR-020.

→ Resolvido por **ADR-017**: a proibição vale para o caminho de produção; o dublê é obrigatório
**no boundary** e proibido dentro da regra de domínio.

### Achados na Especificação Completa que viraram ADR aberto

| achado | seção | ADR |
|---|---|---|
| A entidade "Academia" é desenhada em três níveis e não existe no modelo de dados | §6 vs §10/§90 | ADR-002 |
| O motor de acesso consulta assinatura, desfazendo o princípio da própria §125 | §20 regra 5, §21 | ADR-003 (resolvido) |
| "Decisão local < 300 ms" convive com caminho normal roteado pela nuvem | §26 vs §99 | ADR-004 |
| `GRANTED/DENIED` × `ALLOW/DENY`; `timestamp` × `occurred_at`; `unit_id` × `gym_unit_id` | §31 vs PRD | ADR-005 |
| Cache válido 12 h com carência de 24 h — 12 h de semântica indefinida | §27 | ADR-007 |
| Carência de 3 dias sobre vencimento 10/08 resultando em bloqueio 14/08 (10+3=13) | §42 | ADR-019 |

Além disso: **`tenant_id` obrigatório pela §6 está ausente** em `Subscription`, `Invoice`,
`BodyAssessment`, `HealthMeasurement`, `Consent`, `DeviceUser` e `AIAnalysis`;
`BiometricIdentity.external_enroll_id` é único e não tem `device_id`, embora o `enrollid` do
Topdata seja por dispositivo — dois leitores na mesma unidade não cabem no modelo; e
**Meta, Lead, Contrato, Desconto, Cupom, feriado, `Payment` e `Passage`** aparecem em telas,
menus e regras **sem entidade nem campo**. Tudo catalogado em `docs/CONVENTION.md` §5.

### Pesquisa de mercado — o que mudou a leitura de risco

Levantamento datado em `docs/LANDSCAPE.md`. Dois fatos alteraram prioridade:

**Regulatório.** Em **04/08/2026** — dez dias antes desta entrada — a ANPD determinou, por
Despacho Decisório nº 2/2026/SFI, **suspensão imediata** do reconhecimento facial na rede
estadual do Paraná. Fundamentos: falta de base legal, ausência de comprovação de segurança e
falha no controle de acesso às imagens. A norma específica sobre biometria (Agenda Regulatória
2025-2026, item 5) **ainda não saiu** — a ANPD está agindo antes dela. Isso transforma a LGPD
de seção de conformidade em **requisito funcional com risco corrente**, e é a razão de o
caminho alternativo não-biométrico ter virado invariante (INV-022b) e não recomendação.

**Competitivo.** Controle de acesso facial integrado **não é diferencial em 2026** — Tecnofit,
Pacto, Nextfit, ABC Evo e Cloud Gym já entregam de fábrica, com SDKs de fabricante públicos e
documentados (a Control iD publica API REST aberta, sem login). Ranking e gamificação também já
existem no líder de base. O espaço plausível está em conformidade como produto, entitlement
multi-origem de verdade (Wellhub/TotalPass — ADR-009) e tratamento do ciclo de vida da
autorização do Pix Automático, que pode ser revogada pelo pagador no app do banco sem aviso à
academia.

### Decisões do PI nesta sessão

1. **Processo unificado no `CLAUDE.md`** → ADR-014.
2. **`TESTING.md` reescrito do zero** → ADR-016.
3. **Escopo de offline no MVP 1 registrado como decisão aberta**, não cortado nem confirmado →
   ADR-012.
4. **Conjunto completo de documentos criado**: `CLAUDE.md` (reescrito), `ARCHITECTURE.md`,
   `DECISIONS.md`, `CONVENTION.md`, `STATUS.md`, `DEVELOPMENT.md`, este arquivo, `TESTING.md`
   (reescrito), `LANDSCAPE.md`, `REVIEW.md` e `docs/specs/`.

### Exceção de escrita no Git — autorizada pelo PI

O `CLAUDE.md` limita o push do Cowork na `main` à spec e à linha do Índice Fatia ↔ SPEC, e diz
que *"qualquer ampliação desse escopo passa pelo PI"*. Os doze documentos desta sessão são
governança, não spec.

**O PI aprovou os documentos e autorizou explicitamente, em 14/08/2026, que o Cowork os
commitasse direto na `main` — uma vez, para esta entrega.**

Motivo prático: não existe `.github/`, board nem comando `pnpm`, então não há PR possível
(*exceção de arranque*, `DEVELOPMENT.md` §2), e manter onze documentos de governança fora do
controle de versão é risco maior que a exceção.

**Isto não é precedente.** A próxima escrita do Cowork na `main` volta ao escopo do
`CLAUDE.md`: spec e a linha do Índice. Qualquer coisa além disso pede autorização de novo.

**Ficaram deliberadamente de fora**, por não estarem na lista aprovada: `docs/DESIGN-UI.md` e a
`Especificação Completa`, ambas ainda *untracked*, e `README.md`, que apareceu modificado só por
normalização de fim de linha. Consequência aceita e registrada: os documentos commitados
referenciam dois arquivos que ainda não estão no repositório. Fecha no item 8 do bootstrap.

### O que ficou aberto

Dez ADRs aguardando o PI, conforme o `docs/STATUS.md` daquela data, mais as decisões já declaradas pendentes nos
**planos** (`M2-COMPLIANCE-01`, `M3-CLINICAL-01`, `M3-STUDENT-AI-01`, `M4-DIST-01`,
`M5-RULES-01`) e as 8 de `docs/DESIGN-UI.md` §17.

**Nenhuma linha de código foi escrita.** Nenhum card foi criado. Nenhum gate foi atendido.

---

## 2026-08-14 — Base documental anterior (registro do que já existia)

Onze commits de documentação, todos empurrados direto na `main`, todos com mensagem em inglês:

```
f985011  Initial commit
d0393fb  docs: add technical MVP PRDs for academy module
d7de0ad  docs: approve academy MVP PRDs
7c5849d  docs: add MVP zero Topdata implementation plan
6e437cd  docs: add MVP 01 smart access implementation plans
8ebf0ed  docs: add MVP 02 smart billing implementation plans
980497f  docs: add MVP 03 health intelligence implementation plans
2666631  docs: add MVP 04 app and kiosk implementation plans
c688198  docs: add MVP 05 engagement implementation plans
99f99cb  docs: add MVP 06 retention AI technical design
4b7691e  docs: add MVP 06 retention AI implementation plans
```

Produziram: `docs/prd/README.md` (contrato de produto e engenharia, 280 linhas), 7 PRDs de MVP
(2.666 linhas somadas, com FR/NFR/BR/AC numerados), 6 índices de plano com ~32 gates nomeados, e
os planos por slice.

**Observação para o futuro:** o `CLAUDE.md` diz que o Cowork escreve na `main` apenas spec e a
linha do Índice Fatia ↔ SPEC. Os planos em `docs/superpowers/plans/` foram além disso — são
material de apoio valioso, mas nasceram fora do escopo definido para o papel. Ficam como estão,
classificados em `CLAUDE.md` como **apoio do Code, não contrato**: onde divergirem do PRD, o PRD
vence.
