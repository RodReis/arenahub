# ID da catraca automático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O número da catraca (`FACIAL_ENROLL_ID`) nasce sozinho no cadastro do aluno, aparece em destaque, pode ser gerado ou escolhido do leitor por uma ação na lista de alunos, e o vínculo com o leitor fecha na hora — sem reiniciar o Edge.

**Architecture:** Geração mora em `students` (`TurnstileNumberService`, reaproveita `proximoNumeroLivre`). Vínculo imediato mora em `biometrics` (`VincularCadastroLegadoUseCase` ganha a variante por número), exposto por um controller novo de `biometrics` — `biometrics` já importa `students`, então o inverso criaria ciclo. O Edge passa a mandar o nome que o leitor guarda dos números sem aluno; a API guarda em `DeviceReaderNumber.readerName`. O painel ganha um `<dialog>` na lista e um bloco de destaque na ficha.

**Tech Stack:** NestJS + Prisma 7 (api), Node + Jest (edge-agent), Next.js 16 App Router + Vitest (admin-web), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-10-03-id-catraca-automatico-design.md`

## Global Constraints

- Número no intervalo `NUMERO_MINIMO = 100_000_000_000` … `NUMERO_MAXIMO = 999_999_999_999` (`proximo-numero-livre.ts`); livre simultaneamente no leitor (`DeviceReaderNumber`), em `StudentCredential` e em `DeviceUser` do tenant.
- `tenantId` vem sempre do `TenantContext` autenticado (staff) ou do `edgeContext` (Edge) — nunca do corpo (regra de arquitetura 2).
- Rota de Edge com corpo `.strict()`; teto de itens por chamada.
- Vínculo nunca transfere número de um aluno para outro (`CREDENTIAL_ALREADY_ASSIGNED`); na dúvida, não vincula.
- Nenhum comando novo vai ao leitor por causa desta fatia além de `getuserinfo` de leitura.
- UI: textos pt-BR, feedback por Toast (`useToastDeErro` / `useToast`), CSS só com tokens `--ah-*` (guarda `check-css-tokens`), `<dialog>` nativo com `margin: auto` (`dialogo.module.css`).
- Identificadores em inglês, comentários e commits em PT-BR, sem `any`, `unknown` antes de validar.
- Antes de cada commit: `pnpm lint`, `pnpm typecheck` e a suíte do pacote tocado; integração da API com `pnpm --filter @arenahub/api test:integration -- <arquivo>`.

## Review Focus

1. **Duas recepcionistas gerando ao mesmo tempo** — cada aluno recebe número distinto; nenhum 500. (Task 1, teste paralelo.)
2. **Aluno que já tem número clica "Gerar novo"** — devolve o mesmo número, não troca (troca silenciosa invalidaria a face já cadastrada). (Task 1.)
3. **Número escolhido do leitor já é credencial de outro aluno** (alguém digitou antes) — 409 com `CREDENTIAL_ALREADY_ASSIGNED`, nenhum `DeviceUser` criado. (Task 3.)
4. **Aluno troca de número** — catraca passa a reconhecer o número novo e deixa de reconhecer o antigo; sem erro de unicidade. (Task 2.)
5. **Firmware não devolve `name` no `getuserinfo`** — Edge segue mandando os números; aba "Do leitor" lista só número. (Task 5.)

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/api/src/modules/students/turnstile-number.service.ts` | criar | gerar número livre para o aluno (idempotente, retry 1x) |
| `apps/api/src/modules/students/students.module.ts` | modificar | prover/exportar o service |
| `apps/api/src/modules/students/students.controller.ts` | modificar | `criar` chama `gerar`; `next-available` delega ao service |
| `apps/api/src/modules/devices/device-reader-number.repository.ts` | modificar | `leitoresComNumero`, `listarSemAluno`, `registrarNomes` |
| `apps/api/src/modules/biometrics/biometric-identity.repository.ts` | modificar | `reapontarNumero` |
| `apps/api/src/modules/biometrics/vincular-cadastro-legado.use-case.ts` | modificar | núcleo por leitor, `vincularNumero`, reapontar na troca |
| `apps/api/src/modules/biometrics/student-turnstile-number.controller.ts` | criar | `POST /students/:id/turnstile-number`, `GET /device-reader-numbers/unlinked` |
| `apps/api/src/modules/biometrics/edge-legacy-link.controller.ts` | modificar | `POST /edge/device-users/reader-names` |
| `apps/api/src/modules/biometrics/biometrics.module.ts` | modificar | registrar controller novo |
| `packages/database/prisma/schema.prisma` + migração | modificar | `DeviceReaderNumber.readerName` |
| `apps/edge-agent/src/adapters/topdata/topdata-facial-adapter.ts` | modificar | `lerNome(enrollid)` |
| `apps/edge-agent/src/domain/facial-device.ts` | modificar | `lerNome?` na interface |
| `apps/edge-agent/src/producao/vinculo-legado.ts` | modificar | depois do vínculo, envia nomes dos `withoutStudent` |
| `apps/admin-web/app/actions/numero-da-catraca.ts` | criar | Server Actions gerar / usar do leitor / listar pendentes |
| `apps/admin-web/src/components/numero-em-destaque.tsx` + `.module.css` | criar | bloco grande do número + copiar |
| `apps/admin-web/app/(protected)/students/numero-da-catraca.tsx` | criar | ícone da linha + `<dialog>` com duas abas |
| `apps/admin-web/app/(protected)/students/acoes-do-aluno.tsx` | modificar | encaixar a ação |
| `apps/admin-web/app/(protected)/students/[id]/credencial-de-acesso.tsx` | modificar | destaque do número facial na ficha |
| `docs/runbooks/operacao-edge-arena-positiva.md` | modificar | fluxo novo |

---

### Task 1: API — gerar número livre (service + cadastro do aluno)

**Files:**
- Create: `apps/api/src/modules/students/turnstile-number.service.ts`
- Modify: `apps/api/src/modules/students/students.module.ts:28-40`
- Modify: `apps/api/src/modules/students/students.controller.ts:419-467` (construtor + `next-available`), `:601-626` (`criar`)
- Test: `apps/api/test/integration/turnstile-number.int-spec.ts` (criar)

**Interfaces:**
- Produces: `TurnstileNumberService.gerar(contexto: TenantContext, studentId: string): Promise<{ externalId: string; created: boolean }>` e `TurnstileNumberService.proximoLivre(tenantId: string): Promise<string>`. Exportado por `StudentsModule`.

- [ ] **Step 1: Teste de integração (falha)**

Criar `apps/api/test/integration/turnstile-number.int-spec.ts`. Copiar de `students-credential.int-spec.ts:24-130` o bloco de montagem (`montarAcademia`, `gerarCpfValido`, `criarAluno`, login) para **um** tenant com slug `tn-${sufixo}`, mais `afterAll` que apaga o tenant (memória: suíte que cria tenant precisa apagar). Casos:

```ts
it('cadastro do aluno ja nasce com numero de catraca na faixa', async () => {
  const id = await criarAluno(conta);
  const r = await request(servidor()).get(`/api/v1/students/${id}/credentials`).set('Cookie', conta.cookie);
  const facial = (r.body as { kind: string; externalId: string }[]).find((c) => c.kind === 'FACIAL_ENROLL_ID');
  expect(facial).toBeDefined();
  expect(Number(facial!.externalId)).toBeGreaterThanOrEqual(100_000_000_000);
});

it('gerar de novo para o mesmo aluno devolve o mesmo numero', async () => {
  const id = await criarAluno(conta);
  const servico = app.get(TurnstileNumberService);
  const ctx = { tenantId: conta.tenantId };
  const primeiro = await servico.gerar(ctx, id);
  const segundo = await servico.gerar(ctx, id);
  expect(segundo).toEqual({ externalId: primeiro.externalId, created: false });
});

it('duas geracoes em paralelo para alunos diferentes nao repetem numero', async () => {
  const [a, b] = await Promise.all([criarAluno(conta), criarAluno(conta)]);
  await db.studentCredential.deleteMany({ where: { studentId: { in: [a, b] } } });
  const servico = app.get(TurnstileNumberService);
  const ctx = { tenantId: conta.tenantId };
  const [ra, rb] = await Promise.all([servico.gerar(ctx, a), servico.gerar(ctx, b)]);
  expect(ra.externalId).not.toBe(rb.externalId);
});
```

Confira a forma exata do `TenantContext` em `apps/api/src/common/tenant/tenant-context.ts` e monte `ctx` com os campos obrigatórios dele.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- turnstile-number`
Expected: FAIL — `TurnstileNumberService` não existe / credencial ausente.

- [ ] **Step 3: Implementar o service**

```ts
// apps/api/src/modules/students/turnstile-number.service.ts
import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { proximoNumeroLivre } from '../devices/domain/proximo-numero-livre.js';
import { CredencialJaAtribuidaError, StudentCredentialRepository } from './student-credential.repository.js';

/**
 * Numero de catraca automatico -- o aluno nasce com ele e a recepcao so
 * digita no leitor o que a tela mostra (spec 2026-10-03).
 *
 * IDEMPOTENTE POR ALUNO: quem ja tem `FACIAL_ENROLL_ID` recebe o mesmo
 * numero. Trocar em silencio deixaria a face ja cadastrada no leitor sob o
 * numero antigo -- a catraca passaria a recusar a pessoa.
 *
 * Corrida entre duas geracoes e decidida pelo UNIQUE do banco: a perdedora
 * recalcula UMA vez. Persistindo, sobe o erro de credencial ocupada.
 */
@Injectable()
export class TurnstileNumberService {
  constructor(
    private readonly credenciais: StudentCredentialRepository,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
    private readonly dispositivos: DeviceRepository,
  ) {}

  async proximoLivre(tenantId: string): Promise<string> {
    const [doLeitor, deCredencial, vinculados] = await Promise.all([
      this.numerosDoLeitor.listarNumerosDoTenant(tenantId),
      this.credenciais.listarNumerosDoTenant(tenantId),
      this.dispositivos.listarNumerosVinculadosDoTenant(tenantId),
    ]);

    return proximoNumeroLivre(new Set([...doLeitor, ...deCredencial, ...vinculados]));
  }

  async gerar(
    contexto: TenantContext,
    studentId: string,
  ): Promise<{ externalId: string; created: boolean }> {
    const atuais = await this.credenciais.listarPorAluno(contexto, studentId);
    const facial = atuais.find((c) => c.kind === 'FACIAL_ENROLL_ID');
    if (facial) return { externalId: facial.externalId, created: false };

    for (let tentativa = 0; ; tentativa += 1) {
      const numero = await this.proximoLivre(contexto.tenantId);
      try {
        const criada = await this.credenciais.definir(contexto, studentId, 'FACIAL_ENROLL_ID', numero);
        return { externalId: criada.externalId, created: true };
      } catch (erro: unknown) {
        const colidiu =
          erro instanceof CredencialJaAtribuidaError ||
          (typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002');
        if (!colidiu || tentativa >= 1) throw erro;
      }
    }
  }
}
```

- [ ] **Step 4: Registrar no módulo e usar no controller**

Em `students.module.ts`: adicionar `TurnstileNumberService` a `providers` e `exports` (comentário: "consumido por `biometrics` para a ação da lista").

Em `students.controller.ts`:
- construtor: adicionar `private readonly numeroDaCatraca: TurnstileNumberService`;
- `proximaCredencialDisponivel` passa a ser `return { externalId: await this.numeroDaCatraca.proximoLivre(contexto.tenantId) };` (remove as três leituras duplicadas);
- `criar`, depois de `this.alunos.criar(...)`:

```ts
    // Numero de catraca automatico (spec 2026-10-03). Transacao propria: se
    // falhar, o aluno existe sem numero e a acao da lista gera depois -- nao
    // vale derrubar o cadastro inteiro por isso.
    await this.numeroDaCatraca.gerar(contexto, aluno.id);
```

Se `DeviceRepository`/`DeviceReaderNumberRepository` deixarem de ser usados no controller, remova-os do construtor.

- [ ] **Step 5: Rodar e ver passar; rodar a suíte de credenciais**

Run: `pnpm --filter @arenahub/api test:integration -- turnstile-number students-credential students`
Expected: PASS. Se algum teste de `students-credential` assumir "aluno novo sem credencial facial", ajuste o teste para o comportamento novo (ele grava por cima — o `definir` faz `update` da linha do próprio aluno) e cite a spec no comentário.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/students apps/api/test/integration/turnstile-number.int-spec.ts apps/api/test/integration/students-credential.int-spec.ts
git commit -m "feat(api): numero de catraca automatico no cadastro do aluno"
```

---

### Task 2: API — vínculo por número e reapontar na troca

**Files:**
- Modify: `apps/api/src/modules/devices/device-reader-number.repository.ts`
- Modify: `apps/api/src/modules/biometrics/biometric-identity.repository.ts:145-154`
- Modify: `apps/api/src/modules/biometrics/vincular-cadastro-legado.use-case.ts`
- Test: `apps/api/test/integration/legacy-device-link.int-spec.ts` (acrescentar casos)

**Interfaces:**
- Produces:
  - `DeviceReaderNumberRepository.leitoresComNumero(tenantId: string, externalUserId: string): Promise<{ deviceId: string; serial: string }[]>`
  - `BiometricIdentityRepository.reapontarNumero(tenantId: string, deviceId: string, studentId: string, novoNumero: string): Promise<void>`
  - `VincularCadastroLegadoUseCase.vincularNumero(tenantId: string, numero: string, correlationId: string, agora: Date): Promise<{ linkedReaders: number }>`

- [ ] **Step 1: Testes (falham)**

Em `legacy-device-link.int-spec.ts`, novo `describe('vinculo imediato e troca de numero')`, reusando `criarAluno`, `vincular` e `ctx` do arquivo:

```ts
it('numero ja no leitor vincula na hora pelo caso de uso, sem o Edge reenviar', async () => {
  const numero = `7${sufixo.replace(/\D/g, '').padEnd(11, '1').slice(0, 11)}`;
  await vincular({ deviceSerial: serial, externalUserIds: [numero] }); // leitor informa: sem aluno
  const aluno = await criarAluno('IMEDIATO', [{ kind: 'FACIAL_ENROLL_ID', externalId: numero }]);

  const r = await app.get(VincularCadastroLegadoUseCase).vincularNumero(ctx.tenantId, numero, 'teste', new Date());

  expect(r.linkedReaders).toBe(1);
  const du = await db.deviceUser.findFirst({ where: { deviceId: ctx.deviceId, externalUserId: numero } });
  expect(du?.studentId).toBe(aluno);
});

it('troca de numero reaponta o DeviceUser em vez de recusar', async () => {
  const antigo = `8${sufixo.replace(/\D/g, '').padEnd(11, '2').slice(0, 11)}`;
  const novo = `9${sufixo.replace(/\D/g, '').padEnd(11, '3').slice(0, 11)}`;
  const aluno = await criarAluno('TROCA', [{ kind: 'FACIAL_ENROLL_ID', externalId: antigo }]);
  await vincular({ deviceSerial: serial, externalUserIds: [antigo] });

  await db.studentCredential.updateMany({ where: { studentId: aluno }, data: { externalId: novo } });
  const r = await vincular({ deviceSerial: serial, externalUserIds: [novo] });

  expect(r.status).toBe(201);
  expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([]);
  const doAluno = await db.deviceUser.findMany({ where: { deviceId: ctx.deviceId, studentId: aluno } });
  expect(doAluno.map((d) => d.externalUserId)).toEqual([novo]);
});

it('aluno com cartao e facial de numeros diferentes continua studentAlreadyLinked', async () => {
  const facial = `6${sufixo.replace(/\D/g, '').padEnd(11, '4').slice(0, 11)}`;
  const cartao = `5${sufixo.replace(/\D/g, '').padEnd(11, '5').slice(0, 11)}`;
  await criarAluno('DOIS', [
    { kind: 'FACIAL_ENROLL_ID', externalId: facial },
    { kind: 'TURNSTILE_CARD', externalId: cartao },
  ]);
  await vincular({ deviceSerial: serial, externalUserIds: [facial] });
  const r = await vincular({ deviceSerial: serial, externalUserIds: [cartao] });

  expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([cartao]);
});
```

Importar `VincularCadastroLegadoUseCase` de `../../src/modules/biometrics/vincular-cadastro-legado.use-case.js`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- legacy-device-link`
Expected: FAIL — `vincularNumero` não existe; troca devolve `studentAlreadyLinked: [novo]`.

- [ ] **Step 3: Repositórios**

`device-reader-number.repository.ts`:

```ts
  /** Leitores do tenant que TEM este numero -- vinculo imediato (spec 2026-10-03). */
  async leitoresComNumero(
    tenantId: string,
    externalUserId: string,
  ): Promise<{ deviceId: string; serial: string }[]> {
    const linhas = await this.db.deviceReaderNumber.findMany({
      where: { tenantId, externalUserId },
      select: { deviceId: true, device: { select: { serial: true } } },
    });

    return linhas.map((l) => ({ deviceId: l.deviceId, serial: l.device.serial }));
  }
```

`biometric-identity.repository.ts` (depois de `vinculosDoDispositivo`):

```ts
  /**
   * Troca de numero do aluno -- o vinculo dele NESTE leitor passa a apontar
   * para o numero novo. `@@unique([deviceId, identityId])` impede um segundo
   * `DeviceUser`; reapontar e a unica forma de a catraca reconhecer o novo.
   */
  async reapontarNumero(
    tenantId: string,
    deviceId: string,
    studentId: string,
    novoNumero: string,
  ): Promise<void> {
    await this.db.deviceUser.updateMany({
      where: { tenantId, deviceId, studentId },
      data: { externalUserId: novoNumero },
    });
  }
```

- [ ] **Step 4: Caso de uso**

Em `vincular-cadastro-legado.use-case.ts`:

1. Mover o corpo de `executar` a partir de `const resultado: ResultadoDoVinculoLegado = {` (linha 81) até `return resultado;` para um método privado:

```ts
  private async vincularNoLeitor(
    tenantId: string,
    leitor: { id: string; serial: string },
    numeros: readonly string[],
    correlationId: string,
    agora: Date,
  ): Promise<ResultadoDoVinculoLegado>
```

trocando `edge.tenantId` → `tenantId`, `leitor.id` permanece, `entrada.deviceSerial` → `leitor.serial`, `new Set(entrada.externalUserIds)` → `new Set(numeros)`. `executar` passa a: resolver leitor, `registrarLote`, e `return this.vincularNoLeitor(edge.tenantId, { id: leitor.id, serial: entrada.deviceSerial }, entrada.externalUserIds, correlationId, agora);`.

2. Guardar o número vinculado de cada aluno: trocar `const alunosVinculados = new Set(vinculos.map((v) => v.studentId));` por

```ts
    const numeroDoAluno = new Map(vinculos.map((v) => [v.studentId, v.externalUserId]));
```

e usar `numeroDoAluno.has(studentId)` / `numeroDoAluno.set(studentId, numero)` onde hoje há `alunosVinculados.has/add`.

3. No ramo de aluno já vinculado, antes de `studentAlreadyLinked.push`:

```ts
      const numeroAtual = numeroDoAluno.get(studentId);
      if (numeroAtual !== undefined) {
        // Troca de numero: o antigo nao e mais credencial do aluno, entao o
        // vinculo antigo esta morto -- reaponta. Se o antigo AINDA e
        // credencial (cartao + facial com numeros diferentes), sao dois
        // cadastros vivos e o leitor so aceita um: devolve para a recepcao.
        const credenciaisDoAluno = await this.credenciais.listarNumerosDoAluno(tenantId, studentId);
        if (!credenciaisDoAluno.includes(numeroAtual)) {
          await this.identidades.reapontarNumero(tenantId, leitor.id, studentId, numero);
          numeroDoAluno.set(studentId, numero);
          resultado.linked += 1;
          continue;
        }
        resultado.studentAlreadyLinked.push(numero);
        continue;
      }
```

4. Em `student-credential.repository.ts`, acrescentar:

```ts
  async listarNumerosDoAluno(tenantId: string, studentId: string): Promise<string[]> {
    const linhas = await this.db.comTenant((tx) =>
      tx.studentCredential.findMany({ where: { tenantId, studentId }, select: { externalId: true } }),
    );
    return linhas.map((l) => l.externalId);
  }
```

5. Método público novo:

```ts
  /**
   * Vinculo imediato quando a recepcao grava o numero -- spec 2026-10-03.
   *
   * O leitor ja informou este numero antes (cadastro feito direto no
   * equipamento, `DeviceReaderNumber`). Sem isto o vinculo so fechava no
   * proximo reinicio do Edge: o `senduser` ja tinha sido confirmado e o
   * `getuserlist` roda uma vez por execucao.
   */
  async vincularNumero(
    tenantId: string,
    numero: string,
    correlationId: string,
    agora: Date,
  ): Promise<{ linkedReaders: number }> {
    const leitores = await this.numerosDoLeitor.leitoresComNumero(tenantId, numero);
    let linkedReaders = 0;

    for (const leitor of leitores) {
      const r = await this.vincularNoLeitor(
        tenantId,
        { id: leitor.deviceId, serial: leitor.serial },
        [numero],
        correlationId,
        agora,
      );
      linkedReaders += r.linked + r.alreadyLinked;
    }

    return { linkedReaders };
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- legacy-device-link legacy-device-photo` e `pnpm --filter @arenahub/api test -- vincular-cadastro-legado`
Expected: PASS. O spec unitário existente pode precisar do novo método `listarNumerosDoAluno` no dublê do repositório de credenciais — acrescente devolvendo `[]`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/devices apps/api/src/modules/biometrics apps/api/src/modules/students/student-credential.repository.ts apps/api/test/integration/legacy-device-link.int-spec.ts
git commit -m "feat(api): vinculo imediato por numero e reapontar DeviceUser na troca"
```

---

### Task 3: API — rotas da ação da lista

**Files:**
- Create: `apps/api/src/modules/biometrics/student-turnstile-number.controller.ts`
- Modify: `apps/api/src/modules/biometrics/biometrics.module.ts:23`
- Modify: `apps/api/src/modules/devices/device-reader-number.repository.ts` (`listarSemAluno`)
- Test: `apps/api/test/integration/turnstile-number.int-spec.ts` (acrescentar)
- Test: `apps/api/test/integration/openapi.int-spec.ts` (snapshot/lista de rotas)

**Interfaces:**
- Consumes: `TurnstileNumberService.gerar`, `StudentCredentialRepository.definir`, `VincularCadastroLegadoUseCase.vincularNumero`, `StudentRepository.encontrar`.
- Produces (HTTP, consumidas pela Task 6):
  - `POST /api/v1/students/:id/turnstile-number` corpo `{ externalId?: string }` (`.strict()`; `externalId` `/^\d{1,12}$/`) → `200 { externalId: string; linkedReaders: number }`; `404 STUDENT_NOT_FOUND`; `409 CREDENTIAL_ALREADY_ASSIGNED`. Permissão `student.update`.
  - `GET /api/v1/device-reader-numbers/unlinked` → `200 { externalId: string; readerName: string | null; deviceSerial: string }[]`, ordenado por `externalId`. Permissão `student.read`.
  - `DeviceReaderNumberRepository.listarSemAluno(tenantId: string): Promise<{ externalId: string; readerName: string | null; deviceSerial: string }[]>`

> `readerName` só existe depois da Task 4. Faça a Task 4 Step 1–3 (migração) antes deste Step 3, ou devolva `readerName: null` aqui e troque na Task 4. **Ordem recomendada: Task 4 antes da Task 3.**

- [ ] **Step 1: Testes (falham)** — no `turnstile-number.int-spec.ts`, montar também um `edgeNode` + `device` FACIAL_READER no tenant (copiar `legacy-device-link.int-spec.ts:118-146`) e semear `DeviceReaderNumber` direto pelo `db`:

```ts
it('POST sem numero gera e devolve o numero do aluno', async () => {
  const id = await criarAluno(conta);
  await db.studentCredential.deleteMany({ where: { studentId: id } });
  const r = await request(servidor()).post(`/api/v1/students/${id}/turnstile-number`).set('Cookie', conta.cookie).send({});
  expect(r.status).toBe(200);
  expect(Number((r.body as { externalId: string }).externalId)).toBeGreaterThanOrEqual(100_000_000_000);
});

it('POST com numero do leitor grava e vincula na hora', async () => {
  const numero = '123450000001';
  await db.deviceReaderNumber.create({ data: { tenantId: conta.tenantId, deviceId: leitorId, externalUserId: numero, seenAt: new Date(), readerName: 'MARIA S' } });
  const id = await criarAluno(conta);
  const r = await request(servidor()).post(`/api/v1/students/${id}/turnstile-number`).set('Cookie', conta.cookie).send({ externalId: numero });
  expect(r.body).toEqual({ externalId: numero, linkedReaders: 1 });
});

it('POST com numero que ja e de outro aluno da 409', async () => {
  const dono = await criarAluno(conta);
  const { body } = await request(servidor()).get(`/api/v1/students/${dono}/credentials`).set('Cookie', conta.cookie);
  const ocupado = (body as { externalId: string }[])[0]!.externalId;
  const outro = await criarAluno(conta);
  const r = await request(servidor()).post(`/api/v1/students/${outro}/turnstile-number`).set('Cookie', conta.cookie).send({ externalId: ocupado });
  expect(r.status).toBe(409);
  expect((r.body as { code: string }).code).toBe('CREDENTIAL_ALREADY_ASSIGNED');
});

it('GET unlinked lista so numero de leitor sem aluno, com nome', async () => {
  await db.deviceReaderNumber.create({ data: { tenantId: conta.tenantId, deviceId: leitorId, externalUserId: '123450000099', seenAt: new Date(), readerName: 'JOAO P' } });
  const r = await request(servidor()).get('/api/v1/device-reader-numbers/unlinked').set('Cookie', conta.cookie);
  const lista = r.body as { externalId: string; readerName: string | null }[];
  expect(lista).toContainEqual(expect.objectContaining({ externalId: '123450000099', readerName: 'JOAO P' }));
  expect(lista.map((l) => l.externalId)).not.toContain('123450000001'); // vinculado no teste anterior
});
```

E um caso de isolamento: tenant B (`montarAcademia` de novo) não vê o `123450000099`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @arenahub/api test:integration -- turnstile-number` → 404 nas rotas.

- [ ] **Step 3: `listarSemAluno`**

```ts
  /**
   * Numeros do leitor que nenhum aluno tem como credencial -- a aba "Do
   * leitor" da acao da lista (spec 2026-10-03). Credencial de QUALQUER kind
   * conta: cartao e facial dividem o espaco de numero do leitor.
   */
  async listarSemAluno(
    tenantId: string,
  ): Promise<{ externalId: string; readerName: string | null; deviceSerial: string }[]> {
    const [doLeitor, credenciais] = await Promise.all([
      this.db.deviceReaderNumber.findMany({
        where: { tenantId },
        select: { externalUserId: true, readerName: true, device: { select: { serial: true } } },
        orderBy: { externalUserId: 'asc' },
      }),
      this.db.studentCredential.findMany({ where: { tenantId }, select: { externalId: true } }),
    ]);
    const ocupados = new Set(credenciais.map((c) => c.externalId));

    return doLeitor
      .filter((l) => !ocupados.has(l.externalUserId))
      .map((l) => ({ externalId: l.externalUserId, readerName: l.readerName, deviceSerial: l.device.serial }));
  }
```

> Regra 9: `devices` lendo `student_credentials` cruza módulo. Se a guarda/revisão apontar, mova o filtro para o controller (`credenciais.listarNumerosDoTenant` + `numerosDoLeitor.listar`) — decisão registrada no PR.

- [ ] **Step 4: Controller**

```ts
// apps/api/src/modules/biometrics/student-turnstile-number.controller.ts
import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '<mesmo import usado em students.controller.ts>';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { CredencialJaAtribuidaError, StudentCredentialRepository } from '../students/student-credential.repository.js';
import { StudentRepository } from '../students/student.repository.js';
import { TurnstileNumberService } from '../students/turnstile-number.service.js';
import { VincularCadastroLegadoUseCase } from './vincular-cadastro-legado.use-case.js';

const esquema = z.object({ externalId: z.string().regex(/^\d{1,12}$/).optional() }).strict();

/**
 * Acao "Numero da catraca" da lista de alunos -- spec 2026-10-03.
 *
 * Mora em `biometrics` e nao em `students`: o vinculo imediato e caso de uso
 * daqui, e `biometrics` ja importa `students` -- o contrario fecharia ciclo.
 */
@Controller('api/v1')
export class StudentTurnstileNumberController {
  constructor(
    private readonly contexto: TenantContextService,
    private readonly alunos: StudentRepository,
    private readonly credenciais: StudentCredentialRepository,
    private readonly numeroDaCatraca: TurnstileNumberService,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
    private readonly vincular: VincularCadastroLegadoUseCase,
  ) {}

  @Post('students/:id/turnstile-number')
  @HttpCode(200)
  @RequirePermissions('student.update')
  async definir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ externalId: string; linkedReaders: number }> {
    const dados = esquema.parse(corpo);
    const contexto = this.contexto.require();

    if (!(await this.alunos.encontrar(contexto, id))) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    let externalId: string;
    try {
      externalId =
        dados.externalId === undefined
          ? (await this.numeroDaCatraca.gerar(contexto, id)).externalId
          : (await this.credenciais.definir(contexto, id, 'FACIAL_ENROLL_ID', dados.externalId)).externalId;
    } catch (erro: unknown) {
      const ocupado =
        erro instanceof CredencialJaAtribuidaError ||
        (typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002');
      if (!ocupado) throw erro;
      throw new ConflictException({
        code: 'CREDENTIAL_ALREADY_ASSIGNED',
        title: 'Este número já está vinculado a outro aluno.',
      });
    }

    const { linkedReaders } = await this.vincular.vincularNumero(
      contexto.tenantId,
      externalId,
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    return { externalId, linkedReaders };
  }

  @Get('device-reader-numbers/unlinked')
  @RequirePermissions('student.read')
  async semAluno(): Promise<{ externalId: string; readerName: string | null; deviceSerial: string }[]> {
    return this.numerosDoLeitor.listarSemAluno(this.contexto.require().tenantId);
  }
}
```

Adicionar `@ApiOkResponse` com schema, como os vizinhos. Registrar em `biometrics.module.ts` → `controllers: [BiometricsController, EdgeLegacyLinkController, StudentTurnstileNumberController]`.

Também: `PUT /students/:id/credentials` (manual da ficha) **não** vincula sozinho — `students` não enxerga o caso de uso. Para cobrir o manual sem ciclo, a Task 6 troca a action da ficha para `FACIAL_ENROLL_ID` passar por esta rota nova. Cartão (`TURNSTILE_CARD`) segue no `PUT`.

- [ ] **Step 5: OpenAPI** — rodar `pnpm --filter @arenahub/api test:integration -- openapi`; acrescentar as duas rotas onde o teste lista rotas declaradas (memória: lista em prosa só pega rota que some — conferir os dois lados).

- [ ] **Step 6: Rodar tudo e commit**

Run: `pnpm --filter @arenahub/api test:integration -- turnstile-number openapi`
Expected: PASS.

```bash
git add apps/api/src/modules/biometrics apps/api/src/modules/devices apps/api/test/integration
git commit -m "feat(api): rota de numero da catraca e lista de numeros do leitor sem aluno"
```

---

### Task 4: Banco + API — nome gravado no leitor

**Files:**
- Modify: `packages/database/prisma/schema.prisma:2722-2737`
- Create: `packages/database/prisma/migrations/<timestamp>_device_reader_number_reader_name/migration.sql`
- Modify: `apps/api/src/modules/devices/device-reader-number.repository.ts` (`registrarNomes`)
- Modify: `apps/api/src/modules/biometrics/edge-legacy-link.controller.ts`
- Test: `apps/api/test/integration/legacy-device-link.int-spec.ts`

**Interfaces:**
- Produces:
  - `DeviceReaderNumber.readerName: string | null`
  - `DeviceReaderNumberRepository.registrarNomes(tenantId: string, deviceId: string, nomes: readonly { externalUserId: string; name: string }[]): Promise<number>` (devolve quantos atualizou)
  - `POST /api/v1/edge/device-users/reader-names` (Edge, HMAC) corpo `{ deviceSerial: string; names: { externalUserId: string; name: string }[] }` `.strict()`, `names` 1..500, `name` 1..100 → `200 { updated: number }`. Só atualiza número que já existe em `DeviceReaderNumber` daquele leitor.

- [ ] **Step 1: Schema + migração**

No model `DeviceReaderNumber`, depois de `externalUserId`:

```prisma
  /// Nome que o leitor guarda para este numero (`getuserinfo`). So para a
  /// recepcao reconhecer cadastro sem aluno -- nunca usado em decisao.
  readerName     String?  @map("reader_name") @db.VarChar(100)
```

Migração (memória: `migrate diff` no Prisma 7 usa `--from-config-datasource` e exige `-o`):

```sql
ALTER TABLE "device_reader_numbers" ADD COLUMN "reader_name" VARCHAR(100);
```

Run: `pnpm --filter @arenahub/database prisma generate` e aplicar no banco de teste como as outras migrações (sem `migrate reset` — memória: bloqueado para IA).

- [ ] **Step 2: Teste (falha)** — em `legacy-device-link.int-spec.ts`, helper `enviarNomes` igual a `vincular` com caminho `/api/v1/edge/device-users/reader-names`:

```ts
it('grava o nome do leitor so para numero que o leitor ja informou', async () => {
  const numero = '223450000001';
  await vincular({ deviceSerial: serial, externalUserIds: [numero] });
  const r = await enviarNomes({ deviceSerial: serial, names: [
    { externalUserId: numero, name: 'ANA C' },
    { externalUserId: '223450009999', name: 'FANTASMA' },
  ] });
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ updated: 1 });
  const linha = await db.deviceReaderNumber.findFirst({ where: { deviceId: ctx.deviceId, externalUserId: numero } });
  expect(linha?.readerName).toBe('ANA C');
  expect(await db.deviceReaderNumber.count({ where: { externalUserId: '223450009999' } })).toBe(0);
});

it('recusa tenantId no corpo', async () => {
  const r = await enviarNomes({ deviceSerial: serial, names: [{ externalUserId: '1', name: 'X' }], tenantId: ctx.tenantId });
  expect(r.status).toBe(400);
});
```

- [ ] **Step 3: Implementar**

Repositório:

```ts
  /** Nome que o leitor guarda -- so atualiza numero ja registrado (nao cria). */
  async registrarNomes(
    tenantId: string,
    deviceId: string,
    nomes: readonly { externalUserId: string; name: string }[],
  ): Promise<number> {
    if (nomes.length === 0) return 0;

    const resultados = await this.db.$transaction(
      nomes.map((n) =>
        this.db.deviceReaderNumber.updateMany({
          where: { tenantId, deviceId, externalUserId: n.externalUserId },
          data: { readerName: n.name.trim().slice(0, 100) },
        }),
      ),
    );

    return resultados.reduce((total, r) => total + r.count, 0);
  }
```

Controller do Edge — esquema e rota, injetando `DeviceRepository` e `DeviceReaderNumberRepository`:

```ts
const esquemaDosNomes = z
  .object({
    deviceSerial: z.string().min(1).max(64),
    names: z.array(z.object({ externalUserId: z.string().min(1).max(64), name: z.string().min(1).max(100) }).strict()).min(1).max(500),
  })
  .strict();

  @Post('reader-names')
  @HttpCode(200)
  @EdgeRoute()
  async nomesDoLeitor(@Body() corpo: unknown, @Req() requisicao: Request): Promise<{ updated: number }> {
    const dados = esquemaDosNomes.parse(corpo);
    const edge = requisicao.edgeContext!;
    const leitor = await this.dispositivos.resolverDoEdgePorSerial(edge, dados.deviceSerial);
    if (!leitor) throw new NotFoundException({ code: 'DEVICE_NOT_IN_SCOPE' });

    return { updated: await this.numerosDoLeitor.registrarNomes(edge.tenantId, leitor.id, dados.names) };
  }
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @arenahub/api test:integration -- legacy-device-link openapi` (acrescentar a rota no teste de OpenAPI).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma apps/api/src/modules apps/api/test/integration
git commit -m "feat(api): nome gravado no leitor para numeros sem aluno"
```

---

### Task 5: Edge — ler o nome e enviar

**Pré-requisito de campo (manual, não bloqueia o código):** na bancada (leitor AYTI11108174), confirmar que `{"cmd":"getuserinfo","enrollid":N,"backupnum":50}` volta com `name` no corpo ou no `record`. Registrar o achado no PR. Se vier ausente, o código abaixo devolve `null` e nada quebra.

**Files:**
- Modify: `apps/edge-agent/src/domain/facial-device.ts` (interface)
- Modify: `apps/edge-agent/src/adapters/topdata/topdata-facial-adapter.ts:481-530`
- Modify: `apps/edge-agent/src/producao/vinculo-legado.ts`
- Test: `apps/edge-agent/src/adapters/topdata/topdata-facial-adapter.spec.ts`, `apps/edge-agent/src/producao/vinculo-legado.spec.ts`

**Interfaces:**
- Consumes: `POST /api/v1/edge/device-users/reader-names` (Task 4).
- Produces: `FacialDeviceAdapter.lerNome?(externalEnrollId: string): Promise<string | null>`.

- [ ] **Step 1: Testes (falham)**

Adapter (seguindo o padrão `leitor.responderCom` do spec existente, linhas ~360-400):

```ts
it('lerNome devolve o name do getuserinfo', async () => {
  // conectar como os vizinhos fazem
  const promessa = adapter.lerNome('100000000123');
  leitor.responderCom('getuserinfo', { result: true, enrollid: 100000000123, name: 'MARIA S', backupnum: 50 });
  await expect(promessa).resolves.toBe('MARIA S');
});

it('lerNome devolve null quando o firmware nao manda name', async () => {
  const promessa = adapter.lerNome('100000000124');
  leitor.responderCom('getuserinfo', { result: true, enrollid: 100000000124, backupnum: 50 });
  await expect(promessa).resolves.toBeNull();
});
```

Vínculo:

```ts
it('depois do vinculo, manda o nome dos numeros sem aluno', async () => {
  // dublê de facial com listar() -> ['1','2'] e lerNome -> '1' => 'ANA', '2' => null
  // cliente.post: legacy-links responde withoutStudent ['1','2']; registra chamadas
  // dispara aoRegistrar('SER')
  // espera a fila esvaziar
  expect(chamadas).toContainEqual(['/api/v1/edge/device-users/reader-names', { deviceSerial: 'SER', names: [{ externalUserId: '1', name: 'ANA' }] }]);
});

it('sem lerNome no adapter, nao chama reader-names', async () => { /* mesmo cenário, facial sem lerNome */ });
```

Monte os dublês copiando os que `vinculo-legado.spec.ts` já usa.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @arenahub/edge-agent test -- topdata-facial-adapter vinculo-legado`.

- [ ] **Step 3: Implementar**

`facial-device.ts`, na interface `FacialDeviceAdapter`:

```ts
  /** Nome que o leitor guarda para o numero, ou null -- spec 2026-10-03. */
  lerNome?(externalEnrollId: string): Promise<string | null>;
```

Adapter, ao lado do método de foto (mesma fila/`comandar`):

```ts
  async lerNome(externalEnrollId: string): Promise<string | null> {
    const retorno = await this.comandar(
      comandos.getUserInfo(Number(externalEnrollId), BACKUPNUM.FOTO),
      'getuserinfo',
    );
    const record = retorno['record'];
    const candidato =
      retorno['name'] ??
      (typeof record === 'object' && record !== null && 'name' in record ? record.name : undefined);

    return typeof candidato === 'string' && candidato.trim() !== '' ? candidato.trim() : null;
  }
```

(Confira como o método de foto envolve `comandar` na fila de operações e em try/catch — replique; erro de leitura vira `null`, nunca derruba o vínculo.)

`vinculo-legado.ts`:
- `informar` passa a devolver `{ chegou: boolean; semAluno: string[] }` (acumula `r.withoutStudent`); ajustar os dois chamadores (`chegou` onde hoje usa o booleano).
- depois de `informar` no caminho do **registro** (listagem completa), se `facial.lerNome` existe e `semAluno.length > 0`:

```ts
/** Teto de leituras de nome por base -- cada uma e um comando ao leitor. */
export const MAXIMO_DE_NOMES = 500;

const enviarNomes = async (serial: string, numeros: readonly string[]): Promise<void> => {
  if (!facial.lerNome || numeros.length === 0) return;

  const names: { externalUserId: string; name: string }[] = [];
  for (const numero of numeros.slice(0, MAXIMO_DE_NOMES)) {
    const nome = await facial.lerNome(numero).catch(() => null);
    if (nome) names.push({ externalUserId: numero, name: nome.slice(0, 100) });
  }
  if (names.length === 0) return;

  const resposta = await cliente.post<{ updated: number }>('/api/v1/edge/device-users/reader-names', {
    deviceSerial: serial,
    names,
  });
  // Nome de pessoa nao vai para log -- so a contagem.
  logger.info({ leitor: serial, nomes: names.length, gravados: resposta.body?.updated ?? 0 }, 'nomes do leitor enviados');
};
```

Atualizar o comentário do topo do arquivo: "Daqui so sai o NUMERO" deixa de ser verdade — agora sai também o nome que o leitor guarda dos números sem aluno, para a recepção reconhecer o cadastro.

- [ ] **Step 4: Rodar e ver passar** — `pnpm --filter @arenahub/edge-agent test` (suíte inteira do pacote).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-agent/src
git commit -m "feat(edge): envia o nome que o leitor guarda dos numeros sem aluno"
```

---

### Task 6: admin-web — ação na lista e destaque na ficha

Antes de codar: carregar as skills `impeccable` e `frontend-design:frontend-design` (CLAUDE.md) e ler `docs/design/DS-PAINEL.md` §4.15 (modal) e a seção de tipografia/realce. O destaque pedido pelo PI: número **grande**, fonte mono, cor de acento, borda, efeito (brilho/pulso suave na entrada, respeitando `prefers-reduced-motion`).

**Files:**
- Create: `apps/admin-web/app/actions/numero-da-catraca.ts`
- Create: `apps/admin-web/src/components/numero-em-destaque.tsx`, `apps/admin-web/src/components/numero-em-destaque.module.css`
- Create: `apps/admin-web/app/(protected)/students/numero-da-catraca.tsx`
- Modify: `apps/admin-web/app/(protected)/students/acoes-do-aluno.tsx`
- Modify: `apps/admin-web/app/(protected)/students/[id]/credencial-de-acesso.tsx`
- Modify: `apps/admin-web/app/actions/membership.ts:614-651` (`definirCredencial`: `FACIAL_ENROLL_ID` usa a rota nova)
- Test: `apps/admin-web/app/actions/numero-da-catraca.test.ts`, `apps/admin-web/app/(protected)/students/numero-da-catraca.test.tsx`, `apps/admin-web/src/components/numero-em-destaque.test.tsx`

**Interfaces:**
- Consumes: rotas da Task 3.
- Produces:
  - `gerarNumeroDaCatraca(_: EstadoDoNumero, form: FormData): Promise<EstadoDoNumero>` — campos `studentId`, opcional `externalId`.
  - `listarNumerosDoLeitorSemAluno(): Promise<{ externalId: string; readerName: string | null }[]>`
  - `interface EstadoDoNumero { erro?: string; numero?: string; vinculado?: boolean }`
  - `<NumeroEmDestaque numero={string} vinculado?={boolean} />`

- [ ] **Step 1: Teste da action (falha)** — memória "teste de action antes do navegador": afirmar o corpo enviado.

```ts
// numero-da-catraca.test.ts
vi.mock('../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

it('sem externalId manda corpo vazio e devolve o numero', async () => {
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: { externalId: '100000000007', linkedReaders: 0 } });
  const form = new FormData();
  form.set('studentId', UUID);
  const r = await gerarNumeroDaCatraca({}, form);
  expect(chamarApi).toHaveBeenCalledWith(`/api/v1/students/${UUID}/turnstile-number`, { metodo: 'POST', corpo: {} });
  expect(r).toEqual({ numero: '100000000007', vinculado: false });
});

it('409 vira frase de numero ocupado', async () => {
  vi.mocked(chamarApi).mockResolvedValue({ ok: false, erro: { code: 'CREDENTIAL_ALREADY_ASSIGNED' } });
  const form = new FormData();
  form.set('studentId', UUID);
  form.set('externalId', '100000000001');
  const r = await gerarNumeroDaCatraca({}, form);
  expect(r.erro).toBe('Este número já está vinculado a outro aluno.');
});
```

Confirmar a forma exata do retorno de `chamarApi` em `apps/admin-web/lib/api/server-client.ts` e ajustar os mocks.

- [ ] **Step 2: Action**

```ts
// apps/admin-web/app/actions/numero-da-catraca.ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Numero da catraca -- spec 2026-10-03. Gera (sem `externalId`) ou usa o
 * numero que o leitor ja tem (com `externalId`), e a API vincula na hora.
 */
const esquema = z.object({
  studentId: z.string().uuid(),
  externalId: z.string().trim().regex(/^\d{1,12}$/, 'Número inválido').optional(),
});

export interface EstadoDoNumero {
  erro?: string;
  numero?: string;
  vinculado?: boolean;
}

const MENSAGEM: Record<string, string> = {
  CREDENTIAL_ALREADY_ASSIGNED: 'Este número já está vinculado a outro aluno.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado.',
};

export async function gerarNumeroDaCatraca(
  _anterior: EstadoDoNumero,
  formulario: FormData,
): Promise<EstadoDoNumero> {
  const bruto = formulario.get('externalId');
  const validado = esquema.safeParse({
    studentId: formulario.get('studentId'),
    externalId: typeof bruto === 'string' && bruto !== '' ? bruto : undefined,
  });

  if (!validado.success) return { erro: validado.error.issues[0]?.message ?? 'Confira os dados.' };

  const { studentId, externalId } = validado.data;
  const resposta = await chamarApi<{ externalId: string; linkedReaders: number }>(
    `/api/v1/students/${studentId}/turnstile-number`,
    { metodo: 'POST', corpo: externalId === undefined ? {} : { externalId } },
  );

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';
    return { erro: MENSAGEM[codigo] ?? `Não foi possível gerar o número (${codigo || 'erro'}).` };
  }

  revalidatePath('/students');
  revalidatePath(`/students/${studentId}`);

  return { numero: resposta.dados.externalId, vinculado: resposta.dados.linkedReaders > 0 };
}

export async function listarNumerosDoLeitorSemAluno(): Promise<
  { externalId: string; readerName: string | null }[]
> {
  const resposta = await chamarApi<{ externalId: string; readerName: string | null }[]>(
    '/api/v1/device-reader-numbers/unlinked',
  );

  return resposta.ok && resposta.dados ? resposta.dados : [];
}
```

(memória: `'use server'` só exporta função async — `MENSAGEM` e `esquema` não são exportados.)

- [ ] **Step 3: `NumeroEmDestaque` (teste + componente)**

Teste: renderiza o número, botão "Copiar número" chama `navigator.clipboard.writeText('100000000007')` e dispara toast de info; `vinculado` mostra "Vinculado ao leitor"; sem `vinculado` mostra "Cadastre a face no leitor com este número".

Componente: `role="status"`, número em `<output>` com `font-family: var(--ah-font-mono)`, tamanho de display (token de display do DS-PAINEL), agrupado em blocos de 3 dígitos **só visualmente** (`100 000 000 007` via `Intl`-free split, texto copiado sem espaços), borda 2px em token de acento, fundo de superfície elevada com realce, animação de entrada (`@keyframes` com `opacity`/`transform`/`box-shadow`) desligada em `@media (prefers-reduced-motion: reduce)`. Só tokens `--ah-*` (rodar `pnpm --filter @arenahub/admin-web test:guardas` ou a guarda `check-css-tokens`).

- [ ] **Step 4: Diálogo da lista (teste + componente)**

`numero-da-catraca.tsx` (`'use client'`): botão ícone (padrão de `acoes-do-aluno.tsx`: `variant="icon"`, `aria-label="Número da catraca"`, `title`, `data-testid="acao-numero-catraca-${studentId}"`, ícone `FcKey` ou `FcSms`— escolher em `react-icons/fc`) que abre `<dialog>` nativo com classes de `dialogo.module.css` (padrão `qr-ampliavel.tsx`: `showModal`, fechar no `close`). Conteúdo com `Tabs` de `@arenahub/ui`:

- **Gerar novo:** `<form action={acao}>` com `studentId` oculto e botão "Gerar número". Sucesso → `<NumeroEmDestaque numero vinculado />`.
- **Do leitor:** ao abrir a aba, carrega `listarNumerosDoLeitorSemAluno()` (passada como prop de Server Component, ou chamada via `useTransition`); `<input list>` + `<datalist>` com opções `"100000000123 — MARIA S"` (sem nome: só o número); valor enviado = só os dígitos (extrair com `/^\d+/`). Submit no mesmo `gerarNumeroDaCatraca` com `externalId`.
- Erro → `useToastDeErro(estado.erro, 'error', 'erro-numero-catraca')`.

Testes (Vitest + Testing Library; memória: jsdom não roda Server Action — mockar a action e testar render/estados):
- abre o diálogo ao clicar no ícone;
- estado com `numero` renderiza `NumeroEmDestaque`;
- aba "Do leitor" lista "100000000123 — MARIA S" e "100000000124" (sem nome).

Encaixar em `acoes-do-aluno.tsx` como quarto item, depois de "Cobrança".

- [ ] **Step 5: Ficha**

`credencial-de-acesso.tsx`: quando existe `FACIAL_ENROLL_ID`, renderizar `<NumeroEmDestaque numero={...} />` acima da lista (no estado fechado). Em `membership.ts` `definirCredencial`: se `kind === 'FACIAL_ENROLL_ID'`, chamar `POST /api/v1/students/${studentId}/turnstile-number` com `{ externalId }` (vincula na hora); `TURNSTILE_CARD` continua no `PUT`. Ajustar `MENSAGEM` para o 409 e o teste de action existente (se houver) para o novo corpo.

- [ ] **Step 6: Rodar e commit**

Run: `pnpm --filter @arenahub/admin-web test` e `pnpm --filter @arenahub/admin-web lint` e `pnpm typecheck`
Expected: PASS.

```bash
git add apps/admin-web
git commit -m "feat(admin-web): acao de numero da catraca na lista e destaque na ficha"
```

---

### Task 7: E2E, docs, gate e PR

**Files:**
- Modify/Create: spec E2E do cadastro de aluno em `apps/admin-web/e2e/` (achar o que cobre `/students/novo`)
- Modify: `docs/runbooks/operacao-edge-arena-positiva.md:80-115`
- Modify: `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTING.md`/`TESTS.md` conforme o processo de entrega
- Modify: `docs/superpowers/specs/2026-10-03-id-catraca-automatico-design.md` (número da fatia, se alocado)

- [ ] **Step 1: E2E** — no fluxo de cadastro existente, depois de salvar o aluno, afirmar na ficha `getByTestId('numero-em-destaque')` com texto que casa `/^\d{3} \d{3} \d{3} \d{3}$/`. Na lista, clicar `acao-numero-catraca-<id>`, aba "Gerar novo", ver o mesmo número (idempotente). Memória: matar o Next da 3000 de outra árvore antes; `next start` exige rebuild.

Run: `pnpm test:e2e -- <arquivo>` → PASS.

- [ ] **Step 2: Runbook** — reescrever o trecho "a tela de cadastro sugere" para o fluxo novo:
  1. cadastrar aluno → número aparece em destaque na ficha;
  2. cadastrar face no leitor com esse número;
  3. plano → cobrança → pagamento.
  E o caso legado: lista de alunos → "Número da catraca" → aba "Do leitor" → escolher pelo nome. Remover a orientação de reiniciar o Edge para vincular.

- [ ] **Step 3: Gate local** (memória: gate antes do push; turbo `--force`; `test:report` inclui integração)

```bash
pnpm install --frozen-lockfile
pnpm lint -- --force
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Expected: tudo verde. Integração com `--maxWorkers` se o Windows crashar (memória).

- [ ] **Step 4: Revisão** — rodar `/code-review` (CLAUDE.md) sobre `main...HEAD`; corrigir CRITICAL/HIGH.

- [ ] **Step 5: Docs de entrega e PR**

Atualizar `STATUS.md`/`DEVELOPMENT.md` (sem inventar número de fatia — pedir ao PI/Cowork se não houver). Push e PR com `refs #<issue>` (nunca `closes`), corpo listando: decisões (controller em `biometrics` por ciclo de módulo; reapontar em vez de desativar; geração fora da transação do cadastro), achado de bancada do `getuserinfo`, e o que ficou fora (relatórios; plano liberando antes do pagamento).

```bash
git push -u origin feat/id-catraca-automatico
gh pr create --title "feat: número da catraca automático e vínculo sem reinício do Edge" --body-file <arquivo>
```

Esperar CI com `gh run watch <run-id> --exit-status` em background, avisando o PI; merge com CI verde; atualizar o localhost (memória).
