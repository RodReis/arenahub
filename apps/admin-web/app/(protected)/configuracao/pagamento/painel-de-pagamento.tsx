'use client';

import { useActionState, useEffect, useState, type ChangeEvent } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToast, useToastDeErro } from '@arenahub/ui';

import {
  salvarConfiguracaoDePagamento,
  type ConfiguracaoDePagamento,
  type EstadoDaConfiguracaoDePagamento,
} from '../../../actions/configuracao-de-pagamento';
import { exemploDoCiclo } from '../../../../src/billing/exemplo-do-ciclo';
import estilos from './painel-de-pagamento.module.css';

const ESTADO_INICIAL: EstadoDaConfiguracaoDePagamento = {};

/** Espelham os limites da API; ela continua sendo a autoridade. */
const DIA_MAXIMO = 28;
const BLOQUEIO_MAXIMO = 30;

type Campo = keyof ConfiguracaoDePagamento;
type Valores = Readonly<Record<Campo, string>>;

interface Problema {
  readonly campo: Campo;
  readonly mensagem: string;
}

type Conferencia =
  | { readonly problema: Problema }
  | { readonly config: ConfiguracaoDePagamento };

function inteiroDe(texto: string): number | null {
  if (texto.trim() === '') return null;
  const numero = Number(texto);

  return Number.isInteger(numero) ? numero : null;
}

/** O primeiro problema dos valores digitados; sem problema, os três números. */
function conferir(valores: Valores): Conferencia {
  const gerar = inteiroDe(valores.invoiceGenerationDay);
  const vencer = inteiroDe(valores.dueDay);
  const bloqueio = inteiroDe(valores.graceDays);

  if (gerar === null || gerar < 1 || gerar > DIA_MAXIMO) {
    return { problema: { campo: 'invoiceGenerationDay', mensagem: `Informe um dia de 1 a ${DIA_MAXIMO}.` } };
  }
  if (vencer === null || vencer < 1 || vencer > DIA_MAXIMO) {
    return { problema: { campo: 'dueDay', mensagem: `Informe um dia de 1 a ${DIA_MAXIMO}.` } };
  }
  if (bloqueio === null || bloqueio < 1 || bloqueio > BLOQUEIO_MAXIMO) {
    return { problema: { campo: 'graceDays', mensagem: `Informe de 1 a ${BLOQUEIO_MAXIMO} dias.` } };
  }
  if (gerar > vencer) {
    return {
      problema: {
        campo: 'invoiceGenerationDay',
        mensagem: 'O dia de gerar não pode ser depois do dia do vencimento.',
      },
    };
  }

  return { config: { invoiceGenerationDay: gerar, dueDay: vencer, graceDays: bloqueio } };
}

function BotaoSalvar({ desabilitado }: { readonly desabilitado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={desabilitado || pending} data-testid="config-salvar">
      {pending ? 'Salvando…' : 'Salvar'}
    </Button>
  );
}

/**
 * Configuração de pagamento -- F89.
 *
 * O exemplo ao vivo existe para o operador ver o efeito dos três números no
 * calendário antes de gravar. Salvar vale para as PRÓXIMAS parcelas; as já
 * geradas não mudam, e a tela diz isso ao lado do botão.
 *
 * Sem `podeEditar` a pessoa vê os valores (ler cobrança basta), com os campos
 * travados e sem botão.
 */
export function PainelDePagamento({
  inicial,
  referencia,
  podeEditar,
}: {
  readonly inicial: ConfiguracaoDePagamento;
  /** Mês do exemplo (`mes` de 1 a 12), calculado no servidor. */
  readonly referencia: { readonly ano: number; readonly mes: number };
  readonly podeEditar: boolean;
}) {
  const [estado, acao] = useActionState(salvarConfiguracaoDePagamento, ESTADO_INICIAL);
  const [valores, setValores] = useState<Valores>({
    invoiceGenerationDay: String(inicial.invoiceGenerationDay),
    dueDay: String(inicial.dueDay),
    graceDays: String(inicial.graceDays),
  });
  const { show } = useToast();

  useToastDeErro(estado.erro, 'error', 'erro-da-config-de-pagamento');

  // `useActionState` devolve um objeto novo a cada resposta: a chave é o
  // próprio estado, então salvar duas vezes seguidas avisa duas vezes.
  useEffect(() => {
    if (estado.sucesso) {
      show('info', 'Configuração de pagamento salva.', 'sucesso-da-config-de-pagamento');
    }
  }, [estado, show]);

  const conferido = conferir(valores);
  const problema = 'problema' in conferido ? conferido.problema : null;
  const exemplo = 'config' in conferido ? exemploDoCiclo(conferido.config, referencia) : null;

  function propsDe(nome: Campo, maximo: number) {
    return {
      name: nome,
      type: 'number' as const,
      inputMode: 'numeric' as const,
      min: 1,
      max: maximo,
      step: 1,
      value: valores[nome],
      disabled: !podeEditar,
      onChange: (evento: ChangeEvent<HTMLInputElement>) => {
        const texto = evento.target.value;
        setValores((atual) => ({ ...atual, [nome]: texto }));
      },
      ...(problema?.campo === nome ? { error: problema.mensagem } : {}),
    };
  }

  return (
    <form action={acao} className={estilos['painel']} data-testid="painel-de-pagamento">
      <fieldset className={estilos['grupo']}>
        <legend>Ciclo da parcela</legend>

        <Field
          id="config-gerar"
          label="Dia de gerar as parcelas"
          hint="Todo mês, neste dia, o sistema gera a parcela de cada aluno ativo."
          data-testid="config-gerar"
          {...propsDe('invoiceGenerationDay', DIA_MAXIMO)}
        />
        <Field
          id="config-vencer"
          label="Dia do vencimento"
          hint="Dia do mês em que a parcela vence."
          data-testid="config-vencer"
          {...propsDe('dueDay', DIA_MAXIMO)}
        />
        <Field
          id="config-bloqueio"
          label="Dias de bloqueio após o vencimento"
          hint="Quantos dias depois do vencimento a catraca deixa de liberar quem não pagou."
          data-testid="config-bloqueio"
          {...propsDe('graceDays', BLOQUEIO_MAXIMO)}
        />
      </fieldset>

      <p className={estilos['exemplo']} data-testid="config-exemplo" aria-live="polite">
        {exemplo
          ? `Parcela de ${exemplo.competencia}: gerada em ${exemplo.gerada}, vence em ${exemplo.vence}, catraca bloqueia em ${exemplo.bloqueia} às 00:00.`
          : 'Corrija os valores para ver o exemplo.'}
      </p>

      <div className={estilos['acoes']}>
        {podeEditar ? <BotaoSalvar desabilitado={problema !== null} /> : null}
        <p className={estilos['aviso']}>
          A mudança vale para as próximas parcelas. As parcelas já geradas não mudam.
        </p>
        {podeEditar ? null : (
          <p className={estilos['aviso']}>Você pode consultar estes valores, mas não alterá-los.</p>
        )}
      </div>
    </form>
  );
}
