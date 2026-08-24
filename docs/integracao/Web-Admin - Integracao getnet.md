# admin-web — Integração Getnet

**App:** `apps/admin-web` (Next.js, App Router, Server Components por padrão)
**Escopo deste documento:** tudo que o admin-web precisa implementar para cartão, PIX, estorno, planos e assinaturas.
**Documento-mãe:** `integracao-getnet-spec.md` (arquitetura, backend, webhooks, roteiro). Este doc não repete o backend — só o que o canal consome.

---

## 1. Regra de ouro do canal

O admin-web **nunca chama a Getnet diretamente**. Toda operação passa pela API interna (`/api/v1`, JWT do sistema, RBAC). Nenhuma credencial Getnet, token Bearer ou `seller_id` existe neste app — nem em variável `NEXT_PUBLIC_*`.

Única exceção parcial: o **script de fingerprint antifraude** da Getnet (fornecido no onboarding) roda no browser para gerar `device.finger_print`; o resultado é enviado à API interna junto com o pagamento — sem ele, transações de cartão em produção são bloqueadas pelo antifraude.

## 2. Casos de uso do canal

| Caso de uso | Perfil (RBAC) | Endpoint interno |
|---|---|---|
| Cobrança avulsa com cartão (balcão) | atendente, financeiro | `POST /api/v1/payments/card` |
| Cobrança avulsa PIX (QR no balcão) | atendente, financeiro | `POST /api/v1/payments/pix` + `GET /payments/:id/events` (SSE) |
| Estorno | financeiro, gestor | `POST /api/v1/payments/:id/refund` |
| Publicar plano na Getnet | gestor | `POST /api/v1/plans/:id/getnet` |
| Matrícula com assinatura (adesão) | atendente | `POST /api/v1/members/:id/cards` → `POST /api/v1/members/:id/subscriptions` |
| Cancelar assinatura | financeiro, gestor | `DELETE /api/v1/subscriptions/:id` |
| Trocar cartão da assinatura | atendente | `POST /members/:id/cards` + fluxo de update (ver risco §7) |
| Painéis: pagamentos, cobranças, inadimplência | financeiro, gestor | `GET /payments`, `GET /subscriptions/:id/charges` |
| Console de webhooks (auditoria/reprocesso) | gestor/técnico | endpoints admin de `webhook_event` |

## 3. Fluxos

### 3.1 Cartão no balcão

1. Client Component com formulário de cartão: máscara, validação Luhn local, `autocomplete="cc-number|cc-exp|cc-csc|cc-name"`, sem persistir nada em estado global/localStorage.
2. Coletar fingerprint (script Getnet) + `device_id` (UUIDv4 de sessão).
3. `POST /api/v1/payments/card` com: valor, parcelas, dados do cartão, `memberId`, dados de cobrança do cliente (nome, CPF, e-mail, endereço — **obrigatórios em produção** por antifraude), `device`.
4. Resposta síncrona: `approved` → recibo; `rejected` → mensagem com `failure_message` amigável; `pending` → tela de aguardo com SSE.
5. `saveCard: true` opcional na adesão de assinatura (retorna `savedCardId`).

Restrições: PAN/CVV só em memória do componente; jamais em logs do Next, analytics, Sentry (scrub configurado); requisição direto do browser → API interna via HTTPS (não passar por route handler que logue body).

### 3.2 PIX no balcão

1. `POST /api/v1/payments/pix { amountCents, memberId?, description }`.
2. Renderizar QR (`qrCode` copia-e-cola → lib de QR client-side) + botão copiar + contador com `expiresAt`.
3. Abrir SSE `GET /payments/:id/events`; em `approved` → recibo; em `expired` → oferecer gerar novo QR.
4. Nunca marcar como pago manualmente sem status da API (fonte de verdade = webhook Getnet). Se o aluno pagar após expirar na tela, o backend reverte para `approved` — a listagem deve refletir isso.

### 3.3 Planos e assinaturas

- **Publicar plano:** ação explícita no CRUD de planos ("Publicar na Getnet"). Exibir aviso fixo: *valor de plano Getnet é imutável — alteração de preço = novo plano + migração das assinaturas*. Mostrar `getnet_plan_id` e status.
- **Adesão:** wizard na matrícula: dados do aluno (CPF obrigatório) → cartão (tokenização via `POST /members/:id/cards`) → escolha do plano publicado → data de início (`installment_start_date`) → confirmação com resumo (valor, ciclo mensal, próxima cobrança).
- **Cancelamento:** modal com motivo (auditoria) + data-fim; refletir status `canceled`.

### 3.4 Estorno

Modal de confirmação com valor, motivo obrigatório e dupla checagem de perfil. Exibir resultado e registrar ator (a API audita). Estorno de PIX/cartão segue o mesmo endpoint; prazo e parcialidade dependem do produto Getnet — a UI deve exibir o erro retornado sem mascarar.

## 4. Painéis (Server Components)

- **Pagamentos:** filtro por período/método/status/canal; colunas: data, aluno, método, valor, status, `order_id`; drill-down com timeline de eventos (webhooks aplicados).
- **Assinaturas/inadimplência:** status (`active|past_due|canceled`), última charge, próxima cobrança esperada; ação rápida de cobrança avulsa para regularizar.
- **Charges:** espelho de `subscription_charge` (conciliação diária do backend).
- Listagens via RSC com fetch autenticado server-side; mutações via Server Actions/route handlers chamando a API NestJS (repassando o JWT do usuário, não um token de serviço).

## 5. UI de erros (mapa mínimo)

| Situação | Mensagem |
|---|---|
| `rejected` cartão | "Pagamento recusado pelo emissor. Tente outro cartão." (+ código interno no tooltip p/ suporte) |
| Antifraude bloqueou | "Não foi possível concluir. Confirme os dados do cliente." (não expor 'antifraude') |
| PIX expirado | "QR expirado. Gere um novo código." |
| API interna fora | Banner de indisponibilidade; instruir maquininha física como contingência |

## 6. Critérios de aceite

- [ ] Nenhuma chamada de rede do browser para `*.getnet.com.br` / `*.globalgetnet.com` exceto o script antifraude oficial.
- [ ] PAN/CVV ausentes de: logs, analytics, Sentry, localStorage, URL, estado global.
- [ ] SSE com fallback para polling 5 s.
- [ ] RBAC aplicado por caso de uso (tabela §2) — testes e2e cobrindo negação.
- [ ] Aviso de imutabilidade de valor de plano visível na publicação.
- [ ] Recibo imprimível/enviável por e-mail após aprovação.

## 7. Dependências e riscos herdados

- Fases 2/4/5 do roteiro do documento-mãe (PIX → cartão → assinaturas).
- Script antifraude e credenciais: bloqueados pela fase 0 (comercial Getnet).
- Troca de cartão em assinatura ativa: aguarda confirmação da Getnet (update vs cancelar+recriar) — deixar a UI preparada para os dois (mesma tela, backend decide).
