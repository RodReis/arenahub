'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { salvarPlano, type EstadoDoPlano } from '../../../actions/contratos';

const ESTADO_INICIAL: EstadoDoPlano = {};

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-plano">
      {pending ? 'Salvando…' : 'Cadastrar plano'}
    </Button>
  );
}

/**
 * Cadastro de plano SaaS — F63, ADR-052 §5.
 *
 * O MODELO DECIDE QUAIS CAMPOS EXISTEM, e os do outro modelo somem da tela em
 * vez de ficarem desabilitados: um campo cinza que nunca vale confunde mais do
 * que ajuda, e a API recusa o plano que traz os dois conjuntos de preço.
 *
 * OS CAMPOS ESCONDIDOS NÃO SÃO `required`. `required` dentro de algo escondido
 * bloqueia o envio sem mensagem nenhuma — o navegador tenta focar um campo que
 * não está na tela e desiste calado. A presença é validada na Server Action.
 */
export function FormularioDePlano() {
  const [estado, acao] = useActionState(salvarPlano, ESTADO_INICIAL);
  const [modelo, setModelo] = useState<'PER_STUDENT' | 'FIXED_MONTHLY'>('PER_STUDENT');

  useToastDeErro(estado.erro, 'error', 'erro-do-plano');

  const porAluno = modelo === 'PER_STUDENT';

  return (
    <form className={estilos['formulario']} action={acao}>
      <fieldset className={estilos['grupo']}>
        <legend>Novo plano</legend>

        <Field
          id="nome-do-plano"
          name="name"
          label="Nome do plano"
          required
          defaultValue={estado.valores?.['name'] ?? ''}
          data-testid="campo-nome-do-plano"
        />

        <SelectField
          id="modelo-do-plano"
          name="model"
          label="Modelo de cobrança"
          required
          value={modelo}
          onChange={(evento) =>
            setModelo(evento.target.value === 'FIXED_MONTHLY' ? 'FIXED_MONTHLY' : 'PER_STUDENT')
          }
          data-testid="campo-modelo-do-plano"
        >
          <option value="PER_STUDENT">Por aluno</option>
          <option value="FIXED_MONTHLY">Fixo mensal</option>
        </SelectField>

        {porAluno ? (
          <div className={estilos['par']}>
            <Field
              id="preco-do-ativo"
              name="activeStudentPrice"
              label="Preço por aluno ativo"
              hint="Por mês, em reais. Ex.: 5,00"
              inputMode="decimal"
              defaultValue={estado.valores?.['activeStudentPrice'] ?? '5,00'}
              data-testid="campo-preco-do-ativo"
            />

            <Field
              id="preco-do-inativo"
              name="inactiveStudentPrice"
              label="Preço por aluno inativo"
              /*
                O ZERO PRECISA APARECER COMO OPÇÃO. Cobrar por lead desestimula
                cadastrar lead, e o preço do inativo é negociado por contrato
                (ADR-052 §6) -- quem não souber que pode zerar vai cobrar por
                engano de quem nunca treinou.
              */
              hint="Por mês, em reais. Pode ser 0 se o contrato não cobrar aluno inativo."
              inputMode="decimal"
              defaultValue={estado.valores?.['inactiveStudentPrice'] ?? '2,50'}
              data-testid="campo-preco-do-inativo"
            />
          </div>
        ) : (
          <Field
            id="preco-fixo"
            name="fixedPrice"
            label="Valor mensal"
            hint="Em reais. Ex.: 1.499,00. Corrigido anualmente pelo índice do contrato."
            inputMode="decimal"
            defaultValue={estado.valores?.['fixedPrice'] ?? ''}
            data-testid="campo-preco-fixo"
          />
        )}

        <p className={estilos['nota']}>
          {porAluno
            ? 'Aluno ativo é o que está em situação ativa no dia da emissão; inativo é qualquer outra situação.'
            : 'O valor fixo é corrigido no aniversário do contrato, pelo índice acumulado do histórico.'}
        </p>

        {estado.salvo ? (
          <p role="status" data-testid="plano-salvo">
            Plano cadastrado.
          </p>
        ) : null}

        <div className={estilos['acoes']}>
          <BotaoDeSalvar />
        </div>
      </fieldset>
    </form>
  );
}
