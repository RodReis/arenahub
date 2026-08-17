# Levantamento de campo — ciclo facial ao vivo (F2) e achado `senduser`

**Data:** 17/08/2026 · **Local:** rede da Arena Positiva · **Autor:** Claude Code, com o PI presente
**Natureza:** nota de campo (fato verificado ao vivo) + registro de correção de código autorizada pelo PI.

> **Fronteira deste documento.** Registra o que foi observado ao ligar o `TopdataFacialAdapter`
> real contra o leitor facial de produção, e o ajuste de código que a observação exigiu. Não é ADR
> nem spec. Complementa `docs/field-notes/2026-08-15-hardware-arena-positiva.md` (que só alcançou o
> webserver de admin) e o `docs/runbooks/POC-MVP-00-roteiro-de-execucao.md`.

## 0. O que esta janela conseguiu — inédito

Pela primeira vez o **ciclo facial rodou ponta a ponta** contra o equipamento real:

1. o leitor facial discou para o `edge-agent` (cutover de servidor no menu do leitor);
2. o `TopdataFacialAdapter` respondeu o handshake e **manteve a conexão estável**;
3. o ArenaHub **cadastrou** um usuário de teste (`setuserinfo` → confirmado pelo leitor);
4. a face foi capturada na câmera do leitor (associada ao enrollid);
5. ao passar o rosto, o leitor **reconheceu** e mandou `sendlog`;
6. o ArenaHub **recebeu o evento** com o `externalEnrollId` correto, método `facial` e horário do
   equipamento.

Isto exercita `M0-FR-002` (cadastro) e `M0-FR-004` (evento de reconhecimento) em hardware real —
antes só cobertos por simulador. **Não fecha o gate do MVP 0** (falta latência ponta a ponta com a
catraca no mesmo laço, `M0-AC-004`, e a assinatura do PI, `M0-AC-010`).

## 1. Como o cutover do facial foi feito

O leitor facial, como a catraca, é **cliente**: disca para o servidor gravado nele. A config está
no **menu físico do leitor** (`MENU → Rede → Servidor` ou `Acesso → Servidor`), **sem depender da
senha do webserver de admin** — o que destrava o que o field-note de 15/08 §5 dava como bloqueado.

Campos lidos no menu (17/08):

| campo | valor original | mudado para |
|---|---|---|
| Req. Servidor | Sim | Sim |
| Domínio | Não | Não |
| URL | `ws://facial.topdat...` | (mantida) |
| **IP** | `192.168.002.106` (legado) | **`192.168.002.190`** (edge-agent) |
| Porta | `7792` | `7792` |
| Heartbeat | `3` | `3` |

Com `Domínio: Não`, o leitor usa o campo **IP** — foi o IP que resolveu, não a URL. Ethernet do
leitor: `192.168.2.188`, DHCP, MAC `00:01:a9:03:25:78`. Capacidade lida: **200 usuários, 13 faces,
43 registros**. Firmware: **`ai518_fp26v_v2.16`**.

> **Devolução:** ao fim da janela, o IP do servidor do leitor deve voltar para `192.168.002.106` e
> o legado religado — mesmo procedimento da catraca (runbook §5).

## 2. 🔴 Achado que exigiu código — o `senduser` não documentado

Ao conectar, o leitor `v2.16` entra num **loop de reconexão de ~5 s** e nunca estabiliza. Causa,
diagnosticada ao vivo com um servidor de captura de metadados (sem logar valores — poderia conter
foto):

- logo após o `reg`, o leitor envia **`senduser`** — um por usuário cadastrado — sincronizando a
  base dele para o servidor. Chaves observadas: `cmd, sn, enrollid, name, backupnum, admin, record`.
- esse comando **não estava** no `esquemaMensagemDoEquipamento` (só `reg`, `sendlog`, `ret`),
  então caía em "mensagem fora do formato documentado" e **não era respondido**;
- como o `reg`, o `senduser` **exige ack**. Sem resposta, o leitor reenvia e derruba a conexão.

Os manuais que temos (`docs/vendor/topdata/PROTOCOLO-FACIAL.md`) descrevem revisões anteriores; o
`senduser` é comportamento do firmware `ai518_fp26v_v2.16`, não coberto por eles. **Este é um fato
de campo novo, análogo ao webserver de admin do field-note de 15/08.**

### Correção aplicada (autorizada pelo PI como escopo de F2)

Fora do fluxo normal de spec — o PI, presente, assumiu explicitamente a decisão de escopo. Feita
em branch própria (`feat/f2-facial-senduser`), com TDD (teste RED antes do fix):

- `protocolo.ts`: `esquemaSendUser` (`.loose()`, só o mínimo para identificar) + `respostaSendUser`;
  ambos adicionados ao union e às respostas;
- `topdata-facial-adapter.ts`: branch no `aoReceber` que responde o ack de `senduser`;
- teste `responde ao senduser` cobrindo o contrato.

**Efeito verificado ao vivo:** com o ack, **0 desconexões** e **0 mensagens fora do formato** (antes:
loop a cada ~5 s). A base do leitor **não** é importada — a nuvem é a fonte da verdade (regra de
arquitetura nº 3); o ack só confirma o recebimento.

> **Pendência para a spec de F2 (Cowork):** decidir se `senduser` deve algum dia ser consumido
> (reconciliação de órfãos entre leitor e nuvem) ou permanecer só-ack. Hoje é só-ack, que basta
> para a conexão viver. Também: registrar `senduser` no resumo verificável de
> `docs/vendor/topdata/` quando houver manual da revisão `v2.16`.

## 3. O que ainda falta para o gate

- **latência ponta a ponta** (`M0-NFR-001`, rosto → decisão → giro): exige o facial e a catraca no
  mesmo orquestrador (`lab:run`), que ainda não existe;
- **`M0-AC-004`** (catraca não gira sem comando): a catraca está em `acionamento1:8` (liberada);
- **assinatura do PI** (`M0-AC-010`).

---

*Artefato de campo, datado. Vale para o estado da rede e do firmware em 17/08/2026.*
