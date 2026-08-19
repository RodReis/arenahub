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
| Extração de laudo | `DocumentExtractor` | fake + golden files **anonimizados** | OCR é não-determinístico |
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

**Objetivo:** ligar cada SPEC/fatia aos testes que a provam, com número que veio de execução.

**Artefato:** `reports/TESTS.md`, gerado por `pnpm test:report`, **commitado no PR**. O CI
roda `pnpm test:report --check` e falha se o arquivo commitado divergir do que a execução
produz — é a guarda de evidência citada no `CLAUDE.md`.

**Conteúdo mínimo de cada linha do relatório:**

| campo | vem de |
|---|---|
| SPEC / fatia | tag no teste ou caminho do módulo |
| nível | sufixo do arquivo |
| total / passou / falhou / pulado | saída do runner |
| cobertura de regra de domínio | saída do coverage |
| data e SHA da execução | CI |

**O gerador tem um self-check** (`pnpm test:report:selfcheck`): um teste do próprio gerador,
que garante que ele conta o que existe. Gerador de relatório sem teste é a forma mais elegante
de mentir com número.

> **Nada disso existe ainda.** `scripts/`, `reports/` e `.github/workflows/ci.yml` fazem parte
> do bootstrap (`docs/DEVELOPMENT.md` §4, bootstrap `[INFRA]`). Enquanto não existirem, **não há relatório e não
> há evidência** — e nenhum documento deste repositório pode afirmar que há.

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

*(uma linha por execução relevante. Só entra o que tem SHA e saída de máquina.)*

| data | SHA | F/SPEC | total | passou | falhou | cobertura domínio |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

**Nenhuma execução até 14/08/2026.** O repositório não tem código nem runner configurado.

---

## 9. Critérios de aceite deste documento

- [ ] `pnpm test`, `test:integration` e `test:e2e` existem e rodam (bootstrap)
- [ ] Classificador por sufixo implementado no `test-report.config.json`
- [ ] `scripts/gen-test-report.ts` + self-check
- [ ] `.github/workflows/ci.yml` com os 8 passos
- [ ] Portão de cobertura de 80% em regras de domínio ligado
- [ ] Simulador Topdata rodando em CI sem hardware (`M0-NFR-006`)
- [ ] Primeira linha real na tabela da §8
