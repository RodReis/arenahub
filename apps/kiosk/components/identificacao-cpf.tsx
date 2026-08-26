'use client';

import { useCallback, useState } from 'react';

import { apenasDigitos, cpfEstaCompleto, DIGITOS_DO_CPF, mascararCpf } from '../lib/cpf';

/**
 * Identificacao por CPF -- DS-TOTEM.md §3.19.
 *
 * UM caminho, nao tres. O §5.1 desenha reconhecimento facial e QR Code do
 * app; nesta fatia a config traz `facial: false` e `qrCodeDoApp: false`
 * (decisao do PI, 25/08/2026), e caminho desligado NAO aparece -- nao
 * aparece cinza, nao aparece desabilitado, nao existe.
 *
 * O teclado e o da TELA. O campo e um `<div>` com `role="textbox"`, e nao um
 * `<input>`: um input abriria o teclado do sistema operacional sobre a
 * interface do quiosque em algum dos toques, e `inputMode="none"` depende do
 * navegador respeitar. Sem campo editavel nao ha o que o autofill preencha,
 * nem CPF anterior a reoferecer -- que e o que `autocomplete="off"` tenta
 * garantir num input e aqui e garantido pela ausencia dele.
 */
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Limpar', '0', 'apagar'] as const;

export function IdentificacaoCpf({
  ocupado,
  aoConfirmar,
  aoVoltar,
}: {
  readonly ocupado: boolean;
  readonly aoConfirmar: (cpf: string) => void;
  readonly aoVoltar: () => void;
}) {
  const [digitos, setDigitos] = useState('');

  const completo = cpfEstaCompleto(digitos);

  const pressionar = useCallback((tecla: (typeof TECLAS)[number]) => {
    setDigitos((atual) => {
      if (tecla === 'Limpar') return '';
      if (tecla === 'apagar') return atual.slice(0, -1);

      return apenasDigitos(atual + tecla);
    });
  }, []);

  return (
    <div
      className="tela"
      // `justifyContent: center` distribui o que sobrar em cima e embaixo
      // do bloco inteiro, em vez de empurrar tudo para as pontas.
      style={{
        padding: '96px var(--tt-padding-interno) 56px',
        gap: 40,
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>
        <h1 className="tituloDeTela">Digite seu CPF</h1>
        <p className="corpo">Apenas números. Não é preciso digitar pontos ou traço.</p>
      </div>

      <div
        // `textbox` + `readonly` e a leitura honesta do que isto e: um campo
        // que mostra valor e nao aceita digitacao direta.
        role="textbox"
        aria-readonly
        aria-label="CPF"
        data-testid="campo-de-cpf"
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 132,
          flexShrink: 0,
          padding: '0 40px',
          borderRadius: 'var(--tt-raio-botao)',
          background: 'var(--ah-totem-bg-surface)',
          // A borda vira `brand/500` quando os 11 digitos estao completos.
          border: `var(--tt-borda) solid ${
            completo ? 'var(--ah-totem-brand-500)' : 'var(--ah-totem-border-default)'
          }`,
        }}
      >
        <span
          data-numerico
          style={{
            fontFamily: 'var(--tt-fonte-mono)',
            fontSize: 52,
            fontWeight: 600,
            letterSpacing: '0.04em',
            color:
              digitos === ''
                ? 'var(--ah-totem-text-tertiary)'
                : 'var(--ah-totem-text-primary)',
          }}
        >
          {mascararCpf(digitos)}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
          flexShrink: 0,
        }}
      >
        {TECLAS.map((tecla) => (
          <button
            key={tecla}
            type="button"
            onClick={() => {
              pressionar(tecla);
            }}
            aria-label={tecla === 'apagar' ? 'Apagar último dígito' : tecla}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Tecla de 132 px -- DS-TOTEM.md §2.4.
              height: 'var(--tt-alvo-tecla)',
              border: 'var(--tt-borda) solid var(--ah-totem-border-default)',
              borderRadius: 'var(--tt-raio-botao)',
              background: 'var(--ah-totem-bg-surface)',
              fontSize: tecla === '0' || tecla.length === 1 ? 40 : 26,
              fontWeight: 700,
              color:
                tecla === '0' || tecla.length === 1
                  ? 'var(--ah-totem-text-primary)'
                  : 'var(--ah-totem-text-secondary)',
            }}
          >
            {tecla === 'apagar' ? '⌫' : tecla}
          </button>
        ))}
      </div>

      {/*
        O vao entre o teclado e as acoes. Ele existe -- as teclas nao podem
        encostar em "Continuar", senao o polegar que erra a tecla `0` aciona
        o CTA -- mas nao come a tela inteira: a 1920 px o teclado ficava no
        terco de cima e as acoes no rodape, com um buraco de 600 px no meio
        que fazia a tela parecer quebrada. `max-height` limita o vao; o que
        sobra vai para o `padding` do contêiner.
      */}
      <span style={{ flex: 1, maxHeight: 120 }} />

      <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
        <button
          type="button"
          className="botaoSecundario"
          style={{ flex: 1, minHeight: 'var(--tt-alvo-cta)', background: 'transparent' }}
          onClick={aoVoltar}
        >
          Voltar
        </button>
        <button
          type="button"
          className="ctaPrimario"
          style={{ flex: 2 }}
          // Travado ate os 11 digitos -- e tambem enquanto a chamada corre,
          // senao dois toques abrem duas sessoes para o mesmo aluno.
          disabled={!completo || ocupado}
          data-testid="confirmar-cpf"
          onClick={() => {
            aoConfirmar(digitos);
          }}
        >
          {ocupado ? 'Entrando…' : 'Continuar'}
        </button>
      </div>

      <p
        style={{
          flexShrink: 0,
          fontSize: 'var(--tt-minimo)',
          color: 'var(--ah-totem-text-secondary)',
          textAlign: 'center',
        }}
      >
        {/* Diz quantos faltam sem exibir o valor: util em pe, sem PII extra. */}
        {completo
          ? 'CPF completo. Toque em Continuar.'
          : `Faltam ${String(DIGITOS_DO_CPF - digitos.length)} dígito(s).`}
      </p>
    </div>
  );
}
