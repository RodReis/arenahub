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
| unitário | 2868 | 2868 | 0 | 75.7 |
| contrato | 0 | 0 | 0 | — |
| integração | 810 | 810 | 0 | 83.9 |
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
| 2026-09-01 | #241 | — | unitário | 2868 | 2868 | 0 | 75.7 | — |
| 2026-09-01 | #241 | — | integração | 810 | 810 | 0 | 83.9 | — medido suíte a suíte (o Jest crasha no fim no Windows) |
