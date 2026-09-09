'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { registrarValorDeIndice, type EstadoDoIndice } from '../../../actions/contratos';

const ESTADO_INICIAL: EstadoDoIndice = {};

interface Props {
  readonly codigo: string;
}

function BotaoDeRegistrar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-indice">
      {pending ? 'Registrando…' : 'Registrar variação'}
    </Button>
  );
}

/**
 * Cadastro da variação mensal do índice — F63, ADR-052 §7.
 *
 * A VARIAÇÃO É DIGITADA EM PORCENTO, como o IBGE publica: `0,44`. A conversão
 * para o inteiro que o banco guarda (`440`) é da Server Action. Pedir o número
 * interno aqui transformaria quem cadastra na conversora, e o primeiro erro de
 * fator de mil sairia como reajuste de mil por cento.
 *
 * REGISTRAR A MESMA COMPETÊNCIA DE NOVO CORRIGE O VALOR, em vez de somar outro
 * mês — o IBGE revisa, e a segunda digitação tem de ser a definitiva.
 */
export function FormularioDeIndice({ codigo }: Props) {
  const [estado, acao] = useActionState(registrarValorDeIndice, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-do-indice');

  return (
    <form className={estilos['formulario']} action={acao}>
      <fieldset className={estilos['grupo']}>
        <legend>Registrar variação do mês</legend>

        <div className={estilos['par']}>
          <Field
            id="codigo-do-indice"
            name="code"
            label="Índice"
            required
            defaultValue={codigo}
            data-testid="campo-codigo-do-indice"
          />

          <Field
            id="competencia-do-indice"
            name="competencia"
            label="Competência"
            /*
              `month` e não `date`: competência é MÊS. Um campo de data deixaria
              gravar 15/03, e duas linhas para março não seriam vistas como a
              mesma competência pela chave única do banco.
            */
            type="month"
            required
            data-testid="campo-competencia-do-indice"
          />
        </div>

        <Field
          id="variacao-do-indice"
          name="variacao"
          label="Variação do mês"
          unit="%"
          inputMode="decimal"
          required
          hint="Como o IBGE publica. Ex.: 0,44. Aceita negativo em mês de deflação."
          data-testid="campo-variacao-do-indice"
        />

        {estado.salvo ? (
          <p role="status" data-testid="indice-salvo">
            Variação registrada.
          </p>
        ) : null}

        <div className={estilos['acoes']}>
          <BotaoDeRegistrar />
        </div>
      </fieldset>
    </form>
  );
}
