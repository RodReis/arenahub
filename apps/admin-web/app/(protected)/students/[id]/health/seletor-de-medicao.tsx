import Link from 'next/link';

import { TenantDateTime } from '@arenahub/ui';

import estilos from './health.module.css';

/**
 * O seletor de medição -- qual avaliação a tela está mostrando.
 *
 * ---------------------------------------------------------------------------
 * A MEDIÇÃO VIVE NA URL, COMO O PERÍODO DO HISTÓRICO.
 * ---------------------------------------------------------------------------
 *
 * Mesma decisão do `FiltroDePeriodo` ao lado, pelas mesmas três razões: a
 * página continua Server Component (nada para hidratar), o link é
 * compartilhável ("olha a avaliação de agosto dele") e o botão voltar do
 * navegador faz o que a recepção espera. São links de verdade -- navegação
 * por teclado e leitor de tela vêm de graça do `<a>`.
 *
 * `aria-current="page"` e não `role="tab"`: é navegação entre views, não um
 * widget de abas. Anunciar `tablist` prometeria ao leitor de tela um
 * comportamento de setas que estes links não têm.
 */

export interface MedicaoDisponivel {
  readonly sessionId: string;
  readonly assessedAt: string;
}

interface Props {
  readonly studentId: string;
  readonly medicoes: readonly MedicaoDisponivel[];
  /** A que está sendo exibida -- `null` quando o aluno não tem nenhuma. */
  readonly atual: string | null;
  readonly timeZone: string;
}

export function SeletorDeMedicao({ studentId, medicoes, atual, timeZone }: Props) {
  // Uma medição só não é escolha: o seletor viraria um botão único que não
  // leva a lugar nenhum. A data continua visível no cabeçalho da avaliação.
  if (medicoes.length < 2) return null;

  return (
    <nav className={estilos['seletorDeMedicao']} aria-label="Medições do aluno">
      <p className={estilos['rotuloDoSeletor']} id="rotulo-medicoes">
        Medição
      </p>

      <ul aria-labelledby="rotulo-medicoes">
        {medicoes.map((medicao) => (
          <li key={medicao.sessionId}>
            <Link
              href={`/students/${studentId}/health?medicao=${medicao.sessionId}`}
              aria-current={medicao.sessionId === atual ? 'page' : undefined}
              data-testid={`medicao-${medicao.sessionId}`}
              scroll={false}
            >
              <TenantDateTime iso={medicao.assessedAt} timeZone={timeZone} format="date" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
