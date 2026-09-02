'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  readonly valor: number;
  /** Sufixo colado ao número, como "/4 online". Não anima. */
  readonly children?: React.ReactNode;
}

/** Quanto dura a contagem. Curto o bastante para não atrasar a leitura. */
const DURACAO_MS = 600;

/**
 * O número sobe de zero até o valor ao carregar — F57, passe visual.
 *
 * ## Por que isto não é decoração
 *
 * O painel fica aberto o turno inteiro e recarrega sozinho. Sem movimento
 * nenhum, quem olha de longe não distingue "o dado acabou de chegar" de "esta
 * aba está congelada há uma hora" — e essa é exatamente a dúvida que o
 * dashboard existe para não deixar acontecer. A contagem responde antes de
 * qualquer texto: o que se move está vivo.
 *
 * ## O que ela não faz
 *
 * Não anima em toda re-renderização: só quando o VALOR muda. Um número que
 * recontasse a cada ciclo de 5 s seria um relógio piscando na parede.
 *
 * `prefers-reduced-motion` mostra o valor final direto — sem contagem, sem
 * intervalo, sem trabalho nenhum no primeiro quadro.
 */
export function NumeroQueConta({ valor, children }: Props) {
  /*
   * NASCE COM O VALOR FINAL, e a contagem parte de zero no efeito.
   *
   * A alternativa -- iniciar o estado em 0 -- faria o HTML do servidor
   * carregar "0" e o React reclamar de hidratação divergente. Pior: sem
   * JavaScript (ou antes de ele chegar), a tela mostraria zero acessos numa
   * academia cheia. O número correto é o que o servidor manda; a animação é
   * enfeite por cima, e enfeite não pode ser a fonte do dado.
   */
  const [exibido, setExibido] = useState(valor);
  const anterior = useRef<number | null>(null);

  useEffect(() => {
    // Primeira montagem: conta a partir do zero. Depois, só quando o valor
    // mudar de verdade -- recontar a cada ciclo de 5 s seria um relógio
    // piscando na parede.
    const de = anterior.current ?? 0;

    if (anterior.current === valor) return;

    anterior.current = valor;

    const querMenosMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (querMenosMovimento) {
      setExibido(valor);
      return;
    }

    let quadro = 0;
    const comecou = performance.now();

    const passo = (agora: number): void => {
      const progresso = Math.min((agora - comecou) / DURACAO_MS, 1);

      /*
       * `ease-out-quart`: rápido no começo e desacelerando até parar. Linear
       * pareceria um contador de posto de gasolina; com bounce, o número
       * passaria do valor real e voltaria — inaceitável num painel onde o
       * número É a informação.
       */
      const suave = 1 - Math.pow(1 - progresso, 4);

      setExibido(Math.round(de + (valor - de) * suave));

      if (progresso < 1) quadro = requestAnimationFrame(passo);
    };

    quadro = requestAnimationFrame(passo);

    return () => cancelAnimationFrame(quadro);
  }, [valor]);

  return (
    <>
      {exibido}
      {children}
    </>
  );
}
