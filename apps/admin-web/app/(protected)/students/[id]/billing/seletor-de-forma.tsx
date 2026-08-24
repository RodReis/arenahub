import Link from 'next/link';

import { Button } from '@arenahub/ui';

import estilos from './seletor-de-forma.module.css';

/**
 * O seletor de forma de pagamento -- F53, Task 10.
 *
 * A CENA REAL: a recepcionista tem uma pessoa no balcao querendo pagar a
 * mensalidade. A tela pergunta a FORMA antes do valor -- cada forma segue um
 * caminho diferente depois (dinheiro entra no fluxo que ja existe; PIX e
 * cartao chamam as server actions da Task 11).
 *
 * `DadoFaltante` e `faltandoParaCartao`: `reimplementar nao`. A regra de
 * quem pode pagar com cartao vive em
 * `apps/api/src/modules/billing/domain/dados-de-cobranca.ts` (`faltaParaCartao`)
 * -- e o CASO DE USO que bloqueia de verdade (422
 * `STUDENT_BILLING_DATA_INCOMPLETE`). Esta tela so RECEBE o que falta, ja
 * calculado a partir do cadastro que `page.tsx` busca no servidor, e decide
 * apenas como mostrar -- nunca se algo falta.
 */
export type DadoFaltante = 'CPF' | 'ENDERECO';

export type FormaDePagamento = 'DINHEIRO' | 'PIX' | 'CARTAO';

interface Props {
  readonly faltandoParaCartao: readonly DadoFaltante[];
  readonly onEscolher: (forma: FormaDePagamento) => void;
  /** Para o link "Complete o cadastro" -- so usado quando falta algo. */
  readonly studentId?: string;
}

/**
 * A frase e literal da spec SPEC-053 §9.1 -- nao parafrasear: e o texto que a
 * recepcao le em voz alta para o aluno.
 */
const MOTIVO_CPF =
  'Este aluno ainda não tem CPF no cadastro. Complete o cadastro para pagar com cartão, ou receba em espécie ou PIX.';
const MOTIVO_ENDERECO =
  'Este aluno ainda não tem endereço no cadastro. Complete o cadastro para pagar com cartão, ou receba em espécie ou PIX.';

function motivoDoCartao(faltando: readonly DadoFaltante[]): string | null {
  // CPF vem primeiro porque e o caso mais comum (base do Pacto: 308 alunos
  // sem CPF, ADR-034) -- endereco faltando sozinho e raro.
  if (faltando.includes('CPF')) return MOTIVO_CPF;
  if (faltando.includes('ENDERECO')) return MOTIVO_ENDERECO;
  return null;
}

export function SeletorDeForma({ faltandoParaCartao, onEscolher, studentId }: Props) {
  const motivo = motivoDoCartao(faltandoParaCartao);

  return (
    <fieldset className={estilos['seletor']}>
      <legend className={estilos['legenda']}>Forma de pagamento</legend>

      <div className={estilos['opcoes']}>
        <Button
          type="button"
          data-testid="forma-dinheiro"
          onClick={() => onEscolher('DINHEIRO')}
        >
          Dinheiro
        </Button>
        <Button type="button" data-testid="forma-pix" onClick={() => onEscolher('PIX')}>
          PIX
        </Button>
        <Button
          type="button"
          data-testid="forma-cartao"
          disabled={motivo !== null}
          onClick={() => onEscolher('CARTAO')}
        >
          Cartão
        </Button>
      </div>

      {/*
        NUNCA SOME. A opcao fica visivel e desabilitada, com o motivo ao
        lado -- sumir faria a recepcao procurar o que nao esta la, sem como
        adivinhar que o conserto e completar o cadastro.
      */}
      {motivo ? (
        <p className={estilos['motivo']} data-testid="motivo-cartao-indisponivel">
          {motivo}
          {studentId ? (
            <>
              {' '}
              <Link href={`/students/${studentId}`}>Completar cadastro</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </fieldset>
  );
}
