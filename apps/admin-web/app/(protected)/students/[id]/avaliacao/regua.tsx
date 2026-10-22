import type { Regua as ReguaDaTabela } from '../../../../../src/health/indicadores';
import estilos from './regua.module.css';

interface Props {
  readonly regua: ReguaDaTabela;
  readonly valor: number | null;
  /** Como o número se escreve na tela ("24,7"), para os marcos e o rótulo acessível. */
  readonly formatar: (valor: number) => string;
}

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

/**
 * A tabela de referência desenhada como régua — a assinatura da ficha (F91).
 *
 * Cada faixa da tabela vira um segmento no tom da própria leitura; o valor do
 * aluno pousa nela. A faixa onde ele está acende, as outras recuam. Ler a
 * tabela deixa de ser procurar a linha: o aluno VÊ onde está e quanto falta
 * para a próxima faixa.
 *
 * O marcador anda por `transform` (DS: só propriedade de compositor), e o
 * rótulo acessível diz em texto a faixa e o valor — cor nunca é canal único.
 */
export function Regua({ regua, valor, formatar }: Props) {
  const { faixas, min, max, categorica = false } = regua;
  const extensao = max - min;
  const teto = (ate: number | null): number => (ate === null ? max : limitar(ate, min, max));

  const segmentos = faixas.map((faixa, i) => {
    const anterior = i === 0 ? null : (faixas[i - 1]?.ate ?? null);
    const de = anterior === null ? min : teto(anterior);
    const ate = teto(faixa.ate);
    // Mesma regra do `classificar`: abaixo do teto e no ou acima do teto anterior.
    const ativo =
      valor !== null &&
      (anterior === null || valor >= anterior) &&
      (faixa.ate === null || valor < faixa.ate);

    return { faixa, de, ate, ativo };
  });

  const marcos = categorica ? [] : segmentos.slice(0, -1).map((s) => s.ate);
  const posicao = valor === null ? null : ((limitar(valor, min, max) - min) / extensao) * 100;
  const descricao = segmentos
    .map(({ faixa, de, ate }, i) => {
      if (categorica) return faixa.leitura.classe;
      if (i === 0) return `${faixa.leitura.classe}: abaixo de ${formatar(ate)}`;
      // Marco que a tela arredonda (PAM: 100,4 lido "100") é limite exclusivo: "acima de".
      if (faixa.ate === null) {
        const exibido = Number(formatar(de).replace(/\./g, '').replace(',', '.'));

        return `${faixa.leitura.classe}: ${exibido === de ? 'a partir de' : 'acima de'} ${formatar(de)}`;
      }

      return `${faixa.leitura.classe}: de ${formatar(de)} a ${formatar(ate)}`;
    })
    .join('; ');

  return (
    <div className={estilos['regua']} data-preenchida={valor !== null ? 'true' : undefined}>
      <div className={estilos['trilho']} role="img" aria-label={`Faixas da tabela — ${descricao}`}>
        {segmentos.map(({ faixa, de, ate, ativo }) => (
          <span
            key={`${de}-${faixa.leitura.classe}`}
            className={estilos['segmento']}
            data-tom={faixa.leitura.tom}
            data-ativo={ativo ? 'true' : undefined}
            // Em % da extensão: com `flex-grow` somando menos que 1 (RCE vai de
            // 0,3 a 0,7), os segmentos ocupariam só essa fração do trilho.
            style={{ flexGrow: ((ate - de) / extensao) * 100 }}
          />
        ))}
        {posicao !== null ? (
          <span
            className={estilos['pista']}
            style={{ transform: `translateX(${posicao}%)` }}
            aria-hidden="true"
          >
            <span className={estilos['marcador']} />
          </span>
        ) : null}
      </div>
      <div className={estilos['marcos']} aria-hidden="true">
        {marcos.map((marco) => (
          <span
            key={marco}
            className={estilos['marco']}
            style={{ insetInlineStart: `${((marco - min) / extensao) * 100}%` }}
          >
            {formatar(marco)}
          </span>
        ))}
      </div>
    </div>
  );
}
