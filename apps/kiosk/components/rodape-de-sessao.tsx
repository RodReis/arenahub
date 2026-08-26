'use client';

/**
 * Barra e rodape de sessao -- DS-TOTEM.md §3.18.
 *
 * Topo: trilho de 6 px com preenchimento decrescente e `transition: width
 * 1s linear` -- a mesma cadencia do tique do contador, para a barra andar
 * em vez de pular.
 *
 * Base: contador a esquerda, "Preciso de mais tempo" (borda azul) e
 * "Encerrar" (borda neutra) a direita, ambos com 88 px.
 */
export function BarraDeSessao({ fracaoRestante }: { readonly fracaoRestante: number }) {
  return (
    <div
      style={{ height: 6, flexShrink: 0, background: 'var(--ah-totem-border-hairline)' }}
      role="presentation"
    >
      <div
        style={{
          height: '100%',
          width: `${String(Math.round(fracaoRestante * 100))}%`,
          background: 'var(--ah-totem-brand-500)',
          transition: 'width 1s linear',
        }}
      />
    </div>
  );
}

export function RodapeDeSessao({
  segundosRestantes,
  aoEstender,
  aoEncerrar,
  altoContraste,
  aoAlternarContraste,
}: {
  readonly segundosRestantes: number;
  readonly aoEstender: () => void;
  readonly aoEncerrar: () => void;
  readonly altoContraste: boolean;
  readonly aoAlternarContraste: () => void;
}) {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexShrink: 0,
        padding: '28px var(--tt-padding-interno) 40px',
        borderTop: 'var(--tt-borda) solid var(--ah-totem-border-hairline)',
      }}
    >
      <span
        data-numerico
        data-testid="contador-de-sessao"
        className="corpo"
        style={{ flex: 1 }}
        // O contador muda a cada segundo: sem `polite`, um leitor de tela
        // leria a tela inteira de novo uma vez por segundo.
        aria-live="off"
      >
        Sessão encerra em {segundosRestantes} s
      </span>
      {/*
        O interruptor tambem AQUI, e nao so na tela publica: quem precisa de
        alto contraste descobre isso lendo a propria area, ja dentro da sessao
        -- obriga-lo a encerrar e voltar ao atrator para ligar seria negar a
        acessibilidade no momento em que ela faz falta.
      */}
      <button
        type="button"
        className="botaoDeContraste"
        aria-pressed={altoContraste}
        data-testid="alternar-contraste"
        onClick={aoAlternarContraste}
      >
        Alto contraste
      </button>
      <button
        type="button"
        className="botaoSecundario"
        style={{
          borderColor: 'var(--ah-totem-brand-500)',
          background: 'transparent',
          color: 'var(--ah-totem-brand-200)',
          fontWeight: 700,
        }}
        onClick={aoEstender}
      >
        Preciso de mais tempo
      </button>
      <button
        type="button"
        className="botaoSecundario"
        style={{ background: 'transparent' }}
        data-testid="encerrar-sessao"
        onClick={aoEncerrar}
      >
        Encerrar
      </button>
    </footer>
  );
}
