/**
 * Funcoes puras do gerador de `reports/TESTS.md` -- sem I/O de processo
 * (nunca chama `spawnSync`), so string/Map em memoria. Separado de
 * `test-report.mjs` para o self-check testar a LOGICA (agregacao,
 * formatacao, deteccao de divergencia) sem precisar rodar Jest/Vitest de
 * verdade a cada caso -- rodar 8 pacotes por caso de teste levaria minutos
 * e tornaria o self-check ele mesmo flaky com o crash do Windows.
 */

/**
 * Niveis do TESTING.md §1, na ordem em que aparecem la.
 */
export const NIVEIS = ['unitário', 'contrato', 'integração', 'e2e', 'hardware', 'segurança'];

export function formatarPct(valor) {
  return valor === null || valor === undefined ? '—' : valor.toFixed(1);
}

export function linhaDeNivel(nome, dados) {
  if (!dados) return `| ${nome} | 0 | 0 | 0 | — |`;

  const cobertura = dados.coberturaPeso > 0 ? dados.coberturaPtsSoma / dados.coberturaPeso : null;
  return `| ${nome} | ${dados.testes} | ${dados.pass} | ${dados.falha} | ${formatarPct(cobertura)} |`;
}

/**
 * Acumula um resultado de ALVO (testes/pass/falha/coberturaPct) num Map por
 * nivel. Muta e devolve o Map -- uso em `reduce`-like ao longo dos ALVOS.
 */
export function acumularNoNivel(porNivel, nivel, resultado) {
  const acumulado = porNivel.get(nivel) ?? { testes: 0, pass: 0, falha: 0, coberturaPtsSoma: 0, coberturaPeso: 0 };
  acumulado.testes += resultado.testes;
  acumulado.pass += resultado.pass;
  acumulado.falha += resultado.falha;
  if (resultado.coberturaPct !== null && resultado.coberturaPct !== undefined) {
    acumulado.coberturaPtsSoma += resultado.coberturaPct * Math.max(resultado.testes, 1);
    acumulado.coberturaPeso += Math.max(resultado.testes, 1);
  }
  porNivel.set(nivel, acumulado);
  return porNivel;
}

/** Extrai as linhas de tabela do histórico já commitado, para preservar ao anexar. */
export function historicoExistente(conteudoCommitado) {
  if (!conteudoCommitado) return [];

  const marcador = '## Histórico por entrega';
  const inicio = conteudoCommitado.indexOf(marcador);
  if (inicio === -1) return [];

  const bloco = conteudoCommitado.slice(inicio);
  return bloco
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.includes('Data | Issue'));
}

/**
 * Monta o conteudo completo de `reports/TESTS.md`.
 *
 * `porNivel`: Map nivel -> {testes,pass,falha,coberturaPtsSoma,coberturaPeso}.
 * `entrega`: {issue,spec,pr,data} ou null -- quando presente, ANEXA uma
 * linha por nivel com testes>0 ao histórico (append-only, nunca reescreve
 * linha anterior).
 * `conteudoAnterior`: texto do TESTS.md ja commitado, para extrair o
 * historico existente e preserva-lo.
 */
export function gerar({ porNivel, entrega, conteudoAnterior }) {
  const linhas = [
    '# TESTS.md — relatório de evidência',
    '',
    '> **Gerado por `pnpm test:report`. Não edite à mão.**',
    '>',
    '> O CI roda `pnpm test:report --check` e falha se a seção "Estado atual" divergir do que a',
    '> execução produz. É a guarda de evidência do `docs/TESTING.md` §5.',
    '>',
    '> **O `--check` valida só os números.** Issue/SPEC/PR do histórico vêm de fora do',
    '> repositório e são responsabilidade de quem roda `pnpm test:report --issue N` antes do',
    '> commit — revisão humana no PR é a rede de segurança para esse dado, não o CI.',
    '',
    '## Estado atual',
    '',
    'Última execução — regenerado a cada `pnpm test:report`, não acumulado.',
    '',
    '| nível | testes | pass | falha | cobertura % |',
    '|---|---:|---:|---:|---:|',
    ...NIVEIS.map((nome) => linhaDeNivel(nome, porNivel.get(nome))),
    '',
    '## Histórico por entrega',
    '',
    'Append-only — linhas de entregas passadas são imutáveis.',
    '',
    '| Data | Issue | SPEC | Nível | testes | pass | falha | cobertura % | PR |',
    '|---|---|---|---|---:|---:|---:|---:|---|',
    ...historicoExistente(conteudoAnterior),
  ];

  if (entrega) {
    for (const nome of NIVEIS) {
      const dados = porNivel.get(nome);
      if (!dados || dados.testes === 0) continue;
      const cobertura = dados.coberturaPeso > 0 ? dados.coberturaPtsSoma / dados.coberturaPeso : null;
      linhas.push(
        `| ${entrega.data} | #${entrega.issue} | ${entrega.spec ?? '—'} | ${nome} | ${dados.testes} | ${dados.pass} | ${dados.falha} | ${formatarPct(cobertura)} | ${entrega.pr ? `#${entrega.pr}` : '—'} |`,
      );
    }
  }

  linhas.push('');

  return linhas.join('\n');
}

/** Recorta só a seção "Estado atual" (antes do histórico) para comparação. */
export function secaoEstadoAtual(conteudo) {
  return conteudo.split('## Histórico por entrega')[0].trim();
}
