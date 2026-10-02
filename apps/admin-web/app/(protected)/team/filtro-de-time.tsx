'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Field } from '@arenahub/ui';

import estilos from './team.module.css';

/** Mesmo piso de `FiltroDeAlunos` (issue #118). */
const MINIMO_DE_CARACTERES = 3;
const ATRASO_MS = 300;

interface Props {
  termoInicial: string;
}

/**
 * Filtro da tela de Time -- F81, mesmo padrão de `FiltroDeAlunos`: busca
 * automática por nome, sem botão, escrevendo na URL (não em estado de
 * componente). Sem os filtros de situação/unidade/modalidade de `/students`
 * -- o time não tem situação de matrícula nem modalidade.
 */
export function FiltroDeTime({ termoInicial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [termo, setTermo] = useState(termoInicial);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Ver `FiltroDeAlunos` -- mesma guarda contra a busca "voltar à página 1" sozinha. */
  const ultimoBuscado = useRef(termoInicial);

  const navegar = (proximoTermo: string): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete('cursor');

    if (proximoTermo) url.set('q', proximoTermo);
    else url.delete('q');

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
    <div className={estilos['filtro']}>
      <div className={estilos['busca']}>
        <Field
          id="busca"
          name="q"
          type="search"
          label="Buscar por nome ou ID da catraca"
          value={termo}
          onChange={(evento) => setTermo(evento.target.value)}
          placeholder="Ex.: Fernanda Costa, 1042"
          data-testid="busca-de-time"
        />
      </div>
    </div>
  );
}
