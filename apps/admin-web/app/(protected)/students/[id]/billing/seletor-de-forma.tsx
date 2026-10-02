import { Button, Icon, type IconName } from '@arenahub/ui';

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

/**
 * Um glifo por canal. Ate aqui os quatro botoes eram retangulos IDENTICOS
 * distinguidos so pela palavra -- e a escolha e a acao mais repetida do
 * balcao, feita de relance com a pessoa esperando. O icone da o alvo; o
 * rotulo continua sendo quem informa (cor e forma nunca sao canal unico).
 *
 * Debito e credito compartilham o cartao de proposito: e o mesmo objeto
 * fisico na mao de quem paga, e inventar dois desenhos diferentes para o
 * mesmo plastico ensinaria uma distincao que nao existe no balcao.
 */
/* `canal` aponta para `--ah-channel-*` (DS-PAINEL §2.3b): a mesma cor
 * identifica o canal aqui e na coluna Recebimento da grid. */
export const FORMAS: readonly {
  readonly forma: FormaDePagamento;
  readonly rotulo: string;
  readonly icone: IconName;
  readonly testId: string;
  readonly canal: 'cash' | 'pix' | 'debit' | 'credit';
}[] = [
  { forma: 'DINHEIRO', rotulo: 'Dinheiro', icone: 'banknote', testId: 'forma-dinheiro', canal: 'cash' },
  { forma: 'PIX', rotulo: 'PIX', icone: 'qr-code', testId: 'forma-pix', canal: 'pix' },
  { forma: 'DEBITO', rotulo: 'Débito', icone: 'credit-card', testId: 'forma-debito', canal: 'debit' },
  { forma: 'CREDITO', rotulo: 'Crédito', icone: 'credit-card', testId: 'forma-credito', canal: 'credit' },
];

interface Props {
  readonly onEscolher: (forma: FormaDePagamento) => void;
  /** A forma ja escolhida, quando o recebimento esta em curso. */
  readonly escolhida?: FormaDePagamento | null;
}

export function SeletorDeForma({ onEscolher, escolhida = null }: Props) {
  return (
    <fieldset className={estilos['seletor']}>
      <legend className={estilos['legenda']}>Forma de pagamento</legend>

      <div className={estilos['opcoes']}>
        {FORMAS.map(({ forma, rotulo, icone, testId, canal }) => {
          const estaEscolhida = escolhida === forma;

          return (
            <Button
              key={forma}
              /*
               * `outline` e nao `solid`: o unico primario da tela e "Gerar
               * cobranca do mes" (DS-PAINEL §4.8, um primario por tela). Quatro
               * botoes cheios lado a lado faziam a tela gritar quatro vezes e
               * nao apontar para nada.
               */
              variant="outline"
              type="button"
              data-testid={testId}
              /*
               * TRES CANAIS para a escolha, nao so o fundo cinza do hover que
               * sobrava antes: `aria-pressed` diz ao leitor de tela, o
               * `data-escolhida` pinta a borda e o fundo no accent, e o rotulo
               * continua ali. Escolher o canal decide o que vai para a
               * auditoria -- merece ler como estado, nao como resquicio de
               * ponteiro.
               */
              aria-pressed={estaEscolhida}
              data-escolhida={estaEscolhida ? 'true' : undefined}
              data-canal={canal}
              onClick={() => onEscolher(forma)}
            >
              <Icon name={icone} />
              {rotulo}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
