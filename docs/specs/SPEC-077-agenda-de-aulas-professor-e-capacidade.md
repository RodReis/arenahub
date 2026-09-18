# SPEC-077 — Agenda de aulas: grade recorrente, professor e capacidade

| campo | valor |
|---|---|
| **Fatia** | F77 |
| **MVP** | 1 *(posição na fila)* — decisão do PI, não Slice de PRD |
| **Slice do PRD** | não há. Nasce do [ADR-061](../DECISIONS.md#adr-061), que detalha o [ADR-060](../DECISIONS.md#adr-060) — auditoria de cobertura, issue #339 |
| **Superfície** | `apps/api` (entidades novas) e `apps/admin-web` (grade e cadastro). O app do aluno **não** entra |
| **Card** | [#367](https://github.com/RodReis/arenahub/issues/367) |
| **Status** | `aprovada-pi` — decisões tomadas em 18/09/2026, ver §2 |
| **Depende de** | `GymUnitModality` (F60) e `Student.profile = TRAINER`, ambos já em produção |

---

## 1. O que esta fatia entrega

O ArenaHub passa a saber **que aulas existem, quando, com quem e para quantos**. Hoje o Complexo
Arena Positiva opera cross fit, box e quadras de areia com horário, professor e turma — tudo fora
do sistema, em planilha e WhatsApp. Esta fatia traz essa grade para dentro, e só isso: ninguém
reserva nada ainda. Reserva, presença e o vínculo com o plano são a F78.

O corte é deliberado. A F77 sozinha já substitui a planilha da recepção, e um erro de desenho na
grade aparece antes de haver reserva gravada em cima dele.

---

## 2. Decisões do PI — 18/09/2026 ([ADR-061](../DECISIONS.md#adr-061))

| # | decisão | consequência nesta fatia |
|---|---|---|
| 1 | A agenda é módulo operacional próprio, não acessório de "aulas inclusas" | a grade precisa servir à recepção mesmo sem nenhum plano com aula inclusa |
| 5 | Professor é `Student` com `profile = TRAINER` | nenhuma entidade de pessoa nova; o professor já passa na catraca por vínculo |
| 7 | Aula lotada recusa, sem lista de espera | a capacidade é um número na aula, e a recusa mora na F78 |
| — | derivado, não inventado: a aula é de **uma unidade** e de **uma modalidade** | `GymUnitModality` é por unidade (F60), e não há outro lugar natural |

---

## 3. Escopo

- **Grade recorrente** por unidade: dia da semana, horário de início, duração, modalidade,
  professor e capacidade.
- **Exceção de calendário** sobre a grade: cancelar uma ocorrência (feriado, professor doente) e
  **trocar o professor de um dia específico**, sem desfazer a grade. Este é o comportamento
  exigido; **o modelo de dados que o entrega é decisão do Code** (`CLAUDE.md`, *O que pode
  bloquear o desenvolvimento*) — grade + ocorrências materializadas é o desenho óbvio, não uma
  imposição desta spec.
- **Tela no painel**: cadastro da grade e visão da semana por unidade, com professor e capacidade
  visíveis. Layout e componentes seguem `docs/design/DS-PAINEL.md`.
- **Inativar, nunca apagar** — mesma regra de `GymUnitModality`: aula cancelada some do que se pode
  reservar e permanece no histórico. A F78 vai gravar reserva apontando para aqui.
- `tenant_id` em toda tabela nova (regra de arquitetura nº 2) — a guarda de catálogo deixada pela
  F67 recusa tabela nova sem a coluna, pelo nome.

### 3.1 Em aberto — não decidido aqui; o Code pergunta ao PI antes de implementar

- **Professor obrigatório na aula, ou a aula pode existir sem professor definido?** Quadra de areia
  alugada sem professor é caso real no complexo, e a resposta muda a nulidade da coluna.
- **Uma aula tem um professor ou vários?** Aula com dois professores existe em box; não foi
  perguntado.
- **A grade tem validade (início/fim de temporada) ou vale até ser inativada?**

---

## 4. Escopo negativo — o que esta fatia NÃO faz

- **Não** cria reserva, presença, falta nem lista de espera — tudo F78.
- **Não** toca no motor de decisão de acesso. A catraca não sabe que aula existe
  ([ADR-061](../DECISIONS.md#adr-061), decisão nº 2), e nenhuma PR desta fatia pode mudar isso.
- **Não** toca em `Plan`. O campo "aulas inclusas" é da F78.
- **Não** entra no app do aluno (decisão nº 6) nem no totem.
- **Não** cobra nada — aula avulsa paga segue `[indefinido]`.

---

## 5. Aceite operacional

A recepção cadastra a grade de uma semana real da Arena Positiva (cross fit, box e quadra), vê a
semana na tela com professor e capacidade, cancela **uma** ocorrência por feriado sem perder a
grade, e troca o professor de **um** dia sem alterar os outros. A catraca continua decidindo
exatamente como decidia antes — provado por teste que a fatia não alterou nenhum caminho do motor
de acesso.
