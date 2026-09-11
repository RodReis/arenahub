# SPEC-068 — Superfícies contratadas: mobile e totem como flag negociável

| campo | valor |
|---|---|
| **Fatia** | F68 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec |
| **Superfície** | `api` (`platform`, `kiosk-auth`) · `admin-web` (`/platform/planos`, `/platform/[tenantId]/contratos`) · `packages/database` · `packages/api-contracts` |
| **Card** | [#317](https://github.com/RodReis/arenahub/issues/317) |
| **Status** | pedida pelo PI em 11/09/2026 |

---

## 1. O que esta fatia entrega

O plano SaaS deixa de vender um pacote fechado. Cada plano declara se **app mobile do aluno** e **totem de autoatendimento** fazem parte dele; cada contrato copia esse padrão e **pode divergir dele** na negociação. Contrato sem totem faz o equipamento daquela academia parar de autenticar.

---

## 2. Escopo

- `mobileEnabled` e `kioskEnabled` em `saas_plans` **e** `tenant_contracts`, `NOT NULL DEFAULT true`.
- O plano é o **padrão do catálogo**; o contrato **copia e pode divergir** — quem fatura e quem recusa leem as colunas do contrato, nunca as do plano (mesma regra dos preços, ADR-052 §8).
- Recusa do totem no `KioskAuthService.verificar`, com o código estável `CONTRACT_KIOSK_DISABLED`.
- O PDF do contrato imprime as duas superfícies, **inclusive as não contratadas**.
- Formulário de plano e formulário de contrato ganham os dois campos, com o do contrato herdando o padrão do plano escolhido.

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| recusar login do app mobile do aluno | MVP 4 — `apps/mobile/` ainda é um `.gitkeep`, e não existe endpoint de auth de aluno onde enganchar |
| editar superfície de contrato já `ACTIVE` | nunca — contrato é imutável depois de fechado (ADR-052 §8); a saída é contrato novo |
| recusar o painel (`admin-web`) do tenant | fora — o painel é a superfície que todo cliente contrata; desligá-la seria encerrar o contrato, não negociá-lo |
| barrar inadimplência | F65 — gate de tenant, com carência e regra próprias |

---

## 4. Invariantes

1. **`DEFAULT true`, nunca `false`.** Contrato já fechado nunca autorizou perder acesso. Uma coluna que nascesse `false` desligaria o totem de toda academia existente no dia do deploy, com a catraca parando sem ninguém ter negociado nada.
2. **Quem recusa lê o contrato.** Nada no caminho de autenticação volta ao `SaasPlan`. Alterar o plano do catálogo não pode desligar o totem de quem já fechou contrato.
3. **Academia sem contrato ativo passa.** O totem é o primeiro equipamento testado na implantação e o contrato costuma fechar depois; recusar transformaria *"contrato ainda não assinado"* em *"catraca não funciona"* no dia da instalação.
4. **A recusa fica depois da assinatura e antes do nonce.** Depois, porque consultar o contrato a cada requisição com chave inventada daria consulta de banco de graça a qualquer um. Antes, porque gravar o nonce é o único efeito colateral do método: recusar depois queimaria o nonce de uma requisição nunca atendida, e o reenvio após religar o contrato cairia em `EDGE_REPLAY_DETECTED` — um erro que manda investigar ataque onde houve renegociação comercial.
5. **Código próprio, não `EDGE_KEY_REVOKED`.** Os dois respondem 401, mas quem opera age diferente: chave revogada se resolve emitindo credencial nova, e credencial nova não resolve nada quando a superfície está fora do contrato.
6. **O documento diz o que NÃO foi contratado.** Imprimir só o incluído deixaria o contrato calado sobre a metade que gera discussão depois.

---

## 5. Aceite

- Contrato vigente com `kioskEnabled = false` → o totem daquela academia recebe 401 com `CONTRACT_KIOSK_DISABLED`.
- Contrato vigente com `kioskEnabled = true` → o totem autentica normalmente.
- Academia sem contrato `ACTIVE` → o totem autentica normalmente.
- O PDF do contrato traz as duas superfícies, cada uma com o próprio valor.
- Editar o plano do catálogo não muda contrato já fechado.

---

## 6. Notas de implementação

- **`<select>` Sim/Não, não checkbox.** Checkbox desmarcado não entra no `FormData`: "desligado" chegaria à Server Action indistinguível de "a tela nem tem esse campo". O `select` manda valor nos dois casos e dispensa `input hidden` de acompanhamento.
- **O DTO do contrato não usa `.default()`.** Omitir a superfície **herda o plano**; com default, o contrato que não falasse do totem gravaria `true` por cima de um plano que o vende desligado.
- **A suíte de integração apaga o `SaasPlan` que cria.** Apagar o tenant cascateia o contrato, mas o plano não pendura em tenant nenhum e ficaria no catálogo para sempre — uma execução por dia no CI empilharia um plano por rodada, na mesma lista onde se procura plano de verdade.
- **A asserção do PDF afirma o par rótulo→valor.** `toContain('incluído')` é substring de *"não incluído"* e passaria com as duas superfícies desligadas — exatamente o defeito que o teste existe para pegar.
