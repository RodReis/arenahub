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

Desde a F66 (ADR-054) há uma segunda camada: o Postgres recusa sozinho, por política RLS, o que a
aplicação deixar passar. O teste dela é `apps/api/test/integration/rls-isolation.int-spec.ts`, e
ele tem uma exigência própria — **conectar como o role restrito `arenahub_app`**, por
`RUNTIME_INTEGRATION_DATABASE_URL`. Sem essa variável a suíte **pula**, e não cai no role dono: o
`arenahub` local é superusuário, e superusuário ignora RLS mesmo com `FORCE ROW LEVEL SECURITY` —
o teste passaria verde sem provar nada.

Para rodá-lo localmente, o role precisa de senha (a migration cria o role, não a credencial):

```bash
pnpm --filter @arenahub/database exec tsx prisma/senha-do-role-de-runtime.ts <senha>
```

Depois, `RUNTIME_INTEGRATION_DATABASE_URL` no `.env` — ver `infra/docker/README.md`, seção "Role de
runtime (RLS)". No CI isso é um passo do job, entre as migrations e a integração.

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

Gerada em 26/08/2026 a partir do gate local, e confirmada pelo CI no merge.
**PR: [#208](https://github.com/RodReis/arenahub/pull/208)**

```
| 2026-08-26 | #152 | SPEC-051 | unitário   | 1860 | 1860 | 0 | #208 | — |
| 2026-08-26 | #152 | SPEC-051 | integração |  649 |  649 | 0 | #208 | — |
| 2026-08-26 | #152 | SPEC-051 | e2e        |   61 |   61 | 0 | #208 | — |
```

**A linha `e2e` é preenchida à mão**, pelo motivo já registrado acima: o gerador coleta `test` e
`test:integration`, e o Playwright roda por `pnpm test:e2e`, fora dele. Os 61 incluem os 3 do
aceite da F51 e os 58 pré-existentes, todos verdes na mesma execução.

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

🔴 **`test:integration` roda com `--runInBand` e vaza memória — a F51 cruzou o limiar.** As suítes
compartilham **um processo**, e cada uma monta um `AppModule` Nest próprio; **a maioria não chama
`app.close()` no `afterAll`**, então os módulos ficam vivos até o fim da execução. Na F50 eram 42
suítes e 640 testes e passava; a **43ª** estourou o heap padrão do runner com `FATAL ERROR: Reached
heap limit` e `exit 134` — que **parece crash de teste e não é**: nenhum teste falhou, e o resumo
do Jest nem chegou a ser impresso.

O teto foi elevado (`NODE_OPTIONS=--max-old-space-size=6144` no workflow **e** no `globalEnv` do
`turbo.json`, senão o Turbo descarta a variável sem erro). **É a correção proporcional, não a de
raiz:** fechar a app em ~40 suítes alheias é refatoração que nenhuma fatia pediu. O conserto de
verdade — `afterAll` fechando a app em toda suíte, ou abandonar o `--runInBand` — é card `[INFRA]`
próprio, e **a próxima fatia que acrescentar suíte de integração pode reencontrar o teto**.

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


### Evidência da `SPEC-052` — F52, área do aluno no totem

Gerada em 26/08/2026 a partir do gate local, e confirmada pelo CI no merge.
**PR: [#209](https://github.com/RodReis/arenahub/pull/209)**

```
| 2026-08-26 | #153 | SPEC-052 | unitário   | 1965 | 1965 | 0 | #209 | — |
| 2026-08-26 | #153 | SPEC-052 | integração |  661 |  661 | 0 | #209 | — |
```

**Sem linha `e2e` nesta fatia**, e é escolha, não esquecimento: o aceite da F52 é *isolamento entre
alunos sobre dado de saúde e financeiro*, e isso se mede no **servidor**, não no navegador. Um E2E
que abre a sessão de um aluno e clica nos cards provaria a navegação — que já tem teste de
componente — e **não** provaria que o aluno A não alcança a fatura de B, que é o que importa aqui.
Os 61 do Playwright continuam verdes, sem caso novo.

**Dois defeitos de produção achados na bancada entraram nesta fatia**, e os dois só apareceram
com a tela aberta: o `actorId` do totem violando a chave estrangeira de `audit_logs` (o totem não
tem usuário, e `KioskDevice` não é `User`), e a cobrança PIX que **travava a invoice para sempre**
quando o provedor não conhecia a tentativa pendente. O segundo é o mais caro: a linha `PROCESSING`
não sai do banco sozinha, então nenhum aluno voltava a gerar PIX para aquela fatura.

**Dois defeitos de produção achados na bancada entraram nesta fatia**, e nenhum dos dois apareceria
sem abrir a tela:

1. **O `actorId` do totem violava a chave estrangeira de `audit_logs`.** Montei o `TenantContext`
   com `kioskDeviceId` -- é UUID, compila, passa no typecheck -- mas a coluna referencia `users`, e
   um `KioskDevice` não é um `User`. O INSERT de auditoria derrubava a **transação inteira** da
   cobrança: ninguém pagava pelo totem.
2. **A cobrança PIX travava a invoice para sempre.** O reuso de tentativa pendente consulta o
   provedor, e `PROVIDER_NOT_FOUND` subia sem tratamento. Como a linha `PROCESSING` não sai do banco
   sozinha, a invoice ficava **permanentemente** sem poder gerar PIX novo. Vale para provedor real
   (cobrança expurgada por retenção, id de provedor anterior), não só para o dublê em memória.

O segundo custou uma rodada de teste vermelho para ficar certo: a primeira correção usou `.catch()`,
e o dublê lança de forma **síncrona** -- a porta devolve `Promise`, mas nada obriga a implementação a
ser `async`, e o `.catch()` encadeado nunca era alcançado.

**A contagem de integração foi somada em dois blocos**, porque `test:integration` completo **trava
na saída do Jest neste ambiente Windows** — o processo morre no encerramento, depois de todas as
suítes passarem, e nem o resumo nem o `--outputFile` chegam a ser escritos. É o mesmo defeito de
ambiente já registrado nas `SPEC-050` e `SPEC-051`, e **não é regressão desta fatia**: 43 suítes /
649 testes passavam antes com `exit 0`, e a F52 acrescenta 1 suíte / 10 testes.

O que a fatia cobre, por nível:

| nível | o que prova |
|---|---|
| unitário | `recortarHistorico` (fatura em aberto **não** é cortada por idade — cortá-la sumiria com a dívida em vez de errá-la, e o totem passaria a afirmar por omissão que não há o que pagar; desempate por `id` para a linha não pular de lugar entre dois carregamentos); `resumirMetricas` (tipo não medido **não some** da grade, e "primeira medição" nunca vira zero — INV-104); `agruparSegmentos` (braço esquerdo + direito viram uma linha; ausência **não** vira zero, que leria como "não há gordura ali"); `modulosVisiveis` (`ranking: true` não produz card); `deltaLegivel` (sinal explícito, e "sem mudança" ≠ "primeira medição") |
| integração | módulo desligado responde **404 com sessão válida**, e o **mesmo** 404 de uma sessão inexistente — quem sonda de fora não distingue os dois; `sessionId` de um aluno com token de outro responde 404; o aluno sem fatura recebe `KIOSK_NO_OPEN_INVOICE` em vez de alcançar a fatura alheia; a tentativa de pagamento de outro aluno responde 404, **nunca o estado**; o histórico de um aluno não traz a fatura do outro, **e o do outro traz a dele** (sem esse par, um endpoint que devolvesse sempre lista vazia passaria os dois) |
| componente | o QR **não tem botão de "já paguei"** (`M4-BR-001` — o backend confirma); `CANCELLED` é terminal mas **não** exibe "confirmado"; o laço para ao desmontar, para não confirmar para o próximo aluno; o aviso de não-diagnóstico **não tem botão de fechar**; a faixa de pendência **não mostra o valor** antes da etapa de pagamento |

**Provado por mutação em 26/08/2026** — cada trava foi quebrada de propósito para ver a suíte ficar
vermelha:

| mutação plantada | resultado |
|---|---|
| Trocar `exigirModulo` por `resolverParaDispositivo` (módulo desligado passaria a responder) | 1 teste vermelho |
| Anular a amarra da tentativa ao aluno (`if (false && !daSessao)`) | 1 teste vermelho |
| Tirar `tokenHash` do `where` da sessão (o UUID da URL autorizaria sozinho) | 1 teste vermelho |
| Acrescentar `ranking` à grade do painel (trava 2) | 1 teste vermelho, no `admin-web` |
| Tirar o `orderBy` da busca por CPF (CPF repetido voltaria a depender da ordem física) | 1 teste vermelho |
| Devolver `PROVIDER_NOT_FOUND` sem tratamento no reuso da cobrança PIX | 1 teste vermelho, em `billing-pix-webhook` |

🔴 **A primeira rodada de mutação achou um buraco real, e ele foi fechado antes do PR.** A trava 1
**não tinha teste de integração nenhum**: plantar a mutação deixava as 45 suítes verdes. A suíte
`kiosk-area-do-aluno.int-spec.ts` nasceu daí — antes dela, a trava existia no código e não existia
na prova, que é o mesmo que a guarda de lint sem canário já ensinou nesta casa.

**A guarda de regressão desta fatia tem nome:** *nenhum endpoint da área do aluno aceita id de aluno
ou de fatura*. É estrutural e verificável por leitura — os sete handlers recebem `sessionId` e
`x-session-token`, e o `studentId` sai de `KioskSession`. No dia em que alguém acrescentar um
parâmetro de aluno, a regressão não é sutil: é a assinatura do método mudando.

### Evidência da `SPEC-030` — F30, preferências e identidade pública

**PR: `—`** — preencher depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 30 --spec SPEC-030`, rodado em 27/08/2026, confirma o **unitário**:

```
| 2026-08-27 | #30 | SPEC-030 | unitário   | 2060 | 2060 | 0 | 75.5 | — |
```

**A linha não foi commitada em `reports/TESTS.md` na primeira tentativa**, e a razão virou achado:
o gerador manteve, para `integração`, o número da última execução bem-sucedida (645/645, herdado
da `SPEC-044`) em vez de refletir a execução real, que estava falhando. Commitar aquela linha
registraria prova que não existia. **Regerar e commitar `reports/TESTS.md` é passo do fechamento
desta fatia.**

⚠️ **O gerador de relatório herda o número anterior quando a suíte falha.** Isso não é bug desta
fatia — está descrito no §5 acima — mas é a armadilha que quase transformou 46 suítes quebradas em
uma linha verde no documento de evidência. Quem fechar fatia daqui em diante: confira o número
contra a execução, não contra o arquivo.

#### Percurso na tela — 27/08/2026, ambiente local completo

O plano da F30 exigia percorrer o fluxo com o servidor de pé, e a revisão final foi enfática:
*"não fechar sem ele"*. Feito com Playwright, API em `3344`, totem em `3000`, painel em `3010`.

| passo | resultado |
|---|---|
| Ligar o módulo `ranking` na configuração do totem, publicar | versão 3 publicada com `ranking: true` |
| Abrir a área do aluno por CPF | teclado na tela, campo `readonly` — só o teclado do totem digita |
| Ver o interruptor de ranking | **nasce `[checked]`** — o regime opt-out visível ao aluno |
| Conferir finalidades dormentes | `CHALLENGE` e `ENGAGEMENT_PUSH` **não aparecem** |
| Desligar o ranking | `PATCH … 200` na ponte; `ConsentRecord` `REFUSED` gravado |
| Reabrir a sessão | `RANKING: false` persistiu |
| Pedir apelido "Tigre" | gravado `PENDING`, `nomeExibido` **não vaza** o apelido pendente |
| Abrir a fila de moderação | o apelido aparece com o **nome completo do aluno**, vindo da API |
| Aprovar | `APPROVED`, `alias_normalized: tigre`, moderador registrado, fila esvazia |
| Voltar ao ranking | `nomeExibido` vira **"Tigre"** — o ciclo fecha |
| Repetir o `PATCH` com a mesma `idempotencyKey` | **uma única linha** em `consent_records` |

**O percurso achou a quinta falha de fiação da fatia** — e é a razão de ele existir. A aba de
módulos do painel **não listava `ranking`**: o módulo só podia ser ligado por SQL. O comentário
da F50 apontava a F33 como dona (*"quando a F33 entregar, ela acrescenta a linha aqui"*), e a
F30 chegou antes. Corrigido em `cffba6e`, com o teste que provava a ausência invertido.

**Nenhuma das cinco falhas de fiação desta fatia foi achada por revisão de diff.** Duas vieram
de teste de integração, uma da geração de evidência, e duas — `PATCH` ausente na ponte e o
campo que a API não enviava — só apareceriam abrindo a tela. Elas atravessam **processo**
(navegador → Next → Nest, e Nest → Next SSR), onde `fetch` e `chamarApi<T>` são casts não
verificados que nenhum compilador confere.

#### O defeito que a geração de evidência encontrou — e como escapou de seis revisões

Ao gerar a evidência acima, a integração **não subia**: `EngagementModule` não declarava
`TenantContextService` nos próprios `providers`, embora o `EngagementController` o injete.
`Test.createTestingModule({ imports: [AppModule] })` falhava ao montar o controller, e isso
derrubava **as 46 suítes de integração da API no boot** — 671 de 673 testes —, inclusive suítes
sem relação nenhuma com engajamento (`listar-invoices` entre elas).

**Corrigido em `dd43ce0`**, com uma linha e o import, no padrão que `PrivacyModule` e
`KioskAdminModule` já seguem. Verificado depois: `listar-invoices` 8/8, `engagement` 5/5,
unitário 943/943 no pacote, lint verde.

**Por que passou por seis revisões de código.** O teste unitário do controller declara
`TenantContextService` na mão dentro do `Test.createTestingModule` — passava verde enquanto o
`AppModule` real quebrava. É a mesma classe de defeito que já custou uma rodada nesta fatia (o
`EngagementModule` esquecido no `AppModule`, achado pela F30 na task de integração): **revisão de
diff não enxerga o que não está lá.** Só boot real enxerga.

A lição para o `docs/REVIEW.md`: quando uma fatia cria módulo Nest novo, a checagem de fiação
(`AppModule` o registra? o módulo declara tudo que seus controllers injetam?) não pode depender de
alguém reparar na ausência — precisa de teste que suba o `AppModule` de verdade.

O unitário (2060/2060, cobrindo os 48 testes próprios do módulo — `participacao.spec.ts`,
`exposicao.spec.ts`, `triagem-de-alias.spec.ts`, `engagement.service.spec.ts`,
`engagement.controller.spec.ts`) prova o domínio puro e o service com dublê de repositório.

O que ele **não** prova, e por isso existe `apps/api/test/integration/engagement.int-spec.ts`
(5 casos, verdes):

| o que o caso prova | por que só integração prova |
|---|---|
| os dois regimes na mesma tabela sem contaminação | exige `ConsentRecord` real com linhas de biometria e de engajamento lado a lado |
| dois alunos com o mesmo alias `PENDING` convivem | o índice é **parcial**; dublê não tem índice |
| o segundo `APPROVED` com o mesmo alias é recusado | a recusa vem do Postgres, não do código |
| o mesmo alias aprovado em outro tenant é permitido | prova que a chave inclui `tenant_id` |
| decisão vigente com `occurredAt` empatado | prova que o `orderBy` decide, não a ordem física |

Mais 7 casos em `kiosk-engajamento.int-spec.ts`, incluindo a dedupe por `idempotencyKey` contada
no banco — asserção só na resposta HTTP não distinguiria dedupe de regravação.

---

### Evidência da `SPEC-035` — F35, operação, moderação e experimento

**PR: [#222](https://github.com/RodReis/arenahub/pull/222)** — preenchido depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 35 --spec SPEC-035`, rodado em 28/08/2026, confirma o **unitário**:

```
| 2026-08-28 | #35 | SPEC-035 | unitário | 2557 | 2557 | 0 | 76.8 | — |
```

⚠️ **A linha de integração que o gerador escreveu não é desta execução.** O crash do Jest no
Windows (exit `3221226505`, pré-existente e registrado desde a F32) matou a saída antes do
resultado, e o gerador **herdou o número da última execução bem-sucedida** — exatamente o que ele
avisa em stderr:

```
[test:report] AVISO: apps/api (test:integration) nao produziu saida -- processo terminou com
status 3221226505 sem escrever o resultado. Mantendo o numero da ultima execucao bem-sucedida
para este alvo.
```

Isso já enganou uma vez, na F32. A integração desta fatia foi medida **suíte a suíte**, com as 48
suítes rodadas uma a uma — **734 testes, 0 falhas** —, e a linha do relatório foi corrigida à mão
para esse número (a guarda `--check` segue verde, porque ela confere o cache, não a origem). O 764
que o gerador escrevera era do `#220`.

```
| 2026-08-28 | #35 | SPEC-035 | integração | 734 | 734 | 0 | 83.9 | — |
```

⚠️ **E o próprio script de medição suíte a suíte tem uma aresta:** numa das execuções ele capturou
saída vazia para `billing-pix-webhook` e somou 716 em vez de 734. Rodada isolada, a suíte dá
18/18 — era captura vazia, não regressão. **A aritmética é a defesa:** 732 da medição anterior + 2
do teste de escopo novo = 734, e 716 + 18 = 734. Contagem que cai sem explicação é para investigar,
nunca para anotar.

#### O que os testes desta fatia provam, e o que cai se a regra sumir

Doze canários. Cada um foi executado com a regra removida, para provar que o teste falha:

| canário | o que cai sem a regra |
|---|---|
| `Math.abs` fora do teto de correção | 3 testes — toda correção **negativa** passaria por qualquer teto (`-5000 > 100` é falso) |
| categoria fora do `where` da regeneração | 1 — gerar frequência apagaria o rascunho de XP do mesmo mês |
| `tenantId` fora do escopo da contestação | 1 — moderador do tenant A fecharia contestação do tenant B, com 200 |
| contar linhas `ACCEPTED` em vez de subtrair | 2 — o painel mostraria quase zero participando numa academia inteira |
| `??` no lugar de `!== undefined` no teto | 1 — `null` (sem teto) viraria "não veio", e o campo vazio não limparia o limite |
| seletor de categoria sem enviar a escolha | 1 — o seletor viraria decoração e tudo cairia em XP pelo default |
| `trim()` fora do mínimo da contestação | 2 — oito espaços com duas letras no meio passariam como texto válido |
| linha removida da allowlist da ponte | 1 — a rota do totem daria 404 antes de assinar |
| permissão devolvida para `engagement.moderate` | 1 — quem só modera apelido voltaria a corrigir saldo de XP |
| `P2002` sem tradução em `salvarSnapshot` | 1 — regerar mês publicado voltaria a 500 genérico |
| meta da política fora de `contarSemanasQualificadas` | 4 — a categoria CONSISTÊNCIA voltaria a contar semana "tocada", empatando presença esporádica com regularidade real |
| `allowedUnitIds` fora do controller de contestações | 2 (integração) — gerente restrito voltaria a resolver contestação de outra unidade |

#### Verificação na API rodando e na tela

O CI não prova a tela, e esta fatia tem dois achados que só a execução real revelou (ver
`DEVELOPMENT.md`). O que foi exercido contra a API de verdade, com o build do dia:

| o quê | resultado |
|---|---|
| Teto de correção com limite 100 | `-500` recusado (`CORRECAO_ACIMA_DO_TETO`), `-50` aceito |
| Contestação | aberta → aparece na fila com o nome do aluno → resolvida → **409 na segunda tentativa** |
| Ocultar apelido | `HIDDEN` gravado; sem razão, **400** `RAZAO_DE_RECUSA_OBRIGATORIA` |
| Placar por categoria | as três geram snapshots **independentes** no mesmo mês/unidade |
| Regerar mês publicado | **409** `RANKING_SNAPSHOT_IMUTAVEL` (era 500 antes da correção) |
| Indicadores | 341 ativos, 341 no placar — o regime opt-out do ADR-046 medido ao vivo |

📌 **Duas armadilhas de ambiente, não do código.** A API servia **build de 25/08**, três dias
defasado — `/api/v1/health-goals` respondia, as rotas da F35 não existiam; e o `tsc` incremental
regenerou só os `.d.ts` até o `tsconfig.build.tsbuildinfo` ser removido. E `engagement.correct`
**não existe em banco já semeado**: deu 403 até o seed (idempotente) ser rodado — o mesmo valerá
em produção.

---

### Evidência da `SPEC-036` — F36, contrato de dados e baseline analítica

**PR: [#224](https://github.com/RodReis/arenahub/pull/224)** — preenchido depois do merge, pela regra
do topo desta seção.

`pnpm test:report --issue 36 --spec SPEC-036`, rodado em 31/08/2026:

```
| 2026-08-31 | #36 | SPEC-036 | unitário | 2624 | 2624 | 0 | 76.5 | — |
```

Unitário por pacote: **1348 API** (era 1282 na F35 — os 66 novos são desta fatia) + 443 painel +
247 totem + 204 ui + 199 edge + 72 access-policy + 66 api-contracts + 44 database.

⚠️ **A linha de integração do gerador é herdada, de novo.** Mesmo crash do Jest no Windows (exit
`3221226505`, pré-existente desde a F32) — o gerador avisou em stderr e manteve o número anterior
(764, do `#35`). **Medi suíte a suíte**, as 50 rodadas uma a uma, sem nenhuma captura vazia:

```
50 suítes · 856 testes · 0 falhas
```

📌 **A contagem saltou de 734 (F35) para 856, e só 7 são meus** — contagem que sobe sem explicação
é para investigar, e esta tem: a medição da F35 cobriu **48** suítes, o próprio commit `ed0395e`
acrescentou arquivos depois disso, e hoje o diretório tem **50**. Os outros ~114 testes vieram
junto da F35.

🔴 **A suíte estava vermelha na `main` quando esta fatia começou, e o motivo era o calendário.**

`xp-e-ranking` → *"devolve a consistencia junto do extrato"* (F32) treinava em **datas fixas**
(semana de 17–23/08/2026) e esperava `streak.atual === 1`, mas comparava contra o **relógio real**.
`resumirStreak` conta de trás para frente e **para na primeira semana `PERDIDA`** — quando a semana
de 24/08 fechou, o streak virou `0` e a asserção envelheceu. **Ninguém mudou uma linha de código:**
o último run verde da `main` é de 28/08, e o CI passou a falhar sozinho em 31/08.

Diagnosticado durante a F36 ao medir a integração, registrado na issue
[#223](https://github.com/RodReis/arenahub/issues/223) e **corrigido aqui** — a falha bloqueava a
`main` de qualquer PR, não só desta fatia.

**A correção é no teste, não no código.** O domínio já está certo: `avaliarSemanas` e
`resumirStreak` recebem `hojeLocal` por parâmetro e têm 25 testes unitários com datas injetadas.
Quem lê o relógio é o controller do totem (`new Date()`), e injetar um relógio só para teste seria
abstração de uso único. O bloco de integração passou a **ancorar na semana corrente** e derivar as
demais por posição relativa:

| antes | depois |
|---|---|
| `treinarSemanaDe17` (17, 19, 21/08) | `treinarSemanaQualificada` — seg/qua/sex da semana **anterior à corrente** |
| `projetarAte(new Date('2026-08-24'))` | `projetarAteHoje` |
| `semana.inicio === '2026-08-17'` | `semana.inicio === inicioDaSemanaTreinada()` |
| pausa em 24/08 → 31/08 | `naSemanaCorrente(-1)` → `naSemanaCorrente(7)` |

A semana treinada é a **anterior à corrente** por duas razões que o teste precisa das duas: já está
**fechada** (a corrente é `EM_ANDAMENTO` e nunca qualifica) e é **adjacente** (não há semana perdida
entre ela e hoje para romper o streak).

⚠️ **A primeira tentativa de correção quebrou dois vizinhos** — o bloco inteiro depende de semanas
correlacionadas (a treinada, a da pausa e "hoje"), e mover só uma âncora desalinha as outras.
Corrigir de verdade exigiu reescrever o bloco todo, incluindo as asserções que comparavam
`semana.inicio` com string literal. O resto da suíte **continua com data fixa de propósito**: ela
depende de `localMonth` (`'2026-08'`), que o `AGORA` fixo do topo do arquivo já resolve — só o
streak compara com o relógio real.

📌 **A migration não passou por `prisma migrate dev`.** A migration da F21 foi alterada depois de
aplicada (pré-existente, `ca8535e`), e o Prisma exige **reset do banco** — que apagaria os dados de
desenvolvimento. O SQL saiu de `prisma migrate diff --from-schema/--to-schema`, foi aplicado por
`psql` nos dois bancos (`arenahub` e `arenahub_int`) e registrado em `_prisma_migrations`. É
**aditiva**: só `CREATE TYPE`/`CREATE TABLE`, nenhum `DROP`. Quem pegar a F37 esbarra no mesmo
bloqueio.

🔬 **Canários (4).** Cada guarda desta fatia foi provada removendo-a e vendo o teste cair:

| guarda removida | testes que caem |
|---|---|
| condição de corte de conhecimento em `dentroDaJanela` | **3** |
| `ausente()` devolvendo `0` em vez de `null` | **7** |
| ordenação canônica do checksum | **2** |
| tratamento de `P2002` em `gravarSnapshot` | **1** (o de concorrência) |

O último merece nota: o teste de corrida usa **`Promise.all` de 3 gravações**, não chamadas em
fila. Sequencial não exercita a corrida — passa com o código quebrado, que é como o defeito
sobreviveria a uma revisão de diff.

🔎 **A revisão adversarial achou os dois defeitos que a suíte não pegava**, ambos no repositório
(o domínio puro passou limpo): o `P2002` acima, e `subscription.findFirst` **sem desempate** —
duas assinaturas com o mesmo `startsAt` deixariam a ordem física do Postgres escolher qual é a
corrente, e ela muda depois de um `UPDATE`. O efeito seria `SNAPSHOT_NAO_DETERMINISTICO`
disparando por ordenação e escondendo o alarme que existe para pegar leitura de estado mutável.
Terceira vez que este padrão aparece no repo.

---

### Evidência da `SPEC-037` — F37, regras explicáveis e score

**PR: [#225](https://github.com/RodReis/arenahub/pull/225)** — preenchido depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 37 --spec SPEC-037`, rodado em 31/08/2026:

```
| 2026-08-31 | #37 | SPEC-037 | unitário   | 2707 | 2707 | 0 | 76.4 | [#225](https://github.com/RodReis/arenahub/pull/225) |
| 2026-08-31 | #37 | SPEC-037 | integração |  753 |  753 | 0 | 83.9 | [#225](https://github.com/RodReis/arenahub/pull/225) — suíte a suíte |
```

Unitário: **2707** (era 2624 na F36 — os **83** novos são desta fatia). Integração: **753** em
**51 suítes**, sendo **12** da suíte nova `retencao-score-explicavel.int-spec.ts`.

⚠️ **A linha de integração do gerador continua herdada** — mesmo crash do Jest no Windows
(exit `3221226505`, pré-existente desde a F32). O gerador avisa em stderr e mantém o número
anterior, então a medição foi **suíte a suíte**, as 51 uma a uma.

🔴 **A contagem de integração da F36 estava inflada, e a correção é aqui.** A F36 registrou
**856**; medindo a `main` (`48bdfaa`, sem esta fatia) suíte a suíte, o número real é **741**. A
aritmética desta fatia fecha exata:

```
741 (base da main) + 12 (suíte nova da F37) = 753
```

O erro **não é de código**: nenhum teste sumiu, e a contagem de suítes (50 → 51) bate com o
único arquivo acrescentado. É de **medição** — a F36 mediu 856 onde a mesma árvore rende 741 hoje.
**Não reproduzi a rodada dela, então não afirmo a causa.** Uma armadilha plausível está no
mecanismo: o filtro por nome do Jest casa por substring, e `-- retencao` roda **2 suítes**, não 1
(`retencao-snapshot` e `retencao-score-explicavel`); um laço que filtre por prefixo em vez de
basename soma a mesma suíte várias vezes. Vale a lição já registrada — *contagem que sobe sem
explicação é para investigar* —, e desta vez a investigação encontrou o erro no número anterior,
não no atual.

📌 **Uma suíte veio vazia numa das passagens** (`sessao-multiarquivo`, captura sem saída) e foi
remedida sozinha: **14 testes, 0 falhas**. Captura vazia não é falha, mas **também não é zero** —
somá-la como zero teria produzido 739 e escondido a diferença.

📌 **A migration não passou por `prisma migrate dev`, pelo mesmo bloqueio que a F36 documentou.**
A migration da F21 foi alterada depois de aplicada (`ca8535e`), e o Prisma exige reset. O SQL saiu
de `prisma migrate diff --from-schema/--to-schema --output`, foi aplicado por `psql` nos dois
bancos (`arenahub` e `arenahub_int`) e registrado em `_prisma_migrations`. É **aditiva**: só
`CREATE TYPE`, `CREATE TABLE` e `ADD CONSTRAINT`, nenhum `DROP`.

**Provado que o CI aplica do zero:** `prisma migrate deploy` num banco recém-criado aplicou as
**51 migrations** sem erro. É o que o job de integração faz, e verificar localmente o caminho do
`psql` não provaria nada sobre ele.

⚠️ **`--output` é obrigatório no `migrate diff`.** Redirecionar o stdout (`> arquivo`) grava o
banner do `dotenv` dentro do SQL, e o `psql` morre com `invalid command \..` — a mensagem não
aponta para a causa. O `2>/dev/null` não resolve: o banner sai em **stdout**.

🔬 **Canários (3).** Cada guarda foi provada removendo-a e vendo o teste cair:

| guarda removida | testes que caem |
|---|---|
| `valor.valor` → `valor.valor ?? 0` em `avaliarRegra` | **2** unitários + **1** integração |
| `tenantId` no `where` da fila de risco | **2** integração |
| índice único `(snapshot, provider, versão)` | **2** integração (reexecução **e** corrida) |

🔴 **O primeiro canário achou um buraco real na suíte, e o conserto está nesta fatia.** Na
primeira tentativa, `?? 0` — o defeito exato que `M6-BR-002` existe para impedir — **passou verde
em toda a integração**. O motivo: o único teste com feature ausente usava um aluno novo, com
quase tudo ausente, que é **recusado por completude antes de qualquer regra ser avaliada**. A
ausência nunca chegava ao motor.

Dois testes novos fecham o buraco, e o segundo é o que mata o canário:

- *"feature ausente não pontua, mesmo com completude suficiente"* — completude `0.75` (passa o
  mínimo de `0.3`) com `days_past_due` ausente;
- *"zero observado pontua, ausente não"* — **dois alunos com o mesmo vetor**, um com
  `attendance_days_30d = 0` (faltou o mês) e outro com a mesma feature **ausente** (entrou
  ontem). Colapsados, entrariam na fila com o mesmo número, e a recepção ligaria para quem acabou
  de se matricular.

📌 **O canário da corrida usa `Promise.all` de 3 rodadas**, pela razão que a F36 registrou:
sequencial não exercita a corrida e passa com o código quebrado. A gravação tenta escrever e
trata `P2002` — ler-antes-de-escrever perde a corrida por construção.

---

### Evidência da `SPEC-038` — F38, CRM de retenção

**PR: [#226](https://github.com/RodReis/arenahub/pull/226)** — preenchido depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 38 --spec SPEC-038`, rodado em 31/08/2026:

```
| 2026-08-31 | #38 | SPEC-038 | unitário   | 2768 | 2768 | 0 | 76.3 | [#226](https://github.com/RodReis/arenahub/pull/226) |
| 2026-08-31 | #38 | SPEC-038 | integração |  765 |  765 | 0 | 83.9 | [#226](https://github.com/RodReis/arenahub/pull/226) — suíte a suíte |
```

Unitário: **2768** (era 2707 na F37 — os **61** novos são desta fatia). Integração: **765** em
**52 suítes**, sendo **12** da suíte nova `retencao-crm-tarefas.int-spec.ts`. A aritmética fecha:

```
753 (base da F37) + 12 (suíte nova) = 765
```

⚠️ **A linha de integração do gerador continua herdada** — mesmo crash do Jest no Windows
(exit `3221226505`, pré-existente desde a F32). Medição suíte a suíte, as 52 uma a uma, **por
`basename`** — filtrar por prefixo é a armadilha que a F37 registrou, porque o filtro do Jest casa
por substring e soma a mesma suíte várias vezes.

📌 **Uma suíte veio vazia** (`auth`, captura sem saída) e foi remedida: **42 testes, 0 falhas**.
Somá-la como zero teria produzido 723 e escondido a diferença.

🔬 **Canários (3).** Cada guarda foi provada removendo-a:

| guarda removida | testes que caem |
|---|---|
| índice parcial `(tenant, aluno, estratégia) WHERE ativo` | **1** integração |
| comparação de cooldown em `selecionarFila` | **2** unitários + **1** integração |
| `criadaEm` explícito (volta a `@default(now())`) | **1** unitário |

🔴 **O canário do cooldown achou um DEFEITO REAL no código, não só no teste.** Este é o segundo
achado da mesma família da F37, e vale registrar em detalhe porque a primeira versão do teste
passava por **três** motivos errados em sequência:

1. **Passava pelo `@@unique(score_id)`.** O teste reusava o mesmo `scoreId` para tentar a segunda
   tarefa. A criação era recusada — mas pela chave de score, não pelo cooldown. Corrigido criando
   um score novo de outro dia, que é o que o pipeline produz amanhã.
2. **Passava pelo índice parcial.** Com a tarefa ainda ativa, o índice já bloqueava. Corrigido
   dispensando a tarefa antes (terminal libera o índice parcial, que é *parcial* por isso).
3. **Com 1 e 2 fora do caminho, o teste falhou — e a falha era do código.** `criadaEm` vinha do
   `@default(now())` do Postgres, enquanto o cooldown comparava contra o `agora` da aplicação. Com
   datas de teste no futuro (2026), a subtração dava negativo e o cooldown nunca segurava nada. A
   correção passa a criação por parâmetro, como o "agora" — a mesma disciplina que o `CLAUDE.md`
   exige das funções de cálculo.

**A lição, que generaliza:** um canário verde não prova a guarda quando **outra** guarda recusa o
caso antes dela. Na F37 foi a completude recusando antes da regra; aqui foram duas chaves únicas
recusando antes do cooldown. Montar o cenário que **alcança** a guarda testada é parte do canário,
não um detalhe.

📌 **O índice parcial é a garantia que o `@@unique(score_id)` não dá**, e o teste que o prova usa
score de **outro dia** — o caso normal, porque o pipeline roda diariamente. Sem ele, o mesmo aluno
receberia uma ligação por dia pelo mesmo motivo. O teste irmão prova que o índice é mesmo
*parcial*: tarefa terminal libera o aluno para uma nova.

📌 **A migration passou por `psql` nos dois bancos**, pelo bloqueio que a F36 documentou, e
`migrate deploy` num banco recém-criado aplicou as **52 migrations** — é o que o job de integração
do CI faz.

🔴 **O CI reprovou por um teste que esta fatia não tocou, e a correção entrou aqui.**
`painel-do-placar.test.tsx` (F35, `admin-web`) falhou com
`expect(element).toHaveValue(null) / Received: -10` no job de unitários — num PR cujo diff **não
inclui uma linha de `admin-web`**.

**Era corrida, não regressão.** A limpeza do formulário mora num `useEffect` que roda **depois** do
render que mostra `ajuste-registrado`; o teste esperava o segundo e assertava o primeiro. Passa na
máquina rápida, falha na lenta — e o runner do GitHub é a lenta.

**Provado, não suposto.** Local o teste passava 5 vezes seguidas nos dois formatos, então plantei um
canário no componente (`setTimeout` de 30ms na limpeza) para simular a máquina lenta:

| versão do teste | com a limpeza atrasada |
|---|---|
| asserção direta (como estava na `main`) | ❌ **falha**, com o erro exato do CI |
| `waitFor` (como ficou) | ✅ passa |

O canário foi removido; só o teste mudou. **O código estava certo** — `useEffect` para limpar após
sucesso é o padrão, e o defeito era a expectativa do teste sobre *quando* isso acontece.

⚠️ **`gh pr checks --watch` saiu com 0 mesmo com o job vermelho**, de novo (já registrado na
memória do repo). A conferência que vale é `gh pr checks <n>` sem `--watch`, ou `gh run view` job a
job.

---

### Evidência da `SPEC-039` — F39, experimento operacional

**PR: [#227](https://github.com/RodReis/arenahub/pull/227)** — preenchido depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 39 --spec SPEC-039`, rodado em 31/08/2026:

```
| 2026-08-31 | #39 | SPEC-039 | unitário   | 2808 | 2808 | 0 | 76.1 | [#227](https://github.com/RodReis/arenahub/pull/227) |
| 2026-08-31 | #39 | SPEC-039 | integração |  779 |  779 | 0 | 83.9 | [#227](https://github.com/RodReis/arenahub/pull/227) — suíte a suíte |
```

Unitário: **2808** (era 2768 na F38 — os **40** novos são desta fatia). Integração: **779** em
**53 suítes**, sendo **14** da suíte nova `retencao-experimento.int-spec.ts`. A aritmética fecha:

```
765 (base da F38) + 14 (suíte nova) = 779
```

Medição suíte a suíte por `basename`, as 53 uma a uma — zero falhas, **nenhuma captura vazia** nesta
rodada. Mesmo crash do Jest no fim no Windows (exit `3221226505`, pré-existente desde a F32).

🔬 **Canários (3).** Cada guarda foi provada removendo-a:

| guarda removida | testes que caem |
|---|---|
| semente no hash de randomização | **1** unitário + **1** integração |
| filtro do braço `CONTROLE` na fila | **3** unitários |
| filtro de controle ANTES do corte de capacidade | **1** unitário |

🔴 **O primeiro canário achou um buraco na suíte — terceira fatia seguida com o mesmo padrão.**
Remover a semente do hash (`sha256(studentId)` em vez de `sha256(semente ␟ studentId)`) derrubava
**só o unitário**; a integração inteira passava verde. Nenhum teste de integração usava duas
sementes, então a consequência real — *o mesmo aluno preso no controle em todos os experimentos,
acumulando nas mesmas pessoas o custo de nunca receber intervenção* — nunca era exercitada.

Teste novo: dois experimentos com sementes diferentes sobre os **mesmos 40 alunos**, exigindo que as
divisões divirjam. Com a semente ignorada seriam 40 coincidências de 40; com ela, fica perto de 20.

**A lição já é regra:** guarda verde não prova nada quando o cenário não **alcança** a guarda. Na
F37 era a completude recusando antes da regra de ausência; na F38, duas chaves únicas antes do
cooldown; aqui, a ausência de um segundo experimento.

📌 **O terceiro canário cobre um defeito de ORDEM, não de lógica.** Mover o filtro de controle para
depois do corte de capacidade não quebra nada visivelmente: a fila continua saindo, o controle
continua sem tarefa. Mas o controle passa a **consumir vaga** — a recepção trata 16 numa capacidade
de 20, o braço de tratamento fica menor do que a operação aguenta, e o experimento mede uma
intervenção mais fraca do que a real. É o tipo de viés que só aparece no resultado final, meses
depois, sem sintoma no caminho.

📌 **A imutabilidade mora em TRIGGER, e os testes batem no banco.** Cinco testes de integração
tentam a escrita proibida direto pelo Prisma: mudar o grupo de uma alocação, mexer em `seed` e em
`control_fraction` depois de `RUNNING`, alocar o mesmo aluno duas vezes, gravar o mesmo efeito
adverso duas vezes. Todos são recusados **pelo Postgres**, não por um `if` no serviço — guarda em
serviço é uma porta, e correção manual ou script de migração passam por fora dela.

📌 **A migration inclui `CREATE FUNCTION` e `CREATE TRIGGER`**, e `migrate deploy` num banco
recém-criado aplicou as **53 migrations** sem erro — é o que o job de integração do CI faz. Aplicada
por `psql` nos dois bancos, pelo bloqueio que a F36 documentou.

---

### Evidência da `SPEC-041` — F41, produção controlada e monitoramento

**PR: [#229](https://github.com/RodReis/arenahub/pull/229)** — preenchido depois do merge, pela regra do topo desta seção.

`pnpm test:report --issue 41 --spec SPEC-041`, rodado em 31/08/2026:

```
| 2026-08-31 | #41 | SPEC-041 | unitário   | 2843 | 2843 | 0 | 76.0 | [#229](https://github.com/RodReis/arenahub/pull/229) |
| 2026-08-31 | #41 | SPEC-041 | integração |  791 |  791 | 0 | 83.9 | [#229](https://github.com/RodReis/arenahub/pull/229) — suíte a suíte |
```

Unitário: **2843** (era 2808 na F39 — os **35** novos são desta fatia). Integração: **791** em
**54 suítes**, sendo **12** da suíte nova `retencao-monitoramento.int-spec.ts`:

```
779 (base da F39) + 12 (suíte nova) = 791
```

Medição suíte a suíte por `basename`. Uma captura veio vazia (`retencao-crm-tarefas`) e foi
remedida: **12 testes, 0 falhas** — vazia não é zero.

🔬 **Canários (3).** Cada guarda foi provada removendo-a:

| guarda removida | testes que caem |
|---|---|
| kill switch em `pontuarDia` | **1** unitário + **3** integração |
| `estado.ligado &&` em `precisaDeAtencao` | **1** unitário + **1** integração |
| `createdAt` → `observedAt` na saúde do pipeline | **1** integração |

🔴 **Dois dos três canários acharam buraco na suíte — e o terceiro não era pego por nada.**

**Canário 2** derrubava só o unitário. O teste de integração *"o painel acusa DESLIGADO"* não tinha
drift crítico junto, então `precisaDeAtencao: false` sairia mesmo **sem** a guarda de
`estado.ligado`. Teste novo: mesmo tenant, drift crítico presente, medido **ligado** (alarma) e
**desligado** (não alarma).

**Canário 3 não derrubava nada.** Trocar `createdAt` por `observedAt` na leitura da saúde passava
verde em toda a suíte. A consequência é real: numa **reconstrução histórica** — operação legítima
que a F36 desenhou o corte de conhecimento para permitir — o pipeline grava `observedAt` antigo com
`createdAt` de hoje. Lendo `observedAt`, um pipeline que rodou há 5 horas apareceria como parado há
meses, e o alarme dispararia toda vez que alguém reconstruísse histórico. Teste novo: snapshot com
`observedAt` em março e `createdAt` hoje deve sair **SAUDAVEL**.

**Quarta fatia seguida com o mesmo padrão**, e desta vez em duas variantes novas:

| fatia | por que o canário não alcançava |
|---|---|
| F37 | completude recusava antes da regra |
| F38 | duas chaves únicas recusavam antes do cooldown |
| F39 | faltava a segunda dimensão (só uma semente) |
| **F41** | cenário sem o segundo fator (drift + desligado juntos) **e** distinção de campo nunca exercitada |

📌 **Um teste meu estava errado, e o código certo.** A primeira versão do teste de drift punha os
dois snapshots (01/09 e 05/09) na **mesma janela de 7 dias** — não havia o que comparar, e o teste
falhou. A janela é intencional (7 dias contra 7 anteriores, para não confundir segunda com domingo);
o conserto foi empurrar o snapshot base para 25/08, dentro do período ANTERIOR. Vale registrar
porque o sintoma (drift não detectado) apontava para o código.

📌 **A migration é a menor do MVP 6**: uma coluna booleana com `DEFAULT true`. Tenants existentes
nascem ligados — kill switch é **opt-in**, e um default `false` desligaria o scoring de todo mundo
no deploy. `migrate deploy` num banco recém-criado aplicou as **54 migrations**.

---

### Evidência da `SPEC-057` — F57, dashboard operacional

**PR: [#247](https://github.com/RodReis/arenahub/pull/247)** — mergeado em 01/09/2026, CI verde nos dois jobs.

`pnpm test:report --issue 242 --spec SPEC-057`, rodado em 01/09/2026:

```
| 2026-09-01 | #242 | SPEC-057 | unitário   | 2897 | 2897 | 0 | 75.7 | [#247](https://github.com/RodReis/arenahub/pull/247) |
| 2026-09-01 | #242 | SPEC-057 | integração |  796 |  796 | 0 | 83.9 | [#247](https://github.com/RodReis/arenahub/pull/247) — suíte a suíte |
```

Unitário: **2897** (era 2868 na #245 — os **29** novos são desta fatia: 13 de `feriados`, 7 de
`inicioDoDiaLocal`, 4 de `compararSituacoes`, 6 do feed e 4 do seletor). Integração: **796** em
**56 suítes**, sendo **13** da suíte nova `dashboard-operacional.int-spec.ts`.

⚠️ **O `test:report` gravou 810, e o número está errado — corrigido à mão.** O Jest crasha no fim
no Windows (comportamento conhecido desde a F38), e o gerador, sem saída para ler, **manteve o
número da última execução bem-sucedida** — o 810 da #245. Ele avisa quando faz isso, em vez de
inventar, e o aviso é que denuncia:

```
[test:report] AVISO: apps/api (test:integration) nao produziu saida --
processo terminou com status 3221226505 sem escrever o resultado.
Mantendo o numero da ultima execucao bem-sucedida para este alvo.
```

**796 foi conferido por duas medições independentes**, porque manter um número herdado é
exatamente a forma de o relatório mentir com aparência de evidência:

```
medição 1 — execução suíte a suíte:  ok=796  falha=0  (56 suítes)
medição 2 — contagem estática dos `it`/`test` declarados:  796
```

🔬 **Canários (2).**

| guarda removida | testes que caem |
|---|---|
| `parar()` no ramo `oculta` de `visibilitychange` | **2** unitários (`PARA de recarregar`, `volta a recarregar`) |
| desempate de `compararSituacoes` (só `quantidade`) | **3** unitários |

O primeiro importa porque o comportamento é **ausência de requisição**, e ausência é o que mais
facilmente passa despercebido: sem ele, um teste que só afirmasse o rótulo "pausado" continuaria
verde com o ciclo rodando por baixo.

🔴 **O segundo canário REPROVOU o teste que eu tinha escrito, e essa é a lição da fatia.** A ordem
estável do bloco 4 nasceu testada por **integração**: ler duas vezes pela rota, escrever no aluno
entre as leituras e exigir a mesma ordem. Passava verde — **e continuou verde com o desempate
removido**. A ordem física do Postgres não é reproduzível sob demanda: um `UPDATE` numa tabela
pequena não move a tupla o bastante, e o teste passava pelo motivo errado.

**O defeito é real, e foi medido no banco antes de decidir o que fazer:**

```
 status    | status_reason | count
-----------+---------------+-------
 SUSPENDED | MEDICAL       |     5
 BLOCKED   | DELINQUENCY   |     5
 BLOCKED   | CONDUCT       |     5
```

Três grupos com contagem **idêntica**, já devolvidos numa ordem que não é a de inserção. O teste de
integração saiu (teste decorativo é pior que teste nenhum — afirma cobertura que não tem, e o
arquivo agora explica por que ele não está lá), a comparação virou função pura exportada
(`compararSituacoes`) e o teste unitário a alimenta com as entradas **na ordem errada de
propósito**, incluindo as seis permutações. Aí o canário derruba **3**.

📌 **A guarda do contrato OpenAPI pegou o que nenhuma outra camada pega.** Rota nova sem
`@ApiOkResponse` reprova em `openapi.int-spec.ts` — e **typecheck, lint e `pnpm build` passam
todos**. As quatro rotas da fatia ganharam schema declarado à mão: o Nest só infere schema de
**classe** decorada, e o painel consome `interface`.

📌 **Um teste de contraste que não é teste automatizado, e por isso está escrito aqui.** O passe
visual do PI tinge a superfície do KPI com o tom semântico. Os quatro tons foram **medidos**, não
estimados, contra os limites de WCAG AA (`M1-NFR-008`):

| tom | valor (30 px, precisa ≥3,0) | rótulo (11 px, precisa ≥4,5) |
|---|---|---|
| `success` | 5,17 | 5,95 |
| `warning` | 5,77 | 5,93 |
| `danger` | 5,13 | 5,88 |
| `info` | 5,27 | 5,94 |

A primeira medição usou um cinza **chutado** (`#6b7280`) e deu 4,38 — reprovando. O valor real do
token, lido do navegador, é `rgb(86,94,105)`, e dá 5,95. Registrar isso importa: **o palpite
reprovava e o dado aprovava**, e agir sobre o palpite teria mudado um token por um defeito
inexistente.

📌 **A migration cria uma tabela e não altera nenhuma.** `local_holidays` com `@@unique(gymUnitId,
date)` — sem ele, dois cliques no botão deixam o mesmo feriado duas vezes na lista, e o teste de
integração prova que o segundo cadastro **atualiza o nome** em vez de duplicar a linha.

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

### A regra 1 do DS no CSS — `scripts/check-css-tokens.mjs`

Roda dentro de `pnpm test:guardas`, antes das guardas de `run-task` e de porta. Não é passo novo do
pipeline: é um furo tapado num passo que já existia.

As seis regras do design system (`packages/config/eslint/design-system.js`) são **seletores de AST
de JavaScript** — `Literal`, `TemplateElement`. Nenhum deles enxerga um `.css`. A regra 1 diz "hex
literal fora de `packages/ui/tokens` é erro", e até 31/08/2026 ela valia **apenas** para cor escrita
dentro de TSX.

O custo foi medido, não suposto: **32 valores `oklch()`** do `shadcn add` moraram em
`apps/admin-web/app/globals.css` com o lint verde o tempo todo — num arquivo cujo próprio
comentário mandava "NAO reintroduza valor literal aqui". Nenhum era consumido, e nenhum tinha
contraste verificado.

A guarda pega hex, `rgb()`, `hsl()` e `oklch()`/`lab()`/`lch()` cru em `.css`. Ignora três coisas de
propósito, e cada uma tem razão:

- `packages/ui/tokens/**` e `dist-tokens/**` — a fonte legítima de hex, que é o que a regra 1
  protege.
- `color-mix(… var(--ah-*) …)` — composição sobre token continua sendo token.
- **Cor citada em comentário.** Este repositório documenta decisão de contraste citando o hex
  medido (`#A6AEB9` vale 8.24 sobre a sidebar) e cita issue por número (`#229`). Sem essa exclusão a
  guarda reprovaria a própria prosa que explica por que a regra existe.

Exceção é **nominal, por arquivo e com motivo escrito**, no mesmo molde do `eslint/design-system.js`
— duas hoje, ambas do totem: o `#fff` do cartão de QR (§5.6: sobre o carbono, o leitor de celular
não acha o padrão) e o gradiente metálico da moldura (§3.1 o especifica em hex).

**Provada com canário, nas duas direções.** Plantei `#BADA55` e `oklch(0.205 0 0)` — os dois
reprovaram com exit 1; o segundo é literalmente o caso que passou batido. *Guarda verde sem canário
não prova nada: regra ausente é indistinguível de regra satisfeita* — a mesma lição que a §5 desta
casa já registra.

E ela achou defeito no primeiro `run`: o glow da moldura do totem estava em
`rgb(77 124 255 / 14%)` — o `brand-500` **azul** escrito à mão. O halo continuava azul quando o
tenant escolhia VERDE, LARANJA ou ROXO, discordando da marca que o boot acabara de resolver.

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
