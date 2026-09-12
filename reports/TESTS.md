# TESTS.md — relatório de evidência

> **Gerado por `pnpm test:report`. Não edite à mão.**
>
> O CI roda `pnpm test:report --check` e falha se a seção "Estado atual" divergir do que a
> execução produz. É a guarda de evidência do `docs/TESTING.md` §5.
>
> **O `--check` valida só os números.** Issue/SPEC/PR do histórico vêm de fora do
> repositório e são responsabilidade de quem roda `pnpm test:report --issue N` antes do
> commit — revisão humana no PR é a rede de segurança para esse dado, não o CI.

## Estado atual

Última execução — regenerado a cada `pnpm test:report`, não acumulado.

| nível | testes | pass | falha | cobertura % |
|---|---:|---:|---:|---:|
| unitário | 3276 | 3276 | 0 | 76.0 |
| contrato | 0 | 0 | 0 | — |
| integração | 1079 | 1079 | 0 | 83.7 |
| e2e | 0 | 0 | 0 | — |
| hardware | 0 | 0 | 0 | — |
| segurança | 0 | 0 | 0 | — |

## Histórico por entrega

Append-only — linhas de entregas passadas são imutáveis.

| Data | Issue | SPEC | Nível | testes | pass | falha | cobertura % | PR |
|---|---|---|---|---:|---:|---:|---:|---|
| 2026-08-20 | #125 | — | unitário | 985 | 985 | 0 | 94.5 | #126 |
| 2026-08-20 | #125 | — | integração | 401 | 401 | 0 | 84.6 | #126 |
| 2026-08-20 | #17 | SPEC-017 | unitário | 1023 | 1023 | 0 | 94.6 | #128 |
| 2026-08-20 | #17 | SPEC-017 | integração | 423 | 423 | 0 | 84.5 | #128 |
| 2026-08-20 | #130 | F48 | unitário | 1053 | 1053 | 0 | 92.4 | #131 |
| 2026-08-20 | #130 | F48 | integração | 438 | 438 | 0 | 85.1 | #131 |
| 2026-08-20 | #132 | F49 | unitário | 1053 | 1053 | 0 | 92.1 | #133 |
| 2026-08-20 | #132 | F49 | integração | 450 | 450 | 0 | 85.5 | #133 |
| 2026-08-20 | #134 | F50 | unitário | 1053 | 1053 | 0 | 92.1 | #135 |
| 2026-08-20 | #134 | F50 | integração | 450 | 440 | 0 | 85.5 | #135 |
| 2026-08-21 | #18 | SPEC-018 | unitário | 1120 | 1120 | 0 | 92.3 | [#138](https://github.com/RodReis/arenahub/pull/138) |
| 2026-08-21 | #18 | SPEC-018 | integração | 472 | 472 | 0 | 85.5 | [#138](https://github.com/RodReis/arenahub/pull/138) |
| 2026-08-21 | #129 | FIX | unitário | 1129 | 1129 | 0 | 92.3 | [#140](https://github.com/RodReis/arenahub/pull/140) |
| 2026-08-21 | #129 | FIX | integração | 472 | 472 | 0 | 85.5 | [#140](https://github.com/RodReis/arenahub/pull/140) |
| 2026-08-21 | #20 | F20 | unitário | 1170 | 1170 | 0 | 92.5 | [#141](https://github.com/RodReis/arenahub/pull/141) |
| 2026-08-21 | #20 | F20 | integração | 492 | 481 | 0 | 85.9 | [#141](https://github.com/RodReis/arenahub/pull/141) |
| 2026-08-21 | #21 | F21 | unitário | 1231 | 1231 | 0 | 92.8 | [#142](https://github.com/RodReis/arenahub/pull/142) |
| 2026-08-21 | #21 | F21 | integração | 450 | 450 | 0 | 85.9 | [#142](https://github.com/RodReis/arenahub/pull/142) |
| 2026-08-21 | #19 | F19 | unitário | 1265 | 1265 | 0 | 93.0 | [#143](https://github.com/RodReis/arenahub/pull/143) |
| 2026-08-21 | #19 | F19 | integração | 471 | 471 | 0 | 85.5 | [#143](https://github.com/RodReis/arenahub/pull/143) |
| 2026-08-21 | #22 | F22 | unitário | 1281 | 1281 | 0 | 93.0 | [#144](https://github.com/RodReis/arenahub/pull/144) |
| 2026-08-21 | #22 | F22 | integração | 475 | 475 | 0 | 85.5 | [#144](https://github.com/RodReis/arenahub/pull/144) |
| 2026-08-22 | #147 | — | unitário | 1402 | 1402 | 0 | 77.4 | — |
| 2026-08-22 | #147 | — | integração | 561 | 559 | 2 | 84.5 | — |
| 2026-08-22 | #147 | — | unitário | 1402 | 1402 | 0 | 77.4 | — |
| 2026-08-22 | #147 | — | integração | 561 | 561 | 0 | 84.6 | — |
| 2026-08-22 | #154 | F18/F19/F21 | unitário | 1416 | 1416 | 0 | 77.5 | — |
| 2026-08-22 | #154 | F18/F19/F21 | integração | 561 | 560 | 1 | 84.6 | — |
| 2026-08-22 | #154 | F18/F19/F21 | unitário | 1416 | 1416 | 0 | 77.5 | — |
| 2026-08-22 | #154 | F18/F19/F21 | integração | 561 | 560 | 1 | 84.6 | — |
| 2026-08-24 | #156 | SPEC-053 | unitário | 1440 | 1440 | 0 | 75.4 | #160 |
| 2026-08-24 | #156 | SPEC-053 | integração | 592 | 592 | 0 | 84.3 | #160 |
| 2026-08-24 | #165 | SPEC-053 | unitário | 1456 | 1456 | 0 | 75.4 | #160 |
| 2026-08-24 | #165 | SPEC-053 | integração | 592 | 592 | 0 | 84.3 | #160 |
| 2026-08-25 | #188 | FIX-188 | unitário | 1524 | 1524 | 0 | 75.2 | #189 |
| 2026-08-25 | #188 | FIX-188 | integração | 617 | 617 | 0 | 84.8 | #189 |
| 2026-08-25 | #187 | FIX-187 | unitário | 1538 | 1538 | 0 | 75.3 | #190 |
| 2026-08-25 | #187 | FIX-187 | integração | 617 | 617 | 0 | 84.8 | #190 |
| 2026-08-25 | #191 | FIX-191 | unitário | 1544 | 1544 | 0 | 75.3 | #192 |
| 2026-08-25 | #191 | FIX-191 | integração | 617 | 617 | 0 | 84.8 | #192 |
| 2026-08-25 | #158 | SPEC-055 | unitário | 1544 | 1544 | 0 | 75.1 | #193 |
| 2026-08-25 | #158 | SPEC-055 | integração | 617 | 617 | 0 | 84.8 | #193 |
| 2026-08-25 | #167 | [#202](https://github.com/RodReis/arenahub/pull/202) | unitário | 1627 | 1627 | 0 | 75.8 | [#202](https://github.com/RodReis/arenahub/pull/202) |
| 2026-08-25 | #167 | [#202](https://github.com/RodReis/arenahub/pull/202) | integração | 645 | 645 | 0 | 84.3 | [#202](https://github.com/RodReis/arenahub/pull/202) |
| 2026-08-25 | #159 | F56 | unitário | 1652 | 1652 | 0 | 75.7 || [#203](https://github.com/RodReis/arenahub/pull/203) |
| 2026-08-25 | #159 | F56 | integração | 729 | 729 | 0 | — || [#203](https://github.com/RodReis/arenahub/pull/203) |
| 2026-08-25 | #204 | — | unitário | 1667 | 1667 | 0 | 75.8 || [#205](https://github.com/RodReis/arenahub/pull/205) |
| 2026-08-25 | #204 | — | integração | 645 | 645 | 0 | 84.3 || [#205](https://github.com/RodReis/arenahub/pull/205) |
| 2026-08-25 | #150 | SPEC-049 | unitário | 1738 | 1738 | 0 | 75.6 | [#206](https://github.com/RodReis/arenahub/pull/206) |
| 2026-08-25 | #150 | SPEC-049 | integração | 645 | 645 | 0 | 84.3 | [#206](https://github.com/RodReis/arenahub/pull/206) |
| 2026-08-26 | #83 | SPEC-044 | unitário | 1989 | 1989 | 0 | 75.4 | [#210](https://github.com/RodReis/arenahub/pull/210) |
| 2026-08-26 | #83 | SPEC-044 | integração | 645 | 645 | 0 | 84.3 | [#210](https://github.com/RodReis/arenahub/pull/210) |
| 2026-08-27 | #30 | SPEC-030 | unitário | 2064 | 2064 | 0 | 75.7 | #211 |
| 2026-08-27 | #30 | SPEC-030 | integração | 673 | 673 | 0 | 84.3 | #211 |
| 2026-08-27 | #31 | SPEC-031 | unitário | 2195 | 2195 | 0 | 76.3 | [#213](https://github.com/RodReis/arenahub/pull/213) |
| 2026-08-27 | #31 | SPEC-031 | integração | 753 | 753 | 0 | 83.9 | [#213](https://github.com/RodReis/arenahub/pull/213) |
| 2026-08-28 | #32 | SPEC-032 | unitário | 2240 | 2240 | 0 | 76.3 | [#214](https://github.com/RodReis/arenahub/pull/214) |
| 2026-08-28 | #32 | SPEC-032 | integração | 753 | 753 | 0 | 83.9 | [#214](https://github.com/RodReis/arenahub/pull/214) |
| 2026-08-28 | #215 | INFRA-215 | unitário | 2271 | 2271 | 0 | 76.4 | [#216](https://github.com/RodReis/arenahub/pull/216) |
| 2026-08-28 | #215 | INFRA-215 | integração | 753 | 753 | 0 | 83.9 | [#216](https://github.com/RodReis/arenahub/pull/216) |
| 2026-08-28 | #34 | SPEC-034 | unitário | 2409 | 2409 | 0 | 76.6 | [#219](https://github.com/RodReis/arenahub/pull/219) |
| 2026-08-28 | #34 | SPEC-034 | integração | 764 | 764 | 0 | 83.9 | [#219](https://github.com/RodReis/arenahub/pull/219) |
| 2026-08-28 | #220 | — | unitário | 2447 | 2447 | 0 | 76.6 | [#221](https://github.com/RodReis/arenahub/pull/221) |
| 2026-08-28 | #220 | — | integração | 764 | 764 | 0 | 83.9 | [#221](https://github.com/RodReis/arenahub/pull/221) |
| 2026-08-28 | #35 | SPEC-035 | unitário | 2540 | 2540 | 0 | 76.6 | — |
| 2026-08-28 | #35 | SPEC-035 | integração | 732 | 732 | 0 | 83.9 | — |
| 2026-08-28 | #35 | SPEC-035 | unitário | 2557 | 2557 | 0 | 76.8 | [#222](https://github.com/RodReis/arenahub/pull/222) |
| 2026-08-28 | #35 | SPEC-035 | integração | 734 | 734 | 0 | 83.9 | [#222](https://github.com/RodReis/arenahub/pull/222) |
| 2026-08-31 | #36 | SPEC-036 | unitário | 2624 | 2624 | 0 | 76.4 | — |
| 2026-08-31 | #36 | SPEC-036 | integração | 856 | 856 | 0 | 83.9 | medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-08-31 | #37 | SPEC-037 | unitário | 2707 | 2707 | 0 | 76.4 | [#225](https://github.com/RodReis/arenahub/pull/225) |
| 2026-08-31 | #37 | SPEC-037 | integração | 753 | 753 | 0 | 83.9 | [#225](https://github.com/RodReis/arenahub/pull/225) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-08-31 | #38 | SPEC-038 | unitário | 2768 | 2768 | 0 | 76.3 | [#226](https://github.com/RodReis/arenahub/pull/226) |
| 2026-08-31 | #38 | SPEC-038 | integração | 765 | 765 | 0 | 83.9 | [#226](https://github.com/RodReis/arenahub/pull/226) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-08-31 | #39 | SPEC-039 | unitário | 2808 | 2808 | 0 | 76.1 | [#227](https://github.com/RodReis/arenahub/pull/227) |
| 2026-08-31 | #39 | SPEC-039 | integração | 779 | 779 | 0 | 83.9 | [#227](https://github.com/RodReis/arenahub/pull/227) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-08-31 | #41 | SPEC-041 | unitário | 2843 | 2843 | 0 | 76.0 | [#229](https://github.com/RodReis/arenahub/pull/229) |
| 2026-08-31 | #41 | SPEC-041 | integração | 791 | 791 | 0 | 83.9 | [#229](https://github.com/RodReis/arenahub/pull/229) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-09-01 | #241 | — | unitário | 2859 | 2859 | 0 | 75.5 | [#243](https://github.com/RodReis/arenahub/pull/243) |
| 2026-09-01 | #241 | — | integração | 805 | 805 | 0 | 83.9 | [#243](https://github.com/RodReis/arenahub/pull/243) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-09-01 | #241 | — | unitário | 2868 | 2868 | 0 | 75.7 | [#245](https://github.com/RodReis/arenahub/pull/245) |
| 2026-09-01 | #241 | — | integração | 810 | 810 | 0 | 83.9 | [#245](https://github.com/RodReis/arenahub/pull/245) — medido suíte a suíte (o Jest crasha no fim no Windows) |
| 2026-09-01 | #242 | SPEC-057 | unitário | 2897 | 2897 | 0 | 75.7 | [#247](https://github.com/RodReis/arenahub/pull/247) |
| 2026-09-01 | #242 | SPEC-057 | integração | 796 | 796 | 0 | 83.9 | [#247](https://github.com/RodReis/arenahub/pull/247) — medido suíte a suíte, 56 suítes (o Jest crasha no fim no Windows e o gerador manteve o 810 da entrega anterior); 796 conferido por contagem independente dos `it`/`test` declarados |
| 2026-09-01 | #248 | — | unitário | 2904 | 2904 | 0 | 75.5 | — |
| 2026-09-01 | #248 | — | integração | 799 | 799 | 0 | 83.9 | — medido suíte a suíte, 56 suítes (o Jest crasha no fim no Windows e o gerador manteve o 810 da entrega anterior); 799 conferido por contagem independente dos `it`/`test` declarados |
| 2026-09-01 | #250 | — | unitário | 2914 | 2914 | 0 | 75.5 | — |
| 2026-09-01 | #250 | — | integração | 800 | 800 | 0 | 83.9 | — medido suíte a suíte, 56 suítes (o Jest crasha no fim no Windows e o gerador manteve o 810 herdado); 800 confirmado por três medições: lote (786 + 14 na suíte que rodou vazia, remedida sozinha), execução isolada (14/14) e contagem estática dos `it`/`test` declarados |
| 2026-09-04 | #270 | SPEC-060 | unitário | 2921 | 2921 | 0 | 75.4 | #271 |
| 2026-09-04 | #270 | SPEC-060 | integração | 883 | 883 | 0 | 84.0 | #271 — medido em lotes com `--json`, 57 suítes de `apps/api` (809) + 5 de `@arenahub/database` (74); o Jest crasha no fim no Windows e o gerador manteve o 824 herdado |
| 2026-09-04 | #270 | SPEC-060 | unitário | 2926 | 2926 | 0 | 75.4 | #271 |
| 2026-09-04 | #270 | SPEC-060 | integração | 887 | 887 | 0 | 84.0 | #271 — medido em lotes com `--json`, 57 suítes de `apps/api` (813) + 5 de `@arenahub/database` (74); o Jest crasha no fim no Windows e o gerador herda o número anterior |
| 2026-09-05 | #272 | — | unitário | 2926 | 2926 | 0 | 75.4 | — |
| 2026-09-05 | #272 | — | integração | 888 | 888 | 0 | 84.0 | — medido em lotes com `--json`: 813 em `apps/api` (inalterado) + 75 em `@arenahub/database`; o Jest crasha no fim no Windows e o gerador herda o número anterior |
| 2026-09-05 | #274 | — | unitário | 2947 | 2947 | 0 | 75.5 | — |
| 2026-09-05 | #274 | — | integração | 891 | 891 | 0 | 84.0 | — medido em lotes com `--json`: 816 em `apps/api` (57 suítes; +3 do `GET /roles`) + 75 em `@arenahub/database`; o Jest crasha no fim no Windows e o gerador herda o número anterior |
| 2026-09-05 | #276 | — | unitário | 2953 | 2953 | 0 | 75.6 | — |
| 2026-09-05 | #276 | — | integração | 891 | 891 | 0 | 84.0 | — inalterado: a fatia não toca em `apps/api` nem em `packages/database`. Número herdado da medição da #274 |
| 2026-09-05 | #281 | — | unitário | 2954 | 2954 | 0 | 75.6 | — |
| 2026-09-05 | #281 | — | integração | 892 | 892 | 0 | 84.0 | — 817 em `apps/api` (+1: a fronteira exata do mínimo) + 75 em `@arenahub/database`; o Jest crasha no fim no Windows e o gerador herda o número anterior |
| 2026-09-05 | #277 | — | unitário | 2962 | 2962 | 0 | 75.6 | — |
| 2026-09-05 | #277 | — | integração | 893 | 893 | 0 | 84.0 | — 818 em `apps/api` (+1: o convite nasce mesmo sem envio configurado) + 75 em `@arenahub/database`; o Jest crasha no fim no Windows e o gerador herda o número anterior |
| 2026-09-09 | #284 | SPEC-061 | unitário | 2991 | 2991 | 0 | 75.7 | — |
| 2026-09-09 | #284 | SPEC-061 | integração | 922 | 922 | 0 | 84.1 | — — o Jest crasha no fim no Windows (3221226505, depois dos testes passarem) e o gerador manteria o 896 herdado; medido a mão: apps/api 844 em tres shards (228+290+326) + @arenahub/database 78 |
| 2026-09-09 | #293 | SPEC-061 | unitário | 3002 | 3002 | 0 | 75.7 | — |
| 2026-09-09 | #293 | SPEC-061 | integração | 928 | 928 | 0 | 84.0 | — o Jest crasha no fim no Windows (3221226505, DEPOIS de os testes passarem) e o gerador herdaria o 922 da entrega anterior; medido a mao em dois lotes: `apps/api` 850 em 62 suites (471 + 382, menos 3 de `platform-auth-de-plataforma`, que casa nos dois filtros e rodou duas vezes) + `@arenahub/database` 78. Os +6 sao os da inscricao de MFA |
| 2026-09-09 | #285 | SPEC-062 | unitário | 3039 | 3039 | 0 | 75.8 | — |
| 2026-09-09 | #285 | SPEC-062 | integração | 937 | 937 | 0 | 84.0 | — o Jest crasha no fim no Windows (3221226505, DEPOIS de os testes passarem) e o gerador herdou o 922 de duas entregas atrás; medido à mão **suíte a suíte**: `apps/api` 859 em 63 suítes (número confirmado pela execução do CI, que roda em Linux sem o crash) + `@arenahub/database` 78. Os +8 são os da identidade visual (9 de integração da F62, menos 1 do contrato OpenAPI que já existia e passou a cobrir as rotas novas). Rodando as 63 de uma vez, `students-cadastro-completo` falha 1 por acúmulo de estado no banco da varredura — passa isolado duas vezes e não é tocado por esta fatia |
| 2026-09-09 | #286 | SPEC-063 | unitário | 3073 | 3073 | 0 | 76.1 | [#298](https://github.com/RodReis/arenahub/pull/298) |
| 2026-09-09 | #286 | SPEC-063 | integração | 955 | 955 | 0 | 84.0 | — o Jest crasha no fim no Windows (3221226505, DEPOIS de os testes passarem) e o gerador herdou o 937 da entrega anterior; medido à mão em dois lotes: `apps/api` 877 (443 + 447, menos 13 de `kiosk-auth` e `platform-auth-de-plataforma`, que casam nos dois filtros e rodaram duas vezes) + `@arenahub/database` 78. Os +18 são os da fatia: `platform-contrato.int-spec.ts`. **O CI confirmou o número**: 64 suítes / 877 em `apps/api`, rodando em Linux sem o crash. | [#298](https://github.com/RodReis/arenahub/pull/298) |
| 2026-09-09 | #288 | F65 | unitário | 3110 | 3110 | 0 | 75.9 | [#300](https://github.com/RodReis/arenahub/pull/300) |
| 2026-09-09 | #288 | F65 | integração | 911 | 911 | 0 | 84.0 | — **número confirmado pelo CI** (Linux, sem o crash `3221226505`), não medido à mão: as DUAS tentativas locais desta entrega tinham crashado em pontos DIFERENTES do conjunto de 67 suítes (43/67 numa rodada, 19/67 na outra — zero `FAIL` nas duas), então "medir à mão somando lotes" (o método das entregas anteriores) não dava número confiável sem nenhuma rodada local completa para somar. **67 suítes / 911 testes**, rodando em Linux. Os +34 sobre o 877 da SPEC-063 são as suítes/testes desta fatia (`access-gate-de-tenant.int-spec.ts` novo, mais os acréscimos em `platform-suspensao-automatica`, `platform-fatura`, `manual-override`, `platform-alterar-tenant`). | [#300](https://github.com/RodReis/arenahub/pull/300) |
| 2026-09-10 | #289 | SPEC-066 | unitário | 3126 | 3126 | 0 | 75.7 | — |
| 2026-09-10 | #289 | SPEC-066 | integração | 996 | 996 | 0 | 83.7 | — 918 em `apps/api` + 78 em `@arenahub/database`, medidos numa rodada completa (68 suítes, zero `FAIL`, 2m56s). **Corrigido à mão:** o `test:report` caiu no crash `3221226505` do Windows e herdou o 955 da entrega anterior. Inclui os 7 casos de `rls-isolation`, que rodam sob o role restrito e **pulam** sem `RUNTIME_INTEGRATION_DATABASE_URL` — número do CI pode diferir se a variável faltar lá |
| 2026-09-10 | #290 | SPEC-067 | unitário | 3130 | 3130 | 0 | 75.8 | [#303](https://github.com/RodReis/arenahub/pull/303) — 13/13 tarefas |
| 2026-09-10 | #290 | SPEC-067 | integração | 1004 | 1004 | 0 | 83.7 | — **corrigido à mão**: o gerador avisou que `apps/api#test:integration` terminou com o crash `3221226505` do Windows sem escrever resultado, e manteve o 996 da entrega anterior. Medido em sete lotes de 10 suítes: **926 em `apps/api` (69 suítes, zero `FAIL`)** + 78 em `@arenahub/database`. Inclui os 8 casos de `rls-cobertura` (F67) e os 7 de `rls-isolation` (F66), que pulam sem `RUNTIME_INTEGRATION_DATABASE_URL`. **O CI confirmou o número**: 69 suítes / 926 em `apps/api`, rodando em Linux sem o crash. [#303](https://github.com/RodReis/arenahub/pull/303) |
| 2026-09-10 | #302 | SPEC-066 | unitário | 3130 | 3130 | 0 | 75.8 | [#307](https://github.com/RodReis/arenahub/pull/307) — 13/13 tarefas |
| 2026-09-10 | #302 | SPEC-066 | integração | 1010 | 1010 | 0 | 83.7 | — **corrigido à mão**, terceira entrega seguida: o gerador avisou que `apps/api#test:integration` terminou com o crash `3221226505` do Windows sem escrever resultado, e manteve o 996. Medido em doze lotes de 6 suítes: **932 em `apps/api` (69 suítes, zero `FAIL`)** + 78 em `@arenahub/database`. **Atenção ao somar por lotes:** o `--testPathPattern` não ancora o início do nome, então `auth` casa também com `kiosk-auth` e `edge-auth` — a soma crua deu 71 suítes / 959, e os 27 testes dessas duas repetidas foram descontados. Os +6 sobre o 926 da SPEC-067 são 4 casos novos em `rls-isolation` (2 do `audit_logs` sem tenant, 2 do `include` que volta nulo) e 3 do MFA que vieram no rebase da [#305](https://github.com/RodReis/arenahub/pull/305), menos 1 de diferença na medição anterior. **Uma falha de tempo limite em `platform-fatura` (`job de emissão`, 5000 ms) é PRÉ-EXISTENTE** — reproduzida na `main` num worktree limpo, sem nenhuma alteração desta entrega, e some com `--testTimeout=30000`. **O CI confirmou o número**: 69 suítes / 932 em `apps/api`, rodando em Linux sem o crash e sem a falha de tempo limite. [#307](https://github.com/RodReis/arenahub/pull/307) |
| 2026-09-11 | #306 | SPEC-066 | unitário | 3132 | 3132 | 0 | 75.6 | — 13/13 tarefas. Os +2 sobre o 3130 são os dois casos novos em `tenant-rls.interceptor.spec.ts` (sessão de Super Admin abre `platform`; elevação expirada não vira `platform` mesmo com `platformContext` presente), ambos provados por canário. |
| 2026-09-11 | #306 | SPEC-066 | integração | 1010 | 1010 | 0 | 83.7 | — **conferido à mão**: o gerador avisou que `apps/api#test:integration` terminou com status 134 (heap estourado no Windows) sem escrever resultado, e manteve o número anterior. **O número é o mesmo, mas agora medido**: **932 em `apps/api` (69 suítes, zero `FAIL`, rodada ÚNICA com `--forceExit`)** + **78 em `@arenahub/database`** (6 arquivos). A rodada única dispensa a soma por lotes, que na entrega anterior precisou descontar suítes contadas duas vezes pelo `--testPathPattern` não ancorado. **A falha de tempo limite em `platform-fatura` some com o banco recriado**: ela aparecia porque o banco local tinha 295 contratos ativos acumulados e o job varre todos, três vezes. **O CI confirmou o numero**: 69 suites / 932 em `apps/api`, rodando em Linux. [#308](https://github.com/RodReis/arenahub/pull/308) |
| 2026-09-11 | #317 | SPEC-068 | unitário | 3185 | 3185 | 0 | 75.4 | — |
| 2026-09-11 | #317 | SPEC-068 | integração | 1022 | 1022 | 0 | 83.7 | [#318](https://github.com/RodReis/arenahub/pull/318) — **corrigido à mão**, quarta entrega seguida: o gerador avisou que `apps/api#test:integration` terminou com o crash `3221226505` do Windows sem escrever resultado, e manteve o 1019 da entrega anterior. Medido em quatro lotes, com as 69 suítes conferidas contra o `ls` para nenhuma ser contada duas vezes nem ficar de fora: 27 (308) + 14 (177) + 13 (237) + 15 (222) = **69 suítes / 944** em `apps/api`, mais **78** em `@arenahub/database`. Zero `FAIL` em todos os lotes. Desta fatia são **3 casos novos** em `kiosk-auth.int-spec.ts` (contrato sem totem recusa; com totem aceita; sem contrato ativo aceita); o resto da diferença para o 1010 da entrega anterior vem de números herdados de rodadas que crasharam antes de escrever resultado, e não de testes escritos aqui |
| 2026-09-11 | #319 | F70 | unitário | 3199 | 3199 | 0 | 75.7 | [#320](https://github.com/RodReis/arenahub/pull/320) — inclui os **4 casos** dos ajustes pedidos pelo PI depois de ver a tela (memória de cálculo do valor apurado, variação corrente do índice, ausência de variação cadastrada e variação negativa), cada um provado por canário |
| 2026-09-11 | #319 | F70 | integração | 1028 | 1028 | 0 | 83.7 | [#320](https://github.com/RodReis/arenahub/pull/320) — **corrigido à mão**, quinta entrega seguida: o gerador avisou que `apps/api#test:integration` terminou com o crash `3221226505` do Windows sem escrever resultado, e manteve o 1019 da entrega anterior. Medido em quatro lotes, com as 69 suítes conferidas contra o `ls` (17+19+17+16) para nenhuma ser contada duas vezes nem ficar de fora: 254 + 208 + 208 + 280 = **950 em `apps/api`**, mais **78** em `@arenahub/database` (6 arquivos). Zero `FAIL` em todos os lotes. Desta fatia são **6 casos novos** em `platform-contrato.int-spec.ts` (3 de qualificação obrigatória para ativar, 3 de upload do PDF assinado); `openapi.int-spec.ts` precisou do snapshot regerado e da rota nova declarada na lista em prosa |
| 2026-09-12 | #82 | — | unitário | 3215 | 3215 | 0 | 75.7 | [#321](https://github.com/RodReis/arenahub/pull/321) — inclui os **12 testes** dos quatro padrões críticos do app; primeira aparição de `apps/mobile` neste relatório (a guarda do self-check pegou a superfície fora de `ALVOS`, e ela entrou) |
| 2026-09-12 | #82 | — | integração | 1028 | 1028 | 0 | 83.7 | [#321](https://github.com/RodReis/arenahub/pull/321) — a fatia **não toca no backend**; o número vem do CI no Linux (950 na API + 78 no database), porque o Jest crasha no Windows com exit 3221226505 **depois** dos testes passarem (defeito pré-existente do ambiente, `docs/TESTING.md` §5) |
| 2026-09-12 | #23 | — | unitário | 3264 | 3264 | 0 | 75.9 | [#322](https://github.com/RodReis/arenahub/pull/322) — inclui os **49 do app** e os **12 das regras puras** de identidade |
| 2026-09-12 | #23 | — | integração | 1068 | 1068 | 0 | 83.7 | [#322](https://github.com/RodReis/arenahub/pull/322) — **corrigido à mão**: o Jest crasha no Windows (exit 3221226505) **depois** dos testes passarem, e o gerador herdava o número da entrega anterior (1028). O valor vem da execução verde do CI no Linux — **990 na API** (72 suítes) + 78 no database. A F23 acrescenta **40 testes de integração** |
| 2026-09-12 | #24 | F24 | unitário | 3276 | 3276 | 0 | 76.0 | — — inclui os **12 testes de tela** das duas superfícies novas do app (plano e frequência); o backend da fatia é coberto por integração, porque o que ela precisa provar (RLS, isolamento por sessão, janela do entitlement) não existe sem banco |
| 2026-09-12 | #24 | F24 | integração | 1079 | 1079 | 0 | 83.7 | [#323](https://github.com/RodReis/arenahub/pull/323) — **corrigido à mão**, mesma razão da F23: o Jest crasha no Windows (exit 3221226505) e o gerador herda o número da entrega anterior (1068). O valor vem da **execução verde do CI no Linux** — **1001 na API** (73 suítes) + **78 no database** (6 arquivos). ⚠️ **A medição local suíte a suíte deu 1049, e estava inflada**: `--testPathPattern` **não ancora o nome**, então o padrão `billing.int-spec` casa também as 8 suítes `billing-*` (e `engagement` casa mais 2), contando-as duas vezes. Conferir o total de suítes contra o `ls` (73 em disco × 74 somadas) é o que denuncia. A F24 acrescenta **11 testes de integração**, dos quais 2 nasceram da revisão adversarial |
