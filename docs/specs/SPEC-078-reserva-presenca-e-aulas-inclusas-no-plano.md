# SPEC-078 — Reserva, presença/no-show e "aulas inclusas" no plano

| campo | valor |
|---|---|
| **Fatia** | F78 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce do [ADR-061](../DECISIONS.md#adr-061), que detalha o [ADR-060](../DECISIONS.md#adr-060) — auditoria de cobertura, issue #339 |
| **Superfície** | `apps/api` (reserva, presença, campo em `Plan`) e `apps/admin-web`. O app do aluno **não** entra |
| **Card** | [#368](https://github.com/RodReis/arenahub/issues/368) |
| **Status** | `aprovada-pi` — decisões tomadas em 18/09/2026, ver §2 |
| **Depende de** | **F77** (a grade precisa existir antes de alguém reservar) |

---

## 1. O que esta fatia entrega

Fecha "aulas inclusas", o último dos dois itens da Especificação §34 que o
[ADR-059](../DECISIONS.md#adr-059) confirmou no MVP 1 (o outro, convidados, saiu na F76). A
recepção passa a marcar aluno em aula, registrar quem veio e quem faltou, e `Plan` passa a dizer
**quais aulas o plano autoriza reservar**.

---

## 2. Decisões do PI — 18/09/2026 ([ADR-061](../DECISIONS.md#adr-061))

| # | decisão | consequência nesta fatia |
|---|---|---|
| 2 | Reserva **não** controla a catraca | nenhuma tabela desta fatia entra no motor de decisão de acesso |
| 3 | Cancelamento e no-show **só registram** | sem consumo de aula, sem bloqueio, sem penalidade automática |
| 6 | Só a recepção marca, pelo painel | nada no app do aluno; o aluno não cancela sozinho |
| 7 | Aula lotada recusa, sem lista de espera | a recusa é por capacidade cheia, e acaba aí |
| 8 | Plano que não inclui a aula: recusa, **com liberação manual da recepção registrada** | quem liberou e quando ficam gravados |

**Derivado das decisões acima, não inventado aqui:** "aulas inclusas" é **qualitativo** — o campo
em `Plan` diz *quais* aulas ou modalidades o plano autoriza, não *quantas*. E a **única** força que
essa regra ganha no sistema inteiro é a recusa da reserva: a catraca não a consulta (nº 2) e a
falta não a consome (nº 3).

---

## 3. Escopo

- **Reserva** do aluno numa ocorrência de aula, feita pela recepção no painel, com as duas recusas:
  capacidade cheia e aula fora do plano.
- **Liberação manual** da recusa por plano: a recepção libera, e fica gravado **quem liberou e
  quando**. Aula experimental, cortesia e negociação de balcão passam por aqui — é o que evita que
  a regra nova trave o balcão no primeiro dia.
- **Presença e falta**: a recepção marca quem veio; quem tinha reserva e não foi marcado fica
  registrado como falta. Nada acontece com o aluno por isso — o registro existe para o relatório e
  para alimentar o risco de churn do MVP 6.
- **Cancelamento** da reserva pela recepção, registrado e distinto da falta.
- **Campo em `Plan`** com as aulas/modalidades incluídas. O nome e o tipo do campo são decisão do
  Code; o **comportamento** é o desta spec.
- Plano **sem nada preenchido** no campo autoriza tudo — nenhum plano em produção hoje tem o campo,
  e nascer restritivo recusaria reserva para a base inteira no dia do deploy. Mesma regra do
  `DEFAULT true` da F69.
- `tenant_id` em toda tabela nova (regra de arquitetura nº 2).

### 3.1 Em aberto — não decidido aqui; o Code pergunta ao PI antes de implementar

- **Teto de reservas simultâneas por aluno.** Sem limite quantitativo e sem penalidade, um aluno
  pode reservar a semana inteira e não aparecer. Não foi decidido — e **não** é o Code que decide.
- **Janela de cancelamento** (até quanto antes da aula a recepção pode cancelar sem virar falta),
  se é que existe.
- **O campo em `Plan` aponta para modalidade ou para a grade específica?** Modalidade é mais grossa
  e mais barata; grade específica é o que o ADR-060 escolheu ao pé da letra. Pergunta ao PI.

---

## 4. Escopo negativo — o que esta fatia NÃO faz

- **Não** muda o motor de decisão de acesso, em nenhum caminho. Regra de arquitetura nº 1 sem
  exceção: PR desta fatia que faça a catraca consultar reserva é recusada na revisão.
- **Não** penaliza no-show: sem consumo de aula, sem bloqueio de reserva futura, sem multa.
- **Não** cria lista de espera nem notificação (depende do card #345, ainda aberto).
- **Não** cobra aula avulsa.
- **Não** entra no app do aluno nem no totem.

---

## 5. Aceite operacional

Com a grade da F77 cadastrada: a recepção marca um aluno numa aula do plano dele; tenta marcar um
aluno cujo plano não inclui aquela aula e **é recusada**; libera manualmente, e a liberação aparece
com o nome de quem liberou; enche a aula até a capacidade e a próxima reserva **é recusada**; marca
presença de uns, deixa outro sem marcar, e a falta aparece no registro **sem nenhum efeito sobre o
aluno**. Um aluno com reserva e um sem reserva passam na catraca exatamente igual — provado por
teste, porque é a decisão nº 2 escrita em código.

---

## 6. Risco registrado, aceito pelo PI

Reservar não custa nada e faltar não custa nada ([ADR-061](../DECISIONS.md#adr-061), §"Risco
aceito"). O resultado conhecido é vaga esgotada na tela com sala vazia. O PI preferiu medir antes
de punir — e o registro de falta que esta fatia entrega **é** o instrumento de medida. Reabrir a
decisão nº 3 depende desse dado, não de opinião.
