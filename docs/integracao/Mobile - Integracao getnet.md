# mobile — Integração Getnet

**App:** `apps/mobile` (React Native + Expo)
**Escopo:** aluno paga pendências, adere ao plano (assinatura recorrente), gerencia cartão salvo e acompanha histórico.
**Documento-mãe:** `integracao-getnet-spec.md` (arquitetura, backend, webhooks, roteiro).

---

## 1. Regra de ouro do canal

O app **nunca chama a Getnet**: só a API interna (`/api/v1`, JWT do aluno). Nenhum SDK Getnet de pagamento é embarcado; a exceção é o **componente de fingerprint antifraude** (fornecido no onboarding Getnet) — obrigatório para cartão em produção, senão o antifraude bloqueia a transação. Se o script for web-only, encapsular em WebView invisível ou usar o fallback definido com a Getnet (`device_id` UUIDv4 persistido por instalação + coleta de IP no backend) — **confirmar com a Getnet qual fallback é aceito** antes do go-live.

## 2. Casos de uso e endpoints

| Caso de uso | Endpoint interno |
|---|---|
| Pagar pendência com PIX | `POST /api/v1/payments/pix` + SSE `GET /payments/:id/events` |
| Pagar pendência com cartão | `POST /api/v1/payments/card` |
| Salvar cartão (tokenizar) | `POST /api/v1/members/:id/cards` |
| Listar/remover cartões | `GET` / `DELETE /api/v1/members/:id/cards/:cardId` |
| Aderir ao plano (assinatura) | `POST /api/v1/members/:id/subscriptions { planId, savedCardId, startDate }` |
| Cancelar assinatura | `DELETE /api/v1/subscriptions/:id` |
| Trocar cartão da assinatura | novo cartão via `/cards` + endpoint de troca (backend decide update vs recriar) |
| Histórico | `GET /api/v1/payments?memberId=…`, `GET /subscriptions/:id/charges` |

## 3. Fluxos

### 3.1 PIX

1. `POST /payments/pix` → `{ paymentId, qrCode, expiresAt }`.
2. Tela: QR renderizado + **botão "Copiar código PIX"** (`expo-clipboard`) — no mobile o copia-e-cola é o caminho principal (o usuário troca para o app do banco); QR é secundário.
3. Acompanhar por SSE; **ao voltar do app do banco (AppState → active), forçar um `GET /payments/:id`** — não depender só do SSE, que pode ter caído em background.
4. `approved` → sucesso + atualização imediata do status de adimplência na home; `expired` → regenerar.

### 3.2 Cartão avulso

1. Tela de cartão própria (sem lib de UI que capture/telemetrize input): número, validade, CVV, nome; máscara + Luhn local.
2. Coletar `device` (fingerprint/`device_id`) e enviar com o pagamento; dados de cobrança do aluno (CPF, e-mail, endereço) já vêm do cadastro — a UI só confirma.
3. `POST /payments/card` → tratar `approved`/`rejected`/`pending` (tela de aguardo com SSE).
4. Parcelamento: seletor de parcelas quando o backend informar as opções permitidas para o valor.

### 3.3 Assinatura (adesão no app)

1. Escolher plano (lista de planos publicados, vinda da API).
2. Selecionar cartão salvo ou cadastrar novo (tokenização — o app envia o PAN uma única vez; recebe `savedCardId`, `brand`, `last4`).
3. Confirmação explícita com resumo: valor mensal, data da 1ª cobrança (`startDate`), duração do ciclo.
4. `POST /members/:id/subscriptions` → status `created/scheduled` → tela de sucesso com próxima cobrança.
5. Pós-adesão: card na home com status da assinatura (ativa, pagamento pendente, cartão expirando — evento `CARD_UPDATE` chega via backend).

### 3.4 Cobrança recorrente falhou (past_due)

Push/aviso in-app (disparado pelo backend ao conciliar charges): "Não conseguimos cobrar sua mensalidade". CTA: pagar agora (PIX ou cartão avulso) e/ou trocar cartão da assinatura. Esta régua é o principal redutor de churn involuntário — prioridade alta.

## 4. Segurança no app

- PAN/CVV apenas em estado local da tela; limpar ao desmontar; nunca em Redux/Zustand global, AsyncStorage, logs (`console.log` de payloads proibido em release), breadcrumbs de crash reporting (Sentry scrub por regex de PAN).
- TLS obrigatório; **certificate pinning** da API interna recomendado (expo-build-properties/okhttp) — decisão a registrar.
- JWT em `SecureStore` (Keychain/Keystore), não em AsyncStorage.
- Bloquear screenshot na tela de cartão (Android `FLAG_SECURE`) — desejável, não bloqueante.
- Deep link de retorno do banco: validar que apenas reabre a tela de acompanhamento (nenhuma ação sensível por deep link).

## 5. Offline/erros

| Cenário | Comportamento |
|---|---|
| Sem rede ao criar pagamento | Falha imediata com retry manual — nunca enfileirar pagamento offline |
| App morto durante PIX pendente | Ao reabrir, home consulta pendências e mostra "pagamento em confirmação" se `pending` |
| `rejected` | Mensagem amigável + sugerir outro método; código técnico só no suporte |
| SSE indisponível | Polling 5 s |

## 6. Critérios de aceite

- [ ] Nenhuma chamada a domínios Getnet a partir do app (auditar com proxy/Charles), exceto componente antifraude oficial.
- [ ] PAN não aparece em nenhum log/crash report (teste com Sentry em staging).
- [ ] Retorno do app do banco atualiza status em ≤ 5 s (AppState + GET).
- [ ] Adesão de assinatura exibe confirmação explícita de recorrência antes do submit.
- [ ] Troca de cartão da assinatura funcional (qualquer que seja a implementação do backend).
- [ ] Cancelamento de assinatura acessível no app (sem "dark pattern" de esconder).

## 7. Dependências

- Fases 2, 4 e 5 do roteiro do documento-mãe.
- Definição do mecanismo de fingerprint antifraude para mobile (fase 0/onboarding Getnet) — risco aberto nº 3 do documento-mãe.
- Push notifications já existentes no app (para a régua de past_due).
