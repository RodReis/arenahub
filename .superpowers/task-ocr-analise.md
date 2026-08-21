# OCR real + analise automatica (ADR-036/039/040)

STATUS: concluido.

Commit SHA: `621d8281c4b960910f113c1eaca058eee2dae9c0`

## Numeros reais

- `pnpm --filter @arenahub/api test`: **51 suites, 743 testes, todos passando** (2.2s).
- `pnpm --filter @arenahub/api test:integration -- "sessao-multiarquivo|upload-e-revisao|analise-por-ia"`: **3 suites, 61 testes, todos passando** (9.4s). Nenhuma chamada real a Anthropic (NODE_ENV=test cai para os dublês mesmo com chave real no `.env`).
- `pnpm --filter @arenahub/api exec tsc --noEmit -p tsconfig.json`: **sem erros**.
- `pnpm lint`: **9/9 tarefas passando** (inclui `@arenahub/api:lint` limpo).

## O que foi implementado

- `AnthropicOcrExtractorAdapter` (`claude-haiku-4-5`, sem `thinking`/`effort`) para PNG/JPEG.
- `AnthropicAiProviderAdapter` (`claude-sonnet-4-6`, `thinking: {type:'adaptive'}`, sem `budget_tokens`).
- `DocumentExtractorRouterAdapter` ganhou terceira rota (OCR real opcional), fakes preservados.
- `health.module.ts`: cliente Anthropic unico via factory; `escolherOcrReal`/`escolherProvedorDeIa`
  (`provider/anthropic-gate.ts`) decidem real-vs-dublê e nunca chamam o provedor real em `NODE_ENV=test`.
- `env.ts`: `ANTHROPIC_API_KEY` opcional, nunca logada.
- `import.service.ts`: `publicarAutomaticamente` agora chama `AiAnalysisService.gerar` apos a
  publicacao; `ForbiddenException` (sem consentimento) e qualquer outra falha sao logadas e
  NUNCA derrubam o upload.
- Testes novos: extracao/rejeicao de campo desconhecido, fallback sem chave, sem-consentimento-sem-analise.

## Nao implementado / observacoes

- Nada ficou de fora do escopo pedido.
