# Product

> Contexto estratégico para trabalho de interface. **Não substitui** os documentos normativos:
> `docs/prd/README.md` (contrato de produto e engenharia), `docs/design/DS-PAINEL.md`,
> `DS-APP.md` e `DS-TOTEM.md` (contrato de implementação por superfície, ADR-026).
> Onde divergir, o documento normativo vence.

<!-- impeccable:product-schema 1 -->

## Platform

web

> O painel (`admin-web`) e o totem (`kiosk`) são web. O app do aluno (`mobile`, Expo) tem contrato
> próprio em `docs/design/DS-APP.md` e não é coberto por este registro.

## Users

**Recepcionista da academia** — o usuário que define o painel. Opera no balcão, de pé ou sentado,
sob luz fluorescente forte, com documento físico ao lado do teclado e **um aluno do outro lado
esperando**. A consulta acontece entre atendimentos, na fila da catraca às 7h da manhã. Monitor de
1280 px, sem tempo para procurar.

O trabalho é resolver a exceção: alguém não passou na catraca e quer saber por quê. A resposta
precisa estar legível de relance — *qual estado, qual razão, o que fazer* — não a três cliques de
profundidade.

**Gerente e dono** usam as mesmas telas para plano, unidade e relatório, em sessões mais longas.
Não são o caso de otimização: quando os dois usos conflitam, **a recepção ganha**. Uma tela boa no
balcão serve na sala; o contrário não é verdade.

**Super Admin** (suporte ArenaHub) opera com sessão elevada sobre o tenant do cliente — contexto
que precisa estar visível o tempo todo, não escondido num menu.

## Product Purpose

ArenaHub costura numa cadeia só o que hoje vive em sistemas separados: **matrícula → cobrança →
direito de acesso → catraca com reconhecimento facial → frequência → evolução corporal →
retenção**. Cliente inaugural: Complexo Arena Positiva.

O `admin-web` é a superfície de operação dessa cadeia. Sucesso é medido por **atendimento resolvido
sem escalar**: a recepção entende o que aconteceu e age, sem ligar para o suporte e sem abrir o
terminal.

Duas verdades estruturais que a interface precisa respeitar, e que não são negociáveis:

- **Pagamento não controla acesso — entitlement controla.** A catraca nunca consulta assinatura nem
  invoice. Uma tela que insinue "não passou porque está devendo" contradiz o motor e ensina a
  recepção a diagnosticar errado.
- **A nuvem é a fonte da verdade; o Edge é executor físico.** O painel mostra a idade do cache
  offline, não apenas online/offline — "desatualizado" e "indisponível" são situações diferentes e
  pedem ações diferentes.

## Positioning

**Cadeia única** (confirmado pelo PI em 05/10/2026). Matrícula → cobrança → direito de acesso →
catraca facial → frequência → retenção vivem **num modelo só**, e não em sistemas costurados. Duas
consequências que um concorrente que integra módulos separados não pode afirmar com verdade:

- **Pagamento não abre catraca — entitlement abre.** A catraca nunca consulta assinatura nem
  fatura; a decisão de acesso tem uma razão própria (`NO_ENTITLEMENT`, `WRONG_UNIT`, …).
- **A recepção vê a razão exata de cada negação**, no mesmo lugar onde cobra e onde libera — não
  "acesso negado" genérico.

Catraca facial, recorrência, avaliação física e gamificação **não** são diferencial em 2026 — são
exigência mínima do mercado (`docs/LANDSCAPE.md` §1, §2, §5).

## Operating Context

- **Balcão da academia:** recepção de pé, luz fluorescente, aluno esperando, monitor de 1280 px.
  Abre o painel quando algo deu errado na catraca ou para receber no balcão.
- **Maquininha física não integrada:** a academia recebe por ela (dinheiro, PIX, débito, crédito)
  e dá baixa manual no painel (`billing.payment.manual`). O lançamento manual é controlado por
  auditoria, não por aprovação dupla (ADR-027).
- **Catraca Topdata Inner Fit com leitor facial** na unidade; um Edge (PC da academia) executa o
  acesso offline. A nuvem é a fonte da verdade.
- **Totem** de autoatendimento na entrada (pagamento, personalização com patrocinador).
- **Cliente inaugural:** Complexo Arena Positiva, em produção.

## Capabilities and Constraints

- Monorepo NestJS (API) + Next.js 16 (painel, totem) + Expo (app); PostgreSQL com RLS por tenant.
- Multi-tenant: o tenant vem da identidade autenticada, nunca do corpo da requisição.
- Dinheiro sempre inteiro em centavos; erro de domínio com código estável e `problem+json`.
- Toda decisão de produto é do PI (Rodrigo Reis); o Code implementa a partir do `CLAUDE.md`,
  `docs/` e da Slice do PRD.
- **Fora do produto:** não é ERP contábil, não emite nota fiscal, não é prontuário médico, não é
  adquirente, não substitui prescrição profissional (`docs/prd/README.md` §3).

## Evidence on Hand

Liberado pelo PI em 05/10/2026 para uso em tela:

- **Logo e identidade da Arena Positiva** — o arquivo **não está no repositório**; entra pelo
  upload do tenant (Personalização do totem) ou pedido ao PI. Não recriar nem aproximar a marca.
- **Fotos reais da unidade** — **não estão no repositório**; pedir ao PI. `apps/admin-web/public/login/hero.jpg`
  é render, não foto da unidade.
- **Dados reais agregados de operação** (alunos ativos, receita, frequência) — **sempre sem dado
  pessoal**; nunca nome, CPF, foto ou dado de saúde de aluno real em tela de exemplo, fixture ou
  golden file.

Não existem e **não devem ser inventados**: depoimentos, logos de outros clientes, números de
mercado próprios, prêmios ou certificações.

## Product Principles

1. **A cadeia é uma só.** Toda tela mostra em que elo o aluno está e por quê; nenhuma tela trata
   cobrança e acesso como assuntos separados.
2. **A razão certa, nunca a confortável.** Estado, razão e próximo passo aparecem juntos; achatar
   razões distintas faz a recepção agir errado com confiança.
3. **O balcão vence.** Quando o uso da recepção e o da gerência conflitam, a recepção ganha.
4. **Toda exceção deixa rastro.** Liberação, cancelamento e baixa manual exigem motivo e entram em
   auditoria — o controle é detectivo, e a tela precisa torná-lo visível.

## Brand Personality

**Instrumento de precisão, não app.** Denso, rápido, sóbrio. Mais perto de um terminal de operação
que de um SaaS — equipamento profissional que a recepção aprende uma vez e usa mil.

Três palavras: **denso, honesto, instantâneo.**

O material é físico: carbono como estrutura, superfície e texto; accent do tenant como ação. Nada
de skeuomorfismo com textura literal — a sensação de material vem da densidade e da sobriedade,
não de imitação.

**Tom de voz** (regras já fixadas pelos PRDs, não preferência):

- Erro sempre traz **ação possível**, nunca detalhe técnico.
- Falha de sync traz quatro campos: dispositivo, código, última tentativa, ação recomendada.
- Sóbrio no painel; a linguagem encorajadora pertence ao app do aluno, não aqui.
- Score de retenção é "recomendação operacional, não fato sobre o aluno".
- Botão destrutivo usa o **verbo real** ("Revogar biometria"), nunca "OK".

## Anti-references

- **Dashboard-by-numbers.** Sidebar + grid de cards uniformes + KPI gigante + gradiente. É o que o
  `DESIGN-UI.md` §3.4 chama de "design system genérico": nenhuma biblioteca pronta tem
  `ProblemDetail`, `StateBadge` de 11 máquinas ou `TenantDateTime`, e montar o painel em volta de
  cards genéricos esconde exatamente o que o produto tem de específico.
- ~~**shadcn copiado inteiro.**~~ **Revogado pelo PI em 18/08/2026.** Tailwind e shadcn entraram
  no `admin-web`; a preocupação original continua válida e virou convenção em vez de proibição: o
  painel lê `--ah-*` e o shadcn lê `--*`, então a inversão carbono/accent sobrevive porque os dois
  sistemas usam prefixos diferentes. **Componente do shadcn que quebre teclado, leitor de tela ou
  E2E não entra** — foi o que barrou o `Select` dele, que é `<div role="combobox">` sem `<option>`
  e derrubaria os oito `selectOption` da suíte.
- **Motivacional agressivo ou linguagem de culpa.** Vale no app do aluno e vale em dobro aqui: a
  recepção não é responsável pelo estado do aluno.
- **Cheio de animação de transição.** A promessa é p95 < 300 ms na catraca; a interface não pode
  parecer mais lenta que o motor. Animação decorativa entre telas é ruído no balcão.
- **Card com sombra por padrão.** Sombra é só para camada que flutua (dropdown, popover, modal).
  Card tem borda — superfície plana lê melhor em densidade alta.
- **Cor como único canal.** Ponto colorido sem texto, badge sem ícone, gráfico sem tabela
  equivalente. É proibição de PRD, não escolha estética.

### Emenda de 01/09/2026 — o dashboard tem licença para ser mais expressivo

**Decisão do PI, na F57.** Ao ver a primeira versão do dashboard operacional, o PI pediu uma tela
mais colorida, com efeito e com mais presença visual — e, informado de que isso contrariava as duas
anti-referências acima, decidiu emendá-las em vez de recuar.

O que a emenda **abre**, e só na tela de dashboard:

- **Superfície tingida pelo estado.** A célula de KPI pinta o próprio fundo com o tom semântico a
  7% e ganha uma aresta superior de 3 px na cor cheia. Não é decoração: a cor é a do estado que o
  número descreve, e some quando não há estado.
- **Movimento que comunica estado.** O pulso do indicador "ao vivo" e a entrada da linha nova do
  feed (220 ms). Os dois dizem *"isto está acontecendo agora"* — sem eles a lista troca de conteúdo
  em silêncio e quem olhava não percebe que alguém passou na catraca.

O que a emenda **não toca**, porque não é estética e sim contrato:

- **Contraste WCAG AA** (`M1-NFR-008`), verificado por teste que falha o build. Medido nos quatro
  tons: valor entre 5,13 e 5,77; rótulo entre 5,88 e 5,95 — contra os 3,0 e 4,5 exigidos.
- **Cor nunca é canal único.** Todo KPI colorido carrega ícone e texto; o "ao vivo" diz "pausado"
  por escrito quando para.
- **`prefers-reduced-motion: reduce`** desliga tudo o que se move, e o estado continua legível.
- **Accent é ação, carbono é estrutura, semântico é estado** (Princípio 5). A cor que entrou é
  semântica. Gradiente, sombra decorativa e accent como enfeite continuam fora.

**Isto não se estende às demais telas por tabela.** Grid de alunos, cobrança e operação continuam
sob a regra original: elas são superfícies de trabalho, e o dashboard é a de resumo — a única que
alguém olha de longe, entre atendimentos.

### Emenda de 29/09/2026 — a superfície tingida virou componente do design system

**Decisão do PI.** Pedido o mesmo tratamento visual no **financeiro do aluno** — superfície de
trabalho, não de resumo — e avisado de que a emenda acima o excluía, o PI optou por **ampliar o
design system** em vez de abrir exceção tela a tela.

O que a emenda de 01/09 abriu para o dashboard agora existe como **`PainelDeEstado`**
(`packages/ui`, DS-PAINEL §4.6b) e **qualquer tela pode usar**. O que ficou de pé é o que sempre
foi a regra real, e que nunca foi sobre *qual tela*:

- **O tom é o do estado que o número descreve, e some quando não há estado.** Cor por enfeite
  continua fora — em toda tela, inclusive no dashboard.
- **Alerta exige que o número seja o problema.** Cobrança do mês em aberto é o caso normal do
  balcão e pinta em repouso; vencida pinta em alerta. Se tudo alarma, nada alarma.
- **Contraste AA e cor nunca como canal único** seguem verificados por medição, não por
  intenção — ver os números em DS-PAINEL §4.6b.

A frase acima ("não se estende às demais telas") passa a valer como **regra de conteúdo, não de
rota**: o que não se estende é pintar tela sem estado, não o componente.

### Emenda de 30/09/2026 — a restrição por rota acaba

**Decisão do PI.** Ao pedir o mesmo tratamento na **ficha do aluno** (aba Informação), e informado
de que a emenda de 29/09 já não excluía nenhuma tela por nome — só exigia que houvesse estado a
comunicar —, o PI decidiu fechar de vez a frase residual da emenda de 01/09: **nenhuma superfície
do painel é excluída por ser "tela de trabalho".**

O que muda: a distinção entre "dashboard, superfície de resumo" e "grid de alunos, cobrança,
operação, superfícies de trabalho" deixa de existir como critério de acesso à cor semântica.
Qualquer tela — tabela densa incluída — pode tingir um elemento pelo tom do estado que ele
descreve, usando `PainelDeEstado` ou `SummaryStrip` (DS-PAINEL §4.6b, §4.6c).

O que **não** muda, porque nunca foi sobre rota:

- **O tom é do estado, nunca decoração.** Célula sem estado a descrever não ganha cor "para ficar
  bonita" — isso continua proibido em qualquer tela, dashboard incluído.
- **Cor nunca é canal único.** Ícone e rótulo textual sempre acompanham.
- **Alerta exige que o valor seja o problema**, não o assunto. "Em dia" pinta `ok`; só o que
  precisa de ação pinta `warn`/`err`/`risk`.
- **Contraste AA** segue verificado por medição no navegador, não por intenção.

Exemplo já em produção: a ficha do aluno resume três perguntas (situação do cadastro, acesso
vigente, financeiro) em três células de `SummaryStrip`, cada uma tingida pelo próprio estado — não
pela tela ser "de resumo".

## Design Principles

1. **A exceção é o caso principal.** A recepção abre o painel quando algo deu errado. O caminho
   feliz não precisa de tela; a negativa precisa de estado, razão e próximo passo, os três visíveis
   ao mesmo tempo.

2. **Diga a razão certa, não a razão confortável.** `NO_ENTITLEMENT` não vira "está devendo", e
   `WRONG_UNIT` não vira "acesso negado" genérico. Achatar razões distintas num rótulo só faz a
   recepção tomar a ação errada com confiança.

3. **Estado carrega três canais: cor, ícone e texto.** Nenhum sozinho. Quem não distingue verde de
   vermelho, quem opera com brilho baixo e quem usa leitor de tela chegam à mesma leitura.

4. **Dado ausente não é zero.** `—` com rótulo acessível, nunca `0`, nunca campo vazio. Zero é uma
   afirmação sobre o mundo; ausência é a confissão de que não sabemos.

5. **Accent é ação; carbono é estrutura; semântico é estado.** Os três papéis não se misturam. Um
   tenant com accent verde não pode fazer "Ativo" e "botão salvar" parecerem a mesma coisa.

6. **Densidade é a funcionalidade.** Linha de 40 px, corpo de 14 px, numeral tabular. Cada pixel de
   respiro decorativo custa uma linha a menos na tela e um scroll a mais com o aluno esperando.

## Accessibility & Inclusion

**WCAG 2.2 AA** — requisito contratual em quatro PRDs (`M1-NFR-008`, `M3-NFR-007`, `M4-NFR-007`,
`M5-NFR-008`), não meta.

- Contraste: 4.5:1 texto normal · 3:1 texto grande e componente. Verificado por teste que **falha o
  build**, incluindo os pares derivados do accent do tenant.
- Exceção nomeada única: controle *Disabled* usa `carbon-400` (3.78), isento por WCAG 2.2 §1.4.3
  (componente inativo). Decisão do PI em 16/08/2026 — a alternativa mais escura voltava a ler como
  habilitado.
- Cor nunca é o único canal; todo estado tem ícone e rótulo textual.
- Todo gráfico tem tabela equivalente real no DOM.
- Foco visível em tudo: anel de 2 px + offset de 2 px.
- Zoom de texto até 200% sem perda de conteúdo ou função — nenhum container de texto com altura
  fixa em px.
- `prefers-reduced-motion: reduce` desliga animação decorativa e mantém só opacidade ≤ 100 ms.
- Formulário nunca limpa dado em erro recuperável.
- Ação destrutiva e logout exigem confirmação.
- Unidade de medida ao lado do rótulo, nunca no placeholder.

**Fora da acessibilidade formal, mas do mesmo espírito:** biometria exige consentimento versionado
e **caminho alternativo funcional**. Recusar a biometria não pode negar o acesso — QR, cartão, PIN
e liberação assistida são caminhos de primeira classe, não degradados.
