# totem (kiosk) — Integração Getnet

**App:** `apps/kiosk` (Next.js PWA em modo quiosque)
**Decisão de escopo:** o totem é hardware genérico. **Único meio de pagamento no totem: PIX QR Code dinâmico.** Sem captura de cartão presente, sem teclado de cartão, sem dado sensível — o totem fica **fora do escopo PCI**.
**Documento-mãe:** `integracao-getnet-spec.md`. Os deeplinks do portal Get Smart (getstore.getnet.com.br) **não se aplicam** a este app — valem só para app Android rodando no POS da Getnet (ver Anexo A do documento-mãe).

---

## 1. Regra de ouro do canal

O totem fala **somente com a API interna** (`/api/v1`). Não conhece Getnet, não guarda estado de pagamento, não decide status: exibe o QR, escuta o backend e reage. Fonte de verdade do "pago" = webhook Getnet processado pelo backend.

## 2. Fluxo principal (autoatendimento)

```
[Identificação] → [Seleção/valor] → [QR PIX + contador] → [Confirmação] → [Recibo/ação]
```

1. **Identificação:** CPF, matrícula ou QR do app mobile. `GET /api/v1/members/lookup?...` (endpoint a expor com resposta mínima: nome + pendências — nunca dados completos do cadastro num totem público).
2. **Seleção:** diária, renovação de plano, quitação de débito em aberto (lista de pendências vinda da API).
3. **Criação da cobrança:** `POST /api/v1/payments/pix { amountCents, memberId, description }` → `{ paymentId, qrCode, expiresAt, status:"pending" }`.
4. **Tela de QR:**
   - QR renderizado client-side a partir do copia-e-cola (payload `000201…br.gov.bcb.pix…`);
   - contador regressivo baseado em `expiresAt` (relógio do servidor — usar delta, não o clock local do totem);
   - botão "cancelar/voltar" (cancela a *sessão de tela*, não a cobrança — ver §4).
5. **Acompanhamento:** SSE `GET /api/v1/payments/:id/events`; fallback polling 5 s se o SSE cair.
6. **Aprovado:** tela de sucesso (nome + valor), disparo da ação de negócio (registrar diária, renovar plano, atualizar adimplência → sync edge-agent/catraca) e recibo na tela com opção de envio por e-mail/push. Timeout da tela de sucesso: 15 s → volta ao início.
7. **Expirado:** oferecer "gerar novo QR" (novo `POST`, nova cobrança, novo `idempotency_key` no backend).

## 3. Requisitos de resiliência (críticos em autoatendimento)

| Cenário | Comportamento |
|---|---|
| Pagador paga **depois** que a tela expirou/voltou ao início | O QR PIX continua pagável até expirar na Getnet. O backend recebe o webhook e aplica `approved` mesmo sem tela aberta; o efeito de negócio (diária/renovação) é executado pelo backend, não pela tela. O totem deve avisar: "Se você já pagou, sua liberação sai em instantes — consulte na catraca ou recepção." |
| SSE cai | Degradar para polling 5 s, transparente ao usuário |
| API interna fora | Tela de indisponibilidade + orientação para recepção; **nunca** fila local de pagamentos no totem |
| Duplo toque / repetição de pedido | Botão de criação desabilitado após o 1º `POST`; um pagamento `pending` ativo por sessão de totem |
| Queda de energia no meio do fluxo | Sem estado local: ao religar, fluxo recomeça; cobrança pendente resolve-se via webhook no backend |

## 4. Semântica de cancelamento

"Cancelar" no totem **não cancela a cobrança PIX** (a Getnet documenta que o QR pode ser pago mesmo após cancelamento na tela). O backend mantém o `payment` como `pending` até `approved`/`expired`. A UI deve dizer isso: "Se você já escaneou, conclua ou aguarde o código expirar."

## 5. Modo quiosque (dispositivo)

- Chrome/Chromium em modo kiosk (fullscreen, sem barra, sem gestos de navegação) ou launcher dedicado; auto-start no boot; watchdog que recarrega a PWA se congelar.
- Bloquear: menu de contexto, seleção de texto, zoom, teclas de sistema.
- Sem armazenamento persistente de dados de aluno na PWA (memória de sessão apenas; limpar ao voltar à tela inicial).
- Não confundir com o "Modo Quiosque" do POS Digital Getnet (`kiosk_mode` no AndroidManifest) — aquilo é do terminal Get Smart, não deste app.

## 6. UI/UX mínimos

- Fonte e alvos de toque grandes (uso em pé, pressa); fluxo completo em ≤ 4 telas.
- Contador visível do QR; feedback sonoro/visual na aprovação.
- Acessibilidade: contraste alto, textos curtos; instrução "aponte a câmera do app do seu banco".
- Idle timeout: 60 s sem interação → volta à tela inicial (limpa sessão).

## 7. Critérios de aceite

- [ ] Zero requisições do totem para domínios Getnet (verificável no DevTools/network).
- [ ] Nenhum dado de cartão em nenhuma tela do app.
- [ ] Pagamento aprovado após expiração da tela ainda gera o efeito de negócio (teste e2e com webhook atrasado).
- [ ] SSE→polling fallback testado com queda forçada.
- [ ] Aprovação reflete na catraca (sync edge-agent) em ≤ N min (definir SLA com o time).
- [ ] Totem reiniciado no meio de um pagamento não gera cobrança duplicada.

## 8. Dependências

- Fase 2 (PIX no backend: endpoint, SSE, webhook, expiração/reversão) e fase 3 do roteiro do documento-mãe.
- Endpoint `members/lookup` com resposta mínima (a criar no módulo de membros).
- Definição do valor de expiração do QR (`GETNET_PIX_EXPIRATION_SECONDS`, sugerido 900 s) — validar com a operação.
