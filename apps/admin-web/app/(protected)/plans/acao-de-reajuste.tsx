'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, Money, TenantDateTime, useToastDeErro } from '@arenahub/ui';

import { reajustarPreco, type EstadoDoReajuste } from '../../actions/membership';

interface Preco {
  amountMinor: number;
  currency: string;
  validFrom: string;
}

interface Props {
  readonly planId: string;
  readonly historico: readonly Preco[];
  readonly timeZone: string;
}

const ESTADO_INICIAL: EstadoDoReajuste = {};

function BotaoDeReajuste() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-reajuste">
      {pending ? 'Reajustando…' : 'Confirmar reajuste'}
    </Button>
  );
}

/**
 * Reajuste de preço — F53, item 6 do brief.
 *
 * Fica direto na listagem, não numa ficha separada: `/plans/:id` não existe
 * ainda, e criar uma rota inteira só para hospedar este formulário seria
 * escopo que os testes exigidos não pedem (nem o aceite E2E passa por lá).
 * Nova linha de vigência, sem tocar invoice já emitida (INV-068) — quem
 * reajusta precisa ver o histórico antes de decidir, por isso ele fica à
 * vista assim que o formulário abre.
 */
export function AcaoDeReajuste({ planId, historico, timeZone }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(reajustarPreco, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', `erro-de-reajuste-${planId}`);

  if (estado.sucesso && aberto) {
    return (
      <p role="status" data-testid={`reajuste-confirmado-${planId}`}>
        Novo preço <Money cents={estado.sucesso.amountMinor} /> vigente a partir de{' '}
        <TenantDateTime iso={estado.sucesso.validFrom} timeZone={timeZone} format="date" />.
      </p>
    );
  }

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-reajuste-${planId}`}
      >
        Reajustar
      </Button>
    );
  }

  return (
    <form action={acao} data-testid={`formulario-de-reajuste-${planId}`}>
      <input type="hidden" name="planId" value={planId} />

      {historico.length > 0 ? (
        <section aria-labelledby={`historico-de-vigencias-${planId}`}>
          <h4 id={`historico-de-vigencias-${planId}`}>Histórico de vigências</h4>
          {/*
            À VISTA antes de reajustar -- quem muda o preço precisa ver o que
            já valeu, senão decide às cegas sobre o que virou vigência.
          */}
          <ul data-testid={`historico-de-vigencias-lista-${planId}`}>
            {[...historico]
              .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
              .map((preco) => (
                <li key={preco.validFrom}>
                  <Money cents={preco.amountMinor} currency={preco.currency} /> desde{' '}
                  <TenantDateTime iso={preco.validFrom} timeZone={timeZone} format="date" />
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <Field
        id={`reajuste-valor-${planId}`}
        name="amountMinor"
        label="Novo preço"
        unit="R$"
        defaultValue={estado.valores?.amountMinor ?? ''}
        inputMode="decimal"
        hint="Em reais, com até duas casas — por exemplo 180,00."
        aria-required="true"
        data-testid={`campo-reajuste-valor-${planId}`}
      />

      <Field
        id={`reajuste-data-${planId}`}
        name="validFrom"
        type="date"
        label="Início da vigência"
        defaultValue={estado.valores?.validFrom ?? ''}
        aria-required="true"
        data-testid={`campo-reajuste-data-${planId}`}
      />

      <BotaoDeReajuste />
      <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
        Cancelar
      </Button>
    </form>
  );
}
