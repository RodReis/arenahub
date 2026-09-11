'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, MaskedField, useToastDeErro } from '@arenahub/ui';

import { mascararPercentual } from '@/lib/mascaras';

import estilos from '../../../formulario.module.css';
import proprios from './indices.module.css';

import { registrarValorDeIndice, type EstadoDoIndice } from '../../../actions/contratos';

const ESTADO_INICIAL: EstadoDoIndice = {};

interface Props {
  readonly codigo: string;
  /**
   * Competência a corrigir, vinda de um clique na tabela. Preenchida, o
   * formulário nasce apontando para o mês que já existe.
   */
  readonly corrigindo?: { competencia: string; variacao: string } | undefined;
  readonly onCancelar?: (() => void) | undefined;
}

function BotaoDeRegistrar({ corrigindo }: { readonly corrigindo: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-indice">
      {pending ? 'Registrando…' : corrigindo ? 'Corrigir variação' : 'Registrar variação'}
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
export function FormularioDeIndice({ codigo, corrigindo, onCancelar }: Props) {
  const [estado, acao] = useActionState(registrarValorDeIndice, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-do-indice');

  const corrige = corrigindo !== undefined;

  return (
    <form className={estilos['formulario']} action={acao}>
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
            defaultValue={corrigindo?.competencia ?? ''}
            data-testid="campo-competencia-do-indice"
          />
        </div>

        <MaskedField
          id="variacao-do-indice"
          name="variacao"
          label="Variação do mês"
          unit="%"
          mascara={mascararPercentual}
          inputMode="decimal"
          required
          placeholder="0,44"
          hint="Como o IBGE publica. Aceita negativo em mês de deflação."
          defaultValue={corrigindo?.variacao ?? ''}
          data-testid="campo-variacao-do-indice"
        />

        <div className={estilos['acoes']}>
          <BotaoDeRegistrar corrigindo={corrige} />

          {corrige && onCancelar !== undefined ? (
            <Button variant="ghost" onClick={onCancelar} data-testid="cancelar-correcao">
              Cancelar
            </Button>
          ) : null}

          {estado.salvo ? (
            <p className={proprios['salvo']} role="status" data-testid="indice-salvo">
              Variação registrada.
            </p>
          ) : null}
        </div>
    </form>
  );
}
