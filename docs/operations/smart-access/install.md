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

> **A disponibilidade da catraca é o uptime deste PC.** Se alguém desligar a máquina, a catraca
> não decide nada. Não é modo degradado — é catraca parada.

**Requisitos:**

- Windows com usuário administrador
- Rede alcançando a nuvem (HTTPS de saída) **e** os equipamentos na LAN
- Energia estável — de preferência no nobreak

**Cole um aviso físico na máquina:** *"Este computador não se desliga. Ele controla a catraca."*

---

## 3. Instalação

> **Conta Windows: use SEMPRE a mesma para pareamento e para instalar o serviço.** A credencial
> de pareamento é cifrada com DPAPI `CurrentUser` (ADR-011) — só a MESMA conta Windows que a
> gravou consegue lê-la de volta. O serviço `ArenaHub Edge` é instalado para rodar sob a conta
> interativa que executa `pnpm service:install` (nunca `LocalSystem` nem conta de serviço
> dedicada), justamente para que essa conta seja a mesma do pareamento. Numa academia com PC
> compartilhado e um usuário Windows só (o cenário do ADR-011), isso é automático; se a máquina
> tiver mais de uma conta, **não alterne entre elas**.

1. Logado com a conta Windows que vai rodar o serviço, rode `pnpm build`
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

   Rode o agente uma vez (`pnpm start`) — ele troca o código por um segredo próprio, guardado
   cifrado por **DPAPI** (`%LOCALAPPDATA%\ArenaHub\edge-agent\credencial.dat`), nunca em texto
   puro. Se `EDGE_PAIRING_CODE` não estiver definido e não houver credencial salva, o agente falha
   com `CredencialAusenteError` e sai (exit 1) — nesse caso, confira o `.env`
3. O código morre no primeiro uso. Para reparear: painel → **Operação** → ação **Parear** na linha
   do Edge → novo código no `.env` → rode o agente de novo
4. Abra PowerShell **como Administrador**, na mesma conta, e rode:
   ```powershell
   pnpm service:install
   ```
   O script pede a senha da conta Windows atual (necessária para o serviço rodar sob essa
   conta) e nunca a grava em arquivo, log ou linha de comando do serviço
5. Inicie o serviço:
   ```powershell
   Start-Service "ArenaHub Edge"
   ```

**Serviço Windows:**

- Nome: `ArenaHub Edge`
- Conta: a mesma conta Windows interativa que rodou o pareamento (ver aviso acima) — **nunca**
  `LocalSystem`
- Início: **automático**
- Recuperação: **reiniciar o serviço** em caso de falha (1ª, 2ª e falhas seguintes), já
  configurado por `service:install` via `sc.exe failure`

Para remover o serviço (preserva SQLite e credencial):

```powershell
pnpm service:uninstall
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
| Execução por pessoa diferente do autor (exigência da Task 6) | 🚧 **iniciada em 26/09/2026**, pelo PI, na Arena Positiva — parou no passo 1 (ver abaixo) |
| Tempo real do procedimento | ⬜ não medido |
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
