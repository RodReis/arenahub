import { StateBadge } from '@arenahub/ui';

import { confiancaLegivel } from '../../../../../../../src/health/formatar';
import estilos from './sessao.module.css';
import type { CartaoDeArquivo } from './sessao';

/**
 * Três cartões de arquivo -- um por arquivo enviado (mock do PI).
 *
 * O mock pede subtítulo do tipo de laudo ("Bioimpedância · balança",
 * "Frequência cardíaca · ECG"), tamanho e data do arquivo -- SÓ o tipo de
 * laudo (`tipoDeLaudo`) vem do `GET .../sessions/:id`; tamanho em bytes e
 * data de upload existem no banco (`AssessmentImport.fileSizeBytes`,
 * `createdAt`) mas o DTO da sessão (`import.controller.ts`) não os expõe --
 * só `importId`, `sourceLabel`, `tipoDeLaudo` e `atributos`. Mostrar aqui um
 * tamanho ou data inventados violaria a regra de não fabricar dado; o
 * cartão usa só o que a API garante.
 */

const SUBTITULO_DO_TIPO: Record<string, string> = {
  BIOIMPEDANCE: 'Bioimpedância',
  ECG: 'Frequência cardíaca · ECG',
};

function subtituloDoTipo(tipoDeLaudo: string): string {
  return SUBTITULO_DO_TIPO[tipoDeLaudo] ?? tipoDeLaudo;
}

export function CartoesDeArquivo({ cartoes }: { readonly cartoes: readonly CartaoDeArquivo[] }) {
  if (cartoes.length === 0) return null;

  return (
    <ul className={estilos['arquivos']}>
      {cartoes.map((cartao) => {
        const confianca = confiancaLegivel(cartao.confidenceMedia);

        return (
          <li key={cartao.importId} className={estilos['arquivo']} data-testid={`arquivo-${cartao.importId}`}>
            <p className={estilos['nomeDoArquivo']}>{cartao.sourceLabel}</p>
            <p className={estilos['subtituloDoArquivo']}>{subtituloDoTipo(cartao.tipoDeLaudo)}</p>
            <StateBadge machine="fileReviewState" state={cartao.estado} />
            <p className={estilos['contagemDoArquivo']}>
              {cartao.totalDeCampos} {cartao.totalDeCampos === 1 ? 'campo' : 'campos'}
              {confianca !== null ? ` · confiança ${confianca}` : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
