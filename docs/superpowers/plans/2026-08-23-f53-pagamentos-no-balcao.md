# F53 — Pagamentos e cobrança no balcão · plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recepcionista atende no balcão e resolve o pagamento em uma tela só — dinheiro, PIX ou cartão — com confirmação vinda do backend e recibo em toda confirmação.

**Architecture:** Backend NestJS ganha o nono método da porta `PaymentProvider` (`createHostedCheckout`), um caso de uso que o chama, uma leitura barata para o polling e a lista transversal de faturas. A tela `/students/[id]/billing`, que já existe desde a F12, passa a perguntar a forma de pagamento antes do valor. Nenhuma rota nova no `admin-web`, nenhuma migration de coluna.

**Tech Stack:** NestJS + Prisma 7 (`adapter-pg`) + PostgreSQL · Next.js App Router (Server Components) + `@arenahub/ui` · Jest (api), Vitest + Testing Library (web), Playwright (E2E).

**Spec:** [`docs/specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md`](../../specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md)
**Design:** [`docs/superpowers/specs/2026-08-23-f53-pagamentos-no-balcao-design.md`](../specs/2026-08-23-f53-pagamentos-no-balcao-design.md)
**Card:** [#156](https://github.com/RodReis/arenahub/issues/156)

## Global Constraints

Valem para **toda** task. Não repetidas em cada uma.

- **Dinheiro é `Int` em centavos.** Nunca `float`, nunca `number` para valor monetário (INV-065, `M2-BR-001`).
- **`tenant_id` no `where` de toda consulta.** O tenant vem da identidade autenticada, nunca do corpo (regra de arquitetura nº 2).
- **Id de outro tenant responde 404, nunca 409.** 409 vaza que o id existe em algum lugar — oráculo de existência entre academias (INV-006).
- **Nenhum PAN, CVV ou trilha** em coluna, log, teste ou campo de formulário (INV-098).
- **O "agora" entra por parâmetro** nos casos de uso — nunca `new Date()` dentro da regra (`CLAUDE.md`, Convenções de código).
- **Idioma:** código e identificadores em inglês; nomes de arquivo, comentários, mensagens de UI e commits em **pt-BR**. Os arquivos deste módulo usam nome em português (`criar-cobranca-pix.use-case.ts`) — siga o padrão.
- **Erro de domínio tem código estável** e resposta `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`.
- **Toast, nunca `alert`**, para info/warn/error (`CLAUDE.md`).
- **Sem hex literal no `admin-web`** — só tokens `--ah-*`. A lint reprova hex (ADR-026/031).
- **Commits em pt-BR**, formato `<tipo>: <descrição>`. Tipos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- **`pnpm test` NÃO roda integração** — só unit. Antes de commitar algo com teste de integração, rodar `pnpm test:report`.

---

## Estrutura de arquivos

### `apps/api` — criar

| arquivo | responsabilidade |
|---|---|
| `src/modules/billing/criar-checkout-de-cartao.use-case.ts` | caso de uso do checkout hospedado |
| `src/modules/billing/consultar-tentativa.use-case.ts` | leitura barata para o polling (só banco) |
| `src/modules/billing/listar-invoices.use-case.ts` | lista transversal do tenant, paginada |
| `src/modules/billing/domain/dados-de-cobranca.ts` | regra pura: que dados do aluno o cartão exige |
| `src/modules/billing/domain/dados-de-cobranca.spec.ts` | teste da regra pura |
| `test/integration/checkout-de-cartao.int-spec.ts` | concorrência, idempotência, isolamento |
| `test/integration/listar-invoices.int-spec.ts` | paginação, filtros, isolamento |

### `apps/api` — modificar

| arquivo | mudança |
|---|---|
| `src/modules/billing/provider/payment-provider.port.ts` | `createHostedCheckout` — nono método |
| `src/modules/billing/provider/fake-payment-provider.ts` | implementa o método novo |
| `src/modules/billing/billing.controller.ts` | 3 rotas novas |
| `src/modules/billing/billing.module.ts` | registra os 3 casos de uso |
| `src/modules/students/students.controller.ts` (ou onde vive o Zod do aluno) | CPF obrigatório |
| `src/modules/billing/billing.repository.ts` | `timezone` da unidade na resposta de invoices |

### `packages/database` — criar

| arquivo | responsabilidade |
|---|---|
| `prisma/migrations/<timestamp>_f53_checkout_em_voo/migration.sql` | **só se a Task 3 medir o furo** |

### `apps/admin-web` — criar

| arquivo | responsabilidade |
|---|---|
| `app/(protected)/students/[id]/billing/seletor-de-forma.tsx` | escolha da forma de pagamento |
| `app/(protected)/students/[id]/billing/cobranca-por-qr.tsx` | QR + copia-e-cola + polling (PIX e cartão) |
| `app/(protected)/students/[id]/billing/cobranca-por-qr.test.tsx` | polling para no terminal e no expirado |
| `app/(protected)/students/[id]/billing/seletor-de-forma.test.tsx` | cartão desabilitado sem CPF |
| `app/(protected)/students/[id]/billing/situacao-atual.tsx` | topo: o que o aluno deve agora |
| `src/billing/dados-do-cartao-nao-entram-no-painel.test.ts` | guarda estrutural |
| `tests/e2e/pagamento-no-balcao.spec.ts` | aceite §6.1 da spec |

### `apps/admin-web` — modificar

| arquivo | mudança |
|---|---|
| `app/(protected)/students/[id]/billing/page.tsx` | fuso da API; `situacao-atual` no topo |
| `app/(protected)/students/[id]/billing/painel-de-cobranca.tsx` | forma antes do valor; recibo |
| `app/actions/billing.ts` | server actions das cobranças novas |

---

## Task 1: A regra pura — que dados o cartão exige

Antes de qualquer I/O. A regra é: **cartão exige CPF e endereço; dinheiro e PIX não exigem nada.** O antifraude da Getnet bloqueia `customer` incompleto (spec §9), e descobrir isso pela resposta do provedor custa uma requisição para receber um bloqueio.

**Files:**
- Create: `apps/api/src/modules/billing/domain/dados-de-cobranca.ts`
- Test: `apps/api/src/modules/billing/domain/dados-de-cobranca.spec.ts`

**Interfaces:**
- Consumes: nada — é a primeira task, função pura sem dependência.
- Produces: `type DadoFaltante = 'CPF' | 'ENDERECO'`; `interface DadosDoAluno { cpf: string | null; temEndereco: boolean }`; `function faltaParaCartao(aluno: DadosDoAluno): readonly DadoFaltante[]`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
import { faltaParaCartao } from './dados-de-cobranca.js';

describe('faltaParaCartao', () => {
  it('nao falta nada quando o aluno tem CPF e endereco', () => {
    expect(faltaParaCartao({ cpf: '12345678901', temEndereco: true })).toEqual([]);
  });

  it('acusa o CPF ausente', () => {
    expect(faltaParaCartao({ cpf: null, temEndereco: true })).toEqual(['CPF']);
  });

  it('acusa o endereco ausente', () => {
    expect(faltaParaCartao({ cpf: '12345678901', temEndereco: false })).toEqual(['ENDERECO']);
  });

  /*
   * OS DOIS DE UMA VEZ, em ordem estavel. A tela lista o que falta numa
   * frase; ordem instavel faria a mesma pendencia aparecer de dois jeitos
   * entre dois carregamentos.
   */
  it('acusa os dois, sempre na mesma ordem', () => {
    expect(faltaParaCartao({ cpf: null, temEndereco: false })).toEqual(['CPF', 'ENDERECO']);
  });

  /*
   * CPF EM BRANCO nao e CPF. A coluna e anulavel e a base do Pacto tem 308
   * alunos sem ele (ADR-034); string vazia vinda de importacao antiga
   * passaria por `!== null` e chegaria ao antifraude como campo vazio.
   */
  it('trata CPF em branco como ausente', () => {
    expect(faltaParaCartao({ cpf: '   ', temEndereco: true })).toEqual(['CPF']);
  });
});
```

- [ ] **Step 2: Rode o teste e veja falhar**

Run: `pnpm --filter @arenahub/api test -- dados-de-cobranca`
Expected: FAIL — `Cannot find module './dados-de-cobranca.js'`

- [ ] **Step 3: Implemente o mínimo**

```ts
/**
 * Que dados de cadastro o pagamento com CARTAO exige — e por que os outros
 * dois caminhos nao exigem nada.
 *
 * O antifraude da Getnet bloqueia `customer` incompleto (SPEC-053 §9): nome,
 * e-mail, telefone, CPF e endereco de cobranca. Dinheiro e PIX nao passam
 * pelo antifraude, entao exigir cadastro completo neles barraria recebimento
 * legitimo -- o aluno legado sem CPF paga em especie normalmente.
 *
 * PURA de proposito: nao le banco nem chama provedor. A tela precisa da
 * mesma resposta ANTES de clicar (para desabilitar a opcao com o motivo) e o
 * caso de uso precisa dela DEPOIS (para recusar sem gastar requisicao). Duas
 * copias da regra divergiriam no primeiro campo novo.
 */

export type DadoFaltante = 'CPF' | 'ENDERECO';

export interface DadosDoAluno {
  /** Anulavel: a coluna e `String?` e 308 alunos do Pacto nao tem (ADR-034). */
  readonly cpf: string | null;
  readonly temEndereco: boolean;
}

export function faltaParaCartao(aluno: DadosDoAluno): readonly DadoFaltante[] {
  const faltando: DadoFaltante[] = [];

  // `trim()`: importacao antiga produz string vazia, que nao e CPF.
  if (aluno.cpf === null || aluno.cpf.trim() === '') {
    faltando.push('CPF');
  }

  if (!aluno.temEndereco) {
    faltando.push('ENDERECO');
  }

  return faltando;
}
```

- [ ] **Step 4: Rode o teste e veja passar**

Run: `pnpm --filter @arenahub/api test -- dados-de-cobranca`
Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/domain/dados-de-cobranca.ts apps/api/src/modules/billing/domain/dados-de-cobranca.spec.ts
git commit -m "feat: regra pura dos dados que o cartao exige do aluno"
```

---

## Task 2: `createHostedCheckout` na porta e no fake

Nono método da porta. Ele **não** é `createTokenizedSubscription` (ADR-043 Decisão 5): aquele cobra método já tokenizado, e no balcão o aluno ainda não tem cartão salvo.

**Files:**
- Modify: `apps/api/src/modules/billing/provider/payment-provider.port.ts`
- Modify: `apps/api/src/modules/billing/provider/fake-payment-provider.ts`
- Test: `apps/api/src/modules/billing/provider/fake-payment-provider.spec.ts` (se não existir, crie)

**Interfaces:**
- Consumes: `ErroDoProvedor`, `CodigoDeErroDoProvedor` do próprio arquivo da porta.
- Produces: `interface HostedCheckoutInput { externalAccountId: string; amountMinor: number; currency: string; idempotencyKey: string; expiresAt: Date; descricao: string; customer: CustomerParaAntifraude }`; `interface CustomerParaAntifraude { nome: string; email: string | null; telefone: string | null; cpf: string; endereco: EnderecoDeCobranca }`; `interface EnderecoDeCobranca { logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string }`; `interface HostedCheckout { externalPaymentId: string; checkoutUrl: string; qrCodeDataUri: string; expiresAt: Date }`; método `createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckout>` em `PaymentProvider`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
import { FakePaymentProvider } from './fake-payment-provider.js';

describe('FakePaymentProvider.createHostedCheckout', () => {
  const entrada = {
    externalAccountId: 'conta-getnet',
    amountMinor: 15000,
    currency: 'BRL',
    idempotencyKey: 'checkout:invoice-1',
    expiresAt: new Date('2026-08-23T13:00:00Z'),
    descricao: 'Mensalidade agosto',
    customer: {
      nome: 'Aluno de Teste',
      email: 'aluno@exemplo.test',
      telefone: '11999990000',
      cpf: '12345678901',
      endereco: {
        logradouro: 'Rua Um',
        numero: '10',
        bairro: 'Centro',
        cidade: 'Sao Paulo',
        uf: 'SP',
        cep: '01001000',
      },
    },
  };

  it('devolve link e QR do checkout hospedado', async () => {
    const checkout = await new FakePaymentProvider().createHostedCheckout(entrada);

    expect(checkout.externalPaymentId).toBeTruthy();
    expect(checkout.checkoutUrl).toMatch(/^https:\/\//);
    expect(checkout.qrCodeDataUri).toMatch(/^data:image\/png;base64,/);
    expect(checkout.expiresAt).toEqual(entrada.expiresAt);
  });

  /*
   * A MESMA chave devolve o MESMO externalPaymentId. O fake precisa honrar
   * isso: se ele sortear um id novo a cada chamada, o teste de idempotencia
   * da Task 4 passa por acidente -- ele estaria medindo o fake, nao a guarda.
   */
  it('a mesma chave de idempotencia devolve o mesmo pagamento', async () => {
    const fake = new FakePaymentProvider();
    const primeiro = await fake.createHostedCheckout(entrada);
    const segundo = await fake.createHostedCheckout(entrada);

    expect(segundo.externalPaymentId).toBe(primeiro.externalPaymentId);
  });
});
```

- [ ] **Step 2: Rode o teste e veja falhar**

Run: `pnpm --filter @arenahub/api test -- fake-payment-provider`
Expected: FAIL — `createHostedCheckout is not a function`

- [ ] **Step 3: Acrescente o método na porta**

Em `payment-provider.port.ts`, **antes** da declaração `export interface PaymentProvider`:

```ts
/**
 * Endereco de cobranca. Exigido pelo antifraude da Getnet (SPEC-053 §9).
 *
 * A F45 ja entregou `student_addresses`; este tipo e a projecao do que o
 * provedor pede, nao a entidade.
 */
export interface EnderecoDeCobranca {
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

/**
 * Dados do pagador que o antifraude exige.
 *
 * `cpf` e `endereco` NAO sao anulaveis aqui de proposito: quem nao os tem
 * nao chega a este ponto -- o caso de uso recusa antes (Task 4), com
 * `STUDENT_BILLING_DATA_INCOMPLETE`. Tipo anulavel aqui empurraria a decisao
 * para dentro do adapter, que responderia com bloqueio do antifraude em vez
 * de com uma frase que a recepcao entende.
 */
export interface CustomerParaAntifraude {
  nome: string;
  email: string | null;
  telefone: string | null;
  cpf: string;
  endereco: EnderecoDeCobranca;
}

export interface HostedCheckoutInput {
  externalAccountId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  expiresAt: Date;
  /** Texto curto que o aluno ve no checkout. Sem PII. */
  descricao: string;
  customer: CustomerParaAntifraude;
}

/**
 * MESMA FORMA de `PixCharge`, e nao por acaso: no balcao os dois viram QR na
 * tela, e a diferenca e so o que o aluno faz depois de escanear.
 *
 * `checkoutUrl` existe alem do QR porque o aluno pode preferir o link por
 * WhatsApp -- e porque QR nao e alcancavel por leitor de tela.
 */
export interface HostedCheckout {
  externalPaymentId: string;
  checkoutUrl: string;
  qrCodeDataUri: string;
  expiresAt: Date;
}
```

E dentro de `export interface PaymentProvider`, junto dos outros métodos:

```ts
  /**
   * NONO METODO -- checkout HOSPEDADO, a primeira cobranca no cartao.
   *
   * NAO E `createTokenizedSubscription` (ADR-043, Decisao 5): aquele cobra um
   * metodo JA TOKENIZADO, e no balcao o aluno ainda nao tem cartao salvo.
   * Confundi-los mandaria o backend pedir token que nao existe.
   *
   * O aluno digita o cartao NO PROPRIO CELULAR, na pagina do provedor. E o
   * que torna INV-098 verdadeiro no balcao: nao ha campo de cartao para
   * proteger porque nao ha campo de cartao.
   */
  createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckout>;
```

- [ ] **Step 4: Implemente no fake**

Em `fake-payment-provider.ts`, seguindo o padrão dos métodos vizinhos:

```ts
  async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckout> {
    /*
     * Memoriza por chave de idempotencia, como o provedor real faz. Sortear
     * um id novo a cada chamada faria o teste de idempotencia da Task 4
     * medir o fake em vez da guarda.
     */
    const existente = this.checkoutsPorChave.get(input.idempotencyKey);
    if (existente) return existente;

    const checkout: HostedCheckout = {
      externalPaymentId: `fake-checkout-${input.idempotencyKey}`,
      checkoutUrl: `https://checkout.fake.test/${input.idempotencyKey}`,
      qrCodeDataUri: QR_FALSO,
      expiresAt: input.expiresAt,
    };

    this.checkoutsPorChave.set(input.idempotencyKey, checkout);
    return checkout;
  }
```

Declare o mapa junto dos outros campos da classe:

```ts
  private readonly checkoutsPorChave = new Map<string, HostedCheckout>();
```

Se `QR_FALSO` ainda não existir no arquivo, reuse a constante que `createPix` já usa para o `qrCodeDataUri`; se `createPix` gera inline, extraia para uma constante do módulo e use nos dois.

⚠️ **O fake tem estado.** Uma instância compartilhada entre testes vaza — mapa preenchido num bloco contamina o próximo. Se os testes usarem instância compartilhada, cada suíte precisa de fake próprio.

- [ ] **Step 5: Rode o teste e veja passar**

Run: `pnpm --filter @arenahub/api test -- fake-payment-provider`
Expected: PASS — 2 testes.

- [ ] **Step 6: Typecheck (a porta tem outros implementadores)**

Run: `pnpm typecheck`
Expected: PASS. Se algum outro implementador da porta quebrar por método faltando, implemente-o lá também — a interface é contrato.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/provider/
git commit -m "feat: createHostedCheckout na porta PaymentProvider e no fake"
```

---

## Task 3: **Medir** se o índice da F14 cobre o checkout

**Esta task não escreve feature. Ela responde uma pergunta**, e a resposta decide se a Task 4 leva migration.

**O que se sabe hoje**, lido do schema e da migration `20260819120000_f14_uma_cobranca_em_voo`:

- O índice parcial é `UNIQUE (tenant_id, invoice_id) WHERE "method" = 'CARD' AND "status" = 'PROCESSING'`.
- `PaymentAttemptStatus` é `CREATED | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED`, e o **default é `CREATED`**.
- `PaymentMethodKind` é `MANUAL | PIX | CARD` — o checkout hospedado é `CARD`, logo cai no primeiro predicado.

**A suspeita:** se o checkout gravar a tentativa como `CREATED` (o natural — o aluno ainda nem abriu o link), o índice **não a enxerga**, e duas requisições concorrentes criam dois checkouts para a mesma invoice. É o defeito da F14 renascendo por outra porta.

**Isto é hipótese até a medição.** Pode ser que `PROCESSING` seja o status correto na criação, e aí não há nada a fazer.

**Files:**
- Create: `apps/api/test/integration/checkout-de-cartao.int-spec.ts` (só a sonda; o resto vem na Task 4)

**Interfaces:**
- Consumes: `createHostedCheckout` (Task 2).
- Produces: a decisão registrada — "índice cobre" ou "índice não cobre, migration necessária". A Task 4 depende dela.

- [ ] **Step 1: Suba o banco de desenvolvimento**

Run: `docker compose -f infra/docker/docker-compose.yml up -d`
Expected: Postgres, Redis e MinIO de pé. Se as portas estiverem ocupadas, crie composição nova com portas novas — nunca reaproveite as configuradas (`CLAUDE.md`).

- [ ] **Step 2: Escreva a sonda de concorrência**

Não é o teste final — é a medição. `Promise.allSettled` com o caso de uso ainda não escrito não compila, então **sonde no nível do banco**, que é onde a garantia mora:

```ts
/*
 * SONDA, nao teste de feature: responde se o indice parcial da F14 cobre uma
 * tentativa de cartao criada em `CREATED`.
 *
 * Ela grava DUAS tentativas de cartao para a MESMA invoice, concorrentes, e
 * conta quantas sobreviveram. Se as duas passarem, o indice nao cobre este
 * caminho e a Task 4 leva migration.
 */
it('SONDA: duas tentativas de cartao em CREATED para a mesma invoice', async () => {
  const invoice = await criarInvoiceAberta(db, contexto);

  const gravar = (chave: string) =>
    db.paymentAttempt.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        method: 'CARD',
        status: 'CREATED',
        idempotencyKey: chave,
      },
    });

  const resultados = await Promise.allSettled([gravar('checkout:a'), gravar('checkout:b')]);
  const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;

  const gravadas = await db.paymentAttempt.count({
    where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
  });

  console.log(`SONDA — sucessos: ${sucessos}, gravadas: ${gravadas}`);
  expect({ sucessos, gravadas }).toEqual({ sucessos: 1, gravadas: 1 });
});
```

- [ ] **Step 3: Rode a sonda e LEIA o número**

Run: `pnpm --filter @arenahub/api test:integration -- checkout-de-cartao`

**Dois desfechos, e os dois são resultado válido:**

- **`sucessos: 2, gravadas: 2`** → o índice **não cobre**. A hipótese se confirma. A Task 4 leva migration. Registre o número medido no corpo do PR.
- **`sucessos: 1, gravadas: 1`** → o índice **já cobre**. Sem migration. Registre "verificado, não era problema" no PR e apague a sonda; a Task 4 segue sem o passo de migration.

⚠️ **Não pule esta leitura.** O teste está escrito para passar no desfecho seguro; se ele passar de primeira, a resposta é "já cobre" e não "consertei".

- [ ] **Step 4: Se a sonda acusou o furo — escreva a migration**

Só neste caso. `packages/database/prisma/migrations/<timestamp>_f53_checkout_em_voo/migration.sql`:

```sql
-- Um checkout de cartao EM VOO por invoice -- inclusive o que ainda esta em
-- `CREATED`.
--
-- O indice da F14 (`20260819120000_f14_uma_cobranca_em_voo`) cobre apenas
-- `status = 'PROCESSING'`, e o checkout hospedado nasce em `CREATED`: o aluno
-- ainda nem abriu o link. Medido antes de escrever esta linha -- duas
-- requisicoes concorrentes gravaram DUAS tentativas de cartao para a mesma
-- invoice, que e o defeito da F14 chegando por outra porta.
--
-- PARCIAL, e nao `@@unique` cheio: tentativa que ja terminou (SUCCEEDED,
-- FAILED, CANCELLED) nao pode bloquear a proxima cobranca da mesma invoice --
-- o aluno cujo cartao foi recusado tem de poder tentar de novo.
--
-- NAO ACEITE `prisma migrate dev` propondo apagar este indice: o Prisma nao
-- modela unicidade condicional e nao o enxerga no schema.
CREATE UNIQUE INDEX "payment_attempts_um_checkout_em_voo"
  ON "payment_attempts" ("tenant_id", "invoice_id")
  WHERE "method" = 'CARD' AND "status" IN ('CREATED', 'REQUIRES_ACTION', 'PROCESSING');
```

Documente o índice no `schema.prisma`, no bloco de comentário do `model PaymentAttempt`, ao lado do da F14 — a convenção que `access_events` já usa.

⚠️ **O índice antigo da F14 continua existindo.** Não o remova: ele cobre a cobrança tokenizada, que é outro caminho. Dois índices parciais sobre a mesma tabela convivem.

- [ ] **Step 5: Aplique e re-meça**

Run: `pnpm --filter @arenahub/database prisma migrate dev` e depois `pnpm --filter @arenahub/api test:integration -- checkout-de-cartao`
Expected: `sucessos: 1, gravadas: 1`.

- [ ] **Step 6: Prove por mutação**

Derrube o índice à mão no banco e rode de novo:

```bash
psql "$DATABASE_URL" -c 'DROP INDEX "payment_attempts_um_checkout_em_voo";'
pnpm --filter @arenahub/api test:integration -- checkout-de-cartao
```

Expected: **FALHA**, com 2 onde deveria haver 1. Recrie o índice (`prisma migrate reset` ou reaplique o SQL) e confirme que volta a passar.

Guarda que não falha sem a coisa que ela guarda é decorativa — e decorativa é pior que ausente, porque afirma cobertura que não tem.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/migrations/ packages/database/prisma/schema.prisma apps/api/test/integration/checkout-de-cartao.int-spec.ts
git commit -m "fix: indice parcial cobre o checkout de cartao em voo, nao so PROCESSING"
```

Se a sonda disse "já cobre", commite só a remoção da sonda com `test: verifica que o indice da F14 ja cobre o checkout hospedado`.

---

## Task 4: Caso de uso `criar-checkout-de-cartao`

Espelha `criar-cobranca-pix.use-case.ts` — leia aquele arquivo antes de escrever este; a ordem das operações dele é deliberada e vale aqui.

**Files:**
- Create: `apps/api/src/modules/billing/criar-checkout-de-cartao.use-case.ts`
- Modify: `apps/api/test/integration/checkout-de-cartao.int-spec.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`

**Interfaces:**
- Consumes: `faltaParaCartao`, `DadosDoAluno` (Task 1); `createHostedCheckout`, `HostedCheckout`, `CustomerParaAntifraude` (Task 2); `ProviderAccountResolver.resolver(contexto, 'CARD')` e `podeTransicionar` (já existem).
- Produces: `class CriarCheckoutDeCartaoUseCase` com `executar(contexto: TenantContext, entrada: { invoiceId: string; agora: Date }, correlationId: string): Promise<CheckoutCriado>`; `interface CheckoutCriado { paymentAttemptId: string; externalPaymentId: string; checkoutUrl: string; qrCodeDataUri: string; expiresAt: Date; amountMinor: number; currency: string }`; `class DadosDeCobrancaIncompletosError` (código `STUDENT_BILLING_DATA_INCOMPLETE`, 422); `const MINUTOS_DE_VALIDADE_DO_CHECKOUT = 30`.

- [ ] **Step 1: Escreva os testes de integração que falham**

```ts
describe('CriarCheckoutDeCartaoUseCase', () => {
  it('cria o checkout e devolve link e QR', async () => {
    const invoice = await criarInvoiceAberta(db, contexto);

    const checkout = await useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-1');

    expect(checkout.checkoutUrl).toMatch(/^https:\/\//);
    expect(checkout.amountMinor).toBe(invoice.totalMinor);
  });

  /*
   * RECUSA ANTES DE CHAMAR O PROVEDOR. Nao e economia de rede: chamar a
   * Getnet sem CPF gasta requisicao para receber bloqueio de antifraude, e o
   * bloqueio chega como recusa generica -- a recepcao leria "nao foi
   * possivel" sem saber que o conserto e preencher o cadastro.
   */
  it('recusa aluno sem CPF sem tocar no provedor', async () => {
    const invoice = await criarInvoiceAberta(db, contexto, { cpfDoAluno: null });

    await expect(
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-2'),
    ).rejects.toMatchObject({ codigo: 'STUDENT_BILLING_DATA_INCOMPLETE' });

    expect(fake.chamadasDeCheckout).toBe(0);
  });

  it('invoice ja paga nao aceita checkout', async () => {
    const invoice = await criarInvoicePaga(db, contexto);

    await expect(
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-3'),
    ).rejects.toMatchObject({ codigo: 'INVOICE_NOT_CHARGEABLE' });
  });

  /*
   * ISOLAMENTO: 404, nunca 409. Responder conflito para id de outro tenant
   * confirmaria que aquele id existe em algum lugar -- oraculo de existencia
   * entre academias (INV-006). E a licao da F17, onde o teste passava com o
   * status errado pela causa errada: exija o CODIGO, nao so o status.
   */
  it('invoice de outro tenant e 404, nunca 409', async () => {
    const invoiceDoOutro = await criarInvoiceAberta(db, outroContexto);

    await expect(
      useCase.executar(contexto, { invoiceId: invoiceDoOutro.id, agora: AGORA }, 'corr-4'),
    ).rejects.toMatchObject({ codigo: 'INVOICE_NOT_FOUND', status: 404 });
  });

  /*
   * CONCORRENCIA pelo caso de uso -- a sonda da Task 3 mediu o banco; esta
   * mede o caminho inteiro, que e o que a recepcao exercita com clique duplo.
   */
  it('duas requisicoes concorrentes produzem UM checkout', async () => {
    const invoice = await criarInvoiceAberta(db, contexto);

    const resultados = await Promise.allSettled([
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-5a'),
      useCase.executar(contexto, { invoiceId: invoice.id, agora: AGORA }, 'corr-5b'),
    ]);

    const sucessos = resultados.filter((r) => r.status === 'fulfilled').length;
    const tentativas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId, invoiceId: invoice.id, method: 'CARD' },
    });

    expect({ sucessos, tentativas }).toEqual({ sucessos: 1, tentativas: 1 });
  });
});
```

O fake precisa contar chamadas para o segundo teste — acrescente `chamadasDeCheckout` ao `FakePaymentProvider`, incrementado no início de `createHostedCheckout`.

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/api test:integration -- checkout-de-cartao`
Expected: FAIL — módulo do caso de uso não existe.

- [ ] **Step 3: Implemente o caso de uso**

Copie a **ordem** de `criar-cobranca-pix.use-case.ts`: busca a invoice com `tenantId` no `where` → `podeTransicionar` → resolve a conta por capacidade → grava a tentativa → chama o provedor → atualiza.

Acrescente, **entre `podeTransicionar` e a resolução da conta**, a checagem de cadastro:

```ts
    /**
     * RECUSA ANTES DE RESOLVER CONTA E ANTES DE CHAMAR O PROVEDOR.
     *
     * A ordem importa: a Getnet bloquearia por antifraude e devolveria recusa
     * generica, que a recepcao leria como "o cartao nao passou" -- quando o
     * conserto e preencher o cadastro. Ver SPEC-053 §9.1.
     */
    const faltando = faltaParaCartao({
      cpf: aluno.cpf,
      temEndereco: aluno.addresses.length > 0,
    });

    if (faltando.length > 0) {
      throw new DadosDeCobrancaIncompletosError(faltando);
    }
```

E o erro:

```ts
/**
 * Cadastro incompleto para pagar no cartao. 422 e nao 409: nao ha conflito de
 * estado, ha dado que falta -- e a tela precisa saber QUAL para dizer a frase
 * certa (SPEC-053 §9.1).
 */
export class DadosDeCobrancaIncompletosError extends ErroDeDominio {
  constructor(readonly faltando: readonly DadoFaltante[]) {
    super(
      'STUDENT_BILLING_DATA_INCOMPLETE',
      422,
      `Cadastro do aluno incompleto para pagamento no cartao: ${faltando.join(', ')}`,
    );
  }
}
```

A resolução da conta pede **capacidade**, nunca marca:

```ts
    // `'CARD'`, nao `'getnet'`. Nenhum caso de uso menciona a marca (F14).
    const conta = await this.contas.resolver(contexto, 'CARD');
```

Registre o caso de uso em `billing.module.ts`, junto dos outros `providers`.

- [ ] **Step 4: Rode e veja passar**

Run: `pnpm --filter @arenahub/api test:integration -- checkout-de-cartao`
Expected: PASS — 5 testes (mais a sonda, se ela virou teste).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/criar-checkout-de-cartao.use-case.ts apps/api/src/modules/billing/billing.module.ts apps/api/src/modules/billing/provider/fake-payment-provider.ts apps/api/test/integration/checkout-de-cartao.int-spec.ts
git commit -m "feat: caso de uso do checkout hospedado de cartao"
```

---

## Task 5: Leitura barata para o polling

`GET /payments/:id/status` **bate no provedor a cada chamada** — a docstring do `ConsultarStatusDePagamentoUseCase` diz que é "o caminho de quem não pode esperar", escrita para o excepcional, não para o laço. Polling nela custaria ~20 chamadas externas por minuto de QR aberto, por caixa, e o `FakePaymentProvider` não tem rate limit para avisar em dev.

**Files:**
- Create: `apps/api/src/modules/billing/consultar-tentativa.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Test: `apps/api/test/integration/consultar-tentativa.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TenantContext`, `ErroDeDominio`.
- Produces: `class ConsultarTentativaUseCase` com `executar(contexto: TenantContext, paymentAttemptId: string): Promise<TentativaObservada>`; `interface TentativaObservada { paymentAttemptId: string; status: string; invoiceStatus: string; paidAt: Date | null; expiresAt: Date | null; receiptId: string | null }`; rota `GET /api/v1/payment-attempts/:id` com permissão `invoice.read`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
describe('GET /payment-attempts/:id', () => {
  /*
   * NAO TOCA NO PROVEDOR. E a razao de esta rota existir: o laco da tela roda
   * a cada 3s, e a rota que ja existia (`/payments/:id/status`) consulta o
   * provedor toda vez. Se este teste falhar, o polling virou chamada externa
   * em laco -- e o fake nao tem rate limit para avisar.
   */
  it('le do banco sem consultar o provedor', async () => {
    const tentativa = await criarTentativaPix(db, contexto);

    const observada = await useCase.executar(contexto, tentativa.id);

    expect(observada.status).toBe('PROCESSING');
    expect(fake.chamadasDeStatus).toBe(0);
  });

  it('devolve o recibo quando ja foi emitido', async () => {
    const { tentativa, receiptId } = await criarTentativaPagaComRecibo(db, contexto);

    const observada = await useCase.executar(contexto, tentativa.id);

    expect(observada.invoiceStatus).toBe('PAID');
    expect(observada.receiptId).toBe(receiptId);
  });

  it('tentativa de outro tenant e 404', async () => {
    const doOutro = await criarTentativaPix(db, outroContexto);

    await expect(useCase.executar(contexto, doOutro.id)).rejects.toMatchObject({
      codigo: 'PAYMENT_ATTEMPT_NOT_FOUND',
      status: 404,
    });
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/api test:integration -- consultar-tentativa`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implemente**

```ts
/**
 * Leitura barata da tentativa, para o LACO da tela do balcao.
 *
 * SO O NOSSO BANCO -- que e onde o webhook ja escreveu. Nao injeta
 * `PAYMENT_PROVIDER` de proposito: a dependencia ausente e a garantia de que
 * ninguem acrescenta a chamada externa sem perceber.
 *
 * POR QUE NAO REUSAR `GET /payments/:id/status`: aquela consulta o provedor a
 * cada chamada -- 20 chamadas externas por minuto de QR aberto, por caixa.
 * Sicoob e Getnet cobram e limitam por taxa; o fake nao, e por isso o
 * desenho errado passa verde em dev. Ela continua existindo como CONSULTA
 * ATIVA, o botao "Conferir com o banco".
 */
@Injectable()
export class ConsultarTentativaUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(contexto: TenantContext, paymentAttemptId: string): Promise<TentativaObservada> {
    const tentativa = await this.db.paymentAttempt.findFirst({
      where: { id: paymentAttemptId, tenantId: contexto.tenantId },
      include: { invoice: { select: { status: true, paidAt: true } }, payment: { select: { receipt: { select: { id: true } } } } },
    });

    if (!tentativa) {
      throw new TentativaObservadaNaoEncontradaError();
    }

    return {
      paymentAttemptId: tentativa.id,
      status: tentativa.status,
      invoiceStatus: tentativa.invoice.status,
      paidAt: tentativa.invoice.paidAt,
      expiresAt: null,
      receiptId: tentativa.payment?.receipt?.id ?? null,
    };
  }
}
```

⚠️ Confira o nome da relação do recibo no `schema.prisma` antes de escrever o `include` — se `Payment` não tiver relação `receipt`, busque o recibo por `paymentId` numa segunda consulta.

⚠️ `expiresAt` não está em `PaymentAttempt`. Ou você o devolve do `Payment`/da cobrança onde ele foi gravado, ou a tela guarda o valor que recebeu ao criar a cobrança. **Prefira a segunda**: o valor já viaja na resposta de criação, e acrescentar coluna para repeti-lo é dado duplicado que pode divergir.

Rota no controller, junto das outras leituras:

```ts
  /**
   * Leitura barata para o laco da tela. `invoice.read` e nao permissao nova:
   * quem pode ver a fatura pode ver se ela foi paga.
   */
  @Get('payment-attempts/:id')
  @RequirePermissions('invoice.read')
  async observarTentativa(@Param('id') id: string): Promise<TentativaObservada> {
    return this.tentativa.executar(this.contexto.require(), id);
  }
```

- [ ] **Step 4: Rode e veja passar**

Run: `pnpm --filter @arenahub/api test:integration -- consultar-tentativa`
Expected: PASS — 3 testes.

- [ ] **Step 5: Declare a rota na guarda de contrato OpenAPI**

A guarda existe e a lista **parou na F11** uma vez — F12 e F13 entregaram sete rotas sem declarar nenhuma. Encontre-a com `grep -rn "rotas" apps/api/test/` e acrescente a rota nova.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/consultar-tentativa.use-case.ts apps/api/src/modules/billing/billing.controller.ts apps/api/src/modules/billing/billing.module.ts apps/api/test/integration/consultar-tentativa.int-spec.ts
git commit -m "feat: leitura barata da tentativa para o polling do balcao"
```

---

## Task 6: `GET /api/v1/invoices` — lista transversal

Decisão 1 do PI em 23/08/2026. A spec §3.1 propunha cortar; o PI mandou implementar.

**Files:**
- Create: `apps/api/src/modules/billing/listar-invoices.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Test: `apps/api/test/integration/listar-invoices.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TenantContext`.
- Produces: `class ListarInvoicesUseCase` com `executar(contexto: TenantContext, filtro: FiltroDeInvoices): Promise<PaginaDeInvoices>`; `interface FiltroDeInvoices { status?: string; vencendoDe?: Date; vencendoAte?: Date; pagina: number; tamanho: number }`; `interface PaginaDeInvoices { itens: InvoiceDto[]; total: number; pagina: number; tamanho: number }`; rota `GET /api/v1/invoices` com permissão `invoice.read`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
describe('GET /invoices', () => {
  it('lista as invoices do tenant, da mais recente para a mais antiga', async () => {
    await criarInvoices(db, contexto, 3);

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 20 });

    expect(pagina.total).toBe(3);
    expect(pagina.itens).toHaveLength(3);
  });

  /*
   * ISOLAMENTO -- o teste que importa numa rota SEM filtro de aluno. Sem
   * `tenantId` no `where`, esta rota devolve o financeiro de todas as
   * academias de uma vez, que e a falha mais cara possivel aqui.
   */
  it('nunca devolve invoice de outro tenant', async () => {
    await criarInvoices(db, contexto, 2);
    await criarInvoices(db, outroContexto, 5);

    const pagina = await useCase.executar(contexto, { pagina: 1, tamanho: 50 });

    expect(pagina.total).toBe(2);
  });

  it('filtra por status', async () => {
    await criarInvoiceAberta(db, contexto);
    await criarInvoicePaga(db, contexto);

    const pagina = await useCase.executar(contexto, { status: 'OPEN', pagina: 1, tamanho: 20 });

    expect(pagina.itens.every((i) => i.status === 'OPEN')).toBe(true);
    expect(pagina.total).toBe(1);
  });

  /*
   * PERIODO FECHADO nas duas pontas. Invoice que vence exatamente no limite
   * entra: recorte que perde a borda some com a fatura do dia 31 quando
   * alguem pesquisa "ate o dia 31".
   */
  it('filtra por periodo de vencimento, com as bordas dentro', async () => {
    await criarInvoiceVencendoEm(db, contexto, new Date('2026-08-01T00:00:00Z'));
    await criarInvoiceVencendoEm(db, contexto, new Date('2026-08-31T00:00:00Z'));
    await criarInvoiceVencendoEm(db, contexto, new Date('2026-09-01T00:00:00Z'));

    const pagina = await useCase.executar(contexto, {
      vencendoDe: new Date('2026-08-01T00:00:00Z'),
      vencendoAte: new Date('2026-08-31T00:00:00Z'),
      pagina: 1,
      tamanho: 20,
    });

    expect(pagina.total).toBe(2);
  });

  it('pagina', async () => {
    await criarInvoices(db, contexto, 5);

    const pagina = await useCase.executar(contexto, { pagina: 2, tamanho: 2 });

    expect(pagina.itens).toHaveLength(2);
    expect(pagina.total).toBe(5);
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/api test:integration -- listar-invoices`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implemente**

`tenantId` no `where` **sempre**, `take`/`skip` a partir de `pagina`/`tamanho`, `orderBy` explícito. Teto de `tamanho` em 100 — sem teto, um cliente pede 100000 e a rota vira despejo do financeiro inteiro.

⚠️ **`orderBy` explícito, sempre.** Sem ele o Postgres devolve na ordem física, que muda após `UPDATE`: a mesma página traria linhas diferentes entre dois carregamentos. Ordene por `dueAt desc, id desc` — o `id` desempata, senão duas faturas do mesmo vencimento trocam de lugar entre páginas e uma delas nunca aparece.

Zod no boundary para os filtros, `unknown` antes de validar.

- [ ] **Step 4: Rode e veja passar**

Run: `pnpm --filter @arenahub/api test:integration -- listar-invoices`
Expected: PASS — 5 testes.

- [ ] **Step 5: Declare na guarda de contrato OpenAPI** (como na Task 5, Step 5).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/listar-invoices.use-case.ts apps/api/src/modules/billing/billing.controller.ts apps/api/src/modules/billing/billing.module.ts apps/api/test/integration/listar-invoices.int-spec.ts
git commit -m "feat: lista transversal de faturas do tenant"
```

---

## Task 7: Fuso da unidade na resposta de invoices

Decisão 2 do PI. **Sem migration:** `gym_units.timezone` existe desde o ADR-019 e `students.gym_unit_id` desde a F45, onde virou `NOT NULL`.

**Files:**
- Modify: `apps/api/src/modules/billing/billing.repository.ts` (ou onde `listarDoAluno` monta a resposta)
- Modify: `apps/api/src/modules/billing/billing.controller.ts`
- Test: `apps/api/test/integration/` — a suíte que já cobre `GET /students/:id/invoices`

**Interfaces:**
- Consumes: nada novo.
- Produces: a resposta de `GET /students/:id/invoices` passa de `InvoiceDto[]` para `{ timezone: string; invoices: InvoiceDto[] }`.

⚠️ **É mudança de formato.** A tela da Task 10 depende dela. Se houver outro consumidor, ajuste-o na mesma task.

- [ ] **Step 1: Escreva o teste que falha**

```ts
/*
 * FUSO DA UNIDADE, nunca do tenant e nunca fixo (INV-144, ADR-019).
 *
 * A unidade do teste NAO e America/Sao_Paulo de proposito: com o fuso da
 * academia real, o valor certo e o valor fixo coincidem, e o teste passaria
 * com o `FUSO_PROVISORIO` ainda no lugar -- verde provando nada.
 */
it('devolve o timezone da unidade de origem do aluno', async () => {
  const unidade = await criarUnidade(db, contexto, { timezone: 'America/Manaus' });
  const aluno = await criarAluno(db, contexto, { gymUnitId: unidade.id });
  await criarInvoiceAberta(db, contexto, { studentId: aluno.id });

  const resposta = await useCase.listarDoAluno(contexto, aluno.id);

  expect(resposta.timezone).toBe('America/Manaus');
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/api test:integration -- invoice`
Expected: FAIL — `timezone` é `undefined`.

- [ ] **Step 3: Implemente**

Busque o aluno com a unidade no `include` e devolva o `timezone` junto:

```ts
    /**
     * Fuso da UNIDADE DE ORIGEM do aluno (INV-144, ADR-019) -- sem fallback
     * para o tenant, que e exatamente o que o invariante proibe.
     *
     * A invoice nao tem `gym_unit_id` (financeiro nao e dado fisico,
     * ADR-027), entao o fuso vem pelo aluno. Nao ha aluno sem unidade: a F45
     * tornou a coluna `NOT NULL`.
     */
    const aluno = await this.db.student.findFirst({
      where: { id: studentId, tenantId: contexto.tenantId },
      include: { gymUnit: { select: { timezone: true } } },
    });
```

- [ ] **Step 4: Rode e veja passar**

Run: `pnpm --filter @arenahub/api test:integration -- invoice`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/
git commit -m "feat: resposta de invoices carrega o fuso da unidade do aluno"
```

---

## Task 8: CPF obrigatório no cadastro

Decisão 4 do PI (ADR-043 Decisão 3). Validação de **aplicação**; a coluna segue anulável.

**Files:**
- Modify: o schema Zod do `POST /students` e do `PATCH /students/:id`
- Modify: `apps/admin-web/app/(protected)/students/novo/formulario-de-cadastro.tsx`
- Test: a suíte de integração de alunos

**Interfaces:**
- Consumes: nada novo.
- Produces: `POST` e `PATCH` recusam CPF ausente ou em branco.

- [ ] **Step 1: Escreva o teste que falha**

```ts
it('recusa cadastro sem CPF', async () => {
  await expect(criarAlunoPelaApi({ fullName: 'Sem CPF', cpf: undefined })).rejects.toMatchObject({
    status: 400,
  });
});

/*
 * O LEGADO CONTINUA EXISTINDO. A obrigatoriedade e de aplicacao, nao de
 * coluna: os 308 alunos do Pacto sem CPF (ADR-034) seguem no banco, seguem
 * treinando e seguem passando na catraca. Se este teste falhar, a validacao
 * virou constraint e quebrou a base importada.
 */
it('aluno legado sem CPF continua legivel e editavel em outros campos', async () => {
  const legado = await criarAlunoDireto(db, contexto, { cpf: null });

  const lido = await lerAlunoPelaApi(legado.id);
  expect(lido.cpf).toBeNull();

  await expect(atualizarAlunoPelaApi(legado.id, { phone: '11999990000' })).resolves.toBeTruthy();
});
```

⚠️ **O segundo teste é o que importa.** Tornar o CPF obrigatório sem ele é como a base do Pacto para de funcionar em silêncio.

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/api test:integration -- student`
Expected: FAIL no primeiro (cadastro sem CPF é aceito hoje).

- [ ] **Step 3: Implemente**

No Zod do `POST`: `cpf` deixa de ser `.optional()` e ganha validação de formato. No `PATCH`: `cpf` continua opcional (não enviar = não mexer), mas **`null` explícito é recusado** — apagar um CPF existente contraria a decisão.

⚠️ `undefined` não mexe, `null` apaga — a distinção da F45. Aqui o `null` passa a ser recusado só para o CPF.

- [ ] **Step 4: Marque o campo na tela**

Em `formulario-de-cadastro.tsx`, CPF sai de opcional para obrigatório: `aria-required`, marca visual, e a checagem em JS que **leva a pessoa ao passo onde o campo mora**.

⚠️ **Nunca `required` nativo.** Os passos do wizard ficam montados e escondidos com `hidden`; o navegador barra o envio, tenta focar o campo escondido, falha e **desiste em silêncio** — o defeito que a F45 levou três hipóteses para achar.

- [ ] **Step 5: Rode e veja passar**

Run: `pnpm --filter @arenahub/api test:integration -- student` e `pnpm --filter @arenahub/admin-web test`
Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/students/ apps/admin-web/app/\(protected\)/students/novo/
git commit -m "feat: CPF obrigatorio no cadastro de aluno (ADR-043)"
```

---

## Task 9: Guarda estrutural — nenhum campo de cartão no painel

Espelha `dado-de-cartao-nao-entra-no-backend.spec.ts` da F14. O caminho errado (PAN no nosso lado) é **mais fácil** que o certo — não se chega nele por descuido, chega-se por atalho.

**Files:**
- Create: `apps/admin-web/src/billing/dados-do-cartao-nao-entram-no-painel.test.ts`

**Interfaces:**
- Consumes: nada — lê o código-fonte do `app/`.
- Produces: a guarda.

- [ ] **Step 1: Escreva a guarda**

```ts
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * NENHUM CAMPO DE CARTAO NO PAINEL (INV-098).
 *
 * ESTRUTURAL, e nao comportamental, pela mesma razao da F14: o defeito a
 * prevenir nao e "a tela se comportou errado", e "alguem acrescentou um input
 * de cartao porque era mais rapido que o checkout hospedado". Teste de
 * comportamento so pegaria isso com um cenario que ninguem lembra de
 * escrever.
 *
 * O aluno digita o cartao NO PROPRIO CELULAR, na pagina da Getnet
 * (ADR-043, Decisao 2). Nao ha campo para proteger porque nao ha campo.
 */
const PADROES_PROIBIDOS = [
  /card_?number/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /numero-?do-?cartao/i,
  /codigo-?de-?seguranca/i,
];

describe('dados de cartao nao entram no painel', () => {
  it('nenhum arquivo do admin-web declara campo de cartao', () => {
    const arquivos = globSync('app/**/*.tsx', { cwd: process.cwd() });
    const acusados: string[] = [];

    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, 'utf8');
      for (const padrao of PADROES_PROIBIDOS) {
        if (padrao.test(fonte)) acusados.push(`${arquivo} — ${String(padrao)}`);
      }
    }

    expect(acusados).toEqual([]);
  });

  /*
   * A GUARDA TEM DE VER ALGUMA COISA. Guarda que varre lista vazia passa
   * verde para sempre -- e um `cwd` errado ou um glob que nao casa produz
   * exatamente isso. Foi assim que uma guarda "verde" subcontou 17 arquivos.
   */
  it('a varredura alcanca os arquivos da tela de cobranca', () => {
    const arquivos = globSync('app/**/*.tsx', { cwd: process.cwd() });

    expect(arquivos.length).toBeGreaterThan(20);
    expect(arquivos.some((a) => a.includes('billing'))).toBe(true);
  });
});
```

⚠️ `globSync` vem de `node:fs` no Node 22+; se a versão fixada não o tiver, use o `glob` que o repo já tenha — **não instale dependência nova** para isto.

- [ ] **Step 2: Rode e veja passar** (nada viola hoje)

Run: `pnpm --filter @arenahub/admin-web test -- dados-do-cartao`
Expected: PASS — 2 testes.

- [ ] **Step 3: Prove por mutação**

Acrescente `<input name="card_number" />` a `painel-de-cobranca.tsx`, rode de novo:

Expected: **FALHA**, acusando o arquivo. Remova o input e confirme que volta a passar.

Sem este passo a guarda é decorativa — e decorativa é pior que ausente.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/billing/dados-do-cartao-nao-entram-no-painel.test.ts
git commit -m "test: guarda estrutural contra campo de cartao no painel"
```

---

## Task 10: A tela — forma de pagamento antes do valor

**Files:**
- Create: `app/(protected)/students/[id]/billing/seletor-de-forma.tsx` + `.test.tsx`
- Create: `app/(protected)/students/[id]/billing/situacao-atual.tsx`
- Modify: `app/(protected)/students/[id]/billing/page.tsx`
- Modify: `app/(protected)/students/[id]/billing/painel-de-cobranca.tsx`
- Modify: `app/actions/billing.ts`

**Interfaces:**
- Consumes: a resposta `{ timezone, invoices }` (Task 7); `faltaParaCartao` — **reimplementar não**: a tela recebe do servidor o que falta, calculado com a mesma função da Task 1.
- Produces: `<SeletorDeForma>` com `onEscolher(forma: 'DINHEIRO' | 'PIX' | 'CARTAO')`; `<SituacaoAtual>` com o que o aluno deve agora.

- [ ] **Step 1: Escreva o teste do seletor**

```tsx
describe('SeletorDeForma', () => {
  it('oferece as tres formas', () => {
    render(<SeletorDeForma faltandoParaCartao={[]} onEscolher={vi.fn()} />);

    expect(screen.getByTestId('forma-dinheiro')).toBeEnabled();
    expect(screen.getByTestId('forma-pix')).toBeEnabled();
    expect(screen.getByTestId('forma-cartao')).toBeEnabled();
  });

  /*
   * DESABILITADO COM O MOTIVO, nunca ausente. Sumir com a opcao faz a
   * recepcionista procurar o que nao esta la -- e ela nao tem como descobrir
   * que o conserto e preencher o CPF.
   */
  it('desabilita o cartao e diz o motivo quando falta CPF', () => {
    render(<SeletorDeForma faltandoParaCartao={['CPF']} onEscolher={vi.fn()} />);

    expect(screen.getByTestId('forma-cartao')).toBeDisabled();
    expect(screen.getByText(/ainda nao tem CPF no cadastro/i)).toBeInTheDocument();
    expect(screen.getByTestId('forma-dinheiro')).toBeEnabled();
    expect(screen.getByTestId('forma-pix')).toBeEnabled();
  });
});
```

A frase é a da spec §9.1, literal: *"Este aluno ainda não tem CPF no cadastro. Complete o cadastro para pagar com cartão, ou receba em espécie ou PIX."*

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/admin-web test -- seletor-de-forma`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implemente o seletor**

Três botões, `data-testid` como no teste, alvo de toque ≥ 36 px (`--ah-control-height`), tokens `--ah-*` e nunca hex.

- [ ] **Step 4: Ligue no painel**

Em `painel-de-cobranca.tsx`, o seletor vem **antes** do valor. `DINHEIRO` entra no fluxo que já existe — valor → `SensitiveAction` com motivo —, **intocado**. `PIX` e `CARTAO` chamam as server actions novas e entregam o resultado ao componente da Task 11.

- [ ] **Step 5: Implemente `situacao-atual.tsx` e ponha no topo da página**

Invoice em aberto/vencida em destaque: valor (`<Money>`), vencimento (`<TenantDateTime>`), dias de atraso, `StateBadge` pelo dicionário do `DS-PAINEL` §7. Sem fatura aberta, mostra a situação e mantém *Gerar cobrança do mês*.

- [ ] **Step 6: Mate o `FUSO_PROVISORIO`**

Em `page.tsx`, apague a constante e o bloco de comentário da dívida, e passe o `timezone` da resposta a cada `<TenantDateTime>`. A dívida foi paga na Task 7 — o comentário que a descreve tem de sair junto, senão o próximo leitor acredita nele.

- [ ] **Step 7: Rode os testes**

Run: `pnpm --filter @arenahub/admin-web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/\[id\]/billing/ apps/admin-web/app/actions/billing.ts
git commit -m "feat: a tela do balcao pergunta a forma de pagamento antes do valor"
```

---

## Task 11: QR, polling e recibo

**Files:**
- Create: `app/(protected)/students/[id]/billing/cobranca-por-qr.tsx` + `.test.tsx`
- Modify: `app/actions/billing.ts`

**Interfaces:**
- Consumes: `GET /api/v1/payment-attempts/:id` (Task 5); a saída de `criar-cobranca-pix` e `criar-checkout-de-cartao`.
- Produces: `<CobrancaPorQr>` com props `{ paymentAttemptId, qrCodeDataUri, copiaECola, checkoutUrl, expiresAt }`.

- [ ] **Step 1: Escreva o teste do polling**

```tsx
describe('CobrancaPorQr', () => {
  /*
   * PARA NO TERMINAL. Laco que nao para nunca deixa a aba consultando a API
   * pelo resto do expediente -- e a recepcao mantem a tela aberta o dia todo.
   */
  it('para de consultar quando a invoice fica paga', async () => {
    const consultar = vi.fn().mockResolvedValue({ invoiceStatus: 'PAID', receiptId: 'rec-1' });
    render(<CobrancaPorQr {...props} consultar={consultar} />);

    await waitFor(() => expect(screen.getByTestId('pagamento-confirmado')).toBeInTheDocument());

    const chamadasAteAgora = consultar.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(consultar.mock.calls.length).toBe(chamadasAteAgora);
  });

  /*
   * PARA NO EXPIRADO, com a frase da spec §9.1 -- e nao girando para sempre
   * contra um QR que nenhum banco aceita mais.
   */
  it('para e oferece novo codigo quando o QR expira', async () => {
    const consultar = vi.fn().mockResolvedValue({ invoiceStatus: 'OPEN', receiptId: null });
    render(<CobrancaPorQr {...props} expiresAt={new Date(Date.now() - 1000)} consultar={consultar} />);

    await waitFor(() => expect(screen.getByText(/QR expirado\. Gere um novo codigo\./i)).toBeInTheDocument());
    expect(consultar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/admin-web test -- cobranca-por-qr`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implemente**

`useEffect` com `setInterval` de 3 s, limpo no unmount. Para quando: `invoiceStatus` terminal, `expiresAt` passou, ou o componente sai. Mostra QR (`<img>` do data URI, com `alt`), copia-e-cola com botão de copiar, e `checkoutUrl` como link — QR não é alcançável por leitor de tela, o link é.

`consultar` entra **por prop** para o teste não precisar de servidor.

- [ ] **Step 4: Botão "Conferir com o banco"**

Chama `GET /payments/:id/status` — a consulta ativa. **Uma chamada por clique**, nunca em laço.

- [ ] **Step 5: Recibo**

Na confirmação, `POST /payments/:id/receipt` e abre `GET /receipts/:id`. Nos **três** caminhos, dinheiro incluído — os endpoints existem desde a F16 e nenhuma tela os chamava.

- [ ] **Step 6: Rode e veja passar**

Run: `pnpm --filter @arenahub/admin-web test -- cobranca-por-qr`
Expected: PASS — 2 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/\[id\]/billing/cobranca-por-qr.tsx apps/admin-web/app/\(protected\)/students/\[id\]/billing/cobranca-por-qr.test.tsx apps/admin-web/app/actions/billing.ts
git commit -m "feat: QR, polling controlado e recibo no balcao"
```

---

## Task 12: Aviso de vencimento

Spec §3.4. **Sem tabela, sem provedor, sem push** — derivado de `dueAt`, `blockAt` e `status`, que já vêm na resposta.

**Files:**
- Create: `apps/admin-web/src/billing/vencimento.ts` + `vencimento.test.ts`
- Modify: `app/(protected)/students/[id]/page.tsx` (faixa na ficha)
- Modify: `app/(protected)/students/page.tsx` (marca na lista)

**Interfaces:**
- Consumes: `dueAt`, `blockAt`, `status` das invoices.
- Produces: `type SituacaoDeVencimento = 'EM_DIA' | 'VENCE_EM_BREVE' | 'VENCIDA' | 'BLOQUEIO_PROXIMO'`; `function situacaoDeVencimento(invoice, agora, timezone): SituacaoDeVencimento`.

- [ ] **Step 1: Escreva o teste**

```ts
describe('situacaoDeVencimento', () => {
  it('vencida quando o vencimento ja passou e a invoice segue aberta', () => {
    expect(situacaoDeVencimento(
      { status: 'OPEN', dueAt: '2026-08-20T00:00:00Z', blockAt: null },
      new Date('2026-08-23T12:00:00Z'),
      'America/Sao_Paulo',
    )).toBe('VENCIDA');
  });

  /*
   * INVOICE PAGA NUNCA E VENCIDA, mesmo com dueAt no passado -- e o caso mais
   * comum do historico: toda fatura paga do ano passado venceu ha meses.
   */
  it('paga nunca aparece como vencida', () => {
    expect(situacaoDeVencimento(
      { status: 'PAID', dueAt: '2026-01-10T00:00:00Z', blockAt: null },
      new Date('2026-08-23T12:00:00Z'),
      'America/Sao_Paulo',
    )).toBe('EM_DIA');
  });

  /*
   * O DIA DO VENCIMENTO ainda nao venceu. Comparar instante contra instante
   * marcaria a fatura como vencida as 00:01 do proprio dia.
   */
  it('no dia do vencimento ainda nao esta vencida', () => {
    expect(situacaoDeVencimento(
      { status: 'OPEN', dueAt: '2026-08-23T00:00:00Z', blockAt: null },
      new Date('2026-08-23T12:00:00Z'),
      'America/Sao_Paulo',
    )).toBe('VENCE_EM_BREVE');
  });
});
```

- [ ] **Step 2: Rode e veja falhar**

Run: `pnpm --filter @arenahub/admin-web test -- vencimento`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implemente**

Função pura, `agora` e `timezone` por parâmetro. Compara **dias no fuso da unidade**, não instantes.

⚠️ Use `TenantDateTime`/`Money` do `@arenahub/ui`. Regra 5 da lint cobre `Intl` inteiro; a exceção é nominal.

- [ ] **Step 4: Ligue nas duas telas**

Faixa na ficha do aluno, marca na linha da lista. `StateBadge` pelo dicionário do `DS-PAINEL` §7.

- [ ] **Step 5: Rode e veja passar**

Run: `pnpm --filter @arenahub/admin-web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/billing/vencimento.ts apps/admin-web/src/billing/vencimento.test.ts apps/admin-web/app/\(protected\)/students/
git commit -m "feat: aviso de vencimento na ficha e na lista de alunos"
```

---

## Task 13: E2E do aceite

Aceite §6.1 da spec, ponta a ponta.

**Files:**
- Create: `apps/admin-web/tests/e2e/pagamento-no-balcao.spec.ts`

**Interfaces:**
- Consumes: tudo. É o teste do caminho que o PI descreveu.
- Produces: nada.

- [ ] **Step 1: Escreva o E2E**

```ts
test('a recepcao acha o aluno, cobra e emite recibo', async ({ page }) => {
  await page.goto('/students');
  await page.getByTestId('busca-de-alunos').fill('Aluno de Teste');

  await page.getByTestId(/^cobranca-do-aluno-/).first().click();
  await expect(page).toHaveURL(/\/students\/[^/]+\/billing$/);

  await page.getByTestId('forma-dinheiro').click();
  await page.getByLabel('Valor recebido').fill('150,00');
  await page.getByTestId('confirmar-acao-sensivel').click();
  await page.getByLabel(/motivo/i).fill('Pagamento em especie no balcao');
  await page.getByTestId('confirmar').click();

  await expect(page.getByTestId('recibo-emitido')).toBeVisible();
});
```

Ajuste os `testid` aos que as Tasks 10 e 11 criaram — o E2E é o consumidor, não a fonte.

- [ ] **Step 2: Rode**

Run: `pnpm --filter @arenahub/admin-web test:e2e -- pagamento-no-balcao`

⚠️ **`reuseExistingServer` serve build velho.** Se o teste falhar apontando elemento que você acabou de criar, derrube o servidor Next.js de pé e rode de novo antes de investigar o código — foi o falso negativo que custou 19 testes na F45.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/tests/e2e/pagamento-no-balcao.spec.ts
git commit -m "test: E2E do pagamento no balcao"
```

---

## Task 14: Documentação e entrega

Escopo obrigatório da entrega, não melhoria adjacente (`CLAUDE.md`).

**Files:**
- Modify: `docs/specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTS.md`
- Modify: `docs/CONVENTION.md` (se a Task 3 criou índice)

- [ ] **Step 1: Emende a spec com as quatro decisões**

§7 pergunta 5 fecha com **"implementado na F53 — decisão do PI em 23/08/2026"**. O escopo negativo perde a linha do corte. §3.2 e §5 perdem o aviso do `FUSO_PROVISORIO`, que deixou de ser dívida. §8 marca os checkboxes.

- [ ] **Step 2: Registre a entrega no `docs/DEVELOPMENT.md` §5**

Uma linha na tabela, com a evidência **medida**: contagem real de testes, o número que a sonda da Task 3 devolveu, e o que ficou fora.

- [ ] **Step 3: `docs/TESTS.md`**

⚠️ A linha nasce com `—` no campo do PR e o `--check` **não valida esse campo**. Preencher o número do PR **depois do merge** é passo próprio — falhei nisso no #127 e no #128.

- [ ] **Step 4: Gate local, os cinco comandos**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:report && pnpm build
```

⚠️ `pnpm test` **não roda integração**. `test:report` é obrigatório antes do commit final.

- [ ] **Step 5: Commit e PR**

```bash
git add docs/
git commit -m "docs: F53 entregue — pagamentos e cobranca no balcao"
```

PR com **`refs #156`**, nunca `closes #156` — fechar forjaria o aceite do PI. Corpo com as quatro decisões, o resultado medido da sonda e o que ficou fora. Depois do merge: `proplan:done` com o link do PR, e o número do PR no `TESTS.md`.

- [ ] **Step 6: Pergunte ao PI sobre o graphify**

`/graphify . --update` — incremental. Pergunta, não execução automática.

---

## Ordem e dependências

```
Task 1 (regra pura) ─┐
Task 2 (porta+fake) ─┼→ Task 4 (caso de uso) → Task 10 → Task 11 → Task 13 → Task 14
Task 3 (MEDIR) ──────┘                            ↑         ↑
Task 5 (leitura barata) ──────────────────────────┼─────────┘
Task 6 (GET /invoices) ───────────────────────────┤
Task 7 (fuso) ────────────────────────────────────┘
Task 8 (CPF) ─────────────────────────────────────→ Task 10
Task 9 (guarda estrutural) — independente, a qualquer momento
Task 12 (aviso) — independente do fluxo de pagamento
```

**Task 3 antes da Task 4**, sempre: a medição decide se a Task 4 leva migration.

## O que esta fatia NÃO entrega

Adapters reais de Sicoob e Getnet (**F55** — esta fatia roda contra o `FakePaymentProvider`) · pagamento no totem (**F52**) · no app do aluno (**F25**) · régua de cobrança (**F38**) · rota `/students/[id]/pagar` separada (não existe) · API oficial de WhatsApp · push nativo · maquininha/TEF · edição de invoice paga (proibido por `M2-BR-002`).
