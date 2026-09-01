import { FcBiotech, FcEditImage, FcMoneyTransfer, FcUnlock } from 'react-icons/fc';

import { Button } from '@arenahub/ui';

import estilos from './students.module.css';

/**
 * As três ações de linha, como ícones.
 *
 * ---------------------------------------------------------------------------
 * ÍCONE SOZINHO EXIGE RÓTULO ACESSÍVEL — NÃO É OPCIONAL AQUI.
 * ---------------------------------------------------------------------------
 *
 * Ícone sem texto não tem nome acessível, então cada botão carrega:
 *
 *   - `aria-label` — o leitor de tela anuncia a ação por extenso;
 *   - `title` — o navegador mostra o nome no hover, para quem vê o desenho e
 *     não o reconhece;
 *   - alvo de 32px — o mínimo que a mão acerta no balcão, e o piso do WCAG
 *     2.2 §2.5.8 (24px) com folga.
 *
 * Os desenhos vêm do `react-icons/fc` (Flat Color) por decisão do PI em
 * 24/08/2026, substituindo os glifos de traço que viviam neste arquivo.
 * `aria-hidden` neles porque o nome acessível já está no botão -- sem isso o
 * leitor de tela lê duas vezes.
 */

const TAMANHO = 22;

interface Props {
  readonly studentId: string;
  /** A liberação FINANCEIRA só existe para quem está bloqueado. */
  readonly podeLiberar: boolean;
  /** O botão de liberação — ação de formulário, montada por quem chama. */
  readonly liberacao?: React.ReactNode;
}

export function AcoesDoAluno({ studentId, podeLiberar, liberacao }: Props) {
  return (
    <div className={estilos['acoes']}>
      <Button
        variant="icon"
        href={`/students/${studentId}`}
        aria-label="Editar cadastro"
        title="Editar cadastro"
        data-testid={`acao-editar-${studentId}`}
      >
        <FcEditImage size={TAMANHO} aria-hidden />
      </Button>

      <Button
        variant="icon"
        href={`/students/${studentId}/health`}
        aria-label="Bioimpedância e evolução corporal"
        title="Bioimpedância"
        data-testid={`acao-bioimpedancia-${studentId}`}
      >
        <FcBiotech size={TAMANHO} aria-hidden />
      </Button>

      <Button
        variant="icon"
        href={`/students/${studentId}/billing`}
        aria-label="Cobrança do aluno"
        title="Cobrança"
        data-testid={`acao-pagamento-${studentId}`}
      >
        <FcMoneyTransfer size={TAMANHO} aria-hidden />
      </Button>

      {/*
        A liberação FINANCEIRA não vira ícone fantasma quando não se aplica:
        um botão desabilitado ali sugeriria que a recepção pode liberar
        qualquer aluno, e ela só pode liberar quem o job de inadimplência
        bloqueou (M2-BR-007). Ausência é a informação certa.
      */}
      {podeLiberar ? (
        <span className={estilos['acaoDeFormulario']} title="Liberar catraca">
          {liberacao}
        </span>
      ) : null}
    </div>
  );
}

/** Cadeado aberto — liberar catraca. Usado por `BotaoDeLiberacao`. */
export function IconeCatraca() {
  return <FcUnlock size={TAMANHO} aria-hidden />;
}

/*
 * A ficha do aluno reusa estes dois nas portas de navegação ("Financeiro e
 * cobranças", "Evolução corporal") -- o mesmo destino desenhado de dois
 * jeitos ensinaria que são destinos diferentes.
 */
export function IconePagamento() {
  return <FcMoneyTransfer size={TAMANHO} aria-hidden />;
}

export function IconeBioimpedancia() {
  return <FcBiotech size={TAMANHO} aria-hidden />;
}
