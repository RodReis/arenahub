# Runbook — Diagnóstico

**Para quem:** recepção, gerente e operador técnico.
**Quando:** a catraca não está liberando, um aluno reclama, ou o painel mostra alerta.

> **Comece pelo painel, sempre.** Este runbook só manda usar terminal depois que o painel não
> respondeu à pergunta. O aceite da fatia é *"operar um turno sem acesso direto a banco,
> terminal ou logs brutos"* — se você está abrindo `psql` no passo 1, algo está errado com a
> ferramenta, não com você. **Registre isso**, é defeito a corrigir.

---

## 0. Antes de tudo: a pessoa está esperando?

Se há alguém parado na catraca **agora**, a primeira ação não é diagnosticar — é **liberar
manualmente**:

1. Painel → **Liberação manual**
2. Escolha a unidade, a catraca e o aluno
3. Escreva o motivo real (mínimo 10 caracteres — ele vai explicar a liberação numa auditoria
   daqui a seis meses)
4. Revise e confirme

A liberação **não altera o plano nem a assinatura** do aluno. Ela abre a catraca uma vez e fica
registrada com o seu nome. Se a pessoa voltar amanhã e o problema não tiver sido resolvido, a
catraca nega de novo — e é assim que tem de ser.

**Só depois** siga o diagnóstico.

---

## 1. A API está de pé?

**Sintoma:** o painel não carrega, ou mostra erro em toda tela.

```bash
pnpm smoke:smart-access -- --base-url http://localhost:3344
```

| Saída | Significado | Ação |
|---|---|---|
| `[OK] API pronta` | a API responde e alcança o banco | siga para §2 |
| `[FALHA] API pronta: /health/ready devolveu 503` | a API subiu, mas o banco ou o Redis não responde | verifique os contêineres: `pnpm docker:up` |
| `[FALHA] ... falha de rede` | a API não está rodando | suba o serviço |

**Pare aqui se falhou.** Nada abaixo funciona sem a API.

---

## 2. O painel mostra alerta?

Painel → **Operação**. A primeira linha responde à pergunta mais urgente:

> *"Nenhum problema crítico agora"* ou *"N problemas críticos impedindo acesso agora"*

Cada alerta traz **o que ele impede** e **o que fazer**. Siga a ação recomendada da linha — ela
é específica, e este runbook não a repete para não divergir dela.

**Reconhecer não resolve.** O botão *Reconhecer* diz "estou vendo, estou indo". A condição
continua sendo avaliada a cada 30 s; o alerta só sai do painel quando o problema acabar de
verdade.

---

## 3. Edge sem resposta (`EDGE_OFFLINE`)

**O que isso significa:** a catraca desta unidade **não está liberando acesso**. Sem operação
offline (ADR-012), Edge fora é catraca parada — não é modo degradado.

**Na academia, nesta ordem:**

1. O PC da recepção está ligado?
2. Ele está na rede? (o cabo pode ter sido esbarrado)
3. O serviço `ArenaHub Edge` está rodando?
   - `services.msc` → procure `ArenaHub Edge` → deve estar **Em execução**
   - Se estiver parado: clique com o botão direito → **Iniciar**
4. Depois de iniciar, volte ao painel. O Edge reaparece como *Respondendo* em até 30 s.

> ⚠️ **Este PC não se desliga.** É regra de implantação, não sugestão (ADR-011). Enquanto ele
> estiver fora, a recepção libera manualmente.

**Se o serviço não iniciar**, colete a versão e a última mensagem:

```bash
pnpm --filter @arenahub/edge-agent diagnostico
```

O diagnóstico é **somente leitura** — não envia comando a equipamento nenhum.

---

## 4. Dispositivo sem resposta (`DEVICE_OFFLINE`)

**Leitor facial fora:** ninguém é reconhecido. Use o caminho alternativo de acesso.
**Catraca fora:** ninguém passa, mesmo reconhecido. Libere manualmente e chame manutenção.

1. Energia do equipamento
2. Cabo de rede
3. O equipamento aparece no painel → **Dispositivos** com estado *Em manutenção*? Então alguém
   já o marcou assim de propósito, e ele **não** gera alerta.

---

## 5. Sincronização falhando (`SYNC_FAILED`, `DLQ_NON_EMPTY`)

**O que isso significa:** há alunos cuja biometria **não chegou aos leitores**. Eles vão ser
recusados na catraca mesmo tendo plano válido — e vão reclamar sem entender.

1. Painel → **Operação** → seção *Sincronização de biometria*
2. `Falhadas > 0` ou `dead letters > 0`: abra a fila de sincronização
3. Cada item traz o código do erro. Os comuns:

| Código | Causa | Ação |
|---|---|---|
| dispositivo sem resposta | o leitor está fora | resolva §4 primeiro; a fila retenta sozinha |
| imagem recusada pelo equipamento | foto fora do padrão do leitor | recadastre a biometria do aluno |
| esgotou as tentativas | falha persistente | decida no painel: reprocessar ou descartar |

> **Dead letter não se resolve com o tempo.** Enquanto ficar lá, aquele aluno continua sendo
> recusado. Alguém precisa decidir.

---

## 6. Relógio fora de sincronia (`CLOCK_DRIFT`)

**O que isso NÃO significa:** os acessos continuam corretos. A decisão usa o relógio do
**servidor**, nunca o do equipamento — uma catraca adiantada não estende a validade de um plano.

**O que isso significa:** a investigação de incidentes fica mais difícil, porque os dois relógios
não batem.

**Ação:** sincronize o relógio do PC da academia com um servidor NTP. No Windows:
`Configurações → Hora e idioma → Sincronizar agora`.

---

## 7. Credencial vencendo (`EDGE_CREDENTIAL_EXPIRING`)

**Este alerta é diferente de `EDGE_OFFLINE`, e a diferença importa:** o Edge está **vivo**, mas
a nuvem vai parar de aceitar as decisões dele.

**Não vá até a academia.** É problema de quem opera a nuvem:

1. Painel → **Dispositivos**
2. Localize o Edge
3. Rotacione a credencial

Se o alerta disser *"não tem credencial ativa"*, emita uma nova — não há o que rotacionar.

---

## 8. Um aluno específico não entra

**Não é problema de infraestrutura.** Vá direto à investigação:

1. Painel → **Eventos de acesso**
2. Filtre por *Resultado: Negado* e localize a tentativa
3. A coluna **Motivo** responde:

| Motivo na tela | O que fazer |
|---|---|
| Sem plano vigente | o aluno não tem direito ativo — verifique a assinatura |
| O plano vale em outra unidade | ele está na porta errada, ou o plano precisa ser ampliado |
| Fora do horário do plano | o plano dele não cobre este horário |
| Aluno bloqueado | decisão administrativa — veja com o gerente |
| Cadastro não está ativo | o cadastro está suspenso, cancelado ou arquivado |
| Bloqueio administrativo | alguém bloqueou este aluno; o motivo está no registro |
| não identificado | o leitor viu alguém que a base não conhece — biometria não cadastrada, ou cadastro de fábrica sobrando no equipamento |

> As três primeiras são **comerciais**, não técnicas. Encaminhe à recepção, não ao suporte.

---

## 9. Quando escalar

Escale para o suporte técnico quando:

- a API não sobe depois de reiniciar o serviço;
- o Edge não inicia e o diagnóstico não explica;
- há dead letter que reprocessar não resolve;
- o painel mostra estado que este runbook não cobre.

**Leve junto:** o que o painel mostrava, o horário, e a saída do smoke. Sem isso, a primeira
pergunta do suporte vai ser exatamente essa.

---

## O que este runbook deliberadamente não manda fazer

- **Abrir o banco.** Se a resposta só existe em `psql`, é defeito da ferramenta — registre.
- **Ler log bruto.** O painel e o diagnóstico devem bastar para o turno.
- **Reiniciar "para ver se resolve"** sem antes olhar o alerta. O alerta já diz o que é.
