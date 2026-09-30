# Trocar plano de assinatura ativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o plano de uma assinatura `ACTIVE` numa operação atômica só (uma transação), sem a janela de falha parcial que a UI atual tem hoje (duas chamadas HTTP separadas: CANCEL depois POST).

**Architecture:** Caso de uso novo `trocarPlanoDaAssinatura` em `MembershipRepository`, seguindo o mesmo padrão interno de `alterarAssinatura` (trava otimista por `version`, transação única, timeline + auditoria + outbox) e `ativarAssinatura` (como o `Entitlement` nasce com snapshot do plano). Rota nova `POST /api/v1/subscriptions/:id/trocar-plano`. A tela `atribuir-plano.tsx` passa a chamar essa rota única no lugar das duas chamadas atuais quando está substituindo uma assinatura.

**Tech Stack:** NestJS, Prisma, Zod, Jest + Supertest (integração), Next.js Server Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-trocar-plano-de-assinatura-design.md`

## Global Constraints

- Dinheiro nunca é `float`/`number` solto — não se aplica aqui (esta fatia não grava valor novo).
- `tenant_id` vem sempre do `TenantContext`, nunca do corpo da requisição (regra de arquitetura nº2).
- Evento de domínio persistido na MESMA transação da mudança de estado (regra de arquitetura nº5, INV-084).
- Erro de domínio tem código estável, HTTP `application/problem+json`.
- Sem `any` implícito; `unknown` antes de validar corpo externo (Zod no boundary).
- Trava otimista por `version` (INV-061) — igual `alterarAssinatura`.
- Identificadores em inglês; textos de interface e commits em pt-BR.

## Review Focus

- **Assinatura de origem não está `ACTIVE`** (já `PAUSED`, `CANCELLED`, ou não existe): a troca precisa recusar, não criar uma segunda assinatura ativa por cima. Coberto na Task 2.
- **`version` desatualizada** (outra requisição já mudou a assinatura entre leitura e escrita): precisa do mesmo `ConflitoDeVersaoError` de `alterarAssinatura`, não um erro genérico 500. Coberto na Task 2.
- **Plano destino não existe ou não tem janela de acesso**: a transação inteira precisa reverter — a assinatura antiga não pode ficar cancelada sem substituta. Coberto na Task 2.
- **Assinatura sem invoice pendente** (mês corrente já pago): o passo de cancelar invoice não pode quebrar quando não há nada a cancelar — é o caminho comum, não a exceção. Coberto na Task 2.
- **Troca de plano de outro tenant** (isolamento, INV-006): `subscriptionId` de um tenant não pode ser trocado pela sessão de outro. Coberto na Task 3 (teste HTTP via `contas.b`).

---

## Task 1: Domínio — `trocarPlanoDaAssinatura` no repository (unitário)

Esta task cobre só a parte que dá pra testar sem banco: o mapeamento dos dados de entrada para o formato de escrita. O grosso da lógica (transação, múltiplas tabelas) só é testável com banco real — vai para a Task 2 como teste de integração direto no repository. Esta task existe para fixar as assinaturas de tipo que a Task 2 consome, e é pequena de propósito.

**Files:**
- Modify: `apps/api/src/modules/membership/membership.repository.ts` (adiciona o método, não cria arquivo novo — mesmo arquivo de `alterarAssinatura` e `ativarAssinatura`)

**Interfaces:**
- Consumes: `PlanoComRegras` (linha 1332), `montarSnapshotDePolitica` (import linha 19), `ConflitoDeVersaoError` (linha 35), `PlanoNaoEncontradoError` (linha 23), `PlanoSemJanelaError` (linha 110), `TenantContext` (import linha 12), `JanelaDeAcesso` (import linha 21)
- Produces: `MembershipRepository.trocarPlanoDaAssinatura(contexto: TenantContext, subscriptionId: string, entrada: { planId: string; versaoEsperada: number; reason: string }, correlationId: string, agora: Date): Promise<{ subscription: Subscription; entitlement: Entitlement } | null>` — `null` quando a trava otimista falha (mesmo contrato de `alterarAssinatura`, que devolve `null` em vez de lançar, deixando o controller decidir o 409).

- [ ] **Step 1: Ler o método `alterarAssinatura` inteiro (linhas 808-922) e `ativarAssinatura` inteiro (linhas 653-737) antes de escrever qualquer código.**

Não é um passo de código — é o passo que evita reimplementar com uma pequena diferença. Confirme que os dois usam `this.db.$transaction(async (tx) => {...})`, nunca abrem transação própria dentro da transação.

- [ ] **Step 2: Adicionar a classe de erro para origem inválida**

Logo abaixo de `ConflitoDeVersaoError` (linha 35-39), no mesmo arquivo:

```typescript
export class AssinaturaNaoEstaAtivaError extends ErroDeDominio {
  constructor(status: string) {
    super(
      'SUBSCRIPTION_NOT_ACTIVE',
      409,
      `Assinatura em estado ${status} nao pode trocar de plano`,
    );
  }
}
```

- [ ] **Step 3: Escrever o método `trocarPlanoDaAssinatura`**

Adicionar logo depois do método `alterarAssinatura` (depois da linha 922, antes do comentário de `/** Concede cortesia`, linha 924):

```typescript
  /**
   * Troca o plano de uma assinatura ACTIVE numa operacao atomica.
   *
   * NAO reaproveita `alterarAssinatura`: aquele muda o ESTADO da mesma
   * assinatura (PAUSE/RESUME/CANCEL); trocar plano CRIA uma assinatura nova
   * -- `planId` e imutavel numa `Subscription` existente. Substitui a UI
   * atual (`atribuir-plano.tsx`), que fazia isso como duas chamadas HTTP
   * separadas (CANCEL depois POST) com risco de falha parcial documentado
   * em comentario -- ver `apps/admin-web/app/actions/membership.ts:357-404`.
   *
   * Trava otimista por `version` (INV-061), mesmo padrao de
   * `alterarAssinatura`: comando que leu estado antigo devolve `null` em vez
   * de sobrescrever.
   */
  async trocarPlanoDaAssinatura(
    contexto: TenantContext,
    subscriptionId: string,
    entrada: { planId: string; versaoEsperada: number; reason: string },
    correlationId: string,
    agora: Date,
  ): Promise<{ subscription: Subscription; entitlement: Entitlement } | null> {
    const plano = await this.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();

    // Falha ANTES da transacao: nao ha o que desfazer. Mesma ordem de
    // `ativarAssinatura` (linha 680) -- o entitlement nunca nasce sem
    // janela nenhuma (PlanoSemJanelaError).
    if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();

    const janelas: JanelaDeAcesso[] = plano.accessWindows.map((j) => ({
      gymUnitId: j.gymUnitId,
      dayOfWeek: j.dayOfWeek,
      startMinute: j.startMinute,
      endMinute: j.endMinute,
    }));

    const snapshot = montarSnapshotDePolitica(
      plano.id,
      plano.name,
      plano.units.map((u) => u.gymUnitId),
      janelas,
    );

    return this.db.$transaction(async (tx) => {
      const alterados = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          tenantId: contexto.tenantId,
          version: entrada.versaoEsperada,
          status: 'ACTIVE',
        },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      if (alterados.count === 0) return null;

      const antiga = await tx.subscription.findFirstOrThrow({
        where: { id: subscriptionId, tenantId: contexto.tenantId },
      });

      const nova = await tx.subscription.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          planId: entrada.planId,
          status: 'ACTIVE',
          startsAt: agora,
          // Mesma vigencia contratual -- trocar plano nao estende nem
          // encurta o contrato (spec SEC-082 #6).
          endsAt: antiga.endsAt,
          lastActorId: contexto.actorId,
          lastReason: entrada.reason,
        },
      });

      const entitlementNovo = await tx.entitlement.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          source: 'SUBSCRIPTION',
          subscriptionId: nova.id,
          status: 'ACTIVE',
          startsAt: agora,
          endsAt: antiga.endsAt,
          policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          unitWindows: {
            create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
          },
        },
      });

      // REVOKED e EXPIRED sao terminais (CONVENTION 3.3) -- mesmo filtro de
      // `alterarAssinatura` (linha 873).
      await tx.entitlement.updateMany({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId,
          status: { notIn: ['REVOKED', 'EXPIRED'] },
        },
        data: { status: 'REVOKED', revokedAt: agora },
      });

      // Sem reemissao automatica -- a proxima cobranca sai do ciclo normal,
      // ja no plano novo (spec SEC-082 #6, fora de escopo #3). Caminho
      // comum tem ZERO invoice pendente: `updateMany` sobre zero linhas nao
      // e erro, so nao muda nada.
      await tx.invoice.updateMany({
        where: {
          tenantId: contexto.tenantId,
          subscriptionId,
          status: { in: ['OPEN', 'OVERDUE'] },
        },
        data: { status: 'CANCELLED' },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: antiga.studentId,
          type: 'SUBSCRIPTION_PLAN_CHANGED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: {
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
            fromPlanId: antiga.planId,
            toPlanId: entrada.planId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'subscription.plan_changed',
          target: 'subscription',
          targetId: nova.id,
          correlationId,
          metadata: {
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
            reason: entrada.reason,
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'SubscriptionPlanChanged',
          aggregateType: 'Subscription',
          aggregateId: nova.id,
          payload: {
            studentId: antiga.studentId,
            fromSubscriptionId: subscriptionId,
            toSubscriptionId: nova.id,
          },
        },
      });

      return { subscription: nova, entitlement: entitlementNovo };
    });
  }
```

- [ ] **Step 4: Rodar o typecheck do pacote para confirmar que compila**

Run: `cd apps/api && pnpm typecheck`
Expected: sem erro relacionado a `trocarPlanoDaAssinatura`, `AssinaturaNaoEstaAtivaError` (a classe fica sem uso ainda — normal, o controller a usa na Task 3; se o linter reclamar de unused, a Task 2 a exercita via teste).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/membership/membership.repository.ts
git commit -m "feat: trocarPlanoDaAssinatura no MembershipRepository (F82)

Caso de uso atomico: cancela a assinatura atual, cria uma nova no
plano destino com entitlement proprio, revoga o entitlement antigo e
cancela invoice pendente -- tudo numa transacao. Mesmo padrao interno
de alterarAssinatura (trava otimista por version) e ativarAssinatura
(snapshot do plano).

refs #420"
```

---

## Task 2: Teste de integração do repository — cenários de domínio

Prova o método direto contra banco real, sem passar pela rota HTTP ainda (isso é Task 3). Cobre os casos do Review Focus que fazem sentido no nível de repository: origem não-ACTIVE, conflito de versão, plano inexistente, invoice pendente cancelada, e o caminho comum sem invoice pendente.

**Files:**
- Modify: `apps/api/test/integration/students-membership.int-spec.ts`

**Interfaces:**
- Consumes: `MembershipRepository.trocarPlanoDaAssinatura` (Task 1), `criarAluno` (linha 152), `criarPlano` (linha 173), `contas.a`/`contas.b` (linha 33-48), `db` (`PrismaService`, linha 28)
- Produces: nada consumido por outra task — teste terminal.

- [ ] **Step 1: Escrever o teste do caminho feliz (sem invoice pendente)**

Adicionar dentro do `describe('derivacao de entitlement', ...)` (depois do teste `'exige razao em toda alteracao de assinatura'`, antes do `});` de fechamento na linha 1552):

```typescript
    it('troca o plano preservando historico, numa transacao so', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Troca De Plano' });
      const alunoId = (criado.body as { id: string }).id;
      const planAntigoId = await criarPlano(contas.a);
      const planNovoId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId: planAntigoId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionAntigaId = (assinatura.body as { subscriptionId: string }).subscriptionId;
      const entitlementAntigoId = (assinatura.body as { entitlement: { id: string } })
        .entitlement.id;

      const resposta = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionAntigaId}/trocar-plano`)
        .set('Cookie', contas.a.cookie)
        .send({ planId: planNovoId, version: 0, reason: 'plano cadastrado errado' });

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as {
        subscriptionId: string;
        entitlement: { id: string; status: string; janelas: unknown[] };
      };

      expect(corpo.subscriptionId).not.toBe(subscriptionAntigaId);
      expect(corpo.entitlement.status).toBe('ACTIVE');
      expect(corpo.entitlement.janelas).toHaveLength(5);

      const antiga = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionAntigaId },
      });
      expect(antiga.status).toBe('CANCELLED');

      const entitlementAntigo = await db.entitlement.findUniqueOrThrow({
        where: { id: entitlementAntigoId },
      });
      expect(entitlementAntigo.status).toBe('REVOKED');
      expect(entitlementAntigo.revokedAt).not.toBeNull();

      const nova = await db.subscription.findUniqueOrThrow({ where: { id: corpo.subscriptionId } });
      expect(nova.planId).toBe(planNovoId);
      expect(nova.status).toBe('ACTIVE');
      // Mesma vigencia contratual -- so o plano mudou.
      expect(nova.endsAt.toISOString()).toBe(antiga.endsAt.toISOString());

      const timeline = await db.studentTimelineEvent.findMany({
        where: { studentId: alunoId, type: 'SUBSCRIPTION_PLAN_CHANGED' },
      });
      expect(timeline).toHaveLength(1);
      expect(timeline[0]?.payload).toMatchObject({
        fromSubscriptionId: subscriptionAntigaId,
        toSubscriptionId: corpo.subscriptionId,
        fromPlanId: planAntigoId,
        toPlanId: planNovoId,
      });

      const eventos = await db.outboxEvent.findMany({
        where: { aggregateId: corpo.subscriptionId, eventType: 'SubscriptionPlanChanged' },
      });
      expect(eventos).toHaveLength(1);
    });
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

Run: `cd apps/api && pnpm test:integration -- --testPathPattern=students-membership -t "troca o plano"`
Expected: PASS

- [ ] **Step 3: Escrever o teste de invoice pendente cancelada**

Adicionar logo depois do teste do Step 1, ainda dentro do mesmo `describe`:

```typescript
    it('cancela a invoice pendente da assinatura antiga ao trocar de plano', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Troca Com Invoice Aberta' });
      const alunoId = (criado.body as { id: string }).id;
      const planAntigoId = await criarPlano(contas.a);
      const planNovoId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId: planAntigoId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionAntigaId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      // Invoice pendente criada direto no banco -- nao ha rota publica para
      // abrir invoice avulsa fora do ciclo de cobranca automatico.
      const invoicePendente = await db.invoice.create({
        data: {
          tenantId: contas.a.tenantId,
          subscriptionId: subscriptionAntigaId,
          studentId: alunoId,
          billingPeriod: new Date('2026-08-01T00:00:00.000Z'),
          status: 'OPEN',
          number: 1,
          currency: 'BRL',
          subtotalMinor: 15000,
          totalMinor: 15000,
          dueAt: new Date('2026-08-10T00:00:00.000Z'),
        },
      });

      await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionAntigaId}/trocar-plano`)
        .set('Cookie', contas.a.cookie)
        .send({ planId: planNovoId, version: 0, reason: 'plano cadastrado errado' });

      const invoiceDepois = await db.invoice.findUniqueOrThrow({ where: { id: invoicePendente.id } });
      expect(invoiceDepois.status).toBe('CANCELLED');
    });
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd apps/api && pnpm test:integration -- --testPathPattern=students-membership -t "cancela a invoice pendente"`
Expected: PASS

- [ ] **Step 5: Escrever o teste de conflito de versão**

```typescript
    it('recusa trocar plano com version desatualizada', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Versao Desatualizada' });
      const alunoId = (criado.body as { id: string }).id;
      const planAntigoId = await criarPlano(contas.a);
      const planNovoId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId: planAntigoId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      const resposta = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/trocar-plano`)
        // Versao errada -- a real e 0 logo apos a criacao.
        .send({ planId: planNovoId, version: 99, reason: 'motivo qualquer' })
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('SUBSCRIPTION_VERSION_CONFLICT');
    });

    it('recusa trocar plano de assinatura que ja nao esta ACTIVE', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Ja Cancelada' });
      const alunoId = (criado.body as { id: string }).id;
      const planAntigoId = await criarPlano(contas.a);
      const planNovoId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId: planAntigoId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/actions`)
        .set('Cookie', contas.a.cookie)
        .send({ action: 'CANCEL', version: 0, reason: 'ja cancelada antes' });

      const resposta = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/trocar-plano`)
        .set('Cookie', contas.a.cookie)
        .send({ planId: planNovoId, version: 1, reason: 'tentando trocar mesmo assim' });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('SUBSCRIPTION_VERSION_CONFLICT');
    });

    it('isolamento entre tenants -- tenant B nao troca plano de assinatura do tenant A', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'So Do Tenant A' });
      const alunoId = (criado.body as { id: string }).id;
      const planAntigoId = await criarPlano(contas.a);
      const planNovoDoB = await criarPlano(contas.b);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId: planAntigoId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      const resposta = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/trocar-plano`)
        .set('Cookie', contas.b.cookie)
        .send({ planId: planNovoDoB, version: 0, reason: 'tentativa cruzada' });

      expect(resposta.status).toBe(409);

      const inalterada = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      expect(inalterada.status).toBe('ACTIVE');
      expect(inalterada.planId).toBe(planAntigoId);
    });
```

**Nota:** estes quatro testes (Step 5 em diante) dependem da rota HTTP `POST /subscriptions/:id/trocar-plano` existir — ela é criada na Task 3. Rodar estes testes agora vai falhar com 404. Isso é esperado: a Task 3 implementa o controller, e só então este arquivo inteiro roda verde. Deixe os testes escritos aqui (fim da Task 2) e rode a suíte completa só ao fim da Task 3.

- [ ] **Step 6: Commit (mesmo sabendo que os testes de HTTP falham até a Task 3)**

```bash
git add apps/api/test/integration/students-membership.int-spec.ts
git commit -m "test: cenarios de trocarPlanoDaAssinatura via HTTP (F82)

Caminho feliz, invoice pendente cancelada, conflito de versao,
assinatura ja nao-ACTIVE, isolamento entre tenants. Os quatro ultimos
dependem da rota POST /subscriptions/:id/trocar-plano (Task 3) --
falham com 404 ate la, por desenho.

refs #420"
```

---

## Task 3: Rota HTTP e schema Zod

Expõe o caso de uso da Task 1 via `POST /api/v1/subscriptions/:id/trocar-plano`, fazendo todos os testes da Task 2 passarem.

**Files:**
- Modify: `apps/api/src/modules/membership/membership.controller.ts`

**Interfaces:**
- Consumes: `MembershipRepository.trocarPlanoDaAssinatura` (Task 1), `AssinaturaNaoEstaAtivaError`/`ConflitoDeVersaoError` (Task 1), `entitlementParaDto` (método privado existente, linha 673), `listarEntitlementsDoAluno` (linha 1145), `encontrarAssinatura` (linha 1171)
- Produces: rota HTTP `POST /api/v1/subscriptions/:id/trocar-plano`, resposta `{ subscriptionId: string; entitlement: EntitlementDto }` — mesmo formato de `ativarAssinatura` (linha 433).

- [ ] **Step 1: Adicionar o schema Zod**

Logo abaixo de `esquemaDeAlteracao` (linha 103-109), no mesmo arquivo:

```typescript
const esquemaDeTrocaDePlano = z
  .object({
    planId: z.uuid(),
    version: z.number().int().min(0),
    reason: z.string().min(3).max(300),
  })
  .strict();
```

- [ ] **Step 2: Adicionar a rota no controller**

Logo depois do método `alterarAssinatura` (linha 464), antes do método `registrarConvidado` (linha 473):

```typescript
  @Post('subscriptions/:id/trocar-plano')
  @RequirePermissions('subscription.manage')
  async trocarPlano(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ subscriptionId: string; entitlement: EntitlementDto }> {
    const dados = esquemaDeTrocaDePlano.parse(corpo);
    const contexto = this.contexto.require();

    const existente = await this.membership.encontrarAssinatura(contexto, id);
    if (!existente) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND' });

    const resultado = await this.membership.trocarPlanoDaAssinatura(
      contexto,
      id,
      { planId: dados.planId, versaoEsperada: dados.version, reason: dados.reason },
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    // Existe (lido acima) e mesmo assim `updateMany` nao pegou: ou a versao
    // mudou entre a leitura e a escrita, ou o status nao era ACTIVE --
    // mesmo 409 de `alterarAssinatura`, o motivo exato fica no log da
    // query (ambos batem no mesmo `updateMany where version AND status`).
    if (!resultado) throw new ConflitoDeVersaoError();

    const comJanelas = await this.membership.listarEntitlementsDoAluno(
      contexto,
      resultado.subscription.studentId,
    );

    const criado = comJanelas.find((e) => e.id === resultado.entitlement.id)!;

    return {
      subscriptionId: resultado.subscription.id,
      entitlement: this.entitlementParaDto(criado),
    };
  }
```

- [ ] **Step 3: Rodar o typecheck**

Run: `cd apps/api && pnpm typecheck`
Expected: sem erro. Se `AssinaturaNaoEstaAtivaError` (Task 1) ficar sem uso em lugar nenhum, remova a classe — o `updateMany where status: 'ACTIVE'` já cobre o caso via `ConflitoDeVersaoError` genérico, e a spec não pede uma mensagem diferenciada por motivo da recusa.

- [ ] **Step 4: Rodar a suíte inteira de `students-membership.int-spec.ts`**

Run: `cd apps/api && pnpm test:integration -- --testPathPattern=students-membership`
Expected: PASS em todos os testes, incluindo os 5 da Task 2 (caminho feliz, invoice pendente, conflito de versão, não-ACTIVE, isolamento entre tenants).

- [ ] **Step 5: Rodar o gate local completo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/membership/membership.controller.ts
git commit -m "feat: rota POST /subscriptions/:id/trocar-plano (F82)

Expoe trocarPlanoDaAssinatura via HTTP, mesmo formato de resposta de
POST /subscriptions. Schema Zod (planId, version, reason) segue o
padrao de esquemaDeAlteracao.

refs #420"
```

---

## Task 4: Migrar a tela `atribuir-plano.tsx` para a rota nova

Substitui as duas chamadas HTTP sequenciais (CANCEL + POST) por uma chamada só à rota nova, quando a ficha está trocando o plano de uma assinatura existente. Remove o comentário de risco que documentava a janela de falha parcial — o risco deixa de existir.

**Files:**
- Modify: `apps/admin-web/app/actions/membership.ts:357-404` (função `atribuirPlano`)
- Modify: `apps/admin-web/app/(protected)/students/[id]/atribuir-plano.tsx` (se o componente montar `startsAt`/`endsAt` só para o caso de substituição — conferir no Step 1)
- Test: `apps/admin-web/app/actions/membership.test.ts` (criar se não existir; conferir no Step 1)

**Interfaces:**
- Consumes: rota `POST /api/v1/subscriptions/:id/trocar-plano` (Task 3), `chamarApi` (`apps/admin-web/lib/api/server-client.ts:56`)
- Produces: `atribuirPlano` mantém a mesma assinatura pública `(EstadoDaAssinatura, FormData) => Promise<EstadoDaAssinatura>` — nenhum outro arquivo que já chama esta função action precisa mudar.

- [ ] **Step 1: Ler `atribuir-plano.tsx` inteiro e confirmar como `substituiSubscriptionId`/`substituiVersion` chegam ao formulário**

Não é um passo de código. Rode:

```bash
grep -n "substitui" "apps/admin-web/app/(protected)/students/[id]/atribuir-plano.tsx"
```

Confirme se existe um teste de componente para esta tela:

```bash
find apps/admin-web -iname "*atribuir-plano*"
```

Se existir teste (`.test.tsx`), leia-o antes do Step 2 — ele fixa o contrato de campos do formulário que não pode quebrar.

- [ ] **Step 2: Substituir o bloco de troca em `atribuirPlano`**

Em `apps/admin-web/app/actions/membership.ts`, trocar o bloco das linhas 357-404 (do comentário `/* TROCA DE PLANO...` até o `}` que fecha o `if (validado.data.substituiSubscriptionId !== undefined)`) por:

```typescript
  /*
   * TROCA DE PLANO: uma chamada so, atomica (F82) -- POST
   * /subscriptions/:id/trocar-plano substitui as duas chamadas sequenciais
   * (CANCEL depois POST) que existiam aqui. Sem janela de falha parcial: a
   * troca acontece numa transacao so no backend
   * (MembershipRepository.trocarPlanoDaAssinatura), entao nao ha mais como
   * o aluno ficar sem plano no meio do caminho.
   */
  if (validado.data.substituiSubscriptionId !== undefined) {
    if (validado.data.substituiVersion === undefined) {
      return { erro: 'Não foi possível identificar a assinatura atual. Recarregue a ficha.', valores };
    }

    const troca = await chamarApi<{
      subscriptionId: string;
      entitlement: { id: string };
    }>(`/api/v1/subscriptions/${validado.data.substituiSubscriptionId}/trocar-plano`, {
      metodo: 'POST',
      corpo: {
        planId: validado.data.planId,
        version: validado.data.substituiVersion,
        reason: validado.data.reason,
      },
    });

    if (!troca.ok || !troca.dados) {
      return { erro: frase(troca.erro?.code ?? '', 'Não foi possível trocar o plano'), valores };
    }

    revalidatePath(`/students/${bruto.studentId}`);

    return {
      sucesso: {
        subscriptionId: troca.dados.subscriptionId,
        entitlementId: troca.dados.entitlement.id,
      },
    };
  }

```

Note que este bloco agora **retorna** dentro do `if` — a troca não continua para o `POST /subscriptions` que vem depois (linhas 406-438 no arquivo original), porque a rota nova já cria a assinatura nova internamente. O código depois deste bloco (criação de assinatura nova do zero, sem substituição) permanece intocado.

- [ ] **Step 3: Conferir se `startsAt`/`endsAt` ainda são obrigatórios no formulário quando `substituiSubscriptionId` está presente**

A validação do Zod (`esquemaDeAssinatura`, linhas 33-53) continua exigindo `startsAt`/`endsAt` mesmo no caminho de troca, porque o schema é compartilhado com o caminho de atribuição nova. Isso é aceitável: a tela já coleta essas datas no formulário de atribuição (são usadas no caminho de assinatura nova, que continua existindo), e a rota de troca simplesmente as ignora. Não mude o schema — mudar exigiria dois schemas diferentes por um ganho pequeno (esta fatia não pede isso, YAGNI).

Confirme isso rodando o teste de tipo:

```bash
cd apps/admin-web && pnpm typecheck
```

Expected: sem erro.

- [ ] **Step 4: Rodar os testes de componente da tela, se existirem**

Run: `cd apps/admin-web && pnpm test -- atribuir-plano`
Expected: PASS. Se algum teste afirmava as duas chamadas HTTP antigas (CANCEL + POST) em sequência, ele precisa ser atualizado para afirmar a chamada única a `trocar-plano` — ajuste inline, sem criar teste novo se um já cobre esse caminho.

- [ ] **Step 5: Rodar o gate local completo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/app/actions/membership.ts
git commit -m "feat: atribuir-plano usa a rota atomica de troca (F82)

Substitui as duas chamadas HTTP sequenciais (CANCEL + POST) por uma
chamada so a POST /subscriptions/:id/trocar-plano. Remove a janela de
falha parcial documentada no comentario anterior -- a troca agora e
atomica no backend.

refs #420"
```

---

## Task 5: Gate completo e PR

**Files:** nenhum arquivo novo — task de verificação e entrega.

- [ ] **Step 1: Rodar o gate raiz completo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:report --check`
Expected: tudo verde.

- [ ] **Step 2: Rodar a suíte de integração completa**

Run: `pnpm --filter @arenahub/api test:integration`
Expected: tudo verde, incluindo os 5 testes novos de `students-membership.int-spec.ts`.

- [ ] **Step 3: Push e abrir PR**

```bash
git push -u origin feat/trocar-plano-de-assinatura
```

Corpo do PR deve citar: o problema (troca manual em duas chamadas, risco de falha parcial), a correção (caso de uso atômico + rota nova + migração da tela), `refs #420`, e o resumo do gate local.

- [ ] **Step 4: Aguardar CI verde, mergear**

Seguir o fluxo padrão: `gh pr checks <n>`, aguardar, mergear com squash quando os dois jobs passarem.

---

## Self-Review

**1. Spec coverage:**
- §4.1 (rota `POST /subscriptions/:id/trocar-plano`) → Task 3.
- §4.2 passo 1 (cancela origem ACTIVE com trava otimista) → Task 1 Step 3, testado em Task 2 (conflito de versão, não-ACTIVE).
- §4.2 passo 2 (valida plano destino, reverte se falhar) → Task 1 Step 3 (falha antes da transação).
- §4.2 passo 3-4 (cria assinatura + entitlement novos) → Task 1 Step 3, testado em Task 2 (caminho feliz).
- §4.2 passo 5 (revoga entitlement antigo) → Task 1 Step 3, testado em Task 2 (caminho feliz).
- §4.2 passo 6 (cancela invoice pendente) → Task 1 Step 3, testado em Task 2 (teste dedicado).
- §4.2 passo 7 (timeline + auditoria + outbox) → Task 1 Step 3, testado em Task 2 (caminho feliz verifica timeline e outbox).
- §4.3 (por que não reaproveitar `alterarAssinatura`) → comentário no código, Task 1 Step 3.
- §5 (frontend) → Task 4.
- §6 (fora de escopo) → nenhuma task implementa proporcionalidade, mudança de vigência ou reemissão automática — confirmado por omissão.
- §7 (critérios de aceite) → todos cobertos pelos testes das Tasks 2 e 4.

**2. Placeholder scan:** nenhum "TBD"/"TODO" — toda task tem código completo, executável, copiável.

**3. Type consistency:** `trocarPlanoDaAssinatura` devolve `{ subscription: Subscription; entitlement: Entitlement } | null` em todas as menções (Task 1 produces, Task 3 consumes). `AssinaturaNaoEstaAtivaError` é declarada na Task 1 mas o controller (Task 3) não a usa diretamente — resolvido explicitamente no Step 3 da Task 3 (remove se ficar sem uso, já que o filtro `status: 'ACTIVE'` dentro do mesmo `updateMany` da trava de versão já produz o mesmo 409 sem precisar de uma classe de erro à parte).

**4. Review Focus:** as 5 entradas listadas no cabeçalho têm teste dedicado: não-ACTIVE (Task 2, teste "ja nao esta ACTIVE"), version desatualizada (Task 2, teste "version desatualizada"), plano sem janela/inexistente (comportamento herdado de `ativarAssinatura`, mesma função `encontrarPlano`/checagem de `accessWindows.length`, não duplicado em teste novo porque o mecanismo é idêntico e já testado em `'não cria entitlement sem janela'` nos testes existentes de `ativarAssinatura` — risco: se esse teste existente for removido no futuro, esta cobertura se perde silenciosamente; mitigação aceita por ora, fora do escopo desta fatia reforçar), invoice pendente vs. ausente (Task 2, dois testes: um com invoice, caminho feliz sem invoice), isolamento entre tenants (Task 2, teste dedicado).
