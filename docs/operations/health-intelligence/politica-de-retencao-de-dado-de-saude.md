# Política de retenção e correção de dado de saúde — RASCUNHO

> 🔴 **RASCUNHO.** Precisa de decisão do PI nos prazos e de revisão jurídica. Escrito pelo Cowork
> para dar ao advogado uma minuta que reflete o que o sistema realmente faz.
>
> **Bloqueia:** F17 · **Origem:** `MVP-03` §5 e §15, [ADR-035](../../DECISIONS.md#adr-035),
> [ADR-036](../../DECISIONS.md#adr-036), [ADR-037](../../DECISIONS.md#adr-037) ·
> **Espelha** a decisão 7 do [ADR-008](../../DECISIONS.md) (biometria: expurgo em 30 dias)

---

## 1. O princípio, e por que ele não é o de sempre

Retenção de dado de saúde tem uma tensão que retenção de biometria não tem.

Biometria é **substituível**: apagar e recadastrar custa dois minutos na recepção. Por isso o
ADR-008 pôde escolher 30 dias sem dó.

**Histórico corporal é insubstituível.** Uma série de dois anos apagada não volta — nem
recadastrando, nem pedindo ao aluno. E o valor do dado **cresce** com o tempo: a comparação de
hoje contra a primeira medição é justamente o que a Slice 3.2 entrega.

**A regra que sai disso:** o que identifica a pessoa vai embora rápido; a série pode durar mais
tempo, se for do interesse do titular e ele puder desligá-la a qualquer momento. Guardar dado de
saúde de quem saiu há três anos, "por precaução", não é precaução — é passivo.

## 2. Prazos por artefato

**Todos os `[N]` são decisão do PI.** As colunas *sugerido* trazem uma proposta com o motivo ao
lado, para o PI concordar ou mudar — não são padrão consagrado.

| artefato | sugerido | contagem a partir de | por quê |
|---|---|---|---|
| **Arquivo original do laudo** (PNG, PDF da balança) | **[12] meses** | upload | Depois que os campos foram conferidos e publicados, o arquivo serve só para auditar a extração. É o item mais pesado e o mais identificável — traz nome e data impressos na imagem |
| **Temporários de OCR** (recortes, buffers, saídas intermediárias) | **[24] horas** | fim da extração | `MVP-03` §15 já exige *"retenção curta e deleção verificável"*. Aqui não há trade-off: é lixo com dado sensível dentro |
| **Avaliação publicada** (números, sem arquivo) | **[24] meses** após o fim do vínculo | encerramento da matrícula | É a série que dá valor ao produto. Ex-aluno que volta em um ano encontra o histórico; quem sumiu há três anos não vira acervo |
| **Snapshot enviado à IA e a análise devolvida** | **[6] meses** | geração | Serve para auditar o que o modelo recebeu e respondeu — reproduzir uma análise contestada. Passado isso, o prompt e o modelo provavelmente já mudaram e a reprodução deixa de valer |
| **ECG e demais laudos de aparelho do aluno** | **[6] meses** | upload | Prazo **mais curto que o dos outros arquivos**, de propósito: é o dado com maior potencial de dano e o menor uso legítimo dentro do produto — o ArenaHub não o interpreta (ADR-035). Quem precisa guardar ECG é o médico |
| **Registro de encaminhamento** (que houve, data, responsável) | acompanha a avaliação | — | **Sobrevive à exclusão do ECG.** É a prova de que a academia agiu, e não contém dado clínico |
| **Contexto de saúde** (`student_health_context`) | acompanha a avaliação | — | Sem ele a série antiga fica ilegível: não se sabe mais por que aquele alerta foi suprimido |
| **Consentimento** (aceite e revogação) | **[5] anos** após revogação ou fim do vínculo | evento | Sobrevive ao dado que autorizou, e tem que sobreviver: é a prova de que o tratamento era lícito enquanto durou. Apagar o consentimento junto com o dado destrói a defesa |
| **Log de acesso** (quem viu qual ficha, quando) | **[5] anos** | acesso | Mesma lógica. Foi uma das três causas da suspensão da ANPD no caso do PR (ADR-008) |

## 3. Revogação do consentimento

Espelha a decisão 3 do ADR-008 — bloqueio lógico imediato, exclusão física depois.

1. **Na hora:** as avaliações somem do app, do totem e do painel. Nenhuma nova análise é gerada.
   Nenhum dado novo é coletado.
2. **Em até [30] dias:** eliminação física dos arquivos originais, dos snapshots de IA e das
   análises.
3. **Sobrevivem:** o registro do consentimento e da revogação, os logs de acesso, e o registro de
   que houve encaminhamento — os três sem dado clínico.
4. **Os números da série:** o PI decide entre **eliminar junto** ou **anonimizar** (desvincular do
   aluno, mantendo para estatística agregada). ⚠️ **Anonimização de série temporal individual é
   frágil** — data de nascimento mais sequência de medições reidentifica com facilidade. Se o
   caminho for anonimizar, precisa de limiar mínimo de agregação, como o `MVP-03` §15 já exige
   para agregados executivos.

**Revogar o B (análise por IA) não afeta o A.** As análises já geradas são eliminadas; avaliação e
histórico continuam.

## 4. Correção — e por que ela não apaga nada

O `MVP-03` já fixa: avaliação publicada é **imutável**, e correção é **nova revisão vinculada** à
anterior.

**Isso não é conflito com o direito de retificação (art. 18, III).** O titular tem direito a que o
dado **correto** seja o exibido e o usado — e é o que acontece: a revisão nova passa a valer em
toda tela, gráfico e análise. A versão anterior deixa de ser exibida ao aluno e permanece na
trilha de auditoria.

**Por que a trilha fica:** se um valor errado gerou uma análise, uma meta ou um encaminhamento,
apagar o valor torna impossível explicar depois por que aquilo aconteceu. A cadeia importa mais
que a linha.

**Exceção:** dado inserido na **ficha errada** — avaliação de um aluno lançada no cadastro de
outro. Aí não é correção, é vazamento entre titulares, e a eliminação é imediata e completa da
ficha invadida, com registro do incidente. **Isso precisa existir como caminho de operação na
F17**, não como intervenção no banco.

## 5. Fim do vínculo

- **Encerramento da matrícula** dispara o relógio da avaliação publicada (item 3 da tabela).
- **[60] dias antes** do fim do prazo, o aluno recebe aviso com opção de **exportar** o histórico
  (`MVP-03` §6 já prevê exportação) ou pedir manutenção se voltar a treinar.
- Prazo cumprido, a eliminação é **automática e auditável** — job, não tarefa de alguém lembrar.
- **O prazo é parâmetro do cliente, com padrão seguro** — mesma mitigação de papel do ADR-008
  decisão 10: quem define retenção se parece com controlador, e a academia é a controladora.

## 6. O que precisa existir em código para isto ser verdade

Política que não tem job é prosa. Da F17 em diante:

- job de expurgo por artefato, com **evidência auditável** do que apagou e quando — mesmo padrão
  do expurgo de biometria da F8;
- **deleção verificável** no object storage: apagar e **confirmar que sumiu**, não confiar no
  retorno da API;
- teste que prova que revogação **bloqueia a exibição na hora**, independente do expurgo físico;
- teste que prova que consentimento, log de acesso e registro de encaminhamento **sobrevivem** ao
  expurgo do dado clínico;
- `M3-NFR-008` já exige *"exclusão e exportação respeitam política LGPD testada"* — esta política
  é o que aquele NFR passa a testar.

## 7. Decisões pendentes do PI

- [ ] os nove `[N]` da §2;
- [ ] série temporal na revogação: **eliminar** ou **anonimizar** (§3.4);
- [ ] `[30]` dias para eliminação física após revogação — alinhar ou não com os 30 da biometria;
- [ ] `[60]` dias de aviso prévio antes do expurgo por fim de vínculo;
- [ ] revisão jurídica do conjunto.
