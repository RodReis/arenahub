# TESTS.md — relatório de evidência

> **Gerado por `pnpm test:report`. Não edite à mão.**
>
> O CI roda `pnpm test:report --check` e falha se este arquivo divergir do que a execução
> produz. É a guarda de evidência do `docs/TESTING.md` §5.
>
> **Data e SHA da execução ficam no log do CI, não aqui.** Gravá-los no arquivo tornaria a
> guarda impossível de satisfazer: gerar mudaria o conteúdo, exigindo commit, que mudaria o
> SHA, que desatualizaria o relatório. Este arquivo só carrega o que é reproduzível a partir
> do código.

## Arquivos de teste por nível

Classificação por **sufixo de arquivo**, não por pasta (`docs/TESTING.md` §2).

| nível | sufixo | arquivos |
|---|---|---|
| unitário | `.spec.ts`, `.spec.tsx`, `.test.ts`, `.test.tsx` | 83 |
| contrato | `.contract-spec.ts`, `.contract-spec.tsx` | 0 |
| integração | `.int-spec.ts`, `.int-spec.tsx` | 28 |
| e2e | `.e2e-spec.ts`, `.e2e-spec.tsx` | 6 |
| hardware | `.hw-spec.ts`, `.hw-spec.tsx` | 0 |
| segurança | `.sec-spec.ts`, `.sec-spec.tsx` | 0 |
| **total** | | **117** |

## Por SPEC / fatia

> A ligação SPEC ↔ teste vem da tag no teste ou do caminho do módulo
> (`docs/TESTING.md` §5). Preenchida quando houver teste com tag.
