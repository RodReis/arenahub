# Termo de consentimento de dados de saúde — RASCUNHO

> 🔴 **ISTO NÃO É UM TERMO APROVADO E NÃO PODE SER APRESENTADO A NENHUM ALUNO.**
>
> É um rascunho escrito pelo Cowork para **encurtar a revisão jurídica**, não para substituí-la.
> Quem escreveu não é advogado. O documento existe para que o advogado receba uma minuta com a
> arquitetura do sistema já refletida — o que o produto realmente coleta, para onde manda e por
> quanto tempo guarda — em vez de partir de um modelo genérico que não corresponde ao código.
>
> **Estado:** rascunho · **Versão do termo quando aprovado:** `saude-v1` · **Bloqueia:** F17
> **Origem:** [ADR-035](../../DECISIONS.md#adr-035), [ADR-036](../../DECISIONS.md#adr-036),
> [ADR-037](../../DECISIONS.md#adr-037) · `MVP-03` §5 e §15

---

## 0. Três decisões que o PI precisa tomar antes da revisão jurídica

Elas mudam o texto, então decidir antes economiza uma rodada com o advogado.

### 0.1 Um consentimento ou dois?

O rascunho abaixo usa **dois consentimentos separados e independentes**:

| consentimento | cobre | recusar significa |
|---|---|---|
| **A — Avaliação de saúde** | registrar peso, composição corporal, medidas, anexar laudos | não há avaliação física no ArenaHub; o aluno treina normalmente |
| **B — Análise assistiva por IA** | enviar os números (sem nome, sem CPF, sem imagem) a um provedor no exterior | há avaliação e histórico; não há o texto de acompanhamento gerado |

**Por que separado:** um aluno pode querer acompanhar a evolução e não querer que os dados saiam
do país. Amarrar as duas coisas num aceite só torna o consentimento **menos livre** — e
consentimento não livre é consentimento inválido, que foi o fundamento nº 1 da suspensão da ANPD
no caso do Paraná (ver ADR-008). É o mesmo raciocínio que fez o caminho não-biométrico ser de
primeira classe na F8.

**Custo da separação:** duas colunas de estado, duas versões a controlar, e uma tela que precisa
funcionar com A sem B.

### 0.2 A transferência internacional entra como consentimento ou como cláusula contratual?

A LGPD (art. 33) admite transferência internacional por **cláusulas-padrão contratuais** *ou* por
**consentimento específico e destacado** do titular. O ADR-036 decidiu pseudonimização + DPA com
não-treinamento — o que aponta para o caminho contratual.

**O rascunho pede consentimento específico mesmo assim** (item B.3), por ser o caminho mais
conservador enquanto o DPA não está assinado. Se o advogado confirmar que as cláusulas do contrato
bastam, o item B.3 vira informação em vez de aceite — e o texto encurta.

### 0.3 Menor de 18 anos

O ADR-008 já registrou que há aluno menor no Arena Positiva e tornou o consentimento por
responsável legal **escopo obrigatório da F8**. Dado de saúde tem o mesmo problema e mais um: a
virada dos 18 anos exige **reconsentimento do próprio titular**, não herança do aceite do
responsável. O rascunho assume que a F17 reusa o mecanismo da F8. **Confirmar.**

---

## 1. Minuta — Consentimento A: avaliação de saúde

> Texto proposto para a tela. Linguagem de quem vai ler, não de quem vai processar.

### O que a academia vai registrar sobre você

Ao aceitar, você autoriza o **[NOME DA ACADEMIA]** a registrar e guardar, no sistema ArenaHub:

- peso, altura e as medidas da sua avaliação física;
- resultados de bioimpedância — composição corporal, massa muscular, gordura, água e as medidas
  por segmento do corpo;
- os arquivos de laudo que você ou o avaliador anexarem (fotos, PDFs, exportações de aparelho);
- fatores que mudam como esses números devem ser lidos, informados por você ao avaliador — por
  exemplo, uso de creatina, gestação ou uso de diurético;
- suas metas e a frequência derivada das suas entradas na academia.

### Para que serve

**Acompanhar a sua evolução física ao longo do tempo, e nada além disso.** Estes dados **não**
são usados para decidir se você entra na academia, quanto você paga, nem para qualquer decisão
automática sobre você.

### O que isto NÃO é

> **O ArenaHub não faz diagnóstico e não substitui médico.** Bioimpedância de balança é uma
> estimativa com margem de erro, feita por um aparelho que **não é dispositivo médico** — o próprio
> fabricante declara isso. Nada aqui é laudo, prescrição ou orientação de tratamento. Se algum
> número preocupar você ou o avaliador, o encaminhamento é a um profissional de saúde.

### Sobre laudos de aparelho que você anexar

Se você anexar um exame de aparelho próprio — por exemplo, um eletrocardiograma de monitor
doméstico — o ArenaHub **guarda o arquivo e repete o que o próprio aparelho escreveu**, sempre
identificando que a informação veio do equipamento. **O ArenaHub não lê, não interpreta e não
opina sobre esse resultado.** Se o aparelho apontar algo, o sistema registra que há uma avaliação
médica pendente e mostra isso ao avaliador — para que você seja orientado a procurar um médico,
não para que a academia conclua qualquer coisa.

### Quem pode ver

- **você**, no aplicativo e no totem;
- o **avaliador ou profissional responsável** pela sua avaliação, na unidade em que você treina;
- a **administração da unidade**, para operação e correção de erro, com registro de quem acessou.

Ninguém fora disso. Cada acesso fica registrado.

### Por quanto tempo

Enquanto durar sua matrícula e por **[X] meses** depois do encerramento. Os prazos completos, por
tipo de dado, estão na *Política de retenção* — resumo em §3 deste documento.

### Seus direitos

Você pode, a qualquer momento e sem justificar: **confirmar** que existe tratamento, **acessar**
seus dados, **corrigir** o que estiver errado, **pedir cópia** em formato legível, **revogar**
este consentimento e **pedir eliminação**.

### O que acontece se você revogar

Suas avaliações deixam de ser exibidas **imediatamente**, e a eliminação segue os prazos da
política de retenção. **Revogar não afeta sua matrícula, sua entrada na academia, nem seu plano.**

### Se você não aceitar

Você treina normalmente. Simplesmente não haverá avaliação física registrada no ArenaHub. **Não há
nenhuma diferença de preço, de acesso ou de serviço.**

---

## 2. Minuta — Consentimento B: análise assistiva por inteligência artificial

> Independente do A. Recusar o B mantém o A inteiro.

### O que acontece

Depois que o avaliador confere e publica sua avaliação, o ArenaHub pode enviar **os números** a um
serviço de inteligência artificial, que devolve um texto organizando a sua evolução — o que
melhorou, o que piorou e quais perguntas vale levar ao profissional.

### O que é enviado, e o que não é

| enviado | **não** enviado |
|---|---|
| seus números de composição corporal e o histórico deles | seu nome |
| sua idade e altura | seu CPF, e-mail, telefone ou matrícula |
| os fatores de contexto que você informou | as fotos e os arquivos de laudo |
| suas metas e frequência | qualquer resultado de exame cardíaco |

### Onde isso é processado — leia com atenção

O serviço de inteligência artificial **fica fora do Brasil**. Isso significa que seus dados de
composição corporal, **sem identificação direta**, são processados em outro país.

O contrato com esse fornecedor proíbe expressamente **usar seus dados para treinar modelos**.

### O que a análise é e o que não é

> **É um texto de acompanhamento, não um diagnóstico.** Ele organiza os seus próprios números para
> render uma conversa melhor com o avaliador ou com o seu médico. Toda análise vem marcada como
> não-diagnóstica e traz um canal para falar com um profissional.

### Se você não aceitar

Você continua com **avaliação, histórico, gráficos, comparativos e metas** — tudo. Apenas não
haverá o texto de acompanhamento gerado automaticamente. **Nenhuma diferença de preço ou serviço.**

---

## 3. O que o sistema precisa guardar do aceite

Não é texto de tela — é requisito para a F17.

| campo | por quê |
|---|---|
| `versao_do_termo` (ex.: `saude-v1`) | provar **qual texto** a pessoa aceitou. Termo sem versão é termo sem prova |
| `tipo` (`SAUDE` \| `ANALISE_IA`) | os dois são independentes (§0.1) |
| `aceito_em`, `revogado_em` | data e hora, com fuso |
| `ator` | o próprio aluno ou o responsável legal, identificado |
| `ip`, `dispositivo` | mesma evidência que a F8 já coleta para biometria |
| `canal` | app, totem ou balcão — muda a qualidade da prova |
| **histórico completo** | aceite e revogação **nunca** sobrescrevem: cada evento é uma linha nova |

**Texto novo do termo exige versão nova e reconsentimento.** Editar o texto de uma versão já
aceita destrói a prova de todos os aceites anteriores — é o erro que transforma conformidade em
passivo.

---

## 4. O que falta antes de virar `saude-v1`

- [ ] PI decide §0.1, §0.2 e §0.3;
- [ ] **revisão de advogado** — obrigatória, e é ela que aprova, não este documento;
- [ ] preencher `[NOME DA ACADEMIA]` e o `[X] meses` da retenção;
- [ ] DPA com o provedor de IA assinado (ADR-036), porque o texto do B depende do que ele diz;
- [ ] revisão do trecho *"O que isto NÃO é"* por **profissional de saúde habilitado** — é a parte
      que o aluno mais provavelmente vai citar de volta;
- [ ] teste de leitura com **uma pessoa da recepção e um aluno real**. Termo que ninguém entende é
      consentimento informado no papel e não na prática.
