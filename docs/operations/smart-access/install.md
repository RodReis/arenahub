# Runbook — Instalação do Edge na academia

**Para quem:** operador técnico, com acesso administrativo ao PC da recepção.
**Duração:** ~30 min, fora o tempo de rede.

> ⚠️ **Este runbook ainda não foi ensaiado em academia real.** Ele foi escrito a partir do
> ADR-011 e do que a bancada mostrou, e a Task 6 do plano de F11 exige que **outra pessoa que
> não o autor** o execute e anote as lacunas. Enquanto isso não acontecer, trate cada passo como
> hipótese — ver §7.

---

## 1. Antes de ir

- [ ] Unidade cadastrada no painel, com **timezone correto** (ele decide a janela de horário)
- [ ] Código de pareamento gerado no painel (uso único, TTL curto — ADR-011)
- [ ] Modelo do leitor e da catraca confirmados na lista de hardware homologado
- [ ] Alguém da academia disponível para testar a passagem

> **Não leve segredo no instalador.** O pacote é inerte e pode circular por e-mail; a identidade
> nasce do pareamento, na máquina (ADR-011).

---

## 2. O PC da recepção

O `edge-agent` roda **no PC compartilhado da recepção** — decisão do PI, sem hardware dedicado no
piloto. A consequência está escrita no ADR-011 e precisa ser dita à academia em voz alta:

> **A disponibilidade da catraca é o uptime deste PC.** Se alguém desligar a máquina, a catraca
> não decide nada. Não é modo degradado — é catraca parada.

**Requisitos:**

- Windows com usuário administrador
- Rede alcançando a nuvem (HTTPS de saída) **e** os equipamentos na LAN
- Energia estável — de preferência no nobreak

**Cole um aviso físico na máquina:** *"Este computador não se desliga. Ele controla a catraca."*

---

## 3. Instalação

1. Execute o instalador como administrador
2. Informe o **código de pareamento** quando pedido
3. O agente troca o código por um segredo próprio, guardado pelo **DPAPI/Credential Manager** do
   Windows — nunca em arquivo de texto
4. O código morre no primeiro uso; se precisar reinstalar, gere outro

**Serviço Windows:**

- Nome: `ArenaHub Edge`
- Início: **automático**
- Recuperação: **reiniciar o serviço** em caso de falha (1ª, 2ª e falhas seguintes)

```
services.msc → ArenaHub Edge → Propriedades → Recuperação
```

---

## 4. Conferência

```bash
pnpm smoke:smart-access -- --base-url https://SUA-API --cookie "arenahub_access=..."
```

Espera-se `[OK]` em todas as linhas. Depois, no painel → **Operação**:

- [ ] O Edge aparece como **Respondendo**
- [ ] Os dispositivos aparecem como **Respondendo**
- [ ] Nenhum alerta crítico aberto

---

## 5. Teste de passagem assistido

Com alguém da academia, e **com a recepção pronta para liberar manualmente**:

1. Um aluno com plano válido se apresenta ao leitor
2. Confirme no painel → **Eventos de acesso**: o evento aparece com *Liberado* e *Plano válido*
3. Um aluno sem plano se apresenta
4. Confirme: *Negado*, com o motivo correto, e **a catraca não girou**

> O segundo teste importa mais que o primeiro. Uma catraca que libera todo mundo passa no teste
> feliz.

---

## 6. Firewall

O agente precisa de:

- **saída HTTPS** para a nuvem
- **acesso na LAN** aos IPs dos equipamentos

Ele **não precisa** de porta de entrada aberta da internet. Se alguém propuser abrir, recuse — o
Edge sempre inicia a conexão.

---

## 7. O que ainda não foi ensaiado

| item | estado |
|---|---|
| Instalação em academia real | ⬜ **pendente** |
| Execução por pessoa diferente do autor (exigência da Task 6) | ⬜ **pendente** |
| Tempo real do procedimento | ⬜ não medido |
| Comportamento com rede instável durante o pareamento | ⬜ não testado |

**Quem executar pela primeira vez: anote o que divergiu e corrija este arquivo.** Runbook que
ninguém rodou é hipótese escrita com confiança.
