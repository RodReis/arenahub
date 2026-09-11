# SPEC-070 — Contrato com cláusulas, qualificação das partes e assinatura

| campo | valor |
|---|---|
| **Fatia** | F70 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-055 |
| **Superfície** | `api` (`platform`) · `admin-web` (`/platform/[tenantId]/contratos`) · `packages/database` · object storage |
| **Card** | — |
| **Status** | rascunho — pedida pelo PI em 11/09/2026; depende das lacunas da §7 |

---

## 1. O que esta fatia entrega

O PDF do contrato deixa de ser uma **ficha de dados** e passa a ser um **contrato**: qualifica as
duas partes, diz o que está sendo licenciado, quem responde pelo quê, o que acontece com os dados
e como termina — e traz o campo de assinatura das partes e de duas testemunhas.

O que existe hoje (`contrato-pdf.service.ts`) imprime contratante, plano, superfícies, reajuste e
vigência. Está correto e **continua**: vira a *Seção I — Quadro resumo* do documento novo. O que
esta fatia acrescenta é a *Seção II — Cláusulas* e a *Seção III — Assinaturas*.

---

## 2. Os três defeitos que esta fatia corrige

| # | defeito de hoje | por que importa |
|---|---|---|
| 1 | **O título diz "Contrato de prestação de serviço"** | não é. É licença de uso de software em regime de assinatura. "Prestação de serviço" é o rótulo usado em desenvolvimento sob encomenda — e em contrato sob encomenda a titularidade do que se produz é discutível. O ArenaHub é produto da CONTRATADA, vendido a vários clientes; o documento tem que dizer isso na primeira linha |
| 2 | **A CONTRATADA não aparece** | um contrato com uma parte só não é contrato. Falta a qualificação da RRB TRADING |
| 3 | **Não existe onde assinar** | o documento é gerado, baixado e não vira nada |

---

## 3. Dados novos

### 3.1. Da CONTRATADA — configuração, não literal no código

Razão social, CNPJ, endereço, representante legal, e-mail, site e redes da RRB TRADING **não entram
literais** no `contrato-pdf.service.ts`. Vão para configuração de plataforma (variável de ambiente ou
tabela `platform_settings` de linha única — decisão do Code): mudam por ato societário, e trocar
endereço da empresa não pode exigir deploy. O Code decide onde, registra no PR.

### 3.2. Do tenant — quatro colunas que faltam

`Tenant` tem `cnpj`, `responsavelNome`, `responsavelEmail`. **Não tem endereço, nem telefone, nem o
CPF de quem assina** — e contrato sem endereço da contratante e sem qualificação de quem assina
nasce capenga. Colunas novas, todas opcionais:

- `address_line`, `address_city`, `address_state`, `address_zip` — ou reaproveitar o formato já usado
  em `student_addresses`, se o Code achar que vale (decisão dele).
- `responsavel_cpf`, `responsavel_telefone`.

**O `cnpj` da Arena Positiva está `null` em produção** — é o que o PDF de 11/09 imprime como
*"não informado"*. Preencher é dado, não código.

### 3.3. Do contrato — versão dos termos e assinatura

- **`terms_version`** (`String`, obrigatório) — **a decisão central desta fatia**. O texto das
  cláusulas é versionado e o contrato grava **qual versão foi fechada**. Regerar o PDF de um
  contrato de 2026 em 2029 tem que reproduzir os termos de 2026, não os de 2029. É a mesma regra
  que já vale para os preços (ADR-052 §8: *"valores copiados, não referência viva"*), aplicada ao
  texto. Sem isso, mudar uma cláusula reescreveria retroativamente todo contrato já assinado.
- `signature_status` — `PENDING` | `SIGNED` | `WAIVED`.
- `signed_document_object_key` — o PDF **assinado**, digitalizado ou devolvido pela plataforma de
  assinatura, guardado ao lado do gerado.
- `signed_at`.
- `foro_cidade` e `foro_uf` — o foro é negociado, não é constante do produto.

O `document_object_key` que já existe continua guardando o PDF **gerado**. São dois arquivos: o que
o sistema emitiu e o que as partes assinaram. Nunca sobrescrever um pelo outro.

---

## 4. Texto das cláusulas — versão `2026.1`

> Redigido pelo Cowork a pedido do PI em 11/09/2026. **Não é peça jurídica revisada por advogado.**
> Ver ADR-055, *Limite do que isto é*.

Campos entre `«»` são substituídos na geração. Campos entre `⟪⟫` **ainda não têm valor decidido**
(§7).

### Cabeçalho

**CONTRATO DE LICENÇA DE USO DE SOFTWARE EM REGIME DE ASSINATURA E PRESTAÇÃO DE SERVIÇOS DE SUPORTE**

Nº «numero» — versão dos termos «terms_version»

**CONTRATADA:** «razão social da contratada», inscrita no CNPJ sob o nº «cnpj da contratada», com
sede em «endereço da contratada», neste ato representada por «representante da contratada»,
endereço eletrônico «email da contratada».

**CONTRATANTE:** «razão social do tenant», inscrita no CNPJ sob o nº «cnpj do tenant», com sede em
«endereço do tenant», neste ato representada por «responsável», «CPF do responsável», endereço
eletrônico «e-mail do responsável».

As partes acima qualificadas celebram o presente contrato, que se regerá pelas cláusulas seguintes
e pelo Quadro resumo da Seção I, parte integrante deste instrumento.

### Cláusula 1 — Objeto

**1.1.** A CONTRATADA licencia à CONTRATANTE, em caráter **não exclusivo, intransferível e pelo
prazo deste contrato**, o uso do sistema **ArenaHub**, plataforma de gestão para academias
disponibilizada em regime de software como serviço (SaaS) e acessada pela internet, nas superfícies
descritas no Quadro resumo.

**1.2.** Este contrato **não é de desenvolvimento de software sob encomenda**. Correções, melhorias
e funcionalidades novas — inclusive as sugeridas pela CONTRATANTE — integram o produto e
permanecem de titularidade exclusiva da CONTRATADA, sem que disso decorra qualquer direito de
propriedade, exclusividade ou participação da CONTRATANTE.

**1.3.** A CONTRATADA poderá alterar, evoluir e descontinuar funcionalidades do produto, desde que
não suprima função essencial ao uso contratado sem aviso prévio de ⟪30⟫ dias.

**1.4.** O ArenaHub **não** emite documento fiscal, **não** substitui sistema contábil, **não** é
prontuário médico, **não** é instituição de pagamento ou adquirente e **não** substitui prescrição
ou avaliação de profissional de educação física ou de saúde. As informações produzidas por recursos
automatizados do sistema têm caráter informativo e não constituem diagnóstico.

### Cláusula 2 — Superfícies contratadas

**2.1.** O painel administrativo web integra todo contrato.

**2.2.** O aplicativo do aluno e o totem de autoatendimento são contratados individualmente,
conforme assinalado no Quadro resumo.

**2.3.** Superfície não contratada não é disponibilizada. Sua ativação depende de aditivo ou de novo
contrato.

### Cláusula 3 — Implantação

**3.1.** A CONTRATADA realiza a configuração inicial do ambiente, a importação da base de alunos a
partir de arquivo fornecido pela CONTRATANTE e a instalação dos componentes que operam na academia.

**3.2.** O resultado da importação depende da qualidade do arquivo entregue. Dado ausente,
duplicado ou inconsistente na origem **não é recriado** pela CONTRATADA, e sua correção posterior é
da CONTRATANTE.

**3.3.** Cabem à CONTRATANTE, às suas expensas, o computador da recepção, o equipamento de controle
de acesso e seus acessórios, a energia elétrica e a conexão de internet do local.

### Cláusula 4 — Preço, reajuste e pagamento

**4.1.** A remuneração é a do Quadro resumo, no modelo ali indicado.

**4.2.** No modelo **por aluno**, considera-se **aluno ativo** aquele em situação ativa no dia da
emissão da fatura, e **aluno inativo** qualquer outra situação cadastral. A apuração é feita no dia
da emissão e não se altera por mudanças posteriores.

**4.3.** A fatura é emitida no dia indicado no Quadro resumo, com vencimento em ⟪—⟫ dias.

**4.4.** O valor é reajustado anualmente, na data de aniversário indicada no Quadro resumo, pela
variação acumulada do índice ali previsto nos doze meses anteriores. Extinto o índice, aplica-se o
que oficialmente o substituir; na ausência de substituto, as partes acordarão índice equivalente.

**4.5.** Os valores não incluem tributos que venham a incidir sobre a operação e que sejam de
responsabilidade da CONTRATANTE.

**4.6.** O atraso sujeita a CONTRATANTE a multa de ⟪2⟫% e juros de ⟪1⟫% ao mês, *pro rata die*,
sobre o valor em aberto.

### Cláusula 5 — Inadimplência e suspensão

**5.1.** Vencida a fatura, a CONTRATANTE dispõe do prazo de carência indicado no Quadro resumo,
contado do vencimento, para regularizar.

**5.2.** Esgotada a carência, a CONTRATADA poderá **suspender o acesso ao sistema, inclusive a
liberação de acesso de alunos pelo equipamento de controle de acesso**, até a regularização.

**5.3.** A suspensão **não apaga dado**, não extingue a dívida e não constitui rescisão. Regularizado
o pagamento, o acesso é restabelecido.

**5.4.** A CONTRATANTE é avisada pelo próprio painel desde o vencimento, com indicação do valor em
aberto e do prazo restante.

### Cláusula 6 — Obrigações da CONTRATADA

**6.1.** Manter o sistema em funcionamento e disponível pela internet, ressalvadas as hipóteses da
Cláusula 11.

**6.2.** Prestar suporte por ⟪canal⟫, em ⟪horário⟫, para dúvidas de uso e falhas do sistema.

**6.3.** Manter rotina de cópia de segurança dos dados da CONTRATANTE.

**6.4.** Corrigir, em prazo razoável, os defeitos que impeçam o uso das funções contratadas.

**6.5.** Comunicar com antecedência as paradas programadas.

### Cláusula 7 — Obrigações da CONTRATANTE

**7.1.** Fornecer e manter atualizados dados cadastrais verdadeiros.

**7.2.** Guardar as credenciais de acesso, responder pelos usuários que criar e comunicar de
imediato qualquer uso indevido.

**7.3.** **Colher dos alunos, na forma da lei, o consentimento para o uso de biometria facial**,
informando a finalidade, e garantir a quem recusar o acesso por meio alternativo oferecido pelo
sistema.

**7.4.** Não ceder, sublicenciar, revender, alugar, copiar, descompilar ou tentar obter o
código-fonte do sistema, nem permitir que terceiro o faça.

**7.5.** Prover e manter a infraestrutura local descrita na Cláusula 3.3.

**7.6.** Utilizar o sistema conforme a legislação aplicável à sua atividade.

### Cláusula 8 — Propriedade intelectual e titularidade dos dados

**8.1.** O ArenaHub, seu código-fonte, arquitetura, bases de dados estruturais, marca, identidade
visual e documentação são de **titularidade exclusiva da CONTRATADA**. Este contrato transfere
apenas o direito de uso, nos limites da Cláusula 1.

**8.2.** **Os dados inseridos no sistema pela CONTRATANTE — cadastro de alunos, financeiro,
avaliações, registros de acesso — são de titularidade da CONTRATANTE.** A CONTRATADA não os
comercializa, não os cede a terceiros e os utiliza exclusivamente para executar este contrato.

**8.3.** ⟪A CONTRATADA poderá utilizar dados estatísticos agregados e anonimizados, que não
permitam identificar a CONTRATANTE nem qualquer titular, para aferir e melhorar o produto.⟫

**8.4.** Encerrado o contrato, a CONTRATANTE poderá solicitar a exportação de seus dados em formato
legível por máquina no prazo de ⟪30⟫ dias contados do encerramento. Decorrido o prazo, a CONTRATADA
poderá eliminá-los, ressalvada a guarda exigida por lei.

### Cláusula 9 — Proteção de dados pessoais

**9.1.** Para os fins da Lei nº 13.709/2018, a **CONTRATANTE é a controladora** dos dados pessoais
tratados no sistema, e a **CONTRATADA é a operadora**, tratando-os exclusivamente conforme as
instruções da controladora e para executar este contrato.

**9.2.** A CONTRATANTE declara possuir base legal adequada para o tratamento que realiza e responde
pela relação com os titulares.

**9.3.** **A biometria facial é dado pessoal sensível.** A definição da base legal e a coleta do
consentimento são de responsabilidade da CONTRATANTE. O sistema registra a versão e a data do
consentimento de cada aluno, permite sua revogação e mantém meio alternativo de identificação para
quem não consentir — sem prejuízo do acesso.

**9.4.** A CONTRATADA adota medidas técnicas de proteção compatíveis com a natureza dos dados e
comunicará à CONTRATANTE, em até ⟪48⟫ horas do conhecimento, incidente de segurança que possa
acarretar risco relevante aos titulares.

**9.5.** Pedido de titular recebido pela CONTRATADA é encaminhado à CONTRATANTE, a quem cabe
respondê-lo; a CONTRATADA presta o apoio técnico necessário.

**9.6.** A CONTRATANTE autoriza a CONTRATADA a utilizar prestadores de infraestrutura em nuvem para
hospedagem e processamento, permanecendo a CONTRATADA responsável perante a CONTRATANTE pelos
serviços que subcontratar.

**9.7.** Encerrado o contrato, aplica-se a Cláusula 8.4 quanto à devolução e à eliminação.

### Cláusula 10 — Confidencialidade

**10.1.** Cada parte se obriga a manter sigilo sobre informações técnicas, comerciais, financeiras e
operacionais da outra a que tenha acesso em razão deste contrato, e a não utilizá-las para
finalidade distinta da sua execução.

**10.2.** A obrigação não alcança informação que já fosse pública, que se torne pública sem culpa da
parte receptora, ou cuja divulgação seja exigida por autoridade competente — caso em que a outra
parte será informada, quando permitido.

**10.3.** O dever de sigilo subsiste por ⟪5⟫ anos após o término deste contrato.

### Cláusula 11 — Limitação de responsabilidade

**11.1.** A CONTRATADA **não responde** por indisponibilidade ou falha decorrente de: interrupção de
energia elétrica ou de conexão de internet no local; defeito, configuração ou substituição de
equipamento de controle de acesso, computador ou rede da CONTRATANTE; ato de terceiro fornecedor de
equipamento; uso em desacordo com este contrato; ou caso fortuito e força maior.

**11.2.** A CONTRATADA não responde por lucros cessantes, perda de oportunidade ou danos indiretos.

**11.3.** ⟪A responsabilidade total da CONTRATADA, por qualquer causa, fica limitada ao valor pago
pela CONTRATANTE nos 12 (doze) meses anteriores ao evento.⟫

**11.4.** A limitação não se aplica a dolo.

### Cláusula 12 — Vigência, renovação e rescisão

**12.1.** A vigência é a do Quadro resumo. Sendo por prazo indeterminado, o contrato permanece
válido até que uma das partes o encerre na forma desta cláusula.

**12.2.** Qualquer das partes pode rescindir imotivadamente, mediante aviso por escrito com ⟪30⟫
dias de antecedência.

**12.3.** A CONTRATADA pode rescindir de pleno direito se a inadimplência ultrapassar ⟪60⟫ dias do
vencimento, ou em caso de violação das Cláusulas 7.4, 8.1 ou 10.

**12.4.** A rescisão não dispensa o pagamento dos valores relativos ao período efetivamente
utilizado.

**12.5.** Encerrado o contrato, aplicam-se as Cláusulas 8.4 e 9.7.

### Cláusula 13 — Disposições gerais

**13.1.** Alterações só valem por aditivo escrito.

**13.2.** A tolerância quanto ao descumprimento de qualquer cláusula não implica novação nem
renúncia.

**13.3.** A nulidade de uma cláusula não contamina as demais.

**13.4.** As partes elegem o foro da comarca de «foro», com renúncia a qualquer outro.

### Seção III — Assinaturas

Local e data: «cidade do foro», «data».

```
_______________________________        _______________________________
CONTRATADA                             CONTRATANTE
«razão social da contratada»           «razão social do tenant»
«representante»                        «responsável» — CPF «cpf»

Testemunhas

_______________________________        _______________________________
Nome:                                  Nome:
CPF:                                   CPF:
```

---

## 5. Escopo negativo

| não faz | vai para |
|---|---|
| integração com plataforma de assinatura eletrônica (ZapSign, Autentique, Clicksign, D4Sign) | **fora** — ADR-055 §*Assinatura*; o volume não justifica. O que entra é o **upload do PDF assinado** |
| contrato do **aluno** com a academia | continua sendo a `Subscription` (CONVENTION §5) |
| editar cláusula de contrato já `ACTIVE` | nunca — contrato é imutável (ADR-052 §8). Termo novo = versão nova = contrato novo |
| editor de cláusulas no painel | **fora** — o texto é do produto, versionado em código. Um editor livre produziria 40 contratos diferentes e nenhum revisável |

---

## 6. Aceite

- O PDF gerado traz as três seções e qualifica **as duas partes**.
- Dois contratos fechados em versões diferentes dos termos geram PDFs com textos diferentes, cada um
  reproduzindo a versão gravada em `terms_version` — inclusive ao regerar meses depois.
- Contrato sem CNPJ, endereço ou representante da contratante **não pode ser ativado**: o painel
  recusa e diz qual campo falta. (Hoje imprime *"não informado"* e segue.)
- O upload do PDF assinado grava `signed_document_object_key`, `signed_at` e move
  `signature_status` para `SIGNED`, sem substituir o PDF gerado.
- A lista de contratos mostra quem está `PENDING` de assinatura.

---

## 7. Lacunas — dados e decisões que o PI ainda não passou

Nenhuma delas impede começar pelo §3 (colunas) e pelo §4 (texto). Todas impedem **fechar contrato
de verdade**.

| # | o que falta | quem responde |
|---|---|---|
| 1 | **Endereço completo e representante legal da RRB TRADING** (nome, CPF, cargo) | PI |
| 2 | **CNPJ e endereço da Arena Positiva** — hoje `null` no banco | PI / academia |
| 3 | Foro (comarca) padrão | PI |
| 4 | Canal e horário de suporte (Cláusula 6.2) | PI |
| 5 | Prazo de vencimento da fatura, multa e juros (4.3, 4.6) | PI |
| 6 | Aviso prévio de rescisão e prazo de rescisão por inadimplência (12.2, 12.3) | PI |
| 7 | Manter ou remover o teto de responsabilidade (11.3) e o uso de dado agregado (8.3) | PI |
| 8 | Revisão por advogado antes do primeiro uso real | PI |

---

## 8. Invariantes

1. **`terms_version` gravado no contrato manda no PDF.** Nada no gerador lê "a versão atual".
2. **Dois arquivos, nunca um.** PDF gerado e PDF assinado convivem.
3. **Dado da CONTRATADA vem de configuração**, não de literal no código.
4. **Contrato incompleto não ativa.** Campo obrigatório ausente barra a ativação, não vira
   *"não informado"* no papel.
5. Regras de arquitetura 2 e 6 do `CLAUDE.md` seguem valendo: `tenant_id` e dinheiro inteiro.
