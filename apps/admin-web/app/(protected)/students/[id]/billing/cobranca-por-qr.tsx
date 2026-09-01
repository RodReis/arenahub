'use client';

import { useEffect, useRef, useState } from 'react';

import { Button, Money } from '@arenahub/ui';

import type {
  EstadoDoRecibo,
  EstadoDoStatusAtivo,
  TentativaObservada,
} from '../../../../actions/billing';
import estilos from './cobranca-por-qr.module.css';

/**
 * As tres Server Actions default sao importadas DINAMICAMENTE, dentro da
 * funcao -- nunca no topo do modulo. `app/actions/billing.ts` importa
 * `server-only` (via `server-client.ts`); um import estatico aqui faria
 * QUALQUER teste deste Client Component quebrar ao carregar o modulo,
 * mesmo passando as tres funcoes por prop. So os tipos entram estaticos
 * (`import type`, apagado em tempo de compilacao).
 */
async function consultarPadrao(
  paymentAttemptId: string,
): Promise<TentativaObservada | { erro: string }> {
  const { consultarTentativa } = await import('../../../../actions/billing');
  const resultado = await consultarTentativa(paymentAttemptId);

  if (resultado.erro || !resultado.dados) {
    return { erro: resultado.erro ?? 'Não foi possível consultar o pagamento.' };
  }

  return resultado.dados;
}

async function consultarStatusPadrao(paymentAttemptId: string): Promise<EstadoDoStatusAtivo> {
  const { consultarStatusAtivo } = await import('../../../../actions/billing');
  return consultarStatusAtivo(paymentAttemptId);
}

async function emitirReciboPadrao(paymentId: string): Promise<EstadoDoRecibo> {
  const { emitirReciboDoPagamento } = await import('../../../../actions/billing');
  return emitirReciboDoPagamento(paymentId);
}

async function consultarReciboPadrao(receiptId: string): Promise<EstadoDoRecibo> {
  const { consultarReciboEmitido } = await import('../../../../actions/billing');
  return consultarReciboEmitido(receiptId);
}

const INTERVALO_DE_POLLING_MS = 3_000;

/** Estados terminais da invoice -- o laco para em qualquer um deles. */
const STATUS_TERMINAL = new Set(['PAID', 'CANCELLED', 'REFUNDED']);

interface Props {
  readonly paymentAttemptId: string;
  readonly qrCodeDataUri: string | null;
  readonly copiaECola: string | null;
  readonly checkoutUrl: string | null;
  /** ISO 8601. Vem pronto da resposta de criacao da cobranca -- nunca refeito aqui. */
  readonly expiresAt: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  /**
   * Injetadas por prop -- para o teste nao precisar de servidor. Em producao
   * sao as tres Server Actions de `app/actions/billing.ts`.
   */
  readonly consultar?: (paymentAttemptId: string) => Promise<TentativaObservada | { erro: string }>;
  readonly consultarStatus?: (paymentAttemptId: string) => Promise<EstadoDoStatusAtivo>;
  readonly emitirRecibo?: (paymentId: string) => Promise<EstadoDoRecibo>;
  readonly consultarRecibo?: (receiptId: string) => Promise<EstadoDoRecibo>;
}

/**
 * QR, polling controlado e recibo -- F53, Task 11.
 *
 * A CENA REAL: a recepcionista gerou o QR, o aluno paga pelo celular, e a
 * tela tem de mudar SOZINHA quando a confirmacao chegar -- sem ninguem
 * apertar nada. O webhook chega no backend, nunca no navegador.
 *
 * O LACO CONSULTA `GET /payment-attempts/:id` (leitura barata do nosso
 * banco), NUNCA `GET /payments/:id/status` (bate no provedor a cada
 * chamada). Essa e a decisao de arquitetura que nao pode ser invertida --
 * ver `ConsultarTentativaUseCase` em `apps/api`. `consultarStatusAtivo` so
 * roda por clique, no botao "Conferir com o banco".
 *
 * O LACO PARA em tres condicoes: estado terminal da invoice, QR expirado, ou
 * o componente saiu da tela (cleanup do `useEffect`). A recepcao deixa esta
 * tela aberta o expediente inteiro -- um laco que nao para consome a API o
 * dia todo, por caixa.
 */
export function CobrancaPorQr({
  paymentAttemptId,
  qrCodeDataUri,
  copiaECola,
  checkoutUrl,
  expiresAt,
  amountMinor,
  currency,
  consultar = consultarPadrao,
  consultarStatus = consultarStatusPadrao,
  emitirRecibo = emitirReciboPadrao,
  consultarRecibo = consultarReciboPadrao,
}: Props) {
  const jaExpirado = new Date(expiresAt).getTime() <= Date.now();

  const [tentativa, setTentativa] = useState<TentativaObservada | null>(null);
  const [expirado, setExpirado] = useState(jaExpirado);
  const [consultaAtiva, setConsultaAtiva] = useState<EstadoDoStatusAtivo | null>(null);
  const [consultandoAgora, setConsultandoAgora] = useState(false);
  const [recibo, setRecibo] = useState<EstadoDoRecibo['sucesso'] | null>(null);
  const [emitindoRecibo, setEmitindoRecibo] = useState(false);
  const [erroDoRecibo, setErroDoRecibo] = useState<string | null>(null);
  const reciboPedidoRef = useRef(false);
  /**
   * O laco ja consultou alguma vez? Guarda de REMONTAGEM.
   *
   * `pago` esta nas deps do efeito, entao vira-lo remonta o laco -- e
   * remontagem dispara a consulta de abertura na hora, gastando uma chamada
   * a mais por ciclo. Com a ref, so a PRIMEIRA montagem abre consultando; as
   * seguintes esperam o proximo tick.
   */
  const jaConsultouRef = useRef(false);

  const pago = tentativa !== null && STATUS_TERMINAL.has(tentativa.invoiceStatus);

  useEffect(() => {
    // QR ja nasceu expirado -- nem comeca a consultar (2a condicao de parada).
    /**
     * PARA NO TERMINAL -- MENOS ENQUANTO FALTA O RECIBO (FIX #165).
     *
     * `pago` NAO entra nesta condicao de guarda, so nas deps. Quem desliga o
     * laco e o `return` de dentro de `consultarUmaVez`, e ele so desliga
     * tendo COM QUE emitir (`receiptId` ou `paymentId`).
     *
     * A DIFERENCA IMPORTA: parar no instante em que a invoice vira PAID
     * deixava a tela sem recibo para sempre quando aquela MESMA leitura vinha
     * sem os dois campos -- webhook confirmou a invoice, pagamento ainda nao
     * apareceu. Janela estreita, invisivel em dev.
     */
    if (jaExpirado) return;

    /**
     * JA TEM COM QUE EMITIR -- o laco cumpriu o papel e para aqui.
     *
     * Este `return` e o que substitui o antigo `pago` na guarda: para pelo
     * DADO que chegou, nao pelo status sozinho. Ler `tentativa` sem lista-lo
     * nas deps e deliberado: inclui-lo remontaria o efeito a cada leitura, e
     * remontagem dispara `consultarUmaVez` na hora -- uma consulta extra por
     * ciclo, que foi exatamente a regressao que o teste do QR expirado pegou.
     */
    if (pago && Boolean(tentativa?.receiptId ?? tentativa?.paymentId)) return;

    let cancelado = false;

    const consultarUmaVez = async (): Promise<void> => {
      let resultado: TentativaObservada | { erro: string };

      try {
        resultado = await consultar(paymentAttemptId);
      } catch {
        return;
      }

      if (cancelado) return;

      if ('erro' in resultado) return;

      setTentativa(resultado);

      if (
        STATUS_TERMINAL.has(resultado.invoiceStatus) &&
        Boolean(resultado.receiptId ?? resultado.paymentId)
      ) {
        return;
      }

      if (new Date(expiresAt).getTime() <= Date.now()) {
        setExpirado(true);
      }
    };

    if (!jaConsultouRef.current) {
      jaConsultouRef.current = true;
      void consultarUmaVez();
    }

    const idDoIntervalo = setInterval(() => {
      if (new Date(expiresAt).getTime() <= Date.now()) {
        setExpirado(true);
        return;
      }

      void consultarUmaVez();
      // ponytail: sem clearInterval condicional aqui -- o proximo render, ao
      // ver `pago`/`expirado` mudar, desmonta este efeito pelo cleanup abaixo.
    }, INTERVALO_DE_POLLING_MS);

    return () => {
      cancelado = true;
      clearInterval(idDoIntervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `consultar` e prop estavel na tela real; variar so no teste.
  }, [paymentAttemptId, expiresAt, jaExpirado, pago, expirado]);

  /**
   * Recibo em toda confirmacao, nos tres caminhos -- SPEC-053 item 5. So
   * pede uma vez por confirmacao (`reciboPedidoRef`).
   *
   * CONSOME O QUE O POLLING JA TROUXE (FIX #165). A leitura barata devolve
   * `receiptId` quando o recibo ja existe e `paymentId` quando ainda nao:
   * recibo emitido vira UMA consulta, e a emissao usa o pagamento exato da
   * tentativa. Antes, a tela ignorava os dois campos e redescobria tudo com
   * tres viagens a partir do `invoiceId` -- justamente o oposto da razao de
   * a rota do polling existir.
   *
   * `paymentId` nulo com a invoice ja paga e transitorio e possivel: o
   * webhook confirmou a invoice e o pagamento ainda nao apareceu nesta
   * leitura. O `reciboPedidoRef` so e marcado quando ha o que fazer, entao
   * o proximo ciclo do laco tenta de novo em vez de travar sem recibo.
   */
  useEffect(() => {
    if (!pago || reciboPedidoRef.current) return;

    const receiptId = tentativa?.receiptId ?? null;
    const paymentId = tentativa?.paymentId ?? null;

    if (!receiptId && !paymentId) return;

    reciboPedidoRef.current = true;
    setEmitindoRecibo(true);

    void (receiptId ? consultarRecibo(receiptId) : emitirRecibo(paymentId as string))
      .then((resultado) => {
        setEmitindoRecibo(false);

        if (resultado.erro) {
          setErroDoRecibo(resultado.erro);
          return;
        }

        if (resultado.sucesso) {
          setRecibo(resultado.sucesso);
        }
      })
      .catch(() => {
        setEmitindoRecibo(false);
        setErroDoRecibo('Não foi possível emitir o recibo.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `emitirRecibo`/`consultarRecibo` sao props estaveis na tela real; variar so no teste.
  }, [pago, tentativa?.receiptId, tentativa?.paymentId]);

  const conferirComOBanco = (): void => {
    setConsultandoAgora(true);

    void consultarStatus(paymentAttemptId)
      .then((resultado) => {
        setConsultandoAgora(false);
        setConsultaAtiva(resultado);
      })
      .catch(() => {
        setConsultandoAgora(false);
        setConsultaAtiva({ erro: 'Não foi possível consultar o provedor.' });
      });
  };

  if (pago) {
    return (
      <section className={estilos['cobranca']} data-testid="pagamento-confirmado">
        <p className={estilos['confirmado']}>Pagamento confirmado.</p>
        {emitindoRecibo ? <p role="status">Emitindo recibo…</p> : null}
        {recibo ? (
          <p data-testid="recibo-emitido-por-qr">
            Recibo não fiscal nº {recibo.numero} emitido.{' '}
            <code>{recibo.verificationHash.slice(0, 12)}</code>
          </p>
        ) : null}
        {erroDoRecibo ? (
          <p role="alert" data-testid="erro-do-recibo">
            {erroDoRecibo}
          </p>
        ) : null}
      </section>
    );
  }

  if (expirado) {
    return (
      <section className={estilos['cobranca']} data-testid="qr-expirado">
        <p className={estilos['expirado']}>QR expirado. Gere um novo código.</p>
      </section>
    );
  }

  return (
    <section className={estilos['cobranca']} data-testid="cobranca-por-qr-aguardando">
      {typeof amountMinor === 'number' ? (
        <Money cents={amountMinor} {...(currency !== undefined ? { currency } : {})} />
      ) : null}

      {/*
        QR nao e alcancavel por leitor de tela -- o `checkoutUrl` como link e
        o copia-e-cola com botao de copiar sao o CAMINHO EQUIVALENTE, nunca
        um extra.
      */}
      {qrCodeDataUri ? (
        // `width`/`height` batendo com os 200px do `.qr`: o CSS ja reserva o
        // espaco, mas so depois que a folha aplica -- os atributos dao a
        // proporcao ao parser antes disso, e o copia-e-cola abaixo para de
        // saltar quando o QR entra. Mesmo par que o `pagamento.tsx` do totem
        // ja usa no mesmo caso.
        <img
          className={estilos['qr']}
          src={qrCodeDataUri}
          alt="Código QR para pagamento. Use o copia-e-cola ou o link abaixo se não conseguir escanear."
          width={200}
          height={200}
        />
      ) : null}

      {copiaECola ? (
        <div className={estilos['copiaECola']}>
          <code data-testid="pix-copia-e-cola">{copiaECola}</code>
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(copiaECola);
            }}
          >
            Copiar código
          </Button>
        </div>
      ) : null}

      {checkoutUrl ? (
        <p>
          <a href={checkoutUrl} target="_blank" rel="noopener noreferrer">
            Abrir checkout do cartão
          </a>
        </p>
      ) : null}

      <div className={estilos['acoes']}>
        <Button type="button" onClick={conferirComOBanco} disabled={consultandoAgora}>
          {consultandoAgora ? 'Conferindo…' : 'Conferir com o banco'}
        </Button>
      </div>

      {consultaAtiva?.erro ? (
        <p role="alert" data-testid="erro-consulta-ativa">
          {consultaAtiva.erro}
        </p>
      ) : null}
      {consultaAtiva?.dados ? (
        <p role="status" data-testid="resultado-consulta-ativa">
          {consultaAtiva.dados.divergente
            ? 'O provedor já confirmou o pagamento — aguarde a atualização automática ou acione a conciliação.'
            : 'O provedor ainda não confirmou o pagamento.'}
        </p>
      ) : null}
    </section>
  );
}
