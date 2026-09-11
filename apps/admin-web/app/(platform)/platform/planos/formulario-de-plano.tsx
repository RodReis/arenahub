'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, MaskedField, SelectField, useToastDeErro } from '@arenahub/ui';

import { mascararDinheiro } from '@/lib/mascaras';

import estilos from '../../../formulario.module.css';
import proprios from './planos.module.css';

import { salvarPlano, type EstadoDoPlano } from '../../../actions/contratos';
import type { PlanoNaLista } from './catalogo-de-planos';

const ESTADO_INICIAL: EstadoDoPlano = {};

/** `500` -> `5,00`. O banco guarda centavos; o campo mostra reais. */
function emReais(centavos: number | null): string {
  if (centavos === null) return '';

  return mascararDinheiro(String(centavos));
}

function BotaoDeSalvar({ editando }: { readonly editando: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-plano">
      {pending ? 'Salvando…' : editando ? 'Salvar plano' : 'Cadastrar plano'}
    </Button>
  );
}

interface Props {
  /** `null` cadastra; preenchido edita o plano dado. */
  readonly plano: PlanoNaLista | null;
}

/**
 * Cadastro e edição de plano SaaS — F63, com a edição ligada na F68.
 *
 * O MESMO FORMULÁRIO PARA OS DOIS ATOS, e não uma tela de edição própria: são
 * os mesmos quatro campos, a mesma regra de "qual preço aparece em qual
 * modelo" e a mesma Server Action (ela já aceitava `id` desde a F63 — só não
 * havia tela que o enviasse). Duplicar isso numa segunda tela criaria dois
 * lugares para a regra divergir.
 *
 * O MODELO DECIDE QUAIS CAMPOS EXISTEM, e os do outro modelo somem da tela em
 * vez de ficarem desabilitados: um campo cinza que nunca vale confunde mais do
 * que ajuda, e a API recusa o plano que traz os dois conjuntos de preço.
 *
 * OS CAMPOS ESCONDIDOS NÃO SÃO `required`. `required` dentro de algo escondido
 * bloqueia o envio sem mensagem nenhuma — o navegador tenta focar um campo que
 * não está na tela e desiste calado. A presença é validada na Server Action.
 */
export function FormularioDePlano({ plano }: Props) {
  const [estado, acao] = useActionState(salvarPlano, ESTADO_INICIAL);
  const [modelo, setModelo] = useState<'PER_STUDENT' | 'FIXED_MONTHLY'>(
    plano?.model ?? 'PER_STUDENT',
  );

  useToastDeErro(estado.erro, 'error', 'erro-do-plano');

  const porAluno = modelo === 'PER_STUDENT';
  const editando = plano !== null;

  /*
   * O valor do campo vem, nesta ordem: o que foi digitado e recusado, o que
   * está salvo no plano, o padrão do catálogo. A primeira posição é o que
   * impede o formulário de esvaziar em erro recuperável (§10 item 3).
   */
  const valor = (campo: string, doPlano: string, padrao = ''): string =>
    estado.valores?.[campo] ?? (editando ? doPlano : padrao);

  return (
    <form className={estilos['formulario']} action={acao}>
      {/*
        O `id` É O QUE DISTINGUE cadastro de edição na Server Action: presente,
        ela chama `PATCH plans/:id`; ausente, `POST plans`.
      */}
      {editando ? <input type="hidden" name="id" value={plano.id} /> : null}

      <Field
        id="nome-do-plano"
        name="name"
        label="Nome do plano"
        required
        defaultValue={valor('name', plano?.name ?? '')}
        maxLength={120}
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
          <MaskedField
            id="preco-do-ativo"
            name="activeStudentPrice"
            label="Preço por aluno ativo"
            unit="R$ / mês"
            mascara={mascararDinheiro}
            hint="Multiplica a contagem de alunos ativos no dia da emissão."
            inputMode="decimal"
            defaultValue={valor('activeStudentPrice', emReais(plano?.activeStudentPriceMinor ?? null), '5,00')}
            data-testid="campo-preco-do-ativo"
          />

          <MaskedField
            id="preco-do-inativo"
            name="inactiveStudentPrice"
            label="Preço por aluno inativo"
            unit="R$ / mês"
            mascara={mascararDinheiro}
            /*
              O ZERO PRECISA APARECER COMO OPÇÃO. Cobrar por lead desestimula
              cadastrar lead, e o preço do inativo é negociado por contrato
              (ADR-052 §6) -- quem não souber que pode zerar vai cobrar por
              engano de quem nunca treinou.
            */
            hint="Pode ser 0 se o contrato não cobrar aluno inativo."
            inputMode="decimal"
            defaultValue={valor(
              'inactiveStudentPrice',
              emReais(plano?.inactiveStudentPriceMinor ?? null),
              '2,50',
            )}
            data-testid="campo-preco-do-inativo"
          />
        </div>
      ) : (
        <MaskedField
          id="preco-fixo"
          name="fixedPrice"
          label="Valor mensal"
          unit="R$ / mês"
          mascara={mascararDinheiro}
          hint="Corrigido anualmente pelo índice do contrato."
          inputMode="decimal"
          defaultValue={valor('fixedPrice', emReais(plano?.fixedPriceMinor ?? null))}
          data-testid="campo-preco-fixo"
        />
      )}

      <p className={estilos['nota']}>
        {porAluno
          ? 'Aluno ativo é o que está em situação ativa no dia da emissão; inativo é qualquer outra situação.'
          : 'O valor fixo é corrigido no aniversário do contrato, pelo índice acumulado do histórico.'}
      </p>

      <div className={estilos['acoes']}>
        <BotaoDeSalvar editando={editando} />

        {estado.salvo ? (
          <p className={proprios['salvo']} role="status" data-testid="plano-salvo">
            {editando ? 'Plano atualizado.' : 'Plano cadastrado.'}
          </p>
        ) : null}
      </div>
    </form>
  );
}
