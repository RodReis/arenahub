# docs/specs — specs de fatia

> **Quem escreve: só o Claude Cowork.** O Code lê, implementa e aponta problema técnico — não
> edita.
>
> **Quando existe:** uma spec por fatia, criada **antes** do card, aprovada pelo PI antes de
> qualquer linha de código.

---

> **ADR-022 (14/08/2026): a `Slice N.M` do PRD É a spec.** Este arquivo é o ponteiro para ela.
> As 41 existem desde 14/08/2026 — o que autoriza codificar é o **status**, não a existência.


> ↩️ **23/08/2026 — reaberto por decisão do PI.** Em 18/08 o gate de spec morreu e este diretório
> virou histórico; em 23/08 o PI pediu spec para as fatias novas de pagamento e a decisão dele
> vence. **Vale para fatia criada a partir de 23/08** — `SPEC-053`, `SPEC-054` e `SPEC-055` são as
> primeiras. **F45–F48 continuam sem spec**, e `SPEC-045` a `SPEC-048` continuam queimados.
>
> **O que mudou na forma:** para fatia que nasce de uma Slice de PRD, a spec continua sendo o
> ponteiro fino descrito abaixo. Para fatia **sem** Slice (F49–F55, criadas por ADR ou por
> recorte), **o escopo mora na spec** — não há PRD para apontar.

## 1. O que a spec é — e o que ela não é

A spec deste projeto é **fina de propósito**.

O repositório já tem três camadas de verdade sobre cada fatia:

| camada | onde | o que traz |
|---|---|---|
| requisito | `docs/prd/academia/MVP-nn.md` | FR, NFR, BR, AC numerados; gates; checklist |
| plano | `docs/superpowers/plans/` | passos, arquivos, ordem técnica |
| contrato de domínio | `docs/CONVENTION.md` | entidades, estados, invariantes |

**A spec não copia nada disso.** Copiar cria uma quarta cópia que diverge na primeira mudança —
e aí ninguém sabe qual é a verdade.

**A spec acrescenta exatamente quatro coisas:**

1. **Decisões** que o PI tomou para esta fatia e que não estavam em lugar nenhum.
2. **Escopo negativo** — o que esta fatia deliberadamente **não** faz, e para onde isso foi.
3. **Critérios de aceite operacionais** — como o PI vai olhar e dizer "aceito".
4. **Perguntas resolvidas** — o registro do que foi perguntado e o que se respondeu. É isto que
   impede a mesma dúvida voltar em três meses.

---

## 2. Nome do arquivo

```
SPEC-<nnn>-<slug-em-kebab>.md
```

Exemplos: `SPEC-008-consentimento-biometria-sync.md`, `SPEC-013-pix-webhook-idempotente.md`.

O número vem do **Índice Fatia ↔ SPEC** do `docs/STATUS.md`, é alocado uma vez e **nunca
reaproveitado** (ADR-015). `SPEC-<nnn>` e `F<n>` compartilham o número por construção.

---

## 3. Ciclo de vida

```
planejada          ponteiro criado, MVP ainda não discutido com o PI
                   (antes do ADR-022 isto queria dizer "arquivo não existe" —
                    hoje os 41 arquivos existem; o que falta é a conversa)
   │
   ▼
rascunho
   │  Cowork escreve a partir do PRD + plano + perguntas
   ▼
em-revisao
   │  Cowork apresenta ao PI TODAS as perguntas abertas
   │  ⚠ spec com pergunta aberta NÃO avança — é retrabalho garantido
   ▼
aprovada-pi
   │  Cowork: pusha na main + registra no Índice + cria o card em Backlog
   ▼
entregue
      PI aceitou a issue e aplicou proplan:finalizado
```

**Regra dura:** enquanto a spec não estiver `aprovada-pi`, o Code **não codifica** — e nenhum
ADR que a bloqueia pode estar aberto.

---

## 4. Antes de escrever uma spec, o Cowork verifica

- [ ] A fatia tem número no Índice Fatia ↔ SPEC?
- [ ] Quais **ADRs abertos** a bloqueiam (`docs/STATUS.md` §3)? Eles precisam cair primeiro.
- [ ] O **gate de entrada do MVP** está atendido, com evidência?
- [ ] Quais **invariantes** do `CONVENTION.md` §4 esta fatia toca?
- [ ] Esta fatia esbarra em algum **buraco do modelo** (`CONVENTION.md` §5)? Se sim, a spec
      precisa fechá-lo — ou a fatia não pode começar.
- [ ] O plano em `docs/superpowers/plans/` **diverge** do PRD em algum ponto? Divergência vira
      pergunta ao PI, nunca escolha do Cowork.

---

## 5. Template

Copie de `_TEMPLATE.md`. Mantenha as seções, mesmo vazias — seção ausente esconde omissão;
seção com "nada a declarar" é decisão registrada.
