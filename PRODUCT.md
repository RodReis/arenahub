# Product

> Contexto estratégico para trabalho de interface. **Não substitui** os documentos normativos:
> `docs/prd/README.md` (contrato de produto e engenharia), `docs/design/DS-PAINEL.md`,
> `DS-APP.md` e `DS-TOTEM.md` (contrato de implementação por superfície, ADR-026).
> Onde divergir, o documento normativo vence.

## Register

product

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
