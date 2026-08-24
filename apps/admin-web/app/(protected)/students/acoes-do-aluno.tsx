import { Button } from '@arenahub/ui';

import estilos from './students.module.css';

/**
 * As quatro ações de linha, como ícones.
 *
 * ---------------------------------------------------------------------------
 * ÍCONE SOZINHO EXIGE RÓTULO ACESSÍVEL — NÃO É OPCIONAL AQUI.
 * ---------------------------------------------------------------------------
 *
 * O `PRODUCT.md` proíbe cor (e forma) como canal único. Um ícone sem texto é
 * exatamente isso, então cada botão carrega:
 *
 *   - `aria-label` — o leitor de tela anuncia a ação por extenso;
 *   - `title` — o navegador mostra o nome no hover, para quem vê o desenho e
 *     não o reconhece;
 *   - alvo de 32px — o mínimo que a mão acerta no balcão, e o piso do WCAG
 *     2.2 §2.5.8 (24px) com folga.
 *
 * O `<title>` do SVG fica FORA de propósito: com `aria-hidden` no ícone e o
 * rótulo no botão, o leitor de tela anuncia uma coisa só. Sem isso ele lê o
 * nome duas vezes.
 *
 * Os desenhos são inline e não uma biblioteca de ícones: são quatro glifos
 * de traço simples, e uma dependência para isso custaria mais bytes que o
 * markup inteiro desta tabela.
 */

/**
 * Glifo de 20px com traço 1.8 dentro do alvo de 32px.
 *
 * O ALVO NÃO MUDA, e isso é o ponto: o `Icon` do design system é 32px por
 * decisão registrada (DS-PAINEL §6) -- três controles de 36px empilham a
 * linha de 40px, e ali densidade é a funcionalidade, não o enfeite. O que
 * estava fraco era o DESENHO, não a área de clique: 18px de glifo com traço
 * 1.6 some sob a luz fluorescente do balcão, que é a cena real desta tela.
 *
 * 20px é o teto: acima disso o glifo encosta na borda do alvo de 32px e o
 * hover, que pinta a superfície inteira, fica sem respiro em volta do
 * desenho.
 */
const TRACO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Lápis — editar cadastro. */
function IconeEditar() {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true" {...TRACO}>
      <path d="M4 16h3l8-8-3-3-8 8v3Z" />
      <path d="M12.5 4.5l3 3" />
    </svg>
  );
}

/** Silhueta com marcação — avaliação corporal. */
function IconeBioimpedancia() {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true" {...TRACO}>
      <circle cx="10" cy="4" r="2" />
      <path d="M6 9h8M10 7v9M7 16l1-4M13 16l-1-4" />
    </svg>
  );
}

/** Braço de catraca girando — liberar acesso. */
function IconeCatraca() {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true" {...TRACO}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 7.5V3M12.5 10H17M10 12.5V17M7.5 10H3" />
    </svg>
  );
}

/** Cédula — cobrança. */
function IconePagamento() {
  return (
    <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true" {...TRACO}>
      <rect x="2.5" y="5.5" width="15" height="9" rx="1.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

interface Props {
  readonly studentId: string;
  /** A liberação de catraca só existe para quem está bloqueado. */
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
        <IconeEditar />
      </Button>

      <Button
        variant="icon"
        href={`/students/${studentId}/health`}
        aria-label="Bioimpedância e evolução corporal"
        title="Bioimpedância"
        data-testid={`acao-bioimpedancia-${studentId}`}
      >
        <IconeBioimpedancia />
      </Button>

      <Button
        variant="icon"
        href={`/students/${studentId}/billing`}
        aria-label="Cobrança do aluno"
        title="Cobrança"
        data-testid={`acao-pagamento-${studentId}`}
      >
        <IconePagamento />
      </Button>

      {/*
        A liberação NÃO vira ícone fantasma quando não se aplica: um botão
        desabilitado ali sugeriria que a recepção pode liberar qualquer
        aluno, e ela só pode liberar quem o job de inadimplência bloqueou
        (M2-BR-007). Ausência é a informação certa.
      */}
      {podeLiberar ? (
        <span className={estilos['acaoDeFormulario']} title="Liberar catraca">
          {liberacao}
        </span>
      ) : null}
    </div>
  );
}

/*
 * A ficha do aluno reusa DOIS destes desenhos nas portas de navegação
 * ("Financeiro e cobranças", "Evolução corporal"). Reuso e não cópia: o
 * mesmo destino desenhado de dois jeitos ensina a recepção que são coisas
 * diferentes -- e na primeira correção de traço um dos dois ficaria para
 * trás.
 */
export { IconeCatraca, IconePagamento, IconeBioimpedancia };
