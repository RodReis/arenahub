# Relatório da POC Topdata — MVP 0 (Slice 0.5 / F5)

**Status: PARCIAL — F3 física coletada em 17/08/2026; ciclo facial (F2) e latência ponta a ponta seguem `PENDENTE-POC`.** · **Data:** 15/08/2026, atualizado 17/08/2026 · **Fatia:** F5 · **Spec:** SPEC-005

> **O que este relatório é.** O entregável da Slice 0.5 (`MVP-00` §6): matriz de compatibilidade,
> limitações por equipamento, runbook e recomendação de gate (`GO`/`GO_WITH_CONSTRAINTS`/`NO_GO`).
>
> **O que ainda não é.** As **medições de latência real** (`M0-AC-008`, `M0-NFR-001`) exigem
> rodar `pnpm --filter edge-agent lab:run` contra a catraca real, o que **ainda não aconteceu** —
> a POC física está bloqueada pelos gates de entrada (§5). Toda célula que depende disso está
> marcada **`PENDENTE-POC`**. O relatório completa a parte que **não** depende de hardware e fica
> pronto para receber os números quando a janela física acontecer.
>
> **Fontes:** inventário e protocolos verificados em campo
> ([`docs/field-notes/2026-08-15-hardware-arena-positiva.md`](../field-notes/2026-08-15-hardware-arena-positiva.md)),
> manuais Topdata ([`docs/vendor/topdata/`](../vendor/topdata/)), e o código do `edge-agent`
> (`application/relatorio-operacional.ts`, `LIMITACOES_CONHECIDAS`).

---

## 1. Sumário executivo

O ciclo técnico **cadastrar → reconhecer → decidir → liberar → registrar → reconciliar** está
**implementado e verde em simulador** nas quatro fatias técnicas (F1–F4). O que falta para a
decisão de saída é **evidência física**: latência real e comportamento das falhas obrigatórias na
catraca e no leitor reais, que só a execução de `lab:run` produz.

**Recomendação de gate: `GO_WITH_CONSTRAINTS`** — condicional à execução da POC física numa
janela combinada, sob as restrições da §6. Não é `GO` porque a evidência física não existe; não é
`NO_GO` porque nenhum bloqueio estrutural foi encontrado — ao contrário, o campo **confirmou** a
viabilidade dos dois canais SDK (facial WebSocket ativo no legado; catraca apontando para o canal
EasyInner).

## 2. Matriz de compatibilidade

Colunas de identidade/protocolo: **verificadas** (campo + manuais). Colunas de
capacidade/latência medida: **`PENDENTE-POC`**.

| equipamento | modelo | série | firmware | protocolo | transporte | roda em Node? | latência p95 |
|---|---|---|---|---|---|---|---|
| Catraca | Topdata Inner (Catraca Fit) | `247000797` | `7.05.00` (PCI `v3.1`) | EasyInner.dll (binário proprietário) | TCP **3570** | **não** — bridge Windows x86/.NET | `PENDENTE-POC` |
| Leitor facial | AiFace (OEM, rebrand Topdata) | `AYTI11108174` | ver `getlang`/`reg` | WebSocket JSON `/pub/chat` | TCP **7792** | **sim** | `PENDENTE-POC` |

Notas de campo que a matriz carrega:
- a catraca aponta para o servidor SDK `192.168.2.106:3570` (config lida no painel);
- o leitor facial disca para um servidor WebSocket — confirmado ao vivo no `.106`
  (`websocket-sharp/1.0`, `HTTP 101 Switching Protocols`);
- IP do Inner é **DHCP** — identificar por série, não por IP.

## 3. Percentis de latência por etapa — `PENDENTE-POC`

`M0-NFR-001` pede p50, p95 e máximo entre reconhecimento e comando de liberação; `M0-NFR-002`
fixa o objetivo em **p95 < 300 ms** (o código sinaliza via `OBJETIVO_P95_MS`, não reprova
automaticamente).

| etapa | p50 | p95 | máx | n |
|---|---|---|---|---|
| reconhecimento → decisão | `PENDENTE-POC` | `PENDENTE-POC` | `PENDENTE-POC` | — |
| decisão → comando de liberação | `PENDENTE-POC` | `PENDENTE-POC` | `PENDENTE-POC` | — |
| **comando `liberar` → retorno da DLL** (latência de máquina) | ~74 ms | — | — | 30 |
| comando → confirmação de giro (`origem:6`) — **inclui tempo humano** | 1784 ms | 3552 ms | 3552 ms | 28 |

> A infraestrutura de medição existe: `montarRelatorio()` calcula p50/p95/máx e taxa de erro a
> partir das latências coletadas. As duas primeiras linhas seguem `PENDENTE-POC` porque exigem o
> **ciclo facial** (F2) ligado — o `lab:run` que instancia os adapters ponta a ponta ainda não
> existe (fatia nova, ver §9).
>
> ⚠️ **As duas latências coletadas em 17/08 medem coisas diferentes.** O `liberar → retorno da
> DLL` (~74 ms) é a latência **de máquina** — bem abaixo do objetivo de 300 ms do `M0-NFR-002`.
> Já `comando → confirmação de giro` (p95 3552 ms) é dominado pelo **tempo humano** de girar o
> braço da catraca à mão, porque não há passagem automática na bancada; **não** é o número do
> `M0-NFR-001` (que exige rosto → decisão → giro, ainda não medível). Registrar o segundo como se
> fosse ponta a ponta seria o número inventado que a guarda de evidência existe para barrar.

## 4. Limitações conhecidas por equipamento — `M0-AC-008`

Estas **não dependem de medição** — vêm da documentação do fabricante e do campo. Espelham
`LIMITACOES_CONHECIDAS` no código (`application/relatorio-operacional.ts`), com fonte citada.

| equipamento | limitação | fonte |
|---|---|---|
| catraca | `EasyInner.dll` é Windows x86, protocolo binário proprietário; exige processo Windows dedicado (ponte). Reimplementar exige NDA. | Manual SDK Inner Acesso Rev. 00, §1.2/§6.7 |
| catraca | nenhuma função de liberação aceita id de comando: chamar duas vezes libera duas vezes. Idempotência é do integrador. | Manual SDK Inner Acesso §4.5 |
| catraca | a DLL é bloqueante e não thread-safe; uma única thread de comunicação, ~30 equipamentos por instância. | Manual SDK Inner Acesso §2.1/§1.1 |
| facial | `enrollid` numérico, máx 12 dígitos, e o leitor precisa estar em **18 dígitos** no menu para aceitá-los. | Manual SDK Leitor Facial Rev. 05, §5.4 |
| facial | protocolo sem id de correlação: resposta só traz `ret` com o nome do comando → um comando de cada tipo por vez. | Manual de Comandos do Leitor Facial Rev. 03, §2 |
| **facial (campo)** | **webserver de admin (porta 80) com senha de fábrica trocada** — config de 18 dígitos e flags `use_logphoto`/`stranger_photo` inacessíveis sem a credencial. | field-note 15/08/2026, §5 |
| **ambiente (campo)** | **rede não isolada** — catraca, facial e edge-agent legado `.106` no mesmo `/24` de produção, com o legado operando. | field-note 15/08/2026, §2.3 |

## 5. Estado das falhas obrigatórias de laboratório — `MVP-00` §11

Cada falha exige resultado esperado, código de erro, telemetria e recuperação. Onde há cobertura
por teste de simulador, marca-se ✅ (simulado); a validação **física** é `PENDENTE-POC`.

| falha | simulador | física |
|---|---|---|
| leitor indisponível na inicialização | ✅ `health-check` | `PENDENTE-POC` |
| catraca desconectada durante comando | ✅ adapter/orquestração | `PENDENTE-POC` |
| reconhecimento duplicado | ✅ `orquestrar-passagem` (prevenção de dupla liberação) | ✅ **17/08: 30 comandos → 0 duplas** (§9) |
| usuário inexistente | ✅ | `PENDENTE-POC` |
| `enrollid` já utilizado | ✅ `external-enroll-id` | `PENDENTE-POC` |
| timeout sem giro | ✅ | ✅ **17/08: `origem:5` capturado** (liberou, ninguém passou) (§9) |
| queda do coletor cloud | ✅ `reconciliar`/`coletor-simulado` | n/a (simulável) |
| queda da rede local | ✅ fila SQLite | `PENDENTE-POC` |
| reinício abrupto com fila pendente | ✅ `fila-de-eventos` (`synchronous=FULL`) | `PENDENTE-POC` |
| relógio local divergente | ✅ `occurredAt`/`receivedAt` | `PENDENTE-POC` |
| evento malformado do dispositivo | ✅ validação no boundary | `PENDENTE-POC` |
| retorno da rede com backlog | ✅ `reconciliar` (idempotente) | `PENDENTE-POC` |

## 6. Restrições incorporadas ao MVP 1 (o "with constraints")

1. **A bancada é a unidade em produção**, não um laboratório — a POC exige janela combinada com o
   legado desligado, ou rede isolada montada.
2. **Coexistência com o edge-agent legado** (`.106`) — decisão de substituição ou convivência,
   para não ter dois cérebros na mesma catraca.
3. **Ponte Windows para a catraca** — a DLL exige processo Windows x86/.NET; a forma da ponte é
   decisão do PI (ADR-010).
4. **Idempotência de liberação é inteiramente do integrador** — a DLL não oferece; já coberto no
   `orquestrar-passagem`, mas é restrição permanente a carregar para o MVP 1.
5. **Credencial de admin dos equipamentos** — necessária para config local (18 dígitos, flags de
   foto).
6. **IP do Inner é DHCP** — reserva/IP fixo no piloto.

## 7. Pré-condições do PI para rodar a POC física (nenhuma é código)

- [ ] consentimento dos participantes (regra de arquitetura nº 7 / ADR-008 / gate §4);
- [ ] rede isolada **ou** janela combinada com o legado `.106` desligado;
- [ ] procedimento de parada de emergência da catraca definido (gate §4);
- [ ] forma da ponte Windows decidida (ADR-010);
- [ ] credencial de admin dos dois equipamentos, ou reset físico assumido.

## 8. Recomendação de decisão de saída (`MVP-00` §15)

**`GO_WITH_CONSTRAINTS`**, condicional a:

1. execução de `pnpm --filter edge-agent lab:run` na janela combinada, coletando `M0-AC-001..008`;
2. preenchimento das células `PENDENTE-POC` deste relatório com os números reais;
3. as restrições da §6 propagadas ao MVP 1;
4. **assinatura do responsável técnico e operacional** (`M0-AC-010`) — o gate não fecha sem ela.

> **Este documento não fecha o gate.** É a recomendação de campo que o prepara. O MVP 1 não começa
> até o gate possuir a assinatura e a evidência física (`MVP-00` §15).

---

## 9. Janela física de 17/08/2026 — F3 (catraca) coletada

Primeira janela física executada. Pré-condições do §7 cumpridas: legado `.106` desligado,
consentimento assinado em mãos, academia vazia, parada de emergência definida (cortar a fonte da
catraca). Cutover feito: `ipServer` da catraca `192.168.2.106` → `192.168.2.190` (PC da ponte),
firewall de entrada 3570 aberto. **Ao fim da janela o `ipServer` foi devolvido para `.106` e o
legado religado** (runbook §5).

### 9.1. O que foi provado

| item | evidência |
|---|---|
| ponte EasyInner conecta à catraca real | `versao` → `retorno:0`, firmware `7.05.01` |
| catraca disca para a ponte após cutover | conexão estabelecida ~4–6 s após a ponte subir |
| `liberar` aceito pela DLL | **30/30** `retorno:0` (três séries) |
| giro confirmado por sensor óptico (`origem:6`, `M0-AC-005`) | **28** giros confirmados |
| distingue "liberou sem passagem" (`origem:5`) | 2 casos, corretamente rotulados como timeout |
| **`M0-AC-003` — sem dupla ativação** | **30 comandos → 0 eventos extras** |
| ambos os sentidos sob comando dirigido | 5 `entrada` + 5 `saida`, 10/10 giros |

**Séries executadas:**
1. 10 liberações `entrada` — 8 giros, 2 timeouts (humano), 0 duplas;
2. 10 liberações `entrada` — 10 giros, 0 timeouts, 0 duplas;
3. 5 `entrada` + 5 `saida` — 10 giros, 0 timeouts, 0 duplas.

### 9.2. O que NÃO foi provado, e por quê

- **`M0-AC-004`** (60 s sem comando = sem giro): **não roda** — a catraca está com
  `acionamento1:8` (`CATRACA_LIBERADA_DOIS_SENTIDOS`), o braço gira livre por configuração. O teste
  exige modo bloqueado, que é escrita na config da catraca, não realizada nesta janela.
- **F2 — ciclo facial** (`M0-AC-001`/`002`): **não tocado.** O servidor WebSocket 7792 e o
  `lab:run` que instancia os adapters ponta a ponta **não existem** — é fatia nova, spec do Cowork
  (`STATUS.md` item 6). O leitor facial não reconheceu ninguém nesta janela.
- **Latência ponta a ponta** (`M0-NFR-001`, rosto → decisão → giro): não medível sem F2.

### 9.3. Correção de um mal-entendido de método

A escuta de evento (`receber-evento`) é um **poll instantâneo** — a ponte `.cs` `Receber()` não
bloqueia, por design. Quem faz o loop de espera (pausa + ping até o prazo) é o chamador, e o
`topdata-inner-adapter.esperarDesfecho` **já faz isso corretamente**. Um driver de teste ingênuo
que varre a fila em rajada perde o evento assíncrono de giro — foi o que causou os primeiros
"sem-evento" desta janela. **Não há bug na ponte nem no adapter**; o erro estava no script de
coleta descartável, corrigido para espelhar o adapter.

---

*Relatório parcial, datado. As seções `PENDENTE-POC` são preenchidas quando a POC física rodar.*
