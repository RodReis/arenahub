# STATUS.md — ArenaHub

> Kanban e roadmap. **Prosa curta mora aqui, sem detalhe** — detalhe vai para
> `docs/STATUS-ARQUIVO.md`.
>
> **Dono deste arquivo: o Cowork, por inteiro** (ADR-021 dissolveu a divisão por seção que valia
> antes). Se o Code encontrar este arquivo divergente da sua branch, **a versão da `main` vence**
> e ele reaplica o próprio progresso por cima — nunca desfaz linha do Cowork.

**Última atualização:** 31/08/2026 *(F37 entregue — regras explicáveis e score)*

🎯 **31/08/2026 — F37 entregue, e o score de churn nasce contestável.** O PI liberou a fatia do
gate de ≥6 meses no mesmo dia da F36, com o argumento simétrico: **regra explicável não aprende de
histórico** — ela aplica limites que uma pessoa escreveu, e o gate existe para o modelo
supervisionado da F40, que aprende. Sem histórico a baseline pontua pouca gente; ela nunca fica
*errada* por falta de dado, porque ausência não pontua.

**A regra é tupla fechada, nunca expressão.** Feature + operador de uma allowlist de cinco +
limite + peso + direção. Guardar `"attendance_days_30d <= 4"` como texto e interpretar quebraria a
reprodutibilidade que o aceite exige — e transformaria dado de banco em execução remota. Score é
inteiro `[0,100]`, com faixas versionadas junto das regras, e **nunca probabilidade**: mover o
corte de `ALTO` muda quem entra na fila sem mudar peso nenhum, então o corte mora na versão.

**Quem não pode ser pontuado gera linha com motivo, não score zero.** Score `0` poria o aluno
suprimido no mesmo balde do saudável; e sem a linha, *"não pontuado"* seria indistinguível de
*"o job não rodou"* — duas situações que pedem ações opostas da recepção.

⚠️ **A revisão adversarial achou um buraco na própria suíte, e o conserto entrou na fatia.** O
canário `?? 0` — o defeito exato que a fatia existe para impedir — **passou verde na integração
inteira** na primeira tentativa: o único teste com feature ausente usava aluno novo, recusado por
*completude* antes de qualquer regra ser avaliada. Dois testes novos fecham o buraco, e o segundo
é o par decisivo: dois alunos de vetor idêntico, um que faltou o mês (`0`) e um que entrou ontem
(ausente). Colapsados, a fila mandaria ligar para o recém-matriculado.

📌 **A contagem de integração da F36 estava inflada.** Ela registrou 856; a mesma árvore, medida
suíte a suíte, rende **741** — e 741 + 12 da suíte nova = 753, a aritmética desta fatia. Nenhum
teste sumiu; o erro é de medição, e a causa exata não foi reproduzida. Detalhe em `docs/TESTING.md`.

🎯 **28/08/2026 — F34 entregue, e o opt-in do PRD virou inscrição automática.** O **ADR-048**
autoriza a fatia antes do gate do MVP 5 (mesmo argumento do ADR-047: o app não existe, os eventos
confiáveis existem) e registra quatro decisões; **duas emendas do mesmo dia mudaram o desenho**.

**A emenda 1 inverteu a Slice 5.5.** O PI viu a tela com `0 inscrito(s)` num desafio recém-aberto e
decidiu o contrário do que o PRD pede: ao abrir a inscrição, **todo aluno `ACTIVE` com entitlement
`ACTIVE` entra automaticamente** — 293 na bancada, batendo com a contagem independente. Isso emenda
a Slice 5.5 (*"inscrição opt-in"*) e o `M5-BR-001` **só para desafio**; `RANKING` segue opt-out
(ADR-046). Três pontas fechadas pelo PI: quem fica inadimplente **continua**, o aluno **pode sair**
pelo totem, e **quem saiu não é reinscrito**.

**A emenda 2 levou o desafio para a tela pública** como *sexto tipo de bloco do carrossel*, não como
slot novo — a grade do hero tem seis composições fechadas numa tela de 1080×1920 que não rola. O
bloco mostra campanha, meta e prazo; **sem nome de aluno e sem contagem de inscritos** (`M3.5-BR-001`,
e com inscrição automática o número é a base inteira da academia).

⚠️ **Três defeitos de configuração achados no caminho, todos de fatias anteriores.** O módulo `xp`
(F31) **nunca entrou na lista de módulos configuráveis do painel** — a tela *Meus pontos* e o
**placar público no hero** existiam desde a F31 e só podiam ser ligados por escrita direta no
banco; era esta a causa de *"o ranque não aparece"*, não uma tela faltando. A **allowlist da ponte
do totem** (`rotas-da-ponte.ts`) recusava as rotas novas antes de assinar, e nenhum teste da API
pega a falta de uma linha ali. E a tela de desafios **listava só o criado na sessão**, então um
refresh o fazia sumir e o rascunho ficava inalcançável — o dado sempre esteve no banco.

🔑 **27/08/2026 — F30 entregue, e o gate do MVP 5 se parte em dois.** O **ADR-046** registra três
decisões do PI de 26/08: a superfície é o `apps/kiosk`, não o app do MVP 4 (que segue com
`apps/mobile/.gitkeep`); o gate original do MVP 5 (*"eventos confiáveis + app do MVP 4"*) **não
alcança a F30** — só F31–F35 continuam atrás dele; e o consentimento de ranking vira **opt-out**
— alunos já aceitos e autorizados participam por padrão. A mesma tabela `ConsentRecord` passa a
guardar dois regimes opostos de ausência de linha (biometria/saúde/IA = não autorizado;
engajamento = participa), com predicados separados de propósito. Detalhe em `docs/DEVELOPMENT.md`
§ MVP 5.

🔑 **24/08/2026 — o Cowork passa a empurrar o próprio commit.** Até aqui o commit entrava na `main`
local e ficava esperando alguém sincronizar: o `git push` pelo bridge falhava com
`could not read Username`, e a credencial do PI vive no ambiente dele, fora do que o bridge
enxerga. **Resolvido com config no próprio repositório** — `credential.helper` em `.git/config`
apontando para `.git/cowork-credentials`, que é o único terreno comum entre as duas máquinas.
O token é do PI, gravado por ele; revogar é apagar o PAT no GitHub. **Consequência prática:**
documento do Cowork chega à `main` remota no mesmo instante em que é escrito, e some a janela em
que o Code trabalhava sobre uma `main` desatualizada.

⚠️ **Dois achados de operação no caminho, ambos com custo real hoje.** **(1)** O
`.claude/worktrees/avaliacao-multiarquivo/.git` aponta para caminho Windows
(`C:/Desenv/...`), e isso faz **todo `git status` falhar** quando o repositório é lido de fora do
Windows — cegou o diagnóstico do rebase travado por vários minutos. Se o worktree não estiver em
uso: `git worktree remove` ou `git worktree prune`. **(2)** **Rebase não funciona pelo bridge**: o
git precisa apagar arquivos de controle (`MERGE_MSG`, `*.lock`, `rebase-merge/`) e o bridge não
tem permissão de deletar — dez tentativas de `--continue` avançaram o contador sem aplicar um
commit sequer. Com os dois agentes escrevendo nos mesmos documentos, **`git pull --no-rebase` é a
operação certa**: resolve o conflito uma vez, e não dez.

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

✂️ **18/08/2026 — o processo foi cortado, por decisão do PI.** O gate de spec `aprovada-pi`
**morreu**: ele exigia aprovar um arquivo-ponteiro cujo conteúdo mora no PRD e travava
desenvolvimento sem decidir nada. `docs/specs/**` deixa de ser artefato de processo — os arquivos
ficam como histórico e **não bloqueiam ninguém**. O ciclo da fatia virou três passos (card → PR
com CI verde → aceite do PI) e **só duas coisas podem parar código**: decisão de produto que a
Slice do PRD não define, e LGPD/dado biométrico. **ADR passa a existir só para escolha cara de
desfazer** — decisão sobre o próprio processo não vira mais ADR. Tudo no `CLAUDE.md`; não foi
escrito ADR para isso, de propósito.

✅ **18/08/2026 — a catraca livre é decisão operacional, não defeito.** O PI esclareceu: a
Arena Positiva opera **de propósito** com o braço destravado **enquanto cadastra os alunos** —
travar antes de todo mundo estar cadastrado prenderia sócio na porta. Quando o cadastro terminar,
a catraca passa a travada. **Isso corrige o motivo registrado no field-note de 17/08 e no §9.2 do
relatório de POC**, que trataram a config como *"furo"* e *"achado crítico"* — a observação física
estava certa, a leitura da causa não. E **confirma o `GO_WITH_CONSTRAINTS`**: o `M0-AC-004` não é
mensurável enquanto a academia estiver, por escolha, em modo aberto.

⚠️ **O que sobrevive, e vira o risco a vigiar.** No dia em que a academia trocar para travada, a
troca **pode não segurar**: a Topdata documenta que a config enviada pelo SDK sobrescreve a do
equipamento ao entrar online, e o `EasyInnerBridge.cs` manda `ConfigurarAcionamento1(1, 5)` em
**toda** conexão. Se `Funcao = 1` **não** for o modo travado, o ArenaHub vai **destravar a catraca
de volta** a cada reconexão — silenciosamente, meses depois, com o cadastro pronto e todo mundo
achando que o acesso está controlado. Saber o que é `1` é a única coisa entre isso e um incidente;
a tabela está no *Manual de Integração SDK Inner Acesso* que o PI já tem desde 14/08. Ver ADR-028.

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
`aberto` só para o provedor e as políticas de refund. ⚠️ **Isso não torna F12
pegável:** a entrada do MVP 2 exige MVP 1 estável, e o MVP 1 depende do gate §15 do MVP 0.

📌 **18/08/2026 — F13 tampouco esperava o ADR-013, e foi entregue.** O gate escolhe **marca de
provedor**; a Slice 2.2 escreve contra a porta `PaymentProvider`, com `FakePaymentProvider` no
boundary — dublê que o `docs/TESTING.md` §3 já previa. Trocar o fake pelo adapter homologado é um
`useClass` no módulo, não reescrita. **Restam F14–F16 dependentes do gate** por razão real: cartão
tokenizado e estorno exigem capacidade que só a homologação confirma.

**14/08/2026, segunda rodada — ADR-011 e ADR-008 fechados.** F4 e F8 destravadas. Restam **duas**
pendências, nenhuma no caminho crítico de hoje: ADR-013 (sai da homologação do MVP 2, não de
escolha) e ADR-007 (migrou com F10 para o MVP 1.5). Um ponto remanescente do ADR-008 mudou de
dono: bloqueia F21, não F8.

**Correção material registrada:** o ADR-008 oferecia "legítimo interesse com LIA" como base legal
alternativa. **Essa hipótese não existe para dado biométrico** — é dado sensível, e o art. 11 da
LGPD é lista fechada onde legítimo interesse não figura. Corrigido no ADR.

🩺 **19/08/2026 — o MVP 3 saiu do papel, e o último ADR do ADR-008 caiu.** O PI trouxe os arquivos
reais da bioimpedância da Arena Positiva e decidiu quatro coisas. **(1)** O equipamento é uma
**balança bluetooth de consumo** (`CF610_G`), cujo app exporta **dois PNGs da mesma medição** —
não são duas fontes, e a extração precisa deduplicar por `(device_id, measured_at)` ou a IA lerá
como corroboração. **(2)** Junto veio um **ECG do OMRON HEM-7530T** com `Possível fibrilação
atrial`: entra no produto como anexo e citação literal, **nunca interpretado**, e **fica fora do
payload da IA** — só um booleano de pendência viaja (**ADR-035**). O gate de *protocolo clínico*
do `MVP-03` §5 foi recusado pelo PI e substituído por essa linha. **(3)** IA decidida:
`claude-haiku-4-5` na extração, `claude-sonnet-4-6` na análise. F21** (**ADR-036**). **(4)** Custo estimado em **~US$ 28/mês** para 300 avaliações; o "300" é
premissa, não dado — o número real tende ao total de alunos com o benefício, e o catálogo da F12
dá bioimpedância a cada 30/60 dias.

✍️ **19/08/2026 — o Cowork passa a escrever emenda de PRD, e o `MVP-03` já saiu emendado.**
As três emendas que os ADR-035/036 exigiam estavam paradas porque o ADR-021 fechava
`docs/prd/**` para o Cowork. **O PI ampliou o escopo em 19/08:** o Cowork escreve no PRD **só**
para materializar decisão já registrada em ADR aceito, citando o ADR na emenda — requisito novo
continua sendo do Code ou do PI. Regra no `CLAUDE.md`; a linha riscada e o porquê ficaram na
**emenda ao ADR-021** (não virou ADR novo: processo não vira mais ADR desde 18/08).

🧬 **19/08/2026 — contexto de saúde do aluno, e por que ele decide se o MVP 3 será usado ou
abandonado (ADR-037).** O PI trouxe a ferramenta pessoal que usa para ler a própria bioimpedância,
e a melhor parte dela não era o cálculo: era a lista de **fatores individuais** que mudam como o
laudo deve ser lido. Sem isso, o produto erra de forma previsível — no laudo real de 03/08, com
**69,7 kg de massa livre de gordura** contra a faixa do aparelho de **52,0–64,8**, *seis campos
saem "acima" numa única medição* e nenhum significa o que o aparelho sugere. Ferramenta que
dispara seis alertas falsos por avaliação é abandonada na terceira semana — e junto param de ser
lidos os alertas verdadeiros.

**Decidido:** lista **fechada** de fatores (`student_health_context`), cada um **suprimindo**
alerta específico de forma determinística e testada, **sem nenhum campo de texto livre** — fator
individual é dado sensível, e campo aberto no balcão vira depósito de informação médica sem
finalidade no termo. Quem registra é o **avaliador**, não a recepção. **"Alerta clínico" sai do
vocabulário do produto**: o que existe é *valor fora da faixa do equipamento*, e a dúvida vai para
`questionsForProfessional`. **Exames laboratoriais ficam fora do MVP 3** — nem anexo, nem
extração. Da ferramenta pessoal **não** vieram dieta, treino, suplementação nem recálculo de
macros: lá é uma pessoa cuidando de si com o próprio médico; aqui seria a academia praticando ato
clínico. `MVP-03` §6, §7 (Slices 3.1 e 3.5), §10 e §12 emendados.

✅ **20/08/2026 — RETIFICAÇÃO: a F17 não espera consentimento nenhum, e o Cowork errou a régua.**
O Cowork vinha tratando composição corporal como tratou biometria no ADR-008 — e **não são o mesmo
caso**. Biometria facial a academia **não coletava** antes do ArenaHub: era tratamento novo, do
zero, e por isso exigiu consentimento destacado. **Peso, gordura e medidas a Arena Positiva já
coleta há anos**, com aparelho próprio, como parte do serviço que o aluno contratou — o plano
inclusive **vende** bioimpedância a cada 30/60 dias (catálogo da F12). Trocar o papel ou o Pacto
pelo ArenaHub é **mudança de meio de registro, não início de tratamento**.

O raciocínio já estava no repositório: **ADR-034 decisão 10** usou exatamente isto para os 1.618
CPFs da base Pacto — *o vínculo contratual já existia, o dado migra junto com o vínculo, para a
mesma finalidade, sem mudança de finalidade que exigisse novo consentimento*. Avaliação física é
o mesmo caso.

**O que muda:** **F17 sem trava** — o avaliador que mede hoje pode medir no ArenaHub, com aluno
real. **O único ato genuinamente novo é enviar os números a um terceiro fora do Brasil**, o que a
academia não fazia com caderno nem com o Pacto. Esse aceite é **da F21**, não da F17, e recusá-lo
deixa o aluno com avaliação, histórico, gráficos, comparativos e metas — tudo menos o texto
gerado. **O ECG se resolve sozinho:** quem anexa é o aluno ou o avaliador com o arquivo que o
aluno trouxe, e o ADR-035 garante que o sistema só guarda e repete.

**Ação barata que fecha o assunto:** conferir se avaliação física consta como serviço no contrato
de matrícula da Arena Positiva. Se consta — e num plano que vende bioimpedância periódica quase
certamente consta — a base legal do registro **já existe e já está assinada**. Não há documento a
criar; há documento a apontar.

Aplicado no mesmo dia ao `MVP-03`: **§6** (ECG deixa de ser exclusão absoluta e ganha a fronteira
de *citar sem interpretar*; o gate de protocolo clínico do §5 sai), **§12**
(`pendingMedicalReferral` e `pendingReferralSince` no contrato de saída, mais a regra de que
`attentionPoints` aparece nas três superfícies) e **§16** (`M3-NFR-005` vira teto de gasto por
tenant com degradação para modo manual; entra o **`M3-NFR-009`** de pseudonimização testada).
**O motivo de estar parado era só quem digitava — o conteúdo já estava decidido.**

---

🖥️ **18/08/2026 — o PI olhou o painel pela primeira vez, e o painel não se sustenta.** Prints de
`Unidades`, `Eventos de acesso`, `Liberação manual`, `Dispositivos`, `Alunos` e `Planos` mostram
HTML sem estilo, listas com dado de teste e telas vazias. **Nenhuma das três causas é defeito de
implementação:**

1. **A ordem do roadmap.** A **F42** (design system do painel) foi alocada no **MVP 2.5** — depois
   de todo o MVP 1 e do MVP 2. O plano mandou construir onze telas antes de existir superfície, e
   foi cumprido à risca. **Corrigido:** a F46 passa na frente do resto do MVP 1.
2. **O banco de desenvolvimento é o banco dos testes E2E.** `Caminho Biometria 1787060177858`,
   `Plano Atribuível 1786909436454` e companhia são alunos e planos criados pelo Playwright, com
   epoch no nome e sem limpeza — os testes de integração limpam, os E2E não. O painel parece
   quebrado porque está exibindo o resíduo da própria suíte.
3. **Não existe seed de demonstração.** `Nenhum dispositivo cadastrado`, `Nenhum evento no
   período`, `Unidade não selecionada`: banco vazio, não bug. O `CLAUDE.md` prevê seed em
   `packages/database/prisma/seed.ts` "na primeira fatia que precisar" — nenhuma precisou.

🎨 **18/08/2026, noite — o item 1 fechou: o painel tem superfície.** PR
[#107](https://github.com/RodReis/arenahub/pull/107), F46.

Precedido de uma crítica `/impeccable` com dois assessments isolados. O veredito importa porque
contraria a leitura de manhã: **não era design ruim nem AI slop.** O código tem argumento onde
slop tem preenchimento — recusa `?? []` porque "falha não é lista vazia", estado desconhecido vira
`—` em vez de código em inglês. O problema era que **o design system foi construído e as telas não
o vestiram**.

O número que resume: `<h2>` do navegador renderiza a **24px**, e o `<h1>` do painel a **20px**. A
hierarquia estava invertida em pixels, em 13 telas que já consumiam o design system e envelopavam
tudo em HTML sem estilo. Altura de controle: **19–24px antes, 36px agora**.

> ⚠️ **Dois defeitos que estavam escondidos atrás de guarda verde**, e valem além desta fatia:
>
> - **O gate de contraste media o par errado.** O comentário dizia "o tom sólido tem de passar
>   sobre o fundo do card"; o código media contra **branco**. O badge pinta sobre 10% de si mesmo,
>   e `success` entregava **4.44** na tela contra o alvo de 4.5. O `axe` pegou numa varredura
>   manual; o gate que existe para pegar antes, não.
> - **A suíte de acessibilidade passava 7/7 num falso verde.** O banco de E2E nasce vazio, e tela
>   vazia não tem o que varrer: sem aluno `ACTIVE` não existe o badge que reprovava. É consequência
>   direta do isolamento feito horas antes no #101 — a correção de um problema criou a cegueira do
>   outro.
>
> A lição comum: **guarda verde não é prova de conformidade quando ela mede o alvo errado ou varre
> o vazio.**

🧽 **18/08/2026, fim de tarde — os itens 2 e 3 acima estão resolvidos, e o item 2 estava com a
causa errada.** PRs [#103](https://github.com/RodReis/arenahub/pull/103) e
[#104](https://github.com/RodReis/arenahub/pull/104).

O diagnóstico culpava o E2E. **A maior fonte era a integração.** Dos 1086 tenants no banco de
desenvolvimento, **nenhum** tinha epoch no nome: eram `f7-rede-a-a6b8b550`, `academia-2d849fb4` —
sufixo hex, criados pelas suítes de integração, das quais **17 de 20 não apagam o tenant no fim**.
O E2E contribuiu com 143 alunos dentro do tenant real; a integração, com 1085 tenants inteiros e
802 usuários `@exemplo.test`.

Junto veio uma afirmação falsa no `docs/TESTING.md`: dizia que a integração usava Testcontainers.
**Não usa** — fala com o mesmo Postgres local, pelo mesmo `DATABASE_URL`. Corrigido.

Cada suíte ganhou banco próprio (`E2E_DATABASE_URL`, `INTEGRATION_DATABASE_URL`), recriado do zero
antes de rodar. **Recriar antes, e não limpar depois**, é o que faz suíte interrompida no meio não
sujar a próxima — foi a limpeza-no-fim que nunca rodava que deixou o resíduo se acumular por três
dias sem ninguém notar. O banco de dev voltou a **1 tenant, 0 alunos, 1 usuário**.

O item 3 virou `pnpm db:demo`: doze alunos com nome de gente, um leitor facial, um Edge e uma
semana de passagens. Separado do seed base porque **este roda também antes das suítes** — dado de
demonstração faria os testes herdarem registro que não criaram.

> 📌 **O que o expurgo ensinou, e vale além deste card:** a primeira versão do script listava as
> tabelas a mão, apagou tenant e aluno, e **declarou vitória com 37 planos com epoch ainda no
> banco**. Conferir o resultado — em vez de confiar na mensagem de sucesso — foi o que pegou. A
> versão final varre o catálogo do Postgres, então tabela nova entra sozinha.

**O que isso ensina, e é o item que vale além destas três fatias:** sete PRDs, 44 fatias e 30 ADRs
especificaram domínio com rigor e **não especificaram superfície nenhuma** até o `DS-PAINEL.md`
aparecer em 16/08, com onze fatias entregues. O projeto adiou 100% do feedback visual. Nenhum
processo corrige o que ninguém olhou.

🧹 **18/08/2026 — 470 arquivos "modificados" na `main` eram line ending, não trabalho.** A árvore
estava com CRLF e os blobs com LF, sem `.gitattributes` e sem `core.autocrlf` — todo arquivo do
repositório, código incluído, aparecia sujo no `git status`. Um `commit -a` produziria um commit de
470 arquivos com zero mudança semântica, e todo PR nasceria ilegível. **Mitigado** com
`core.autocrlf=input` local (2 arquivos sujos depois disso, ambos deste registro). **A correção
definitiva é um `.gitattributes` com `* text=auto eol=lf` na raiz — arquivo do Code, não do
Cowork.** Vira o card [`#101`](https://github.com/RodReis/arenahub/issues/101).

✅ **18/08/2026 — F45 e F46 aprovadas pelo PI, com a ordem invertida: F46 primeiro.** Escopo das
duas em [`docs/notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md`](notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md).
Decisões travadas na mesma conversa: **CPF continua opcional** (INV-009/011 — o mockup que o
marcava obrigatório é que está errado); **CNPJ, responsável de contrato e professores ficam fora**;
**estado civil e profissão entraram e saíram no mesmo dia** — *"só informação inútil"*, e é a
decisão certa: dado pessoal que nenhum caso de uso consome é passivo, não funcionalidade (LGPD
art. 6º, III); **foto fica fora** por risco de reclassificação como biometria (art. 11) e vai para
a F8.

✅ **18/08/2026 — F45 entregue.** Modelo, API e wizard de quatro passos. O que a fatia fecha:
`student_addresses` deixou de ser tabela órfã, o aluno passou a ter **unidade de origem**
(`gym_unit_id` obrigatório, com migration em três passos e backfill provado contra base populada)
e **passou a existir edição de dado cadastral** — até aqui só havia `PATCH /:id/status`, e um CEP
digitado errado era permanente. `gym_unit_id` **não entra na decisão de acesso**, e há teste
estrutural que falha se alguém o acrescentar ao `select` do módulo de acesso — verificado por
mutação, não só escrito. **Uma divergência contra a issue, registrada no PR:** ela manda a
listagem filtrar "pela unidade do cabeçalho", mas o cabeçalho não tem seletor — só o indicador
estático, e criar o seletor é decisão de produto adiada (`DS-PAINEL.md` §5). O filtro existe no
backend; a listagem segue mostrando o tenant inteiro. **Origem do lead ficou com seis valores**
por decisão do PI nesta conversa: indicação, redes sociais, passagem na porta, campanha, site e
outro.

🏢 **18/08/2026 — o aluno passa a pertencer a uma unidade.** `students` ganha **`gym_unit_id`
obrigatório**: a Especificação §11 pede "unidade", a regra de arquitetura nº 2 manda tê-lo quando o
dado é físico, e `Device`, `AccessEvent` e `PlanUnit` já têm. **É unidade de origem, não controle
de acesso** — quem decide onde o aluno entra continua sendo o plano, por `PlanUnit` e
`EntitlementUnitWindow`; ler `students.gym_unit_id` na decisão de acesso criaria a segunda fonte de
verdade que a regra de arquitetura nº 1 proíbe. Migration em **dois passos** (coluna anulável →
backfill para `MATRIZ` → `NOT NULL`), listagem passa a filtrar pela unidade do cabeçalho, e
transferência entre unidades vira ação auditada — não edição de campo solta.

💳 **23/08/2026 — pagamento do aluno nas três superfícies: o pedido virou duas fatias, não seis.**
O PI pediu controle de pagamento no painel, no totem e no app. O recorte está em
[`notes/2026-08-23-pagamento-nas-tres-superficies.md`](notes/2026-08-23-pagamento-nas-tres-superficies.md)
e o resumo é que **três dos quatro itens pedidos não são frontend**: o painel gerencial precisa de
endpoint de agregação que não existe, a lista transversal de invoices precisa do
`GET /api/v1/invoices` que o `MVP-02` §13 prevê e ninguém implementou, e **notificação não tem
módulo nenhum** na API. Decisões do PI no mesmo dia: dashboard é **KPI gerencial**, não esteira de
cobrança (esteira é F38, MVP 6); **totem só PIX**, cartão fica no mobile — o que *confirma* o
`MVP-04` §7 Slice 4.6 em vez de emendá-lo; e notificação é **aviso in-app + WhatsApp**, sem push
nativo. Nascem **F53** (pagamentos e cobrança no balcão) e **F54** (painel gerencial). **O totem
não ganha fatia nova** — pagamento lá já é a F52, e a ordem F49 → F50 → F51/F52 do ADR-042
continua obrigatória. **Mobile fica fora:** `apps/mobile` está vazia, e cartão do aluno é a F25,
que espera F23 e F24.

⚠️ **O que trava dinheiro real, e não é código:** os adapters de **Sicoob e Getnet não existem** —
tudo roda contra o `FakePaymentProvider`, e a assinatura de webhook segue não confirmada nos dois
(registro de 19/08). F52, F53 e F54 podem ser construídas e testadas inteiras sem colocar um
centavo na conta da Arena Positiva. **Credencial e sandbox são insumo do PI.**

💳 **23/08/2026, segunda rodada — o cartão entra, o `FakePaymentProvider` NÃO sai, e as specs
voltaram.** O PI revisou o recorte e decidiu seis coisas. **(1)** No balcão o aluno escolhe
**dinheiro, PIX ou cartão**; cartão é **checkout hospedado da Getnet**, digitado **no celular do
aluno** — nenhum número passa pelo painel nem pela recepcionista. **(2)** No totem entra cartão,
mas por **QR de checkout que o aluno abre no próprio celular**: nada de 16 dígitos e CVV numa tela
de 1080×1920 em área pública. **(3)** No totem **não há baixa manual nem `wa.me`** — não existe
operador ali, e a baixa é automática por webhook. **(4)** Base de cálculo do painel gerencial vem
do **plano em que o aluno está matriculado** (`PlanPrice` das assinaturas ativas), não da soma das
invoices. **(5)** Credenciais e tokens dos provedores ganham tela: menu **Configuração → aba
Pagamento**. **(6)** **`docs/specs/` foi reaberto** — `SPEC-053`, `SPEC-054` e `SPEC-055` existem;
o `CLAUDE.md` §Mapa foi emendado.

⚠️ **Duas coisas ficaram registradas contra o pedido, e valem a leitura.** A primeira: *"nada de
fakePay"* **não pode ser cumprido ao pé da letra** — o `FakePaymentProvider` é dublê de boundary
exigido pelo ADR-017 e pelo `TESTING.md` §3, e é ele que permite testar webhook duplicado, evento
fora de ordem e estorno assíncrono sem depender da rede de um banco. O que muda é a **seleção**:
`useClass` fixo vira roteamento por `ProviderAccount.capability`, e o fake fica só em teste. A
segunda: **cartão no totem amplia o `MVP-04` §7 Slice 4.6**, que prevê apenas PIX — a emenda de
PRD que isso exige **não é minha** (o ADR-021 só me autoriza a materializar decisão já registrada
em ADR aceito), então ou vira ADR ou é o Code/PI quem escreve.

🔇 **26/08/2026 — a F44 achou uma flag que não fazia nada, e inverteu a própria premissa.** O
ADR-025 criou a fatia com gate (*"o PI priorizar o MVP 4"*) e o risco escrito de *"componente sem
consumidor erra em silêncio"*. O ADR-042 antecipou o totem e as **F49–F52 construíram
`apps/kiosk` inteiro antes** — o risco não se materializou, porque veio consumidor primeiro e o
design system nasceu destilado das telas. Sobrou o que ficou de fora. 🔴 **O achado:**
`avisoSonoroNaRecusa` existia no contrato desde a F50 **ligada por padrão**, com checkbox no
painel, e **nenhuma linha do kiosk lia o campo** — a academia marcava a caixa e o totem seguia
mudo. Mesmo padrão da análise de IA e do OCR de ECG na F51. ⚠️ **E dois defeitos que só a tela
revelou, com 155 testes verdes:** a forma angular saiu como tarja cortando a headline, depois como
bloco invadindo o card. **Defeito visual é invisível para teste de comportamento.** A `SPEC-044`
foi reescrita: ela apontava para seções (`§8` catraca, `§9`, `§11`, `§12`) que a **v2.0 do
`DS-TOTEM.md` apagou** na F50. Duas perguntas ao PI ficaram: a **escala da pontuação** (o DS mostra
`80 PONTOS` e nunca diz de quanto — assumido 100) e o destino da **tela pública da catraca**, sem
contrato de design vigente.

📺 **26/08/2026 — a F51 entregou a tela pública, e duas decisões do PI mudaram o escopo da
issue.** A primeira: **o Instagram entra como porta, não como adapter** — a Decisão 7 do ADR-042
manda extrair reel com `yt-dlp`, binário que não existe na imagem da API nem no CI, então o campo
`linkExterno` já está no contrato e o painel o mostra **desabilitado com o motivo em tela**; o
adapter real vira fatia `[INFRA]`. A segunda pede **leitura explícita do `M3.5-FR-005`**: o bloco
de informações da unidade exibe número **real**, buscado no heartbeat de 30 s que já existia e
guardado em cache de memória. O requisito diz *"servir toda **mídia** do cache local, sem rede"* e
**continua literal** — vídeo, logotipo e imagem nunca são buscados em runtime; o que se acrescenta
é texto, e sem rede a tela mostra o último valor conhecido em vez de piscar para vazio. **A tela
pública nunca depende da rede para renderizar**, que é a garantia que o requisito protege.
**"Treinando agora" é estimativa e a tela diz isso** — a catraca registra entrada e não saída.
Nenhuma tabela nova: blocos e patrocínio vivem no `payload` versionado que a F49 já criou.

🏦 **23/08/2026, terceira rodada — chegaram quatro documentos de integração Getnet, e eles foram
escritos como se o backend não existisse.** O PI trouxe `docs/integracao/` (um documento-mãe e um
por canal). Análise inteira em
[`notes/2026-08-23-analise-integracao-getnet.md`](notes/2026-08-23-analise-integracao-getnet.md).

**O que eles trazem de valor, e é bastante:** a correção comercial de que **maquininha ativa não é
credencial de e-commerce** (produtos contratuais distintos — é o bloqueio da F55, agora com nome e
caminho); Global API × API Brasil legada, com a pergunta certa e os paths em configuração; a
mecânica real do PIX (QR pagável depois de a tela morrer, webhook depois do `expired`); e o
descarte fundamentado do Get Smart — os deeplinks `getnet://` só existem para app Android **dentro
do POS**, e uma PWA em totem genérico nunca os invoca.

**O erro-raiz:** o documento-mãe abre com *"Novo módulo `billing` em `apps/api`"* e propõe tabelas,
estados e endpoints do zero. **O módulo existe e o MVP 2 está entregue** (F12–F16): onze tabelas,
porta `PaymentProvider` com oito métodos, idempotência por índice parcial que já pegou cobrança em
dobro medida, retry por tenant e conciliação com fila. Adotar o desenho como está criaria **uma
segunda modelagem financeira dentro do mesmo módulo**. Os documentos entram como **material de
fornecedor**, no estatuto de `docs/vendor/topdata/` — o que é da Getnet vai para a `SPEC-055`; o
que é modelagem é substituído pelo schema que já está no banco.

🔴 **Três conflitos que só o PI resolve, e um achado que ninguém tinha visto.**
**(1) PIX:** os documentos assumem Getnet, o **ADR-032 decidiu Sicoob** — Getnet simplifica a
construção (um adapter, um webhook, um extrato) e encarece a operação; Sicoob põe o dinheiro
direto na conta e exige mTLS que ninguém estudou aqui. **(2) Recorrência:** eles propõem o
Subscriptions Engine da Getnet no lugar do ciclo que a **F14 já entregou** — o custo, admitido
pelos próprios documentos, é **preço de plano imutável**, retry da Getnet no lugar do `[0,3,7]` do
PI e uma segunda fonte de verdade de assinatura. **(3) Webhook por Basic Auth** autentica o
remetente, não o corpo; sem HMAC, a compensação (`getPaymentStatus` antes de qualquer efeito) vira
parte do aceite. **E o achado:** o antifraude da Getnet **exige CPF e endereço** para cartão em
produção, e o ArenaHub decidiu em 18/08 que **CPF é opcional** (INV-009/011) — aluno sem CPF paga
em espécie e por PIX, mas **não paga com cartão**. A saída proposta pede o dado **no fluxo de
pagamento**, não no cadastro: não desfaz decisão nenhuma e não incomoda quem paga de outro jeito.

⚖️ **23/08/2026, quarta rodada — o PI decidiu, e virou o ADR-043.** Cinco pontos:
**(1) PIX continua no Sicoob** — o ADR-032 fica de pé, e a Getnet vira **plano B escrito**, com
gatilho de reabertura (o custo do mTLS do Sicoob, medido na fase 0). **(2) A recorrência continua
no ArenaHub** — o Subscriptions Engine da Getnet foi recusado porque o custo dele aparece em regra
comercial: preço de plano imutável, retry dele no lugar do `[0,3,7]`, e uma segunda fonte de
verdade de assinatura. Em troca nasce a **F56**: *plano com assinatura mensal* como **modalidade
de plano** — o aluno adere uma vez, o ArenaHub cobra sozinho, e o calendário continua nosso.
**(3) CPF passa a ser obrigatório no cadastro**, revertendo a decisão de 18/08 — validação de
aplicação, coluna anulável, porque a base do Pacto tem **pelo menos 308 alunos sem CPF** e não há
de onde inventá-lo; INV-009, INV-011 e INV-012 continuam inteiras. **(4) O totem ganha dois QRs**
— PIX e checkout de cartão no celular do aluno, sem teclado de cartão e fora do escopo PCI; o
`MVP-04` §7 Slice 4.6 foi **emendado**, autorizado pelo próprio ADR.

🐛 **(5) E a análise achou um defeito latente na F14, que nenhum teste podia pegar.** A cobrança de
invoice no cartão chama `createTokenizedSubscription` **a cada cobrança**. Contra o
`FakePaymentProvider` isso passa — o dublê devolve um id e ninguém cobra nada. **Contra a Getnet
real, cada invoice instalaria uma recorrência mensal viva:** doze meses, doze assinaturas cobrando
o mesmo aluno em paralelo, e o ArenaHub sem onde vê-las (o `externalSubscriptionId` é gravado em
`payment_attempts`, não em `Subscription`). A **F55 não entrega adapter real sem separar os dois
atos** — cobrança pontual com token salvo contra recorrência instalada uma vez. **É a segunda vez
que o dublê esconde defeito de dinheiro**; a primeira foi a chave de idempotência derivada de
contagem, na própria F14, que cobrava em dobro.
✅ **Corrigido em 25/08/2026 (PR #193).** `chargeTokenizedPayment` nasceu na porta e a F14 passou a
chamá-lo; o campo de retorno virou `externalPaymentId`. Achado durante a correção: **o
cancelamento dependia do defeito** — `CancelarRecorrenciaUseCase` só funcionava porque a coluna
guardava, por acidente, um id de assinatura. Decisão do PI: zero recorrências a cancelar é o
estado verdadeiro, e a fonte correta (`Subscription.externalSubscriptionId`) nasce na F56.

🌐 **25/08/2026 — o PI escolheu a Global API (ADR-044).** A pergunta que decidia os *paths* de toda
a integração Getnet foi respondida: **Global API** (`api-sbx.globalgetnet.com`), não a API Brasil
legada. Razão: interface unificada, não está em fim de vida, e cobre Brasil/Argentina/Chile/México
por uma integração só — multi-país não é requisito do MVP 2, mas trocar transporte de pagamento
com dinheiro correndo é caro. A doc pública confirmou OAuth2 `client_credentials`, header
`x-seller-id`, captura em passo único, tokenização e **Web Checkout** em três formas. **Não
respondeu** hosts, paths, validade do token, idempotência — nem **como se verifica a autenticidade
do webhook**, que segue sendo o achado aberto desde 19/08 e o que **impede tráfego de produção**.
**A F55 continua bloqueada**: `client_id`/`client_secret`/`seller_id` e o mTLS do Sicoob seguem
sendo insumo do PI.

🔎 **23/08/2026, quinta rodada — o PI descreveu o caminho do atendimento, e metade dele já estava
no ar.** *"Pesquisa do aluno → aluno localizado → na grid, coluna Ação → ícone do pagamento →
página de pagar."* A grid de `/students` **já tem** a coluna Ação com quatro ícones, e o terceiro é
a cédula de **Cobrança**, com `aria-label`, `title` e alvo de 32 px, apontando para
`/students/[id]/billing` — que existe desde a F12, com *Gerar cobrança do mês* e *Receber no
balcão*. **Não há rota nem ícone novos:** o que falta é o que a página faz — escolher a forma
(espécie, PIX, cartão), o QR na tela, o checkout hospedado e o recibo.

**O corte proposto na spec foi RECUSADO pelo PI em 23/08/2026.** O `GET /api/v1/invoices` foi
pensado para uma busca por *fatura*, e o fluxo do balcão é a busca por *aluno* — mas o PI mandou
implementá-lo mesmo assim, como visão de gestão. **Entregue na F53**, paginado e filtrável, sem
nenhuma tela desta fatia consumindo-o: quem vai consumir é a **F54**.

✅ **A dívida do fuso foi paga na F53 (24/08/2026).** `/students/[id]/billing` fixava
`FUSO_PROVISORIO = 'America/Sao_Paulo'` em código, contra a **INV-144**. A rota
`GET /students/:id/invoices` passou a devolver o fuso da **unidade de origem do aluno**, e a tela usa
o que a API manda — sem fallback para o tenant, que é o que o invariante proíbe. **Sem migration:**
`gym_units.timezone` existe desde o ADR-019. O teste usa `America/Manaus` de propósito — com o fuso
da academia real, o valor certo e o fixo coincidem e o teste ficaria verde com a constante no lugar.


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
| 7 | 🟡 **catraca em `acionamento1: 8` — livre por decisão operacional.** A academia opera destravada **enquanto cadastra os alunos** (esclarecido pelo PI em 18/08); trava quando o cadastro fechar. **Não é defeito** — é fase. ⚠️ **O risco é a troca não segurar:** o `EasyInnerBridge.cs` manda `ConfigurarAcionamento1(1, 5)` em toda conexão e a config do SDK sobrescreve a do equipamento; se `Funcao = 1` não for o modo travado, o ArenaHub destrava de volta a cada reconexão. Falta ler a tabela do enum no manual que o PI já tem (ADR-028) | **restrição 2 do ADR-029** — condição de saída do MVP 1 |
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
| Backlog | `proplan:backlog` | card criado; **estacionamento visível** — nem tudo aqui é pegável | **23** |
| A Fazer | `proplan:todo` | Code pegou | 0 |
| Em Andamento | `proplan:doing` | Code está implementando | 0 |
| Feito | `proplan:done` | PR mergeado com CI verde | **1** — [F44](https://github.com/RodReis/arenahub/issues/83) |
| Finalizado | `proplan:finalizado` | **PI aceitou e fechou a issue** | **81** |

> 🧾 **25/08/2026 — o quadro foi reconciliado contra o board, não estimado.** A tabela acima
> estava defasada: listava F2, F10 e F53 em *Em Andamento* e quatro cards em *Feito*, mas F2 e
> F10 nunca saíram do backlog e o board não tem nenhum `proplan:done` vivo. **F53 (#156),
> F54 (#157) e F56 (#159) estão fechadas e `proplan:finalizado`** — o PI aceitou as três. As
> contagens vêm de `gh issue list --label proplan:<x> --state all`, conferidas uma a uma.
>
> **F49 (#150) está em `doing`** — é a fatia desta entrega. A única issue de fatia ainda aberta
> fora do backlog.

> 🩺 **22/08/2026 — a avaliação virou UMA tela, e três funcionalidades que pareciam prontas não
> estavam.** As quatro abas saíram (não existem na referência de design e escondiam três quartos
> do conteúdo); `/students/:id/health` e a rota da sessão passaram a renderizar o **mesmo**
> componente, com seletor de medição. 🔴 **O que a entrega descobriu, e nenhum teste pegava:**
> **nenhuma análise de IA jamais publicou** — o prompt pedia "o JSON do schema" sem mostrar o
> schema, e `validarSaida` rejeitava tudo; **o ECG em PDF nunca foi lido** — a camada de texto do
> ADR-035 §8 nunca foi implementada, e o extrator decodificava bytes comprimidos como UTF-8; e
> **`consent_documents` estava vazia**, então nenhum aluno podia aceitar a análise. Os três tinham
> o mesmo padrão: **o dublê de teste devolvia o formato certo por construção**, e a suíte provava
> a metade que existia. Corrigidos e verificados com o laudo real do PI. Detalhe no
> `DEVELOPMENT.md` §5 e na correção de 22/08 do ADR-041.
>
> 💳 **19/08/2026 — F14 entregue, e o MVP 2 voltou a andar.** Cartão tokenizado, recorrência,
> política de retry (D+0/D+3/D+7 por decisão do PI) e cancelamento — PR
> [#117](https://github.com/RodReis/arenahub/pull/117). 🔴 **A fatia produziu um defeito crítico
> que foi achado e corrigido antes do PR:** a chave de idempotência derivava de uma **contagem**, e
> duas cobranças concorrentes cobravam o aluno **em dobro** — medido, não deduzido. Fechado por
> índice parcial no banco. **Os adapters reais não foram escritos:** dependem de credencial e
> sandbox, e a matriz do gate marcou como não verificado justamente o que eles teriam de honrar.
> ~~**F15 está livre; F16 espera** as duas políticas do `M2-COMPLIANCE-01`.~~ **As duas políticas foram decididas pelo PI em 19/08/2026** — `KEEP_UNTIL_PERIOD_END` e teto por tenant. **F16 entregue; o MVP 2 fechou o escopo de código.**

> ✅ **19/08/2026 — as duas `[INFRA]` de guarda de CI entregues, PR [#116](https://github.com/RodReis/arenahub/pull/116).**
> Contagem reconferida na API do board no mesmo dia: *Finalizado* subiu de 27 para **31** (o PI
> aceitou F45, F46 e mais duas), e *Feito* voltou a se formar com [#111](https://github.com/RodReis/arenahub/issues/111)
> e [#112](https://github.com/RodReis/arenahub/issues/112). Detalhe da entrega no
> [`STATUS-ARQUIVO.md`](STATUS-ARQUIVO.md).

> 🔒 **19/08/2026 — F15 entregue: a regra nº 1 fechou o circuito.** A cadeia
> `Invoice vencida → Subscription PAST_DUE → Entitlement SUSPENDED → DENY` existe, e a catraca
> continua sem saber o que é uma invoice. Razão de negativa nova (`PAYMENT_OVERDUE`), liberação
> financeira com prazo, e a tela do gestor com gráfico de composição da dívida.
> ⚠️ **O `POLICY_VERSION` subiu para 1.1.0** — o desfecho não mudou, mas o `reason` gravado sim.
> **Não há evolução mensal no gráfico:** o sistema tem um mês de dado, e uma linha com um ponto
> mentiria. **F16 é a última do MVP 2** e ainda espera as duas políticas do `M2-COMPLIANCE-01`.

> 💳 **19/08/2026 — o provedor de pagamento foi decidido, e são dois (ADR-032).** **Sicoob para
> PIX** (a academia já recebe por lá) e **Getnet/Santander para cartão tokenizado e recorrência**
> — o Sicoob é banco, não adquirente, e **não tem cartão nem assinatura**. O card `[GATE]` do
> ADR-013 **nunca chegou a ser criado no board**, e F14–F16 ficaram paradas por um portão que não
> existia. Emenda o `MVP-02` §5 (*"um segundo provedor não faz parte deste MVP"*). Verificação em
> [`reports/MVP-02-matriz-de-homologacao-de-provedor.md`](reports/MVP-02-matriz-de-homologacao-de-provedor.md).
> ⚠️ **Um achado segue aberto:** a **assinatura de webhook não está confirmada em nenhum dos dois**
> — não bloqueia F14, bloqueia dinheiro real em produção.

> ⚠️ **Reconferido na API do board em 18/08/2026, fim de tarde.** *Feito* voltou a **0** e
> *Finalizado* subiu de 22 para **25**: o PI aceitou o `[INFRA]` [#94](https://github.com/RodReis/arenahub/issues/94),
> a [F12](https://github.com/RodReis/arenahub/issues/12) e a [F13](https://github.com/RodReis/arenahub/issues/13),
> esvaziando a fila de aceite no mesmo dia em que ela se formou.
>
> 📌 **O `[INFRA]` [#101](https://github.com/RodReis/arenahub/issues/101) fechou os três itens** e
> está em *Feito*, esperando o aceite do PI. Entregue pelos PRs
> [#103](https://github.com/RodReis/arenahub/pull/103) (banco do E2E),
> [#104](https://github.com/RodReis/arenahub/pull/104) (banco da integração, expurgo e seed de
> demonstração) e pelo commit `c9eeff2` (line ending). Ficou em *Em Andamento* enquanto só um dos
> três estava pronto — `proplan:done` afirma card inteiro entregue, e afirmar isso com dois terços
> em aberto é o sinal falso que o quadro existe para não dar.
>
> ⚠️ **O `apt-get` do Chromium derrubou o CI duas vezes neste card** (runs `32169931742` e
> `32171334856`), com o mesmo timeout de 8 min que o `[INFRA]`
> [#94](https://github.com/RodReis/arenahub/issues/94) mitigou em 18/08. A mitigação de lá —
> timeout curto mais uma tentativa extra — **não basta quando o mirror fica fora por minutos**:
> as duas tentativas caem dentro da mesma janela. A #94 deixou registrada a opção 3 (container do
> Playwright) com a condição *"só se voltar a cair"*; **voltou, quatro vezes**. Virou o card
> [`#105`](https://github.com/RodReis/arenahub/issues/105), **resolvido no mesmo dia** pelo PR
> [#106](https://github.com/RodReis/arenahub/pull/106): o job roda dentro de
> `mcr.microsoft.com/playwright:v1.62.1-noble` e não chama `apt-get` em nenhum passo. O card foi
> aberto pelo Code com autorização explícita do PI — pela regra, `[INFRA]` é do Cowork e o Code só
> abre `[FIX]`; o PI liberou a exceção para não travar a entrega.
>
> 💰 **O container custa ~50s por execução** (4m30s contra 3m39s), e o PI aceitou o trade-off
> sabendo o número: os 50s pagam a eliminação de uma classe de falha que derrubou o CI quatro
> vezes num único dia. O job caiu de 23 para 14 passos.
>
> 🪤 **Três armadilhas no caminho, e nenhuma aparece sem execução real no runner.** Vale registrar
> porque a próxima mudança de infraestrutura vai esbarrar nas mesmas: (1) a env var da imagem
> **não chega ao job** — o runner troca o `HOME` e monta ambiente próprio, e verificar com
> `docker run` não prova nada sobre isso; (2) declarada no job, **o Turbo a descarta** — o
> `turbo.json` avisa em letra maiúscula que sanitiza o ambiente, e a variável precisa estar nos
> dois lugares; (3) o Postgres **muda de endereço** ao entrar num container. A terceira estava
> prevista no card e acertou de primeira; as duas primeiras só apareceram no CI.
>
> ⚠️ **Leitura anterior de 18/08/2026, preservada** — não estimados. A composição de
> *Em Andamento* mudou desde a leitura anterior: o `[INFRA]` [#68](https://github.com/RodReis/arenahub/issues/68)
> **foi aceito pelo PI e conta em Finalizado** (21 → 22), e entrou no lugar dele o `[INFRA]`
> [#94](https://github.com/RodReis/arenahub/issues/94) — `apt-get` do Chromium pendurando e
> derrubando o job de E2E no timeout de 20 min — percorreu Backlog → *Em Andamento* → **Feito**
> no mesmo dia, com o merge do PR [#95](https://github.com/RodReis/arenahub/pull/95).
>
> 📌 **A coluna *Feito* deixou de ser 0 pela primeira vez.** É o estado que faltava exercitar:
> PR mergeado com CI verde, **issue ainda aberta**, esperando o aceite do PI. As labels
> `proplan:todo` e `proplan:done` também **passaram a existir em 18/08/2026** — nasceram ao pegar
> e ao entregar o #94.
>
> ⚠️ **Leitura de 22h de 17/08/2026, preservada:** não estimados. A linha de
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
estacionadas: **F12 e F13 não estão mais paradas por ADR** — o ADR-027 fechou em 18/08 e F13 escreve contra a porta, sem depender da marca do provedor; F14–F16 seguem no ADR-013; **F17–F22 já não estão paradas por ADR** — o ADR-036 fechou o último ponto do ADR-008 em 19/08 e quem as segura agora é só a entrada do MVP 3; F23–F41 porque o MVP ainda não foi discutido com o PI, e
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
| ~~**ADR-008**~~ *(ponto remanescente)* | ✅ **FECHADO em 19/08/2026 pelo ADR-036.**; modelos decididos (`claude-haiku-4-5` na extração, `claude-sonnet-4-6` na análise). **A F21 deixa de ter ADR bloqueando** — resta firmar o contrato, que é ato de terceiro. O escopo do ECG saiu no ADR-035: guardar e citar sim, interpretar não | ~~F21~~ → **—** |
| **ADR-013** | ✅ **fechado**; as duas políticas do `M2-COMPLIANCE-01` que restavam foram decididas pelo PI em 19/08/2026 e implementadas na F16. **Nada mais bloqueia o MVP 2.** Histórico: fechado em 19/08/2026 pelo ADR-032: **Sicoob para PIX, Getnet (Santander) para cartão**. O card `[GATE]` nunca chegou a existir no board, e o que faltava não era matriz — era o fato de que **a academia já recebe pela Sicoob**. Restam abertas só as **duas políticas do `M2-COMPLIANCE-01`** (refund e limites), que bloqueiam **F16**, não F14 | ~~F14–F16~~ → **F16** |
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
| **2** | Pagamento controla entitlement automaticamente | MVP 1 estável + **provedor homologado** | F12–F16 | **provedor decidido em 19/08 (ADR-032): Sicoob PIX + Getnet cartão** — F14 e F15 destravadas, F16 ainda espera as duas políticas do `M2-COMPLIANCE-01`. F12 e F13 já entregues |
| **2.5** | Design system: tokens, `packages/ui` e as três superfícies | **F42 sem gate** (dívida ativa: `admin-web` está na `main` sem CSS) · **F43 e F44 têm gate:** o PI priorizar o MVP 4 | F42–F44 | criado por **ADR-025**. F42 pegável assim que o card `[INFRA]` do pipeline de tokens sair |
| **3** | Evolução física rastreável + IA assistiva | identidade e frequência estáveis (o *protocolo clínico* como gate **caiu em 19/08** — decisão do PI, ADR-035) | F17–F22 | **bloqueado só por MVP 1.** ADR-008 e ADR-036 fechados; F17–F20 não chamam IA e são as primeiras pegáveis quando o MVP 1 estabilizar |
| **3.5** | Totem: tela pública configurável + autosserviço do aluno | MVP 1 estável + PIX operando (F13 ✅) | F49–F52 | criado por **ADR-042** em 22/08/2026. **Antecipa a decisão, não a execução** — o kiosk nasce configurável em vez de ser retrabalhado depois. Antecipa a execução das Slices 4.5 e 4.6. **Em execução: F49 entregue em 25/08/2026** — regime de identificação fixado pelo **ADR-045** (CPF sozinho; facial vai para o backlog) |
| **4** | Autosserviço: **app do aluno** (o totem saiu para o MVP 3.5) | APIs estáveis dos MVPs 1, 2 e 3 | F23–F29 | bloqueado — e **vem depois do MVP 3.5**, decisão do PI em 22/08 (ADR-042). **Slices 4.5 e 4.6 são executadas no MVP 3.5**; o texto e o aceite continuam no PRD MVP-04 §7, sem cópia |
| **5** | Engajamento opt-out mensurável | eventos confiáveis + app do MVP 4 — **não alcança nenhuma fatia do MVP 5** (ADR-046, ADR-047, ADR-048, ADR-049 e decisão do PI de 28/08 sobre a F32) | F30–F35 | **F30 a F35 entregues** (27–28/08/2026) — superfície no totem e no painel. A F31 absorveu a F33 (ADR-047). **A F34 inverteu o opt-in para inscrição automática** (ADR-048, emenda 1) e trouxe o desafio para a tela pública (emenda 2). **A F35 fechou o MVP 5 em 28/08** (ADR-049) — o gate original **não guarda mais nenhuma fatia** |
| **6** | Risco de churn explicável → tarefa operacional | ≥ 6 meses de histórico confiável | F36–F41 | **o gate não alcança a F36 nem a F37** — duas decisões do PI em 31/08/2026. O gate existe para o **modelo supervisionado** (Slice 6.5 / F40), que aprende de histórico: sem snapshot as-of os 6 meses nunca começam a contar (F36), e regra explicável não aprende — aplica limite que uma pessoa escreveu (F37). **F38–F41 continuam atrás dele** |


**Ordem de execução (decisão do PI em 22/08/2026, ADR-042):**
`MVP 1 → MVP 2 → MVP 3 → **MVP 3.5 (totem)** → MVP 4 (app mobile) → MVP 5 → MVP 6`.
O totem vem **antes** do app: ele não depende do celular do aluno e alcança todo mundo que passa
pela recepção. ✅ **A fila do `docs/DEVELOPMENT.md` §4 foi reordenada na F49, em 25/08/2026** —
era a tarefa que o ADR-042 registrava para esta fatia, e ela também acrescentou as F42–F48 e
F53–F56, que faltavam naquele arquivo.

**Observação sobre o MVP 3:** o índice do plano declara que **o MVP 2 não é dependência
funcional** — MVP 3 pode andar em paralelo se o PI priorizar assim.

⚠️ **O ADR-042 referencia seções que o `DS-TOTEM.md` não tem.** O ADR declara *"Alcança
`docs/design/DS-TOTEM.md` §11 regra 9 e §12 pendências 1 e 4"* e cita ainda §9.1, §11.2, §11.3,
§11.5 a §11.8 e §11.10 — mas o arquivo vai de §1 a §8. Na F50 (26/08/2026) o PI decidiu **registrar
e não editar**: a mecânica da Decisão 3 entrou em **§7.2**, que é a seção real de configuração, e
nenhuma seção foi inventada. Alinhar ADR e documento é tarefa do Cowork.

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
| F13 | SPEC-013 | 2 | 2.2 | PIX e webhook idempotente | [`SPEC-013-pix-e-webhook-idempotente.md`](specs/SPEC-013-pix-e-webhook-idempotente.md) | [#13](https://github.com/RodReis/arenahub/issues/13) | ✅ **entregue** em 18/08/2026 ([#102](https://github.com/RodReis/arenahub/pull/102)) |
| F14 | SPEC-014 | 2 | 2.3 | Cartão e recorrência | [`SPEC-014-cartao-e-recorrencia.md`](specs/SPEC-014-cartao-e-recorrencia.md) | [#14](https://github.com/RodReis/arenahub/issues/14) | ✅ **entregue** em 19/08/2026 ([#117](https://github.com/RodReis/arenahub/pull/117)) |
| F15 | SPEC-015 | 2 | 2.4 | Inadimplência e acesso | [`SPEC-015-inadimplencia-e-acesso.md`](specs/SPEC-015-inadimplencia-e-acesso.md) | [#15](https://github.com/RodReis/arenahub/issues/15) | ✅ **entregue** em 19/08/2026 |
| F16 | SPEC-016 | 2 | 2.5 | Estorno, conciliação e operação | [`SPEC-016-estorno-conciliacao-e-operacao.md`](specs/SPEC-016-estorno-conciliacao-e-operacao.md) | [#16](https://github.com/RodReis/arenahub/issues/16) | ✅ **entregue** em 19/08/2026 |
| F17 | SPEC-017 | 3 | 3.1 | Consentimento e avaliação manual | [`SPEC-017-consentimento-e-avaliacao-manual.md`](specs/SPEC-017-consentimento-e-avaliacao-manual.md) | [#17](https://github.com/RodReis/arenahub/issues/17) | ✅ **entregue** em 20/08/2026 |
| F18 | SPEC-018 | 3 | 3.2 | Histórico e comparativos | [`SPEC-018-historico-e-comparativos.md`](specs/SPEC-018-historico-e-comparativos.md) | [#18](https://github.com/RodReis/arenahub/issues/18) | ✅ **entregue** em 21/08/2026 |
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
| F30 | SPEC-030 | 5 | 5.1 | Preferências e identidade pública | [`SPEC-030-preferencias-e-identidade-publica.md`](specs/SPEC-030-preferencias-e-identidade-publica.md) | [#30](https://github.com/RodReis/arenahub/issues/30) | ✅ **entregue** em 27/08/2026 ([#211](https://github.com/RodReis/arenahub/pull/211)) |
| F31 | SPEC-031 | 5 | 5.2 + 5.4 | XP, conquistas e ranking mensal | [`SPEC-031-xp-e-conquistas.md`](specs/SPEC-031-xp-e-conquistas.md) · [ADR-047](DECISIONS.md#adr-047) | [#31](https://github.com/RodReis/arenahub/issues/31) | ✅ **entregue** em 27/08/2026 ([#213](https://github.com/RodReis/arenahub/pull/213)) |
| F32 | SPEC-032 | 5 | 5.3 | Consistência e streak | [`SPEC-032-consistencia-e-streak.md`](specs/SPEC-032-consistencia-e-streak.md) | [#32](https://github.com/RodReis/arenahub/issues/32) | ✅ **entregue** em 28/08/2026 ([#214](https://github.com/RodReis/arenahub/pull/214)) |
| ~~F33~~ | ~~SPEC-033~~ | 5 | 5.4 | ~~Rankings privados por padrão~~ | **absorvida pela F31** — [ADR-047](DECISIONS.md#adr-047), Decisão 2 | [#33](https://github.com/RodReis/arenahub/issues/33) | 🔒 **número queimado**. Card fechado em 28/08/2026 com **uma ponta registrada**: rankings **por categoria** (frequência, consistência, evolução relativa — PRD §7) ficam para **F34/F35**. ✅ **A F35 fechou a ponta em 28/08** com XP, frequência e consistência; **evolução relativa continua aberta** — `M5-BR-006` exige baseline corporal comparável, que é entrega do MVP 3 (ADR-049, Decisão 4) |
| F34 | SPEC-034 | 5 | 5.5 | Desafios e notificações | [`SPEC-034-desafios-e-notificacoes.md`](specs/SPEC-034-desafios-e-notificacoes.md) | [#34](https://github.com/RodReis/arenahub/issues/34) | ✅ **entregue** em 28/08/2026 — aguardando aceite |
| F35 | SPEC-035 | 5 | 5.6 | Operação, moderação e experimento | [`SPEC-035-operacao-moderacao-e-experimento.md`](specs/SPEC-035-operacao-moderacao-e-experimento.md) | [#35](https://github.com/RodReis/arenahub/issues/35) | ✅ **entregue** em 28/08/2026 ([#222](https://github.com/RodReis/arenahub/pull/222)) — aguardando aceite |
| F36 | SPEC-036 | 6 | 6.1 | Contrato de dados e baseline analítica | [`SPEC-036-contrato-de-dados-e-baseline-analitica.md`](specs/SPEC-036-contrato-de-dados-e-baseline-analitica.md) | [#36](https://github.com/RodReis/arenahub/issues/36) | ✅ **entregue** em 31/08/2026 ([#224](https://github.com/RodReis/arenahub/pull/224)) — aguardando aceite — snapshot point-in-time entregue por **decisão do PI de 31/08** (aceite relaxado: o gate de ≥6 meses **não** guarda esta fatia). As 13 features do PRD §9 saem as-of; só `payment_failure_count_90d` é marcada `ESTADO_CORRENTE` |
| F37 | SPEC-037 | 6 | 6.2 | Regras explicáveis e score | [`SPEC-037-regras-explicaveis-e-score.md`](specs/SPEC-037-regras-explicaveis-e-score.md) | [#37](https://github.com/RodReis/arenahub/issues/37) | ✅ **entregue** em 31/08/2026 ([#225](https://github.com/RodReis/arenahub/pull/225)) — aguardando aceite — baseline explicável entregue por **decisão do PI de 31/08** (o gate de ≥6 meses **não** guarda esta fatia: ele existe para o modelo supervisionado da F40, que aprende de histórico; regra declarativa não aprende). Score `[0,100]` com faixas versionadas, até 5 fatores com o valor observado, e recusa registrada com motivo em vez de score zero |
| F38 | SPEC-038 | 6 | 6.3 | CRM de retenção | [`SPEC-038-crm-de-retencao.md`](specs/SPEC-038-crm-de-retencao.md) | [#38](https://github.com/RodReis/arenahub/issues/38) | planejada |
| F39 | SPEC-039 | 6 | 6.4 | Experimento operacional | [`SPEC-039-experimento-operacional.md`](specs/SPEC-039-experimento-operacional.md) | [#39](https://github.com/RodReis/arenahub/issues/39) | planejada |
| F40 | SPEC-040 | 6 | 6.5 | Modelo supervisionado (condicionado a M6-ML-01) | [`SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md`](specs/SPEC-040-modelo-supervisionado-condicionado-a-m6-ml-01.md) | [#40](https://github.com/RodReis/arenahub/issues/40) | planejada |
| F41 | SPEC-041 | 6 | 6.6 | Produção controlada e monitoramento | [`SPEC-041-producao-controlada-e-monitoramento.md`](specs/SPEC-041-producao-controlada-e-monitoramento.md) | [#41](https://github.com/RodReis/arenahub/issues/41) | planejada |
| F42 | SPEC-042 | 2.5 | 2.5.1 | Design system da superfície `admin-web` | [`SPEC-042-design-system-do-painel.md`](specs/SPEC-042-design-system-do-painel.md) | [#81](https://github.com/RodReis/arenahub/issues/81) | aprovada-pi |
| F43 | SPEC-043 | 2.5 | 2.5.2 | Design system da superfície `mobile` | [`SPEC-043-design-system-do-app.md`](specs/SPEC-043-design-system-do-app.md) | [#82](https://github.com/RodReis/arenahub/issues/82) | aprovada-pi *(gate: MVP 4)* |
| F44 | SPEC-044 | 2.5 | 2.5.3 | Design system da superfície `kiosk` | [`SPEC-044-design-system-do-totem.md`](specs/SPEC-044-design-system-do-totem.md) | [#83](https://github.com/RodReis/arenahub/issues/83) | ✅ **entregue** em 26/08/2026 ([#210](https://github.com/RodReis/arenahub/pull/210)) — aguardando aceite |
| F45 | — | 1 | — | Cadastro completo de aluno (retrabalho da Slice 1.2) | [retrabalho](notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md) | [#100](https://github.com/RodReis/arenahub/issues/100) | **entregue** — aguardando aceite |
| F46 | — | 2.5 | — | Design system aplicado ao `admin-web` (execução da F42) | [retrabalho](notes/2026-08-18-retrabalho-cadastro-completo-de-aluno.md) | [#99](https://github.com/RodReis/arenahub/issues/99) | **entregue** — PR [#107](https://github.com/RodReis/arenahub/pull/107), aguardando aceite |
| F47 | — | 1 | — | Importação da base legada Pacto (1.926 alunos) | [ADR-033](DECISIONS.md#adr-033--importação-da-base-legada-do-pacto-1926-alunos-entram-como-cancelled) | [#118](https://github.com/RodReis/arenahub/issues/118) | planejada |
| F48 | — | 1 | — | Ativação da base corrente do Pacto (~340 ativos) | [design](superpowers/specs/2026-08-20-ativacao-base-corrente-design.md) | — | **entregue** — aguardando aceite |
| F49 | SPEC-049 | 3.5 | 3.5.1 | Kiosk seguro, provisionamento e sessão efêmera | [ADR-042](DECISIONS.md#adr-042) · [`MVP-04` §7 Slice 4.5](prd/academia/MVP-04-app-totem.md) | [#150](https://github.com/RodReis/arenahub/issues/150) | ✅ **entregue** em 25/08/2026 — aguardando aceite |
| F50 | SPEC-050 | 3.5 | 3.5.2 | Contrato de configuração, painel e publicação versionada | [ADR-042](DECISIONS.md#adr-042) | [#151](https://github.com/RodReis/arenahub/issues/151) | ✅ **entregue** em 26/08/2026 — aguardando aceite |
| F51 | SPEC-051 | 3.5 | 3.5.3 | Tela pública (hero): blocos, mídia e patrocínio | [ADR-042](DECISIONS.md#adr-042) | [#152](https://github.com/RodReis/arenahub/issues/152) | ✅ **entregue** em 26/08/2026 — aguardando aceite |
| F52 | SPEC-052 | 3.5 | 3.5.4 | Área do aluno no totem: identificação, pagamento e evolução | [ADR-042](DECISIONS.md#adr-042) · [`MVP-04` §7 Slice 4.6](prd/academia/MVP-04-app-totem.md) | [#153](https://github.com/RodReis/arenahub/issues/153) | ✅ **entregue** em 26/08/2026 — aguardando aceite |
| F53 | SPEC-053 | 3 | — | Pagamentos e cobrança no balcão (`admin-web`) | [`SPEC-053-pagamentos-e-cobranca-no-balcao.md`](specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md) | [#156](https://github.com/RodReis/arenahub/issues/156) | ✅ **finalizado** — aceito pelo PI |
| F54 | SPEC-054 | 3 | — | Painel financeiro gerencial (KPIs) | [`SPEC-054-painel-financeiro-gerencial.md`](specs/SPEC-054-painel-financeiro-gerencial.md) | [#157](https://github.com/RodReis/arenahub/issues/157) | ✅ **finalizado** — aceito pelo PI |
| F55 | SPEC-055 | 3 | — | Adapters reais (Sicoob e Getnet) e Configuração → Pagamento | [`SPEC-055-adapters-sicoob-getnet-e-configuracao-de-pagamento.md`](specs/SPEC-055-adapters-sicoob-getnet-e-configuracao-de-pagamento.md) | [#158](https://github.com/RodReis/arenahub/issues/158) | aprovada-pi — **bloqueada** (credenciais Getnet + mTLS Sicoob) |
| F56 | SPEC-056 | 3 | — | Plano com assinatura mensal | [`SPEC-056-plano-com-assinatura-mensal.md`](specs/SPEC-056-plano-com-assinatura-mensal.md) | [#159](https://github.com/RodReis/arenahub/issues/159) | ✅ **finalizado** — aceito pelo PI |



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

> **F45 e F46 criadas em 18/08/2026, por decisão do PI.** F45 é **retrabalho da Slice 1.2**: a
> F7 entregou quatro campos onde a Especificação §11 lista dezoito, e `student_addresses` nasceu
> órfã — criada, nunca escrita. F46 aplica no `admin-web` o design system que a F42 contratou e
> nenhuma tela usa. **Nenhuma das duas tem SPEC**: o gate de spec morreu em 18/08 e o escopo mora
> no documento de retrabalho, linkado acima. Coluna `SPEC` fica vazia de propósito — inventar
> `SPEC-045` seria criar artefato que o processo aposentou. A contagem vai de 44 para **46**.

> **F49–F52 criadas em 22/08/2026 por ADR-042.** As Slices 3.5.1–3.5.4 são definidas **no próprio
> ADR** — mesmo mecanismo do ADR-025 para as 2.5.x. As 3.5.1 e 3.5.4 **citam** as Slices 4.5 e
> 4.6 do `MVP-04` em vez de copiá-las: quem executa lê o PRD, e não existe segunda versão do
> mesmo texto. As 3.5.2 e 3.5.3 são escopo novo, sem PRD que as descreva.
>
> **O ADR-042 antecipa a decisão, não a execução.** O PI o pediu para que o totem, quando começar
> a ser desenvolvido, já nasça sabendo que é configurável — em vez de nascer com valor fixo em
> tela e ser retrabalhado, como aconteceu com o `admin-web` (F42 e F46). A consequência
> normativa está na Decisão 0: **nenhuma tela do `kiosk` nasce com valor fixo** naquilo que a
> Decisão 6 não trava, desde o primeiro commit da superfície.
>
> **Ranking e gamificação sai do escopo desta fatia**: o módulo depende da F33 (MVP 5) e, pela
> Decisão 5, módulo cuja fatia de origem não foi entregue **não aparece no painel**. A contagem
> vai de 48 para **52 fatias** — nenhum número reaproveitado, `SPEC-049` a `SPEC-052` alocados
> aqui pela primeira vez.

> **F53, F54 e F55 criadas em 23/08/2026, por decisão do PI.** Escopo em
> [`notes/2026-08-23-pagamento-nas-tres-superficies.md`](notes/2026-08-23-pagamento-nas-tres-superficies.md)
> e nas specs `SPEC-053`, `SPEC-054` e `SPEC-055`.
>
> ↩️ **`docs/specs/` foi REABERTO na mesma conversa, por decisão do PI.** O `CLAUDE.md` dizia
> *"não se criam novas"* desde 18/08; o PI pediu spec para estas fatias e a decisão dele vence.
> As três **têm spec com número**, e o par `F<n>` = `SPEC-<nnn>` do ADR-015 volta a valer para
> fatia nova. **F45–F48 continuam sem spec** — e `SPEC-045` a `SPEC-048` continuam queimados; o
> que mudou vale daqui para a frente, não para trás.
>
> O conteúdo das três é Smart Billing (`MVP-02` §7); o token `[MVP3]` reflete a **posição na
> fila** que o PI escolheu, não o PRD de origem. A **F55 nasce separada da F53 por proposta do
> Cowork** — a F53 é construível hoje, a F55 espera credencial de banco —, e a separação está
> registrada como pergunta aberta na própria `SPEC-055`. A **F56** (plano com assinatura mensal) nasce em seguida, pelo **ADR-043**. A contagem vai de 52 para **56 fatias**.
> **F49 entregue em 25/08/2026 — e trouxe o ADR-045.** A fatia fixou o **regime de
> identificação do totem**: reconhecimento facial vai para o **backlog** (sem MVP de destino), o
> QR desta superfície é **PIX**, não carteirinha do app, e o login é **CPF sozinho, sem segundo
> fator** — o que **emenda `M4-BR-004`**. O PI aceitou dois riscos por escrito: quem sabe o CPF
> vê nome, plano e valor em aberto; e a enumeração de CPF é barata, porque a mensagem de falha é
> única, neutra e sem limite de tentativas. **A área interna sai com zero dos seis módulos do
> `DS-TOTEM.md` §5.2, de propósito** — o aceite da fatia é isolamento de tenant e limpeza de
> sessão, não funcionalidade.
>
> ⚠️ **A segunda aceitação é condicional, e a condição é técnica.** A ponte Node do totem
> escutava em `0.0.0.0`; com a rede da academia não isolada, isso permitia enumerar a base
> inteira do tenant a partir de qualquer host da LAN, sem tocar no aparelho. Corrigido para
> loopback. **Tirar a ponte do loopback reabre o ADR-045** — não é ajuste de infraestrutura, é
> mudança do risco que o PI aceitou.

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
