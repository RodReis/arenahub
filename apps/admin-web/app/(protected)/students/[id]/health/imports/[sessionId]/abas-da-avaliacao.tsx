import Link from 'next/link';

import estilos from './sessao.module.css';

/**
 * As abas da avaliação.
 *
 * ---------------------------------------------------------------------------
 * ABAS POR URL, NÃO POR ESTADO DE CLIENTE.
 * ---------------------------------------------------------------------------
 *
 * A aba vive na query (`?aba=segmentos`), e não num `useState`. Três razões,
 * nessa ordem de peso:
 *
 *   1. **A tela continua Server Component.** Nada para hidratar, nada de
 *      JavaScript baixado para trocar de aba — a promessa é uma interface
 *      que não parece mais lenta que o motor (`PRODUCT.md`).
 *   2. **O link é compartilhável e o voltar funciona.** Quem manda "olha o
 *      histórico dele" manda a aba certa, e o botão voltar do navegador faz
 *      o que a recepção espera.
 *   3. **Sem JS, ainda funciona.** São links de verdade: navegação por
 *      teclado e leitor de tela vêm de graça do `<a>`.
 *
 * O custo é uma ida ao servidor por troca de aba. Aceitável aqui: os dados
 * já vêm todos na mesma requisição da página, e o Next serve do cache do
 * roteador na segunda visita.
 *
 * `aria-current="page"` e não `role="tab"`: isto é navegação entre views,
 * não um widget de abas com painéis no mesmo documento. Anunciar `tablist`
 * prometeria ao leitor de tela um comportamento de setas que estes links
 * não têm.
 */

export const ABAS = ['valores', 'segmentos', 'historico', 'ecg'] as const;

export type Aba = (typeof ABAS)[number];

const ROTULO: Record<Aba, string> = {
  valores: 'Valores',
  segmentos: 'Segmentos',
  historico: 'Histórico',
  ecg: 'ECG',
};

export function ehAba(valor: string | undefined): valor is Aba {
  return valor !== undefined && (ABAS as readonly string[]).includes(valor);
}

interface Props {
  readonly caminho: string;
  readonly ativa: Aba;
  /** Contagem por aba, quando há o que contar — `undefined` não renderiza nada. */
  readonly contagens?: Partial<Record<Aba, number>>;
}

export function AbasDaAvaliacao({ caminho, ativa, contagens }: Props) {
  return (
    <nav className={estilos['abas']} aria-label="Seções da avaliação">
      <ul>
        {ABAS.map((aba) => {
          const total = contagens?.[aba];

          return (
            <li key={aba}>
              <Link
                href={`${caminho}?aba=${aba}`}
                aria-current={aba === ativa ? 'page' : undefined}
                data-testid={`aba-${aba}`}
                scroll={false}
              >
                {ROTULO[aba]}
                {/*
                  A contagem é informação, não enfeite: "Segmentos" vazio e
                  "Segmentos 10" pedem decisões diferentes de quem olha, e
                  saber disso ANTES de clicar evita a aba que não tinha nada.
                */}
                {total !== undefined ? (
                  <span className={estilos['contagemDaAba']}>{total}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
