import type { ReactNode } from 'react';

/**
 * Icones do totem -- DS-TOTEM.md §2.5: traco, viewBox 24x24, `stroke-width`
 * 1.7-2.2, cantos redondos, sem preenchimento.
 *
 * Locais, e nao do `@arenahub/ui`: o `Icon` de la e um catalogo de 16-24 px
 * para o painel; aqui o mesmo glifo aparece a 34-52 px, e o traco herda a
 * cor de quem chama (`currentColor`) para servir tanto ao CTA (branco)
 * quanto a faixa de estado (a cor do estado).
 */
interface PropsDeIcone {
  readonly tamanho: number;
  readonly tracado?: number;
  readonly rotulo?: string;
}

function Base({
  tamanho,
  tracado = 2,
  rotulo,
  children,
}: PropsDeIcone & { readonly children: ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={tracado}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rotulo === undefined}
      {...(rotulo === undefined ? {} : { role: 'img', 'aria-label': rotulo })}
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** Entrar -- seta atravessando uma porta. */
export function IconeEntrar(props: PropsDeIcone) {
  return (
    <Base {...props} tracado={props.tracado ?? 2.2}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3" />
    </Base>
  );
}

/** Halter com batimento -- marca da academia, no cabecalho. */
export function IconeMarca(props: PropsDeIcone) {
  return (
    <Base {...props} tracado={props.tracado ?? 1.7}>
      <path d="M2.5 9.5v5 M5 7.5v9 M19 7.5v9 M21.5 9.5v5 M5 12h3.2 M15.8 12H19 M8.2 12l1.4-2.6 1.9 5.2 1.7-4 1 1.4h1.6" />
    </Base>
  );
}

/** Triangulo de atencao -- faixa de pendencia. */
export function IconeAtencao(props: PropsDeIcone) {
  return (
    <Base {...props}>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5z M12 10v4 M12 16.8v.01" />
    </Base>
  );
}

/** Circulo com visto -- faixa de plano ativo. */
export function IconeConfirmado(props: PropsDeIcone) {
  return (
    <Base {...props}>
      <path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20 M8.5 12.2l2.4 2.4 4.6-5" />
    </Base>
  );
}

/** Camera do Instagram -- bloco INSTAGRAM da tela publica (§4). */
export function IconeInstagram(props: PropsDeIcone) {
  return (
    <Base {...props} tracado={props.tracado ?? 2}>
      <path d="M3 8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M17.2 6.8v.01" />
    </Base>
  );
}
