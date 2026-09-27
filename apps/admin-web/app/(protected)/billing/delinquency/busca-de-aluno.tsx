'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Field } from '@arenahub/ui';

/** Não busca com menos de 3 caracteres -- mesmo piso de `FiltroDeAlunos` (issue #118). */
const MINIMO_DE_CARACTERES = 3;
const ATRASO_MS = 300;

interface Props {
  /** Prefixo do parametro de URL -- cada aba tem o proprio, para nao colidir. */
  readonly prefixo: 'qInad' | 'qPag';
  readonly termoInicial: string;
  readonly label: string;
  readonly testId: string;
}

/**
 * Busca por nome, para as duas abas da tela de cobranca -- pedido do PI.
 *
 * MESMO PADRAO de `FiltroDeAlunos` (busca automatica, sem botao, URL como
 * fonte da verdade), reduzido ao que esta tela precisa: so o campo de texto,
 * sem os selects de situacao/unidade/modalidade que `/students` tem.
 *
 * PARAMETRO PROPRIO POR ABA (`qInad`/`qPag`, ver `Props.prefixo`): as duas
 * abas ficam montadas ao mesmo tempo (`Tabs` do DS), e um parametro `q` unico
 * faria buscar em Pagantes tambem mexer na URL que Inadimplentes le --
 * trocar de aba devolveria a outra lista filtrada por engano.
 */
export function BuscaDeAluno({ prefixo, termoInicial, label, testId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [termo, setTermo] = useState(termoInicial);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * O ultimo termo REALMENTE buscado -- mesma guarda de `FiltroDeAlunos`
   * (issue #263): sem ela, chegar a uma pagina 2 pelo cursor da URL montaria
   * o componente, disparava a busca 300ms depois e apagaria o cursor,
   * devolvendo a recepcao a primeira pagina sem ninguem ter tocado em nada.
   */
  const ultimoBuscado = useRef(termoInicial);

  const cursorDaAba = prefixo === 'qInad' ? 'cursorInad' : 'cursorPag';

  const navegar = (proximoTermo: string): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete(cursorDaAba);

    if (proximoTermo) url.set(prefixo, proximoTermo);
    else url.delete(prefixo);

    router.replace(`${pathname}?${url.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (termo === ultimoBuscado.current) return;
    if (termo.length > 0 && termo.length < MINIMO_DE_CARACTERES) return;

    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      ultimoBuscado.current = termo;
      navegar(termo);
    }, ATRASO_MS);

    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o texto redispara a busca.
  }, [termo]);

  return (
    <Field
      id={`busca-${prefixo}`}
      name={prefixo}
      type="search"
      label={label}
      value={termo}
      onChange={(evento) => setTermo(evento.target.value)}
      placeholder="Ex.: Maria"
      data-testid={testId}
    />
  );
}
