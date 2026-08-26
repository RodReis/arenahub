# TESTING.md — estratégia de teste e evidência do ArenaHub

> **Reescrito do zero em 14/08/2026 (ADR-016).** A versão anterior era material importado de
> outro produto (ProPlan): citava `apps/web` — app inexistente nesta arquitetura —, boundaries
> que não existem aqui, e registrava como fato PRs, SPECs e contagens de teste que **nunca
> ocorreram neste repositório**. Nada dela sobreviveu.
>
> **Princípio único deste arquivo:** *evidência é saída de máquina, nunca prosa.* Um número que
> não veio de uma execução real não entra aqui. Se você está prestes a escrever "os testes
> passaram" sem colar a saída, pare.

**Estado em 14/08/2026:** nenhum teste existe. Nenhuma execução ocorreu. As seções de evidência
estão **vazias de propósito** — e assim devem permanecer até o primeiro `pnpm test` real.

---

## 1. Os sete níveis

Herdado de `docs/prd/README.md` §9. Cada nível responde a uma pergunta diferente; nenhum
substitui outro.

| nível | pergunta | ferramenta | onde |
|---|---|---|---|
| **Unitário** | a regra está certa? | Jest (`api`, `edge-agent`) · Vitest + Testing Library (web) | `src/**/*.spec.ts`, `src/**/*.spec.tsx` |
| **Integração** | a regra sobrevive ao banco e à fila? | Jest + Testcontainers (PG/Redis) · SQLite descartável no Edge | `src/**/*.int-spec.ts` |
| **Contrato** | as duas pontas concordam? | schema OpenAPI, schema de evento, contrato API↔Edge, contrato de webhook | `test/contract/**/*.contract-spec.ts` |
| **E2E** | o usuário consegue? | Playwright (web e API) · runner compatível com o Expo fixado (MVP 4) | `test/**/*.e2e-spec.ts` |
| **Hardware** | o equipamento faz o que dissemos? | simulador em CI; bancada real no gate | `test/hardware/**/*.hw-spec.ts` |
| **Segurança** | dá para violar? | isolamento de tenant, autorização, idempotência, abuso | `test/security/**/*.sec-spec.ts` |
| **Carga** | aguenta? | ferramenta a definir quando houver o que carregar | `test/load/` |

**Classificação é por sufixo de arquivo, não por pasta ou por intenção.** O relatório da §5
depende disso: um arquivo mal nomeado desaparece da contagem sem ninguém notar.

### 1.1 Qual banco cada nível usa

Nenhum nível escreve no banco de desenvolvimento. Os caminhos são diferentes porque os níveis
falham de formas diferentes:

| nível | banco | quem limpa |
|---|---|---|
| **Integração** | banco **dedicado**, `INTEGRATION_DATABASE_URL` | 3 das 20 suítes apagam o tenant; as outras 17 não |
| **E2E** | banco **dedicado**, `E2E_DATABASE_URL` | ninguém — o banco é **recriado do zero** antes de cada execução |

> ⚠️ **Correção de 18/08/2026:** este documento afirmava que a integração usava
> Testcontainers. **Não usa.** O `setup-env.ts` carrega o `.env` da raiz e as
> suítes falam com o mesmo Postgres local — e foi assim que 1085 tenants de
> teste e 802 usuários `@exemplo.test` se acumularam no banco de
> desenvolvimento sem ninguém notar. Testcontainers segue disponível para
> quando uma suíte precisar de instância própria; nenhuma precisou até agora.

**Bancos separados entre si**, e não um só para as duas suítes: elas podem
rodar ao mesmo tempo, e o `migrate reset` de uma derrubaria o banco sob os pés
da outra.

**O E2E não limpa, e isso é deliberado.** Ele exercita o fluxo como um operador faria, e um
operador não apaga o aluno que acabou de cadastrar. A consequência é que limpeza no fim não
serviria: quando a suíte quebra no meio — ou leva `Ctrl+C` — o passo de limpeza simplesmente não
roda. Foi assim que o banco de desenvolvimento acumulou **1016 tenants** com epoch no nome
(`Caminho Biometria 1787060177858`), até a tela de Alunos passar a exibir o rastro da própria
suíte em vez do produto.

Por isso o `pretest:e2e` **recria o banco antes**, e não depois: a próxima execução não herda
nada, independentemente de como a anterior terminou. Mesmo Postgres, banco separado — não é
preciso container novo.

```
pnpm db:e2e     # recria o banco de E2E (roda sozinho antes de test:e2e)
pnpm db:int     # idem para a integração (roda sozinho antes de test:integration)
```

Duas guardas, porque o comando é destrutivo:

- **A variável não tem valor padrão nem cai para `DATABASE_URL`.** Faltando, o script para e diz o
  que fazer. Um fallback silencioso para o banco de dev é exatamente o defeito que esta separação
  existe para impedir, e um default embutido carregaria a porta da máquina de quem o escreveu.
- **O nome do banco precisa terminar no sufixo da suíte** (`_e2e` ou `_int`). Uma URL mal copiada
  apontando para `arenahub` destruiria o ambiente de quem rodou.

A **integração** é a exceção deliberada da primeira regra: sem
`INTEGRATION_DATABASE_URL` ela cai no `DATABASE_URL`, em vez de parar. O motivo é a assimetria de
dano — ela limpa em parte e nunca recria banco, então cair no de desenvolvimento **suja**; no E2E,
onde roda `migrate reset`, **apagaria**.

> ⚠️ **Agente de IA:** o Prisma 7 recusa `migrate reset` quando detecta `AI_AGENT` no ambiente e
> exige consentimento humano em `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. O bloqueio não
> atinge pessoa nem CI. **Não embutir o consentimento no script** — a guarda existe para o caso em
> que o alvo não é um banco descartável.

---

## 2. Cobertura

**Regras de domínio: mínimo 80%** (`docs/prd/README.md` §9). Isso é **portão de merge**, não
relatório informativo.

O que conta como regra de domínio: cálculo puro, máquina de estado, invariante do
`docs/CONVENTION.md` §4, resolução de entitlement, motor de decisão de acesso, aritmética
financeira, conversão de unidade de saúde.

O que **não** entra na conta: controller, DTO, módulo de configuração, migration, arquivo de
barrel.

Três avisos, porque cobertura mente com facilidade:

1. **Cobertura não substitui aceite.** 100% de linhas com zero asserção útil é 0% de teste.
2. **Teste removido ou enfraquecido exige aprovação explícita do PI** — e some no PR, não some
   no commit.
3. **Remover um teste que falha para liberar a entrega é proibido.** Está em
   `docs/prd/README.md` §10.3 e vale como regra de conduta, não como sugestão.

---

## 3. Dublês: onde podem e onde não podem

> **Esta tabela é a fonte.** `docs/ARCHITECTURE.md` §13 a espelha para contexto.

Ver **ADR-017**. A regra em uma linha: **o dublê substitui o processo externo, nunca a regra de
domínio.**

| boundary | porta | dublê | por que existe |
|---|---|---|---|
| Leitor facial Topdata | `FacialDeviceAdapter` | simulador contratual | `M0-NFR-006` exige CI **sem hardware** |
| Catraca Topdata | `TurnstileAdapter` | simulador contratual | idem |
| Provedor de pagamento | `PaymentProvider` | `FakePaymentProvider` | não se testa cobrança real em CI |
| Extração de laudo — imagem | `DocumentExtractor` (OCR) | fake + golden files **anonimizados** | OCR é não-determinístico |
| Extração de laudo — CSV e PDF | nenhum — o parser real roda no teste | fixture de verdade (CSV; PDF com camada de texto) | Determinístico: ou lê, ou falha. Dublê aqui provaria o dublê. **Foi o que aconteceu até 22/08:** o fixture de ECG era um `.txt` com o texto já extraído — o resultado do passo que o extrator não executava — e a suíte passava com o ECG quebrado em produção |
| Análise de IA | `AIProvider` | fake determinístico | custo, latência e variação |
| Antivírus de upload | `MalwareScanner` | fake | não há vírus em CI |
| Notificação | `NotificationChannel` | fake | não se manda push para gente real |
| Convênio corporativo | `CorporateCheckInProvider` | fake | fatia futura (ADR-009) |

**Proibido:**

- dublar caso de uso, repositório de domínio ou máquina de estado do próprio sistema;
- dublar o banco em teste de integração — é para isso que existe Testcontainers;
- golden file com **dado real de aluno**. Anonimizado ou sintético, sempre.

---

## 4. Testes que são obrigatórios, sempre

Estes não dependem de fatia. Se faltarem, a entrega não está pronta.

### 4.1 Isolamento de tenant
Todo caso de uso multi-tenant crítico tem teste que **tenta cruzar tenants e falha**
(INV-006). Não é teste de que funciona — é teste de que **não** funciona.

### 4.2 Idempotência
Para todo consumidor de evento externo: **processar duas vezes produz o mesmo estado**
(INV-076, INV-085, INV-086). Inclui webhook duplicado, webhook fora de ordem e reprocessamento
manual de DLQ.

### 4.3 Propriedades do motor de acesso
- **Entitlement expirado nunca retorna `ALLOW`** (INV-035) — propriedade obrigatória.
- Regras sobrepostas: a mais restritiva prevalece (INV-034).
- Dado offline vencido **nunca** produz allow ilimitado (INV-053).
- A catraca **não consulta assinatura** (INV-030) — testável por ausência de dependência.

### 4.4 Dinheiro
Nenhum `float` em caminho monetário (INV-065). Teste de arredondamento em proração, desconto e
estorno.

### 4.5 Vazamento
- Erro nunca traz PII, biometria, token ou dado de cartão (INV-133).
- Log nunca traz template biométrico, token ou cartão (INV-022).
- A tela pública da catraca nunca exibe dívida, valor ou CPF (INV-123).

### 4.6 LGPD
- Revogação de consentimento produz bloqueio lógico **imediato** (INV-018).
- Existe caminho de acesso alternativo funcional para quem recusa biometria (INV-022b).
- Exportação e exclusão LGPD são testadas de ponta a ponta (INV-131).

---

## 5. Relatório de evidência

**Objetivo:** ligar cada entrega (Issue/SPEC/PR) aos testes que a provou, com número que veio de
execução — e manter o histórico de entregas passadas **imutável**, não sobrescrito a cada run.

**Artefato:** `reports/TESTS.md`, gerado por `pnpm test:report`, **commitado no PR**. Duas
seções: **Estado atual** (última execução, uma linha por nível) e **Histórico por entrega**
(*append-only* — uma linha nova a cada entrega, linhas anteriores nunca mudam).

**Conteúdo de cada linha, por nível** (unitário/contrato/integração/e2e/hardware/segurança —
§1):

| campo | vem de |
|---|---|
| Data | data da execução (só na linha de histórico, não no `--check`) |
| Issue / SPEC / PR | flag de quem entrega (`--issue`, `--spec`, `--pr`) — só na linha de histórico |
| nível | sufixo do arquivo (§1) |
| testes / pass / falha | saída `--json` do runner (Jest e Vitest têm o mesmo schema) |
| cobertura % | `coverage-summary.json` (`total.lines.pct`), gerado por `--coverage
  --coverage.reporter=json-summary` (Vitest) / `--coverageReporters=json-summary` (Jest) |

**Fluxo de entrega — dois comandos, dois momentos:**

```
pnpm test:report                                   # atualiza "Estado atual", sem tocar histórico
pnpm test:report --issue 122 --spec F47 --pr 123    # ambos: atualiza estado atual E ANEXA linha ao histórico
```

Quem entrega roda o segundo comando **localmente, antes do commit final do PR** — é o mesmo
momento em que hoje se roda `pnpm test:report` sem flag. `--spec` aceita `SPEC-nnn`, `F<n>` (fatia
sem SPEC no Índice do `STATUS.md`) ou fica de fora quando o card não tem nenhum dos dois
(`[INFRA]` sem F).

**O que o `--check` do CI valida — e o que não valida.** `pnpm test:report --check` roda **sem
flag**: ele regenera a seção "Estado atual" (roda os testes, lê os números) e compara com o que
está commitado. **Ele não pode validar Issue/SPEC/PR da última linha do histórico** — esses
valores vêm de fora do repositório (o board, a issue), e o CI não tem como adivinhá-los. A
garantia do CI é *"os números da última entrega batem com uma execução real"*, não *"a
Issue/SPEC/PR estão corretos"* — essa segunda parte é responsabilidade de quem roda o comando com
as flags, e revisão humana no PR continua sendo a rede de segurança para isso.

**O gerador tem um self-check** (`pnpm test:report:selfcheck`): um teste do próprio gerador,
que garante que ele conta o que existe. Gerador de relatório sem teste é a forma mais elegante
de mentir com número.

### O campo PR nasce `—`, e isso é a regra — não um esquecimento

Quem entrega roda `test:report` **antes** do commit final, e nesse momento **o PR ainda não
existe**: ele é aberto depois, a partir do commit que o comando acabou de produzir. Então a
linha nasce com `—` no campo PR, e o número real entra num commit posterior, **depois do merge**.

`--check` não valida esse campo (bloco acima), então nada quebra se ele ficar `—` — e é
exatamente por isso que ele precisa estar escrito aqui. **Inventar o número é pior que deixar
vazio:** um PR que ainda não existe pode nascer com outro número, e a linha passaria a apontar
para trabalho de terceiros com aparência de evidência conferida. `—` é honesto; palpite não é.

**Preencher depois do merge é passo do fluxo**, junto com `proplan:done` — ver `CLAUDE.md`,
*Ciclo de vida de uma fatia*, passo 2.

### Evidência da `SPEC-049` — F49, kiosk seguro

Registrada em `reports/TESTS.md` por
`pnpm test:report --issue 150 --spec SPEC-049`, em 25/08/2026. **PR: `—`** — preencher depois do
merge, pela regra acima.

```
| 2026-08-25 | #150 | SPEC-049 | unitário   | 1738 | 1738 | 0 | 75.6 | — |
| 2026-08-25 | #150 | SPEC-049 | integração |  645 |  645 | 0 | 84.3 | — |
```

Os números **já incluem** `apps/kiosk` e `packages/api-contracts` — ver o bloco de correção
abaixo. A primeira geração desta linha saiu com `1677` e foi descartada: contava a fatia do
totem sem contar o totem.

O que a fatia cobre, por nível (detalhe em
[`superpowers/specs/2026-08-25-f49-kiosk-seguro-design.md`](superpowers/specs/2026-08-25-f49-kiosk-seguro-design.md) §7):

| nível | o que prova |
|---|---|
| unitário | expiração e extensão de sessão (funções puras, **"agora" entra por parâmetro**), máscara e validação de CPF, resolução das três camadas de configuração, accent com alvo 7:1 |
| integração | HMAC do dispositivo nos seis casos (assinatura válida e inválida, relógio fora da janela, nonce repetido, credencial revogada, credencial vencida); **isolamento A/B**; sessão expirada não autoriza; sessão encerrada por `DELETE` não autoriza mesmo com token em mãos; módulo desligado devolve 404 |
| e2e | jornada atrator → CPF → minha área → encerrar, com **asserção de limpeza**: `sessionStorage` e `localStorage` vazios e nenhum dado do aluno no DOM |

**A guarda de regressão desta fatia tem nome, não é implícita:** *dado do aluno A não aparece
para o aluno B*. É o aceite literal da Slice 4.5, e um teste nomeado é o que impede que ele seja
"coberto" por acidente e perdido no refactor seguinte.

✅ **Corrigido em 25/08/2026, nesta fatia — e a lacuna era maior que o kiosk.**

Ao registrar a evidência da `SPEC-049` descobriu-se que a lista `ALVOS` do gerador **não tinha
`apps/kiosk`** — a superfície nasceu nesta fatia e o gerador não sabia que ela existia. Ao
escrever a guarda que impede isso, ela acusou **um segundo pacote invisível que ninguém
procurava**: `packages/api-contracts`, com 31 testes rodando desde sempre e nunca contados.

| pacote | testes que estavam invisíveis |
|---|---:|
| `apps/kiosk` | 30 |
| `packages/api-contracts` | 31 |
| **total** | **61** |

O nível `unitário` do relatório foi de **1677 para 1738** — a diferença não é teste novo, é
teste que já passava e não aparecia. **Este é o formato exato da mentira que o §5 existe para
impedir:** ninguém escreveu um número errado, e mesmo assim o relatório afirmava menos do que a
suíte provava. Pacote fora da lista é indistinguível de pacote sem teste.

**A correção tem duas camadas, e a segunda é a que importa:**

1. `apps/kiosk` e `packages/api-contracts` entraram em `ALVOS` — conserta **o caso**.
2. `alvosFaltando()` (em `scripts/test-report.core.mjs`) compara os workspaces do disco contra
   `ALVOS`, e o `test:report:selfcheck` **falha** quando existe pacote com script `test` ou
   `test:integration` fora da lista — conserta **a classe**. O próximo app não nasce invisível:
   o selfcheck fica vermelho nomeando o pacote e apontando onde acrescentá-lo.

A guarda foi provada nas duas direções, não só na verde: com um workspace-canário plantado o
selfcheck sai **1 e nomeia o pacote**; removido o canário, volta a 0. *Guarda que não fica
vermelha quando deveria é pior que guarda nenhuma* — provar só o verde não distingue "regra
satisfeita" de "regra ausente".

**`ALVOS` mora em `test-report.core.mjs`**, não no `test-report.mjs`, justamente para o
selfcheck poder conferi-la sem importar o lado que roda processo.

⚠️ **O que continua em aberto, de propósito: o nível `e2e` segue em `0`.** O gerador coleta
`test` e `test:integration`; o Playwright roda por `pnpm test:e2e`, fora dele. Isso **não é
específico do kiosk** — vale igual para o `admin-web`, e é pré-existente. `alvosFaltando()`
ignora `test:e2e` deliberadamente, para não cobrar o que o gerador não sabe coletar. Ligar o
Playwright ao relatório é trabalho de `[INFRA]`, fora do escopo desta fatia.

### Evidência da `SPEC-050` — F50, configuração do totem

Gerada por `pnpm test:report --issue 151 --spec SPEC-050`, em 26/08/2026. **PR: [#207](https://github.com/RodReis/arenahub/pull/207)** — preenchido pela F51, que encontrou o campo em `—`.

```
| 2026-08-26 | #151 | SPEC-050 | unitário   | 1757 | 1757 | 0 | #207 | — |
| 2026-08-26 | #151 | SPEC-050 | integração |  640 |  640 | 0 | #207 | — |
```

**Cobertura % não capturada nesta linha.** `pnpm test:report` trava na saída do processo Jest
neste ambiente Windows — o runner termina os testes e fecha um handle aberto de um jeito que
nunca devolve controle ao processo pai (comportamento pré-existente, distinto do crash por
violação de acesso já registrado; aqui não há saída nenhuma, só travamento). Os números de
`testes`/`pass`/`falha` acima são os que o gate local realmente produziu: unitário 1757/1757,
integração 640/640 (42 suítes), ambos 0 falhas — **escopo é a suíte inteira do monorepo**, não
um subconjunto isolado da F50, porque o gerador nunca soube separar por fatia (mesma limitação já
registrada para `SPEC-049` acima). Preencher a cobertura % é trabalho de rodar `test:report` fora
deste ambiente (CI, ou terminal do PI) uma vez que o handle pendurado for investigado.

O que a fatia cobre, por nível (detalhe em
[`superpowers/specs/2026-08-26-f50-configuracao-do-totem-design.md`](superpowers/specs/2026-08-26-f50-configuracao-do-totem-design.md)):

| nível | o que prova |
|---|---|
| unitário | `proximaVersao` (incremento de versão na publicação), `totemOcupado` (totem em sessão bloqueia reinício imediato), `decidirReinicio` (comparação de `configVersion` que decide se o totem reinicia) |
| integração | as cinco rotas de `kiosk-admin`; **isolamento A/B** — totem do tenant X não acessa nem lista o do tenant Y, 404 e não 403; publicar **nunca** reescreve a versão publicada anterior (linha antiga permanece imutável); descartar rascunho restaura a configuração publicada, não um estado intermediário; `GET /kiosk/config` (rota do totem, F49) **nunca** serve rascunho — só a versão com `publishedAt` preenchido |
| e2e | aceite via painel `/operations/kiosks`: edita marca/cor/sessão → salva rascunho → publica → barra de estado volta a "sem alterações"; descartar rascunho restaura o valor publicado (não o valor descartado) |

**A guarda de regressão desta fatia tem nome:** *rascunho de um tenant nunca vaza para outro; publicar
nunca reescreve versão publicada*. É o índice parcial do passo 1 (isolamento por chave) mais a
imutabilidade do passo 2 (publicar sempre insere linha nova) — os dois described em
`docs/DEVELOPMENT.md` §"F50 — o que a fatia cumpriu".

### Evidência da `SPEC-051` — F51, tela pública do totem

Gerada em 26/08/2026 a partir do gate local. **PR: `—`** — preencher depois do merge, pela regra acima.

```
| 2026-08-26 | #152 | SPEC-051 | unitário   | 1860 | 1860 | 0 |    — | — |
| 2026-08-26 | #152 | SPEC-051 | integração |  649 |  649 | 0 |    — | — |
```

**Cobertura % não capturada, pelo mesmo motivo já registrado na `SPEC-050`:** `pnpm test:report`
trava na saída do Jest neste ambiente Windows. Os números acima são os que o gate local produziu —
unitário 1860/1860 (12 pacotes), integração 649/649 (43 suítes), zero falhas. **Escopo é a suíte
inteira do monorepo**, não um subconjunto da F51, porque o gerador nunca soube separar por fatia.

O que a fatia cobre, por nível (detalhe em
[`superpowers/specs/2026-08-26-f51-tela-publica-do-totem-design.md`](superpowers/specs/2026-08-26-f51-tela-publica-do-totem-design.md)):

| nível | o que prova |
|---|---|
| unitário | `blocosVisiveis` (vídeo sem mídia resolvida **sai** do rodízio, em vez de virar 12 s de tela preta), `proximoIndice`/`indiceSeguro` (lista vazia devolve 0, nunca `NaN`; lista que encolheu volta ao início), `mover` (subir a primeira e descer a última **não** embaralham), `aceitarMidia` e `pareceMp4` (a assinatura ISO-BMFF mora no **offset 4**, não no 0), `rotuloDePatrocinio` (rótulo vazio cai no padrão, nunca em nada), `formatarData` (a data digitada não anda um dia para trás), `inicioDoDiaLocal` (22h locais ainda são o mesmo dia, embora já seja o dia seguinte em UTC) |
| integração | `POST /admin/kiosk-devices/:id/media` — MP4 aceito devolve chave escopada por tenant **e** unidade; PNG renomeado é recusado **sem sequer chamar o antivírus**; EICAR responde 422 e **não** chega ao storage; totem de outro tenant responde 404, nunca 403. `GET /kiosk/config` — os blocos publicados chegam ao totem na ordem e no tempo configurados; **mídia apontando para outra unidade não vira URL assinada**, mesmo gravada no payload. `POST /kiosk/heartbeat` — os indicadores contam `access_events` reais e contam **só os da unidade daquele totem**; `DENY` não conta como check-in |
| componente | a faixa de patrocinadores **não tem `<a>` nem `<button>`** (vitrine, não mídia — ADR-042, Decisão 4); o bloco de informações mostra o título e **não um zero** enquanto nenhum número chegou; o campo de link do Instagram aparece **desabilitado com o motivo em tela** |

🔴 **O CI sobe SÓ Postgres — nem MinIO, nem Redis.** Descoberto pela F51, que foi a **primeira
suíte de integração a gravar objeto de verdade** no object storage e derrubou o pipeline com
`ECONNREFUSED 127.0.0.1:9000`. Toda suíte de integração desta casa dubla o storage com
`.overrideProvider(OBJECT_STORAGE)` (`access-query-export`, `biometric-identity`, `device-sync`,
`health`, `historico-e-comparativos`, `upload-e-revisao`) — o padrão existia, e a F51 era a única
que não o seguia. **Quem escrever a próxima fatia que toque o storage precisa saber disto antes de
abrir o PR:** localmente o MinIO do `docker-compose` responde e o teste passa; no CI, não.

O dublê **guarda o que foi gravado** e **registra o que foi assinado**, para não cair na armadilha
do dublê que esconde o ato errado: um serviço que devolvesse a chave sem gravar nada passaria verde
com um dublê que só responde `Promise.resolve()`. Provado por mutação — remover o `putPrivateObject`
do serviço deixa o teste vermelho.

**Provado por mutação em 26/08/2026**, e não por leitura — cada guarda foi quebrada de propósito
para ver a suíte ficar vermelha:

| mutação plantada | resultado |
|---|---|
| Gravar no storage **antes** de escanear | 2 testes vermelhos (`ESCANEIA ANTES de gravar`, `scanner FORA DO AR ... NAO entra no storage`) |
| Tirar a barra final do prefixo de mídia (`u1` passaria a alcançar `u10`) | 4 testes vermelhos, em unidade **e** integração |
| Vídeo sem `midiaUrl` **voltar** ao rodízio (12 s de tela preta) | 2 testes vermelhos, no domínio puro e no componente |
| Marca do patrocinador virar `<a href>` | 1 teste vermelho (`NAO ha link nem area clicavel na faixa`) |

⚠️ **Uma guarda que a mutação mostrou ser retórica, e está registrada como tal.** Mover o `throw`
de "arquivo infectado" para dentro do `try` do antivírus **não quebra teste nenhum** — os 7 seguem
verdes, porque o erro cai no próprio `catch`, não é `ErroDoScanner` e sai relançado intacto. As
duas formas são observacionalmente idênticas hoje. O comentário no código foi reescrito para dizer
isso: a separação é disciplina contra o *próximo* `catch`, não correção de defeito presente.

**A guarda de regressão desta fatia tem nome:** *nenhuma configuração publica dado de aluno na tela
pública, e a faixa de patrocínio nunca conta exibição*. A primeira metade é estrutural — o
componente da hero recebe `config` e dois inteiros, e `SessaoDoAluno` não é importado no arquivo; o
endpoint que produz os números devolve **dois inteiros**, sem lista, sem nome, sem id
(`M3.5-BR-001`). A segunda também: não há campo de contagem, clique, campanha ou período **no
contrato**, e o `parse` do Zod descarta o que vier a mais (`M3.5-BR-006`).

---

## 6. CI

Pipeline mínimo, em ordem de custo crescente (falhe cedo, falhe barato):

```
1. pnpm install --frozen-lockfile
2. pnpm lint
3. pnpm typecheck
4. pnpm test               # unitário + contrato
5. pnpm test:integration   # Testcontainers
6. pnpm build
7. pnpm test:e2e           # Playwright
8. pnpm test:report --check
```

**Barram o merge:** todos os 8. Inclusive a cobertura de 80% em regras de domínio e a guarda de
evidência.

**Dois jobs paralelos** (issue [#77](https://github.com/RodReis/arenahub/issues/77)). A numeração
acima é a ordem de **custo**, não a de execução — o que não depende um do outro não espera na fila:

| job | passos | por quê separado |
|---|---|---|
| **rapido** | lint, typecheck, guardas, **evidência**, test, build | só precisa de disco e CPU |
| **pesado** | migrations, test:integration, build, seed, test:e2e | precisa de Postgres e de navegador |

Duas consequências da divisão, ambas deliberadas:

- **A guarda de evidência (8) roda no job rápido, logo após as outras guardas.** `--check` não
  depende de teste nenhum ter rodado: ele lê `git ls-files` e compara com o `reports/TESTS.md`
  commitado. Estava por último e custava ~4min para reportar um diff de duas linhas. **Continua
  barrando o merge** — só barra mais cedo.
- **`build` (6) roda nos dois jobs.** No pesado porque o `webServer` do Playwright sobe
  `next start` e `node dist/main.js`, que são artefatos compilados; o `dependsOn: ["^build"]` do
  turbo constrói as *dependências* da task, nunca o próprio app.

Nenhuma verificação foi removida ou afrouxada: **os dois jobs são obrigatórios** para o merge.

**Não rodam em CI:** teste de hardware real (só na bancada, no gate) e teste de carga (sob
demanda).

---

## 7. Ambientes

| ambiente | para quê | dado |
|---|---|---|
| local | desenvolvimento | seed (`packages/database/prisma/seed.ts`) |
| CI | portão de merge | efêmero, Testcontainers |
| bancada (MVP 0) | hardware real | sintético |
| homologação | piloto com o cliente | **decisão aberta** — nenhum PRD define |
| produção | — | dado real, sem exceção de acesso para debug |

> **Aberto:** não há definição de ambiente de homologação em documento nenhum. Antes do piloto
> do MVP 4 isso vira pergunta ao PI.

---

## 8. Registro de execuções

O registro vivo é `reports/TESTS.md` — gerado por `pnpm test:report`, commitado no PR, verificado
pela guarda `pnpm test:report --check` (§5/§6). Este arquivo não duplica a tabela: uma tabela
escrita à mão aqui divergiria do gerador na primeira execução e violaria o princípio do topo deste
documento (*evidência é saída de máquina, nunca prosa*).

---

## 9. Critérios de aceite deste documento

- [ ] `pnpm test`, `test:integration` e `test:e2e` existem e rodam (bootstrap)
- [ ] Classificador por sufixo implementado no `test-report.config.json`
- [ ] `scripts/gen-test-report.ts` + self-check
- [ ] `.github/workflows/ci.yml` com os 8 passos
- [ ] Portão de cobertura de 80% em regras de domínio ligado
- [ ] Simulador Topdata rodando em CI sem hardware (`M0-NFR-006`)
- [ ] Primeiro `reports/TESTS.md` real gerado e commitado
