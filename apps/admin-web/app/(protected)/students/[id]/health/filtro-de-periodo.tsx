import estilos from './health.module.css';

interface Props {
  studentId: string;
  periodoAtual: string;
  periodos: readonly { valor: string; rotulo: string }[];
}

/**
 * Filtro de período do histórico (`M3-FR-008`).
 *
 * **Links, não `<select>` nem estado de cliente.** São cinco opções fixas que
 * trocam o conteúdo inteiro da página — exatamente o que um link faz. Isso
 * mantém a página inteira como Server Component: sem hidratação, sem
 * `useState`, e o botão voltar do navegador funciona de graça.
 *
 * A URL continua sendo a fonte da verdade, como no filtro da lista de alunos:
 * o avaliador pode mandar o link "últimos 6 meses deste aluno" para outro
 * profissional e ele abre a mesma tela.
 *
 * `aria-current="page"` marca o período ativo para quem usa leitor de tela —
 * sem ele, os cinco links soariam idênticos e a pessoa não saberia qual está
 * vendo.
 */
export function FiltroDePeriodo({ studentId, periodoAtual, periodos }: Props) {
  return (
    <nav aria-label="Período do histórico" className={estilos['filtro']}>
      <ul>
        {periodos.map((periodo) => {
          const ativo = periodo.valor === periodoAtual;

          return (
            <li key={periodo.valor}>
              <a
                href={`/students/${studentId}/health?period=${periodo.valor}`}
                aria-current={ativo ? 'page' : undefined}
                data-testid={`periodo-${periodo.valor}`}
              >
                {periodo.rotulo}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
