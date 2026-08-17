# MVP-04.0 — Gates de canais Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixar contratos, versões, hardware, segurança, providers e distribuição antes de implementar mobile ou kiosk sobre premissas não verificadas.

**Architecture:** Manifests JSON validados registram decisões operacionais separadas do código. Cada integração real exige documentação oficial, ambiente de teste, evidência sanitizada e um plano de adapter com símbolos e versões exatos. Gates opcionais como push podem ser formalmente transferidos sem enfraquecer identidade, kiosk ou pagamentos.

**Tech Stack:** Markdown, JSON Schema, OpenAPI, documentação oficial via Context7, inventário de dispositivos, ambientes sandbox, threat modeling e testes sintéticos.

---

### Task 1: Auditar contratos dos MVPs 1 a 3

**Files:**
- Create: `docs/operations/app-totem/upstream-contract-inventory.md`
- Create: `docs/operations/app-totem/mobile-bff-contract.json`
- Create: `docs/operations/app-totem/kiosk-bff-contract.json`
- Create: `docs/operations/app-totem/upstream-contract.schema.json`
- Create: `scripts/docs/validate-json-manifest.mjs`
- Create: `scripts/docs/validate-json-manifest.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Inventariar operações públicas**

Liste operação OpenAPI, versão, owner, escopo, autorização, idempotência, erro e SLO para student, membership, access/frequency, invoice/payment, assessment/analysis, consent e export. Marque como ausente qualquer contrato que só exista no plano.

- [ ] **Step 2: Definir DTOs mínimos dos canais**

Registre campos permitidos por endpoint. Exclua entidade Prisma, observação administrativa, dado de terceiros, token de provider, raw webhook e informação de saúde não publicada.

- [ ] **Step 3: Validar isolamento de módulo**

Para cada campo, nomeie a porta/application service upstream. Consulta direta a tabela privada bloqueia `M4-ENTRY-01`.

- [ ] **Step 4: Implementar o validador de manifests**

Use Ajv já fixado no toolchain ou instale-o como dependência de desenvolvimento aprovada. O script recebe pares schema/documento, habilita formatos estritos, rejeita propriedade adicional e encerra com código 1 por erro. Registre `docs:validate` no `package.json` apontando para esse script.

```js
const [schemaPath, documentPath] = process.argv.slice(2);
if (!schemaPath || !documentPath) throw new Error('SCHEMA_AND_DOCUMENT_REQUIRED');
```

- [ ] **Step 5: Executar validação de schema**

Run: `node --test scripts/docs/validate-json-manifest.test.mjs`
Expected: PASS para documento válido e rejeição de propriedade adicional, formato inválido e argumento ausente.

Run: `pnpm docs:validate -- docs/operations/app-totem/upstream-contract.schema.json docs/operations/app-totem/mobile-bff-contract.json docs/operations/app-totem/kiosk-bff-contract.json`
Expected: PASS e nenhuma operação marcada `UNRESOLVED`.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/app-totem/upstream-contract-inventory.md docs/operations/app-totem/mobile-bff-contract.json docs/operations/app-totem/kiosk-bff-contract.json docs/operations/app-totem/upstream-contract.schema.json scripts/docs/validate-json-manifest.mjs scripts/docs/validate-json-manifest.test.mjs package.json pnpm-lock.yaml
git commit -m "docs(channels): inventory upstream student contracts"
```

### Task 2: Aprovar identidade, recuperação e segundo fator

**Files:**
- Create: `docs/operations/app-totem/identity-policy.md`
- Create: `docs/operations/app-totem/identity-threat-model.md`
- Create: `docs/operations/app-totem/identity-capabilities.json`
- Create: `docs/operations/app-totem/identity-capabilities.schema.json`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI

- [ ] **Step 1: Definir ativação e recuperação**

Fixe canal aprovado, validade, comprimento/entropia, uso único, hash, tentativas, cooldown, mensagens antienumeração, suporte e auditoria. Recepção pode reenviar convite, nunca ler token ou definir senha.

- [ ] **Step 2: Definir step-up e sessão**

Fixe janela de reautenticação, ações sensíveis, TTL de access/refresh, rotação, família, replay e revogação. Separe sessão mobile de kiosk.

- [ ] **Step 3: Definir identificação do kiosk**

CPF é somente localizador. Registre segundo fator aprovado, fallback, privacidade da tela e comportamento quando o canal estiver indisponível; ausência de segundo fator mantém login por CPF desabilitado.

- [ ] **Step 4: Executar casos de abuso em tabletop**

Cubra token interceptado/reutilizado/expirado, enumeração, SIM/e-mail comprometido, recepção curiosa, refresh replay e CPF de terceiro. Registre decisão e contenção por cenário.

- [ ] **Step 5: Aprovar e commit**

Privacidade, Segurança, Produto e Operação assinam `M4-IDENTITY-01`.

```bash
git add docs/operations/app-totem/identity-policy.md docs/operations/app-totem/identity-threat-model.md docs/operations/app-totem/identity-capabilities.json docs/operations/app-totem/identity-capabilities.schema.json docs/DECISIONS.md
git commit -m "docs(channels): approve student identity policy"
```

### Task 3: Fixar plataforma Expo e dispositivos de referência

**Files:**
- Create: `docs/operations/app-totem/mobile-platform.schema.json`
- Create: `docs/operations/app-totem/mobile-platform.json`
- Create: `docs/operations/app-totem/mobile-device-matrix.md`
- Create: `docs/operations/app-totem/mobile-deep-links.md`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI

- [ ] **Step 1: Consultar documentação oficial atual**

Use Context7 para Expo, React Native e cada SDK. Registre versão estável, matriz de compatibilidade, Node, plataforma mínima, Expo Router, SecureStore, Notifications, Linking, Updates, build CLI e datas das fontes. Registre também decisão de certificate pinning; só habilite com rotação e rollback comprovados.

- [ ] **Step 2: Homologar dispositivos e runner E2E**

Selecione ao menos um Android físico e um iPhone físico compatíveis, mais simuladores. Fixe o perfil de conexão usado no SLO. Compare runners suportados pela versão fixada e execute instalação, deep link, background/foreground, biometria local opcional e captura de crash sintético.

- [ ] **Step 3: Definir links e armazenamento**

Fixe scheme, universal/app link, domínios, association files, paths aceitos, nonce/state e fallback web. SecureStore guarda somente refresh e material de device autorizado; AsyncStorage não guarda sessão ou dado do aluno.

- [ ] **Step 4: Validar manifesto**

Run: `pnpm docs:validate -- docs/operations/app-totem/mobile-platform.schema.json docs/operations/app-totem/mobile-platform.json`
Expected: PASS com versões exatas e nenhuma incompatibilidade aberta.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/app-totem/mobile-platform.schema.json docs/operations/app-totem/mobile-platform.json docs/operations/app-totem/mobile-device-matrix.md docs/operations/app-totem/mobile-deep-links.md docs/DECISIONS.md
git commit -m "docs(mobile): fix platform and device matrix"
```

### Task 4: Homologar QR rotativo e integração de acesso

**Files:**
- Create: `docs/operations/app-totem/qr-credential.schema.json`
- Create: `docs/operations/app-totem/qr-credential.json`
- Create: `docs/operations/app-totem/qr-validator-inventory.md`
- Create: `docs/operations/app-totem/qr-golden/README.md`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI

- [ ] **Step 1: Inventariar validação física**

Registre leitor, catraca, Edge/API, firmware, formato suportado, latência, relógio, conectividade e confirmação física. Diferencie validação criptográfica de consumo/replay.

- [ ] **Step 2: Fixar o envelope**

Defina versão, algoritmo, key ID, `jti` aleatório, finalidade, expiração, tamanho máximo, codificação e assinatura. Payload não contém PII; hash de `jti` registra emissão/consumo.

- [ ] **Step 3: Fixar política online/offline**

Documente tolerância de relógio, rotação de chave, lista de revogação, consumo atômico e comportamento offline. Se replay não puder ser controlado, `ROTATING_QR=false` na unidade.

- [ ] **Step 4: Criar vetores golden**

Inclua válido, expirado, futuro, assinatura adulterada, key ID desconhecido, consumido, tenant/unidade incorretos e relógio fora de tolerância.

- [ ] **Step 5: Validar e commit**

Run: `pnpm docs:validate -- docs/operations/app-totem/qr-credential.schema.json docs/operations/app-totem/qr-credential.json`
Expected: PASS.

```bash
git add docs/operations/app-totem/qr-credential.schema.json docs/operations/app-totem/qr-credential.json docs/operations/app-totem/qr-validator-inventory.md docs/operations/app-totem/qr-golden docs/DECISIONS.md
git commit -m "docs(access): homologate rotating qr contract"
```

### Task 5: Homologar hardware e lockdown do kiosk

**Files:**
- Create: `docs/operations/app-totem/kiosk-platform.schema.json`
- Create: `docs/operations/app-totem/kiosk-platform.json`
- Create: `docs/operations/app-totem/kiosk-device-inventory.md`
- Create: `docs/operations/app-totem/kiosk-lockdown.md`
- Create: `docs/operations/app-totem/kiosk-threat-model.md`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI

- [ ] **Step 1: Inventariar equipamento e SO**

Registre fabricante/modelo/asset, CPU/RAM/tela, touch/teclado/leitor/câmera/impressora, Windows/browser/driver, rede, energia, remote management e suporte.

- [ ] **Step 2: Definir lockdown verificável**

Fixe usuário restrito, auto-login controlado, navegador kiosk, allowlist, downloads, autofill, password manager, devtools, clipboard, print, USB, atalhos do SO, reinício e restauração.

- [ ] **Step 3: Definir credencial do dispositivo**

Fixe token de provisionamento de uso único, credencial persistente sem PII, cookie/keystore, rotação, revogação, binding tenant/unidade e recuperação. Credencial copiada para outro device deve falhar quando o mecanismo aprovado suportar binding.

- [ ] **Step 4: Executar bateria A→B preliminar**

Verifique DOM, back/forward, screenshots, autofill, impressão, downloads, Cache API, IndexedDB, local/session storage, crash restore, perda de rede, reinício de browser e SO.

- [ ] **Step 5: Validar e commit**

Run: `pnpm docs:validate -- docs/operations/app-totem/kiosk-platform.schema.json docs/operations/app-totem/kiosk-platform.json`
Expected: PASS.

```bash
git add docs/operations/app-totem/kiosk-platform.schema.json docs/operations/app-totem/kiosk-platform.json docs/operations/app-totem/kiosk-device-inventory.md docs/operations/app-totem/kiosk-lockdown.md docs/operations/app-totem/kiosk-threat-model.md docs/DECISIONS.md
git commit -m "docs(kiosk): approve device and lockdown profile"
```

### Task 6: Homologar pagamentos nos dois canais

**Files:**
- Create: `docs/operations/app-totem/channel-payment.schema.json`
- Create: `docs/operations/app-totem/channel-payment.json`
- Create: `docs/operations/app-totem/checkout-navigation-policy.md`
- Create: `docs/operations/app-totem/payment-return-cases.md`

- [ ] **Step 1: Mapear operações do MVP-02**

Registre invoice read, PIX creation, hosted tokenized checkout, payment observation, receipt e entitlement projection com operação OpenAPI, idempotência e owner.

- [ ] **Step 2: Fixar navegação hospedada**

Liste hosts exatos, scheme HTTPS, redirect permitido, cancelamento, cookies do provider, abertura externa, bloqueio de download/popup e tratamento de URL desconhecida. Retorno é informativo até confirmação backend.

- [ ] **Step 3: Executar sandbox adversarial**

Cubra clique duplo, app fechado, kiosk encerrado, webhook atrasado/duplicado/ausente, redirect adulterado, invoice de outro aluno, PIX expirado e polling sob rate limit.

- [ ] **Step 4: Validar e commit**

Run: `pnpm docs:validate -- docs/operations/app-totem/channel-payment.schema.json docs/operations/app-totem/channel-payment.json`
Expected: PASS.

```bash
git add docs/operations/app-totem/channel-payment.schema.json docs/operations/app-totem/channel-payment.json docs/operations/app-totem/checkout-navigation-policy.md docs/operations/app-totem/payment-return-cases.md
git commit -m "docs(channels): homologate payment journeys"
```

### Task 7: Aprovar push, crash, stores e atualização

**Files:**
- Create: `docs/operations/app-totem/push-provider-scorecard.md`
- Create: `docs/operations/app-totem/push-capabilities.json`
- Create: `docs/operations/app-totem/push-capabilities.schema.json`
- Create: `docs/operations/app-totem/distribution-policy.md`
- Create: `docs/operations/app-totem/version-policy.json`
- Create: `docs/operations/app-totem/version-policy.schema.json`
- Create: `docs/operations/app-totem/crash-provider-scorecard.md`
- Create: `docs/operations/app-totem/legal-content.md`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI

- [ ] **Step 1: Avaliar push e privacidade**

Fixe provider, token lifecycle, consentimento, retenção, região, conteúdo de lock screen, deep link opaco, opt-out, receipt e deleção. Payload com valor, saúde, pendência detalhada ou nome é eliminatório.

- [ ] **Step 2: Avaliar crash e analytics**

Exija scrub antes de envio, allowlist de atributos, amostragem, retenção, região, DPA, sourcemaps privados, user feedback opcional e teste de payload. Identificador direto é eliminatório.

- [ ] **Step 3: Definir distribuição e versão mínima**

Registre application IDs, contas, certificados, responsáveis, privacy labels, ambientes, assinatura, canal interno, store rollout, update compatível, rollback, minimum version, grace period e suporte.

`legal-content.md` registra versões aprovadas de privacidade, termos, consentimentos e canais de suporte exibidos nos apps.

- [ ] **Step 4: Validar manifests**

Run: `pnpm docs:validate -- docs/operations/app-totem/push-capabilities.schema.json docs/operations/app-totem/push-capabilities.json`
Expected: PASS ou status explícito `DEFERRED_TO_MVP_05_SLICE_5_5`.

Run: `pnpm docs:validate -- docs/operations/app-totem/version-policy.schema.json docs/operations/app-totem/version-policy.json`
Expected: PASS.

- [ ] **Step 5: Gerar planos fixos dos adapters reais**

Crie `docs/superpowers/plans/2026-08-14-mvp-04-push-provider-adapter.md` e `docs/superpowers/plans/2026-08-14-mvp-04-crash-provider-adapter.md` somente para providers aprovados, com SDK, versão, métodos, erros, fixtures e testes exatos.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/app-totem/push-provider-scorecard.md docs/operations/app-totem/push-capabilities.json docs/operations/app-totem/push-capabilities.schema.json docs/operations/app-totem/distribution-policy.md docs/operations/app-totem/version-policy.json docs/operations/app-totem/version-policy.schema.json docs/operations/app-totem/crash-provider-scorecard.md docs/operations/app-totem/legal-content.md docs/DECISIONS.md
git commit -m "docs(channels): approve distribution and telemetry gates"
```

Cada plano de adapter criado no Step 5 recebe commit próprio após a auditoria da skill `writing-plans`; um provider diferido não gera arquivo vazio.

## Definition of done

- [ ] `M4-ENTRY-01`, `M4-IDENTITY-01` e `M4-MOBILE-01` possuem evidência assinada;
- [ ] QR e kiosk real possuem inventário e threat model aprovados;
- [ ] hosted checkout possui allowlist e sandbox adversarial;
- [ ] push foi aprovado ou formalmente transferido;
- [ ] distribuição, versão mínima e rollback estão fixados;
- [ ] nenhum segredo, token, dado real ou contrato privado foi versionado.
