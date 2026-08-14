# REVIEW.md — instruções de revisão do ArenaHub

> **Estas instruções são injetadas em todos os agentes do pipeline de revisão com a mais alta
> prioridade.** Elas definem o que é sinalizado, com qual gravidade, e como o achado é relatado.
>
> Use este arquivo para **ajustar o comportamento da revisão** — não para documentar
> arquitetura. Contexto vive em `ARCHITECTURE.md` e `CONVENTION.md`.

---

## 1. Postura

**Revisão não é validação.** O trabalho do revisor é achar o ponto mais fraco antes de aprovar,
não confirmar que está bom.

- Não elogie sem apontar o que está errado ou faltando primeiro.
- Não repita o enquadramento do autor de volta para ele.
- Comece pelo achado mais grave. Se a resposta é "isto não pode ser mergeado", diga na primeira
  frase.
- **Achado sem localização não é achado.** Sempre arquivo, linha e o comportamento concreto.
- **Achado sem consequência não é achado.** "Isto viola INV-035, então entitlement expirado
  libera a catraca" é achado. "Poderia ser mais limpo" não é.
- Não aprove por cansaço. PR grande demais para revisar é motivo para pedir divisão, não para
  aprovar no escuro.

---

## 2. Escala de gravidade

| nível | significado | ação |
|---|---|---|
| **BLOQUEIO** | viola invariante, regra de arquitetura ou ADR aceito; ou expõe dado | **não mergeia.** Correção obrigatória |
| **GRAVE** | bug real de comportamento, ou ausência de teste em caminho crítico | corrige antes do merge, salvo decisão explícita do PI registrada no PR |
| **ATENÇÃO** | risco de manutenção, acoplamento indevido, nome enganoso | corrige agora ou vira `[FIX]` com card |
| **NOTA** | preferência, estilo, oportunidade | **não bloqueia.** Máximo 5 por PR — acima disso vira ruído |

**Regra anti-inflação:** se tudo é BLOQUEIO, nada é. Um PR com oito BLOQUEIOS provavelmente tem
um problema estrutural — reporte **o problema estrutural**, não os oito sintomas.

---

## 3. BLOQUEIO — lista fechada

Qualquer um destes impede o merge. Não há bom senso a aplicar; há regra escrita a citar.

### 3.1 Multi-tenant
- Query sem `TenantContext` (INV-003).
- `tenant_id` vindo do corpo da requisição ou do payload de webhook (INV-002, INV-078).
- Entidade de negócio nova **sem `tenant_id`** (INV-001).
- Caso de uso multi-tenant crítico **sem teste que tenta cruzar tenants e falha** (INV-006).

### 3.2 Acesso
- Motor de decisão consultando `Subscription` ou `Invoice` (INV-029, INV-030).
- Caminho onde entitlement expirado pode retornar `ALLOW` (INV-035).
- Dado offline vencido produzindo allow sem limite (INV-053).
- Override alterando assinatura ou entitlement silenciosamente (INV-040).
- Evento de passagem sendo **editado** em vez de gerar registro novo (INV-043).

### 3.3 Dinheiro
- `float`, `number` ou decimal de ponto flutuante em caminho monetário (INV-065).
- Invoice paga voltando a aberta (INV-069).
- Efeito externo sem chave de idempotência persistida **antes** do efeito (INV-076, INV-084).
- Webhook processado sem verificação de assinatura (INV-077).
- Qualquer dado completo de cartão tocando o backend (INV-098, INV-099).

### 3.4 Dado pessoal
- Template biométrico, token, cartão ou PII em log (INV-022).
- Erro de API vazando detalhe interno ou PII (INV-133).
- Tela pública da catraca exibindo dívida, valor, CPF ou dado sensível (INV-123).
- Revogação de consentimento **sem** bloqueio lógico imediato (INV-018).
- Fluxo biométrico **sem** caminho alternativo funcional (INV-022b).
- Dado real de aluno em fixture, seed, golden file ou teste.
- Segredo commitado.

### 3.5 Saúde e IA
- OCR ou IA publicando dado de saúde sem confirmação humana (INV-103).
- Saída de IA sem `disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS'`, ou aceita fora do schema (INV-111,
  INV-112).
- Ausência de dado tratada como zero (INV-104).
- Qualquer decisão de acesso derivada de dado de saúde (INV-119).

### 3.6 Processo
- PR com **`closes #N`** em vez de `refs #N` — forja o aceite do PI.
- Teste removido, pulado (`skip`, `only`) ou enfraquecido sem aprovação explícita.
- Migração destrutiva sem rollback documentado.
- Código implementando fatia **sem spec `aprovada-pi`**.
- Código que resolve por conta própria um **ADR aberto**.
- Documento afirmando resultado de execução que não ocorreu (evidência narrada — ADR-016).

---

## 4. O que o revisor deve procurar ativamente

Além da lista fechada, estes são os pontos onde este projeto especificamente erra:

1. **Acoplamento de acesso a pagamento.** É a tentação estrutural do domínio, e a própria
   Especificação escorrega nela. Procure qualquer caminho onde a catraca "sabe" de dinheiro.
2. **Vocabulário divergente.** `ALLOW`/`GRANTED`, `occurred_at`/`timestamp`,
   `gym_unit_id`/`unit_id`. Um alias hoje é um `if` errado em seis meses (ADR-005).
3. **Módulo lendo tabela de outro módulo.** É assim que monólito modular vira monólito.
4. **Abstração especulativa.** Adapter para fabricante que ninguém contratou; interface com uma
   implementação e cinco imaginárias; flag de configuração sem consumidor.
5. **Dublê no lugar errado.** Fake de caso de uso ou de repositório de domínio não testa nada
   (ADR-017).
6. **Fila sem observabilidade.** DLQ sem painel é lixeira; `retry_count` sem limite é loop.
7. **Timezone implícito.** Data sem offset, "hoje" calculado no servidor, janela de acesso em
   horário local não declarado (INV-134, ADR-019).
8. **`[FIX]` que é fatia disfarçada.** Se o card não cita ADR, invariante ou spec que define o
   comportamento correto, **não é bug** — é escopo novo sem aval. Sinalize como BLOQUEIO de
   processo.

---

## 5. Formato do achado

```
[GRAVIDADE] arquivo:linha — título curto

O que acontece: <comportamento concreto, não adjetivo>
Por que é problema: <consequência real; cite INV-nnn ou ADR-nnn quando houver>
Como reproduzir: <entrada → saída observada → saída esperada>
Sugestão: <opcional; a correção é do autor>
```

**Não** escreva "considere refatorar", "seria bom", "talvez". Ou é achado com consequência, ou
não vai no relatório.

---

## 6. Relatório do PR

Ordem fixa:

1. **Veredito em uma frase.** "Não mergeia: viola INV-035." ou "Mergeia."
2. **BLOQUEIOS**, se houver.
3. **GRAVES.**
4. **ATENÇÕES.**
5. **NOTAS** (até 5).
6. **O que foi verificado** — quais invariantes desta fatia foram checadas e como. Isso existe
   para que a próxima revisão saiba o que **não** foi olhado.

Se não houver achado de gravidade BLOQUEIO ou GRAVE, diga isso direto e pare. Revisão que
inventa achado para parecer rigorosa treina o autor a ignorar revisão.

---

## 7. Frontend — critérios adicionais

Aplicam-se a `admin-web`, `kiosk` e `mobile`. Fonte: `docs/DESIGN-UI.md` (**status
`RASCUNHO`** — o que estiver marcado como proposta ali **não** é base para BLOQUEIO).

- **BLOQUEIO:** contraste abaixo de WCAG 2.2 AA. É NFR de PRD (`M1-NFR-008`, `M3-NFR-007`,
  `M4-NFR-007`, `M5-NFR-008`), não preferência estética.
- **ATENÇÃO:** accent de tenant aceito sem a derivação por hue seed e sem
  `ACCENT_CONTRAST_UNREACHABLE`. O *mecanismo* é resolução proposta em `DESIGN-UI.md` §7.4, ainda
  em `RASCUNHO` — o **resultado** (contraste AA) é que é obrigatório.
- **Cor nunca é o único indicador** de estado, resultado ou tendência (INV-124, INV-125).
- Toast para Info/Warn/Error. **Alert é BLOQUEIO.**
- Máscara e validação em Date, R$, CPF, CNPJ, telefone e e-mail.
- Totem: sessão limpa tudo em 2 s (`M4-NFR-004`); efeito visual pesado só na tela atrator.
- Estado vazio, de carga e de erro existem — tela que só desenha o caminho feliz é GRAVE.

---

## 8. O que a revisão **não** faz

- Não discute **escopo**. Escopo é do PI. Se o código faz mais do que a spec pede, isso é
  achado de processo (ATENÇÃO ou BLOQUEIO), não convite a opinar sobre o produto.
- Não reescreve o código do autor no comentário.
- Não pede refatoração de código que a fatia não tocou (`CLAUDE.md` → alterações cirúrgicas).
- Não aprova condicionalmente ("aprovo se você arrumar X"). Ou bloqueia, ou aprova.
