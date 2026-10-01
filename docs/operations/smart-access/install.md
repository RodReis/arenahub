# Runbook — Instalação do Edge na academia

**Para quem:** operador técnico, com acesso administrativo ao PC da recepção.
**Duração:** ~30 min, fora o tempo de rede.

> ✅ **Ensaiado em academia real — Arena Positiva, 26/09 a 01/10/2026.** O ensaio achou o que o
> papel não via: cada passo errado virou correção (§7) e, no fim, o ArenaHub passou a decidir a
> catraca. Narrativa e defeitos: [`docs/field-notes/2026-10-01-implantacao-arena-positiva.md`](../../field-notes/2026-10-01-implantacao-arena-positiva.md).
> Ao bater num passo que não fecha, **o passo está errado até prova em contrário**.

---

## 1. Antes de ir

- [ ] Unidade cadastrada no painel, com **timezone correto** (ele decide a janela de horário)
- [ ] **Edge cadastrado no painel**: Operação → **Novo Edge** → unidade + código (ex.: `RECEPCAO-01`)
- [ ] Código de pareamento gerado (uso único, TTL curto — ADR-011). Sai na mesma tela, logo depois
  do cadastro, e também pela ação **Parear** na tabela de Edge do `/operations` — é por ali que se
  gera outro quando o anterior expira ou é revogado
- [ ] Modelo do leitor e da catraca confirmados na lista de hardware homologado
- [ ] Alguém da academia disponível para testar a passagem

> **Não leve segredo no instalador.** O pacote é inerte e pode circular por e-mail; a identidade
> nasce do pareamento, na máquina (ADR-011).

---

## 2. O PC da recepção

O `edge-agent` roda **no PC compartilhado da recepção** — decisão do PI, sem hardware dedicado no
piloto. A consequência está escrita no ADR-011 e precisa ser dita à academia em voz alta:

> **O plano só é verificado enquanto este PC estiver ligado e o agente rodando.** Se alguém
> desligar a máquina, em ~10 s a catraca volta ao modo offline e decide **sozinha, pela lista
> dela**: libera quem estiver nela, **sem consultar plano**, e o que ela guardar entra como
> frequência quando o agente voltar (ADR-012). Não é catraca parada, mas também não é controle.

**Requisitos:**

- Windows com usuário administrador
- Rede alcançando a nuvem (HTTPS de saída) **e** os equipamentos na LAN
- Energia estável — de preferência no nobreak

**Cole um aviso físico na máquina:** *"Este computador não se desliga. Ele controla a catraca."*

> ⚠️ **Desative o TopFace antes de instalar** (#504, Arena Positiva, 01/10/2026). Se o PC tem o
> software da Topdata (`TopFace.exe`, serviço `TopFaceService`), ele escuta a **mesma porta 7792**
> do agente e, por subir no boot antes do login, **fica com o leitor a cada reinício** — rosto
> reconhecido, catraca parada, nada no painel. Confira com `tasklist /svc | findstr /i topface` e,
> se existir, num PowerShell de administrador: `sc.exe stop TopFaceService` e
> `sc.exe config TopFaceService start= disabled`. Como voltar: runbook de operação da Arena
> Positiva §7 (`docs/runbooks/operacao-edge-arena-positiva.md`).

---

## 3. Instalação

> **Conta Windows: use SEMPRE a mesma para pareamento e para a tarefa que roda o agente.** A
> credencial de pareamento é cifrada com DPAPI `CurrentUser` (ADR-011) — só a MESMA conta Windows
> que a gravou consegue lê-la de volta. A tarefa agendada `ArenaHub Edge` roda sob a conta
> interativa que executa o `instalar-edge.cmd` (nunca `LocalSystem`), justamente para que essa
> conta seja a mesma do pareamento. Numa academia com PC compartilhado e um usuário Windows só (o
> cenário do ADR-011), isso é automático; se a máquina tiver mais de uma conta, **não alterne entre
> elas**.

1. Logado com a conta Windows que vai rodar o agente, rode `pnpm install` e `pnpm build`
2. Preencha o `.env` da **raiz do monorepo** (dois níveis acima de `apps/edge-agent` — é de lá que
   `main.ts` resolve o arquivo, pela mesma convenção usada pelo docker-compose e pela API)
   **antes** de rodar o agente. Não há prompt interativo: o agente lê a variável de
   ambiente/`.env` no arranque.

   | variável | valor |
   |---|---|
   | `EDGE_AGENT_ID` | o mesmo código que você deu ao Edge no painel (ex.: `RECEPCAO-01`) |
   | `TENANT_ID` / `GYM_UNIT_ID` | UUIDs do tenant e da unidade — o agente **valida e encerra** se faltarem |
   | `CLOUD_API_URL` | URL **pública** da API. `arenahubapi.railway.internal` **não resolve** do PC da academia (§1 do `docs/DEPLOY.md`) |
   | `EDGE_PAIRING_CODE` | o código gerado no painel, uso único |
   | `FACIAL_MODE` / `CATRACA_MODE` | `real` na academia; `simulador` é o padrão e não gira nada |
   | `CATRACA_INVERTIDA` | `true` se a catraca gira para o sentido errado. **Só se descobre testando** na bancada (`lab:run --invertido`). Arena Positiva: `true` (#407) |
   | `CATRACA_TEMPO_LIBERADA_S` | segundos destravada depois de liberar, de 1 a 50. Padrão `10`; era 5 fixo e o aluno não alcançava girar (#497) |
   | `LOG_LEVEL` | `info` em produção. `debug` só para diagnóstico — lista cada mensagem do leitor |

   Rode o agente uma vez (`pnpm start`) — ele troca o código por um segredo próprio, guardado
   cifrado por **DPAPI** (`%LOCALAPPDATA%\ArenaHub\edge-agent\credencial.dat`), nunca em texto
   puro. Se `EDGE_PAIRING_CODE` não estiver definido e não houver credencial salva, o agente falha
   com `CredencialAusenteError` e sai (exit 1) — nesse caso, confira o `.env`
3. O código morre no primeiro uso. Para reparear: painel → **Operação** → ação **Parear** na linha
   do Edge → novo código no `.env` → rode o agente de novo
4. **Compile a ponte da catraca** (o `.exe` não é versionado) e o agente, uma vez:
   ```powershell
   pnpm --filter @arenahub/edge-agent bridge:build
   pnpm exec turbo run build --filter=@arenahub/edge-agent
   ```
5. **Instale a tarefa que mantém o agente de pé.** Em `apps\edge-agent\scripts\windows\`, botão
   direito em **`instalar-edge.cmd`** → **Executar como administrador**, logado na conta do
   pareamento. Ele cria a tarefa `ArenaHub Edge` (dispara no login, **sem janela**, religa o agente
   em 5 s se cair) e já inicia.

> ⚠️ **Não use `pnpm service:install`** — [#499](https://github.com/RodReis/arenahub/issues/499).
> O script registra `node.exe` direto como serviço do Windows, e o Node não responde ao Service
> Control Manager (erro 1053 ao iniciar); também exige a senha da conta. Nunca foi executado numa
> máquina real. O que roda na Arena Positiva é a tarefa agendada, **validada em 01/10/2026 com
> reinício do Windows**.

**Scripts de dois cliques** — em `apps/edge-agent/scripts/windows/`. **Nenhum comando para
copiar**: copiar pelo WhatsApp apagou `_` e `*` e inverteu a ordem de blocos de várias linhas no PC
da recepção (01/10/2026).

| arquivo | para quê |
|---|---|
| `instalar-edge.cmd` | (administrador) cria a tarefa `ArenaHub Edge` e inicia |
| `parar-edge.cmd` | para o agente — a catraca volta ao modo offline em ~10 s |
| `ver-log-edge.cmd` | log ao vivo (`apps/edge-agent/data/edge-agent.log`); fechar não para o agente |
| `atualizar-edge.cmd` | para, `git pull`, `pnpm install`, `bridge:build`, build do agente, sobe de novo |
| `edge-rodar.cmd` / `edge-rodar-oculto.vbs` | o laço que religa em 5 s e o lançador sem janela — não clicar |

**Limitações da tarefa agendada:**

- Só sobe quando a conta **entra no Windows**. A Arena Positiva faz **login automático sem senha**,
  então sobe no boot; se alguém ativar senha ou trocar a conta, o agente não sobe até entrar — e
  nesse tempo a catraca decide sozinha pela lista dela.
- O log não tem rotação ainda (#499) — apague o arquivo de vez em quando, com o agente parado.

Operação do dia a dia e diagnóstico: [`docs/runbooks/operacao-edge-arena-positiva.md`](../../runbooks/operacao-edge-arena-positiva.md).

---

## 4. Conferência

```bash
pnpm smoke:smart-access -- --base-url https://SUA-API --cookie "arenahub_access=..."
```

Espera-se `[OK]` em todas as linhas. Depois, no painel → **Operação**:

- [ ] O Edge aparece como **Respondendo**
- [ ] Os dispositivos aparecem como **Respondendo**
- [ ] Nenhum alerta crítico aberto

> **Dispositivo cadastrado antes do Edge não precisa ser ligado a ele.** O leitor entra no painel
> sem Edge, e o **primeiro Edge da mesma unidade que apresentar o serial** dele passa a ser o dono,
> com registro de auditoria (`device.claimed_by_edge`). Dispositivo que já tem outro Edge, ou que é
> de outra unidade, **nunca** é tomado. O serial cadastrado no painel tem de ser **exatamente** o
> `sn` que o leitor informa (`sn` na linha `leitor registrado` do log do agente) — serial diferente
> dá 404 no vínculo dos alunos e todo reconhecimento é negado (#488).

> **Publique o termo biométrico antes de subir o agente.** Painel → Administração → **Termo
> biométrico**. Sem termo vigente, os alunos que já estão no leitor facial não são vinculados
> (`semTermoBiometrico` na linha `base do leitor vinculada` do log) e todo reconhecimento é
> negado (#491). Publicou depois? Reinicie o agente para refazer o vínculo.

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
| Execução por pessoa diferente do autor (exigência da Task 6) | ✅ **concluída em 01/10/2026**, pelo PI, na Arena Positiva — catraca liberando pelo ArenaHub; serviço Windows trocado por tarefa agendada (#499) |
| Tempo real do procedimento | ⬜ não medido (a Arena Positiva levou 6 dias, por causa dos defeitos achados) |
| Comportamento com rede instável durante o pareamento | ⬜ não testado |

### O que a primeira execução real revelou (26/09/2026)

**O passo 1 era impossível de cumprir.** "Código de pareamento gerado no painel" pressupunha um
`EdgeNode` cadastrado, e **não havia como cadastrá-lo**: nem endpoint, nem tela. O
`POST /api/v1/edge-nodes/:id/pairing-codes` existia desde a F59 e exigia o id de um registro que
nenhum caminho do produto criava. O teste de integração da F59 criava o `EdgeNode` direto via
Prisma no `beforeAll`, então os critérios automatizados passavam sobre um caminho que nenhum
operador consegue percorrer — que é exatamente o tipo de buraco que "AC-6–9 só fecham na academia"
existia para pegar.

Corrigido na [issue #404](https://github.com/RodReis/arenahub/issues/404): a tela **Operação →
Novo Edge** cadastra e gera o código na mesma etapa, e a ação **Parear** na tabela de Edge gera
outro quando o anterior expira ou é revogado (o ADR-011 §4 prevê revogação pelo painel, e sem essa
ação um Edge revogado só voltaria a funcionar cadastrando um segundo registro).

**Também corrigido junto:** `docs/DEPLOY.md` afirmava que a API não tinha domínio público. Tem
(`arenahubapi-production.up.railway.app`). A afirmação errada virou bloqueio aparente na hora de
apontar `CLOUD_API_URL` do Edge para a nuvem — `railway.internal` não resolve do PC da academia.

**Lição para quem executar o resto:** o runbook ainda tem passos que nunca ninguém percorreu. Ao
bater num que não fecha, **o passo está errado até prova em contrário** — não é você que não
entendeu.

**Instalação real do serviço (F59, Task 13):** os scripts `install-service.ps1` /
`uninstall-service.ps1` existem e foram revisados manualmente (`.superpowers/sdd/2026-09-16-f59-composicao-edge-agent/task-13-report.md`),
mas **não foram ensaiados numa máquina Windows real**. `AC-9` continua pendente até esse ensaio
presencial acontecer.

**Quem executar pela primeira vez: anote o que divergiu e corrija este arquivo.** Runbook que
ninguém rodou é hipótese escrita com confiança.
