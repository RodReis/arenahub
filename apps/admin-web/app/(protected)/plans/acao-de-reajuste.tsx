'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, Money, TenantDateTime, useToastDeErro } from '@arenahub/ui';

import estilos from './planos.module.css';

import { reajustarPreco, type EstadoDoReajuste } from '../../actions/membership';

interface Preco {
  amountMinor: number;
  currency: string;
  validFrom: string;
}

interface Props {
  readonly planId: string;
  /** Nome do plano, para o modal dizer de qual se trata. */
  readonly nomeDoPlano: string;
  /** Nomes das unidades onde o plano vale. Vazio quando não há nenhuma. */
  readonly unidades: readonly string[];
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
export function AcaoDeReajuste({
  planId,
  nomeDoPlano,
  unidades,
  historico,
  timeZone,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(reajustarPreco, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', `erro-de-reajuste-${planId}`);
  useToastDeErro(
    estado.sucesso ? 'Preço reajustado.' : undefined,
    'info',
    `sucesso-de-reajuste-${planId}`,
  );

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // `showModal()` é o que traz foco preso e backdrop -- o atributo `open`
    // abriria o dialog sem nada disso.
    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // Fechou pelo `Esc` ou pelo backdrop: sem isto o estado ficaria dizendo
    // "aberto" com o dialog fechado, e o próximo clique não abriria nada.
    const aoFechar = (): void => setAberto(false);
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, []);

  // Reajustou: fecha sozinho. A lista por trás já foi revalidada pela action.
  useEffect(() => {
    if (estado.sucesso) setAberto(false);
  }, [estado.sucesso]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-reajuste-${planId}`}
      >
        Reajustar
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-reajuste-${planId}`}
      >
        <form
          className={estilos['formulario']}
          action={acao}
          data-testid={`formulario-de-reajuste-${planId}`}
        >
          <input type="hidden" name="planId" value={planId} />

          <div className={estilos['cabecalho']}>
            <h2 className={estilos['titulo']} id={`titulo-reajuste-${planId}`}>
              Reajustar preço
            </h2>
            {/*
              DE QUAL PLANO e de QUAL UNIDADE: o modal cobre a tabela, e sem
              isto quem abre a partir da quinta linha não tem como conferir
              que clicou na certa.
            */}
            <p className={estilos['nomeDoPlano']}>
              {nomeDoPlano}
              {unidades.length > 0 ? ` · ${unidades.join(', ')}` : ''}
            </p>
          </div>

          <div className={estilos['corpo']}>
            {historico.length > 0 ? (
              <section aria-labelledby={`historico-de-vigencias-${planId}`}>
                <h3
                  className={estilos['tituloDoHistorico']}
                  id={`historico-de-vigencias-${planId}`}
                >
                  Histórico de vigências
                </h3>
                {/*
                  À VISTA antes de reajustar -- quem muda o preço precisa ver o
                  que já valeu, senão decide às cegas sobre o que virou vigência.
                */}
                <ul
                  className={estilos['historico']}
                  data-testid={`historico-de-vigencias-lista-${planId}`}
                >
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
          </div>

          <div className={estilos['rodape']}>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoDeReajuste />
          </div>
        </form>
      </dialog>
    </>
  );
}
