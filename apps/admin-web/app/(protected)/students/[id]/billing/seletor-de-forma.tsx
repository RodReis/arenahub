import { Button } from '@arenahub/ui';

import estilos from './seletor-de-forma.module.css';

/**
 * O seletor de forma de pagamento -- F-painel-financeiro.
 *
 * A CENA REAL: a academia tem maquininha fisica (nao integrada ao sistema),
 * onde a recepcionista recebe dinheiro, PIX, debito ou credito. A tela so
 * pergunta POR ONDE o dinheiro entrou -- os quatro caminhos viram baixa
 * manual da mesma forma (`SensitiveAction` com motivo obrigatorio), e so o
 * canal registrado muda (`receivedVia`, `billing.repository.ts`).
 *
 * NAO EXISTE mais checkout hospedado nem antifraude de provedor aqui -- por
 * isso o bloqueio de CPF/endereco que existia para "Cartao" (regra da
 * Getnet) saiu: maquininha fisica nao passa pelo antifraude de ninguem.
 * Quando a F55 integrar checkout hospedado de verdade, esse caminho volta
 * como opcao SEPARADA, nao substitui este seletor.
 */
export type FormaDePagamento = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';

interface Props {
  readonly onEscolher: (forma: FormaDePagamento) => void;
}

export function SeletorDeForma({ onEscolher }: Props) {
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
        <Button type="button" data-testid="forma-debito" onClick={() => onEscolher('DEBITO')}>
          Débito
        </Button>
        <Button type="button" data-testid="forma-credito" onClick={() => onEscolher('CREDITO')}>
          Crédito
        </Button>
      </div>
    </fieldset>
  );
}
