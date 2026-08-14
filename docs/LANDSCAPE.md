# LANDSCAPE.md — cenário competitivo e regulatório

> **Leitura datada de 14/08/2026.** Serve para não reconstruir o que já existe de graça e para
> não ser pego por mudança de regra.
>
> **Aviso metodológico, e ele importa:** quase todo comparativo público de software de academia
> é escrito por **concorrente** ou por gateway vendendo integração. Onde a fonte é parte
> interessada, está marcado. Números de base de clientes são **auto-declarados** — não há
> auditoria independente. Este documento **não substitui validação comercial direta**.
>
> **Revalide quando** qualquer gatilho da §6 disparar. Sem gatilho, revalide em **fevereiro de
> 2027**.

---

## 1. Software de gestão de academias no Brasil

### O mercado

- 56 mil+ academias ativas, 13,65 mi de membros, penetração ~7% (Panorama Setorial Fitness
  Brasil 2025).
- Setor movimentou **R$ 17 bi em 2024** (ACAD Brasil), +44% sobre 2019.
- **Consolidação em curso:** Smart Fit assumiu o controle da rede Evolve com investimento de
  até R$ 100 mi; Bluefit foi adquirida pela Mubadala Capital; a **W12 virou ABC Evo** após
  aquisição pela ABC Financial em 2019 — o topo do segmento enterprise brasileiro já é de
  capital estrangeiro.

### Os players e o que entregam de fábrica

Capacidades **declaradas pelos fabricantes**, não testadas. Fonte principal: comparativo de 15
sistemas do blog da Pacto, atualizado em maio/2026 (parte interessada, se auto-lista em 1º).

| sistema | recorrência | acesso/catraca | app do aluno | base declarada |
|---|---|---|---|---|
| **Tecnofit** | sim | sim | sim, com IA prescritiva | 16.500 clientes |
| **Nextfit** | sim | sim | sim | 12.000+ clientes |
| **Pacto** | cartão, débito, **Pix Automático** (PactoPay) | catraca + facial | App Treino + App Meu Box | 5.800 negócios |
| **ABC Evo** (ex-W12) | sim | hardware ABC | sim | — |
| **Cloud Gym** | sim | **facial nativo** | sim | declara PCI DSS Level 1 |
| **SCA** | sim | sim | parcial | ativo desde 2004 |
| **Actuar** | sim | **catraca própria** (é fabricante) | parcial | 15+ anos |

Preço: **só a Tecnofit tem página pública** (não renderizou no fetch; fontes secundárias citam
~R$ 3,38/aluno ativo/mês — **confiança baixa, verificar na fonte**). Pacto, ABC Evo, Nextfit,
Cloud Gym e SCA: **orçamento fechado por comercial**. Faixa de mercado single-unit citada:
R$ 150 a R$ 1.200/mês conforme módulos, mais 1,5% a 4,5% de adquirência.

### O que já é padrão — e portanto não é diferencial

- **Avaliação física e bioimpedância**: módulo de fábrica em praticamente todos. A Pacto oferece
  avaliação física como módulo gratuito.
- **Gamificação e ranking**: o Tecnofit Box tem "**Nível Fitness**" com ranking do aluno dentro
  da unidade, documentado na central de ajuda do produto, mais timeline social no app.
- **Integração Wellhub/TotalPass/ClassPass**: declarada nativa por Tecnofit, ABC Evo, Pacto,
  Nextfit, Cloud Gym e HubFit.
- **IA prescritiva de treino**: virando padrão em 2026. **Ressalva relevante:** vale checar se
  gera ficha utilizável ou rascunho que o professor reescreve — o *gap de qualidade* pode ser o
  espaço real.

**Não encontrado** em fontes públicas, apesar de citados: Actual Fit, Sistema Gestão Fitness,
Trybe. Dados verificáveis da ZW Sistemas também não foram localizados.

---

## 2. Controle de acesso e biometria facial

**Conclusão que muda a estratégia: o hardware não é o gargalo.** SDK existe, é documentado, e o
atrito de acesso é baixo ou nulo.

### Control iD — API pública, aberta, sem porteiro comercial aparente

Documentação REST **acessível sem login**. Três modos de operação, e a escolha é decisão de
arquitetura nossa:

| modo | identifica | autoriza |
|---|---|---|
| Standalone | terminal | terminal |
| **Pro** | terminal | **servidor** |
| Enterprise | servidor | servidor |

Nos modos Pro e Enterprise, a regra de entitlement fica no nosso backend, consultada em tempo
real — que é exatamente o desenho do ADR-004. Há `Monitor` para eventos assíncronos (giro,
abertura, logs), **Push** por polling HTTP do equipamento (resolve NAT sem VPN), endpoints de
cadastro facial por foto **e por template**, exemplos oficiais em C#, Delphi, Java, NodeJS e
Python no GitHub, e coleção Postman pública.

> "Cadastro por template" significa que o vetor biométrico pode ser gerado e armazenado fora do
> equipamento. Isso é decisão de **LGPD**, não só técnica — ver §4 e ADR-008.

### Topdata — três SDKs, documentação em portal de integradores

| SDK | equipamento | tecnologia | exemplos |
|---|---|---|---|
| Inner REP | relógios de ponto | DLL | C#, Java, Delphi |
| **Inner Acesso** | catracas (Fit, Revolution, Box) | DLL | C#, Java, Delphi |
| **Leitor Facial** | T4, F4 | **WebSocket** | **só C#** |

Existe FAQ do fabricante sobre "Modo Nuvem" e sobre confirmação de giro via WebSocket — o
caminho de integração é maduro. **Não determinado:** as condições de acesso ao Portal do
Integrador (gratuito? cadastro? contrato?). Preço indicativo de hardware: Catraca Fit a partir
de ~R$ 4.138 (revenda).

**A Topdata também vende software próprio (TopAcademia)** — é fornecedor **e** concorrente
parcial do nosso módulo de acesso.

### Os outros

- **Henry** — SDK existe, protocolo único para Argos/PrimmeAcessoSF/CatracaSF por IP,
  documentado por terceiros. **Portal público do fabricante: não encontrado.**
- **Intelbras** — vende catraca biométrica para academia; **SDK/API pública: não encontrada.**
- **Hikvision** — protocolo ISAPI (HTTP/REST) documentado, mas **em portal de parceiros com
  aprovação**. Risco político adicional de fornecedor, não avaliado aqui.

### O ponto duro

**Controle de acesso facial integrado não é diferencial em 2026** — a própria Pacto o classifica
como "exigência mínima". A Actuar fabrica a própria catraca e vende pacote único; a Pacto vende
catraca facial já integrada; a Tecnofit integra com Henry, Topdata, Tecnibra, Control iD, Trix e
Proveu.

Construir a integração é trabalho conhecido e razoavelmente documentado. **Construir o
diferencial em cima dela é a questão em aberto.**

---

## 3. Programas corporativos — e por que isso é modelagem, não integração

**O aluno corporativo existe na catraca sem existir no financeiro da academia.** É o argumento
mais forte a favor do `Entitlement` como conceito de primeira classe (ADR-003, ADR-009).

### Wellhub (ex-Gympass) — tem API pública de desenvolvedor

Portal aberto com trilhas para clientes (RH), parceiros fitness e apps. O que importa:

- **Access Control API** — valida o check-in feito no app, recebendo o `gympass_id`. A validação
  **gera a transação que será paga depois**: check-in validado **é** o evento de receita.
- **Check-in Webhook** — assinado com header `X-Gympass-Signature`.
- Também há Booking API e Integration Setup API. Declara integração com 50+ plataformas.

Repasse mensal por quantidade de check-ins, pago no mês seguinte. **Valores em R$ não são
públicos.** Há evidência de atrito real: reclamação formal sobre **redução de repasse** levando
academias a **limitar o uso do plano a 13 dias/mês** (fonte é reclamação de usuário, não dado
auditado — mas o comportamento é sintoma de tensão econômica no modelo).

### TotalPass

Integra com EVO, Cloud Gym, Next Fit, HubFit e outros. Academia com controle de acesso integrado
**não faz validação manual** — o aluno faz check-in no app e vai direto à catraca. Repasse fixo
por check-in, sem mínimo, desde o primeiro aluno. **API pública de desenvolvedor: não
encontrada** — provavelmente acordo bilateral.

### Cinco consequências de domínio

1. **Direito de acesso ≠ assinatura.** `Entitlement.source` precisa ser polimórfico.
2. **A fonte da verdade do direito é externa e assíncrona.** Webhook chega quando chega; a
   catraca decide em ~1 s. Isso força cache local + reconciliação.
3. **Receita por evento, não por ciclo.** Convive com a recorrência, não substitui.
4. **Limite por aluno tem de ser política configurável**, não constante no código — a academia
   vai querer mexer nisso quando o repasse cair.
5. **Idempotência obrigatória** no check-in: o mesmo evento não pode gerar dois acessos nem dois
   repasses.

---

## 4. Regulatório

### 4.1 LGPD e biometria — risco corrente, não futuro

**O fato mais importante deste documento.** Em **04/08/2026**, a Superintendência de
Fiscalização da ANPD determinou, por **Despacho Decisório nº 2/2026/SFI**, a **suspensão
imediata** do tratamento de dados biométricos de crianças e adolescentes na rede estadual do
Paraná (sistema "Escola Paraná Biometria", com Celepar e Valid Solutions).

**Os três fundamentos:**

1. **falta de base legal**
2. **ausência de comprovação de segurança**
3. **falhas no controle de acesso às imagens**

Prazo de 10 dias úteis para comprovar a interrupção; autos encaminhados à Coordenação-Geral de
Sanções.

**A norma específica sobre biometria ainda não saiu.** A ANPD abriu Tomada de Subsídios em
02/06/2025 (item 5 da Agenda Regulatória 2025-2026, Resolução CD/ANPD nº 23/2024), recebeu 1.594
contribuições e fez audiência pública em 02/12/2025. Até pelo menos julho/2026, **nada
publicado**. Biometria segue como eixo prioritário no Mapa de Temas 2026-2027.

**Leitura:** a ANPD **está agindo antes da norma**, com poder de suspensão imediata. Os três
fundamentos usados mapeiam direto em requisito de produto. Menor de idade foi agravante — e
academia tem aluno menor.

**Requisitos em que a literatura jurídica converge** (fontes secundárias — escritórios e
análises, não a ANPD):

- Base legal: consentimento destacado, livre, informado e inequívoco, por escrito — ou legítimo
  interesse **com LIA documentada**.
- **Não obrigatoriedade:** o consentimento não é livre se não houver **alternativa equivalente
  de acesso** sem biometria. Negar acesso a quem recusa é tratamento abusivo. → virou
  **INV-022b**, invariante, não recomendação.
- **RIPD** provavelmente exigido em facial em larga escala.
- Retenção: a LGPD não fixa prazo; a prática é eliminar ao fim do vínculo. → expurgo automático
  do template no encerramento do contrato.
- Sanção: até **R$ 50 milhões por infração**.

### 4.2 Pix Automático

Lançado pelo Banco Central em **16/06/2025**. Autorização única do pagador, valor máximo
definido, débitos em datas combinadas, sem QR nem chave a cada cobrança. Cobre os ~60 milhões de
brasileiros sem cartão de crédito.

**A consequência de modelagem que ninguém pode ignorar:** a autorização é **gerenciável e
cancelável pelo pagador no app do próprio banco**. A academia perde a autorização **sem ser
avisada pelo cliente**. → `autorização revogada` é estado de primeira classe, **distinto** de
`pagamento falhou` (ADR-013). Tratar os dois igual gera cobrança indevida e churn silencioso.

**Adoção acelerando.** Dados operacionais de um PSP (PagBrasil, Q4/2025 → Q1/2026 — **fonte
interessada, carteira específica, não auditada**): transações +182%, novos usuários +181%,
receita processada +170%. Um caso citado reporta churn −25,2% e custo de assinatura −50% vs.
cartão.

**Nova regra do BC com prazo de adaptação até abril de 2026** — só cobertura de imprensa
localizada; **o teor exato não foi verificado na fonte do BC. Verificar antes de codificar.**

PSPs participantes incluem Asaas (com documentação pública de Pix Automático), Iugu, Vindi,
Pagar.me, MercadoPago, Stone, Cielo, PagSeguro, Stripe Brasil. **Pacto, Cloud Gym, Tecnofit e
Nextfit já declaram suporte.**

---

## 5. O que não vale reconstruir

| item | estado | por quê |
|---|---|---|
| Comunicação com catraca e leitor facial | comoditizado e documentado de graça | Control iD publica API REST aberta + SDKs em 5 linguagens; Topdata tem 3 SDKs |
| **Matching biométrico 1:N** | vem na caixa | modo Standalone identifica e autoriza no próprio terminal |
| Motor de recorrência (cartão, boleto, Pix Automático, split) | comoditizado | Asaas, Vindi, Iugu, Pagar.me, Stone, Cielo, Stripe BR |
| Validação de check-in corporativo | fornecida de graça pelo Wellhub | Access Control API + webhook assinado, portal aberto |
| Fórmulas de avaliação física | domínio público | Pollock 3 e 7 dobras, Guedes, Faulkner |
| App do aluno (treino, agendamento, histórico) | comoditizado | padrão em todo software relevante de 2026 |
| Ranking e gamificação básica | já é feature de fábrica no líder de base | Tecnofit "Nível Fitness" |

**Onde o espaço parece existir** — inferência, **confiança baixa**, precisa de validação com o
PI:

1. **Conformidade LGPD como produto**, não como disclaimer: RIPD gerado, log de acesso a
   template, expurgo automático no fim do vínculo, caminho alternativo não-biométrico de
   primeira classe. O caso PR mostra que os fundamentos de autuação são exatamente esses.
2. **Entitlement multi-origem tratado como modelo de domínio de verdade** (assinatura + Wellhub
   + TotalPass + diária + cortesia), com reconciliação de repasse — em vez de "integração com
   Gympass" pendurada na lateral.
3. **Ciclo de vida da autorização Pix Automático** tratado explicitamente.

---

## 6. Gatilhos de revisão

Ordenados por probabilidade × impacto.

1. **ANPD publica a norma de biometria** (prevista para 2026). *Impacto altíssimo.* Pode impor
   RIPD, limites de retenção, exigência de template no dispositivo. **Monitorar `gov.br/anpd` →
   Processo Regulatório e Notícias.**
2. **Primeira sanção contra ambiente privado por facial.** O caso PR é setor público com menores
   — a extrapolação para academia é inferência. Sanção contra condomínio, varejo ou academia
   muda o cálculo de risco.
3. **Desfecho do processo sancionador do caso Paraná.** O valor e o fundamento da multa viram
   régua.
4. **Fabricante lança software de gestão.** Topdata já tem "Modo Nuvem" e TopAcademia; Actuar já
   vende hardware+software. Se Control iD ou Topdata entrarem de vez, o fosso muda de lugar.
5. **Wellhub muda repasse ou fecha/abre a Access Control API.** Já há sinal de aperto.
6. **TotalPass publica API pública** (hoje inexistente).
7. **Novo M&A no software fitness BR.** Rede grande comprando ERP fecha um canal inteiro.
8. **BC altera regras do Pix Automático.** Já houve mudança com prazo até abril/2026.
9. **Pix Automático vira default** e o diferencial passa a ser a régua de cobrança sobre ele.
10. **Nova edição do Panorama Setorial ACAD.** Os números aqui são de 2024-2025.

---

## 7. Fontes

**Software de gestão** — [Pacto: comparativo de 15 sistemas, 19/05/2026](https://blog.sistemapacto.com.br/melhores-sistemas-para-academias/) · [Pacto: custo de sistema](https://blog.sistemapacto.com.br/quanto-custa-sistema-para-academia/) · [Tecnofit Gym](https://www.tecnofit.com.br/produtos/tecnofit-gym/) · [Tecnofit: Nível Fitness](https://ajuda.tecnofit.com.br/pt-BR/support/solutions/articles/67000364609-) · [ABC Evo: aquisição](https://blog.abcevo.com.br/aquisicao-abc-financial-software-evo) · [Nextfit: bioimpedância](https://blog.nextfit.com.br/avaliacao-bioimpedancia/) · [Fitness Brasil: Smart Fit / Evolve](https://www.fitnessbrasil.com.br/newsfitbr/smart-fit-avanca-na-consolidacao-do-mercado-e-assume-controle-da-evolve-com-investimento-de-r-100-milhoes/)

**Controle de acesso** — [Control iD: API de acesso](https://www.controlid.com.br/docs/access-api-pt/) · [Control iD: exemplos no GitHub](https://github.com/controlid/integracao) · [Topdata: quais SDKs, 28/07/2025](https://integrador.topdata.com.br/suporte/quais-sdks-estao-disponiveis-e-qual-a-diferenca-entre-elas/) · [Topdata: catraca para academia](https://www.topdata.com.br/catraca-para-academia/) · [Hikvision ISAPI](https://tpp.hikvision.com/download/ISAPI_OTAP)

**Programas corporativos** — [Wellhub: Access Control API](https://developers.wellhub.com/product/access-control-api/1.0/getting-started) · [Wellhub: check-in webhook](https://developers.wellhub.com/product/access-control-api/1.0/check-in-webhook) · [TotalPass: integração de acesso](https://ajuda.totalpass.com.br/hc/pt-br/articles/18969671062299-) · [Reclame Aqui: redução de repasse Wellhub](https://www.reclameaqui.com.br/wellhub/wellhub-reducao-de-repasse-para-academias-gera-impacto-negativo-e-restricao-de-acesso-para-usuarios_QimTJVS5PRhOj_q_/)

**Regulatório** — [ANPD: tomada de subsídios sobre biometria](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-abre-tomada-de-subsidios-sobre-tratamento-de-dados-biometricos) · [ANPD: mapa de temas 2026-2027](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-mapa-de-temas-prioritarios-para-o-bienio-2026-2027-e-atualiza-agenda-regulatoria-2025-2026) · [Data Privacy Brasil: suspensão no Paraná, 04/08/2026](https://www.dataprivacybr.org/anpd-suspende-o-uso-de-reconhecimento-facial-em-escolas-publicas-do-parana/) · [Olhar Digital, 06/08/2026](https://olhardigital.com.br/2026/08/06/pro/anpd-manda-parana-suspender-reconhecimento-facial-de-alunos-em-escolas/) · [Jus: biometria em academias e LGPD](https://jus.com.br/artigos/88446/uso-de-biometria-nas-academias-e-adequacao-a-lei-geral-de-protecao-de-dados-pessoais)

**Pagamentos** — [PagBrasil: Pix Automático 2026, atual. 14/07/2026](https://www.pagbrasil.com/pt-br/blog/pagamento-recorrente/pix-automatico-2026/) · [BC: Pix em números](https://www.bcb.gov.br/estabilidadefinanceira/pix-em-numeros-estatisticas) · [Asaas: docs Pix Automático](https://docs.asaas.com/docs/pix-automatico)

---

## 8. Declarado como não encontrado

Para que ninguém preencha com suposição:

- Preço público de Pacto, ABC Evo, Nextfit, Cloud Gym e SCA.
- Valor exato da tabela Tecnofit na fonte primária.
- Valores de repasse do Wellhub e do TotalPass em reais.
- API pública de desenvolvedor do TotalPass.
- SDK/API pública documentada da Intelbras.
- Portal público de documentação do fabricante Henry.
- Condições de acesso ao Portal do Integrador da Topdata.
- Texto final da norma de biometria da ANPD.
- Teor exato da nova regra do BC sobre Pix Automático (prazo até abril/2026).
- Actual Fit, Sistema Gestão Fitness e Trybe como players de gestão de academias.
