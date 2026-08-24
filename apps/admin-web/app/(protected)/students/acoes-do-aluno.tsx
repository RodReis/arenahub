import { FcBiotech, FcEditImage, FcKey, FcMoneyTransfer, FcUnlock } from 'react-icons/fc';

import { Button } from '@arenahub/ui';

import estilos from './students.module.css';

/**
 * As quatro ações de linha, como ícones.
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
 * 24/08/2026, substituindo os quatro glifos de traço que viviam neste
 * arquivo. `aria-hidden` neles porque o nome acessível já está no botão --
 * sem isso o leitor de tela lê duas vezes.
 */

const TAMANHO = 22;

interface Props {
  readonly studentId: string;
  /** Para montar a query do override manual, que mostra o nome na tela. */
  readonly nomeDoAluno: string;
  /** A liberação FINANCEIRA só existe para quem está bloqueado. */
  readonly podeLiberar: boolean;
  /** O botão de liberação — ação de formulário, montada por quem chama. */
  readonly liberacao?: React.ReactNode;
  /**
   * `true` quando o aluno NÃO tem direito de acesso vigente.
   *
   * É o caso em que a recepção precisa abrir a catraca na mão -- e o único
   * em que faz sentido oferecer o override. Para quem já entra, o atalho
   * seria um convite a abrir a catraca sem motivo.
   */
  readonly semAcessoVigente: boolean;
}

export function AcoesDoAluno({
  studentId,
  nomeDoAluno,
  podeLiberar,
  liberacao,
  semAcessoVigente,
}: Props) {
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
        LIBERAR A CATRACA MANUALMENTE -- o override da F9, que ABRE a catraca
        fisicamente. Saiu da ficha do aluno (decisão do PI, 24/08/2026) e
        virou ícone de linha: a recepção decide isso olhando a LISTA, com a
        pessoa parada na porta, não depois de abrir o cadastro.

        Não confundir com o cadeado ao lado: aquele é liberação FINANCEIRA,
        que dá prazo sem abrir nada. Chave e cadeado são desenhos diferentes
        de propósito.

        Só para quem NÃO tem acesso vigente -- para quem já entra, o atalho
        seria convite a abrir a catraca sem motivo.
      */}
      {semAcessoVigente ? (
        <Button
          variant="icon"
          href={`/access/override?aluno=${studentId}&nome=${encodeURIComponent(nomeDoAluno)}`}
          aria-label="Liberar a catraca manualmente"
          title="Liberar a catraca manualmente"
          data-testid={`acao-liberacao-manual-${studentId}`}
        >
          <FcKey size={TAMANHO} aria-hidden />
        </Button>
      ) : null}

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
