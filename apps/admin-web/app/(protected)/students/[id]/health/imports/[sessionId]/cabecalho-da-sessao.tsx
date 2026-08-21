import { valorLegivel } from '../../../../../../../src/health/formatar';
import estilos from './sessao.module.css';

/**
 * Cabeçalho da revisão -- mock do PI: nome · idade · altura, matrícula.
 *
 * O mock também pede "data e hora da avaliação" no cabeçalho, mas ANTES da
 * confirmação não existe avaliação nenhuma -- `assessedAt` é o campo que o
 * avaliador ainda vai preencher no formulário de baixo (`revisao-de-campos`).
 * Mostrar aqui um "agora" fixo passaria a impressão de uma data já decidida;
 * a data real da avaliação é a que o formulário confirma, não uma que o
 * cabeçalho inventa antes da hora.
 *
 * Idade é calculada aqui (função pura, sem `new Date()` implícito: o "agora"
 * entra por parâmetro -- `CLAUDE.md`); altura vem da métrica `HEIGHT` mais
 * recente do `body-evolution`, porque a sessão em revisão pode não conter
 * bioimpedância com estatura nenhuma.
 */

export interface DadosDoCabecalho {
  readonly fullName: string;
  readonly birthDate: string;
  readonly membershipNumber: string;
  readonly alturaCm: number | null;
}

interface Props {
  readonly dados: DadosDoCabecalho;
  readonly agora: Date;
}

/** Idade em anos completos, a partir de `AAAA-MM-DD`. Função pura -- `agora` entra por parâmetro. */
export function idadeEmAnos(birthDate: string, agora: Date): number | null {
  const nascimento = new Date(`${birthDate}T00:00:00Z`);

  if (!Number.isFinite(nascimento.getTime())) return null;

  let idade = agora.getUTCFullYear() - nascimento.getUTCFullYear();
  const aniversarioJaPassou =
    agora.getUTCMonth() > nascimento.getUTCMonth() ||
    (agora.getUTCMonth() === nascimento.getUTCMonth() && agora.getUTCDate() >= nascimento.getUTCDate());

  if (!aniversarioJaPassou) idade -= 1;

  return idade;
}

export function CabecalhoDaSessao({ dados, agora }: Props) {
  const idade = idadeEmAnos(dados.birthDate, agora);

  return (
    <div className={estilos['cabecalho']}>
      <p className={estilos['nomeDoAluno']} data-testid="nome-do-aluno">
        {dados.fullName}
        {idade !== null ? ` · ${idade} anos` : null}
        {dados.alturaCm !== null ? ` · ${valorLegivel(dados.alturaCm, 'cm')}` : null}
      </p>
      <p className={estilos['matricula']} data-testid="matricula-do-aluno">
        Matrícula {dados.membershipNumber}
      </p>
    </div>
  );
}
