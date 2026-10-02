'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

import { IconeCelular } from './icones';

export const ESPERA_DO_APP_MS = 60_000;

const PASSOS = [
  { titulo: 'Escaneie', texto: 'com a câmera do celular' },
  { titulo: 'Permita', texto: 'instalar apps desta origem, se o celular pedir' },
  { titulo: 'Entre', texto: 'com o seu CPF no app' },
] as const;

/**
 * Tela do QR do instalador Android -- issue #534.
 *
 * Fora da sessao do aluno: nao pede CPF e nao abre nada. Por isso nao ha
 * `expiraEm` do servidor para mandar de volta a espera; a contagem e LOCAL, e
 * qualquer toque a reinicia -- quem esta lendo o passo 2 nao pode ser
 * devolvido a tela inicial no meio da frase.
 *
 * O QR vira `data:image/svg+xml` num `<img>`: imagem nao executa script nem
 * interpreta HTML, ao contrario de injetar o SVG no DOM. Gerado no navegador,
 * porque o totem recebe a URL na config e nao ha rota de imagem a assinar.
 */
export function TelaDoApp({
  url,
  version,
  aoVoltar,
  tempoDeEsperaMs = ESPERA_DO_APP_MS,
}: {
  readonly url: string;
  readonly version: string | null;
  readonly aoVoltar: () => void;
  readonly tempoDeEsperaMs?: number;
}) {
  const totalSegundos = Math.ceil(tempoDeEsperaMs / 1000);
  const [qr, setQr] = useState<string | null>(null);
  const [restante, setRestante] = useState(totalSegundos);
  const aoVoltarRef = useRef(aoVoltar);
  aoVoltarRef.current = aoVoltar;

  useEffect(() => {
    let ativo = true;

    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
      if (ativo) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });

    return () => {
      ativo = false;
    };
  }, [url]);

  useEffect(() => {
    const relogio = setInterval(() => {
      setRestante((atual) => atual - 1);
    }, 1000);

    return () => clearInterval(relogio);
  }, []);

  // Zerou: devolve a tela de espera. Ref, e nao `aoVoltar` nas deps, para o
  // efeito nao reagendar quando o pai recria a funcao.
  useEffect(() => {
    if (restante <= 0) aoVoltarRef.current();
  }, [restante]);

  const progresso = Math.max(0, Math.min(1, restante / totalSegundos));

  return (
    <main
      className="telaDoApp"
      data-testid="tela-do-app"
      onPointerDown={() => setRestante(totalSegundos)}
    >
      <header className="cabecalhoDoApp">
        <span className="iconeDoApp" aria-hidden="true">
          <IconeCelular tamanho={44} />
        </span>
        <div>
          <h1 className="tituloDoApp">
            Baixe o app <span className="destaqueDoApp">no celular</span>
          </h1>
          <p className="subtituloDoApp">
            Aponte a <strong>câmera do celular</strong> para o código.
          </p>
        </div>
      </header>

      <div className="cartaoDoQr quadroDoQr">
        {qr ? (
          <img
            src={qr}
            alt="Código QR para baixar o app Android"
            width={420}
            height={420}
            data-testid="qr-do-app"
          />
        ) : null}
      </div>

      <p className="pilulaDoApp" data-testid="versao-do-app">
        <span className="pontoDoApp" aria-hidden="true" />
        Android{version ? ` · versão ${version}` : ''}
      </p>

      <ol className="passosDoApp">
        {PASSOS.map((passo, indice) => (
          <li key={passo.titulo} className="passoDoApp" data-testid="passo-do-app">
            <span className="numeroDoPasso">{indice + 1}</span>
            <strong>{passo.titulo}</strong>
            <span>{passo.texto}</span>
          </li>
        ))}
      </ol>

      <div className="rodapeDoApp">
        <p className="contagemDoApp" data-testid="contagem-do-app" role="timer">
          Volta à tela inicial em <strong>{Math.max(0, restante)} s</strong>
        </p>
        <div className="barraDaContagem" aria-hidden="true">
          <span style={{ transform: `scaleX(${progresso})` }} />
        </div>
        <button type="button" className="botaoSecundario" onClick={aoVoltar} data-testid="voltar-do-app">
          ← Voltar
        </button>
      </div>
    </main>
  );
}
