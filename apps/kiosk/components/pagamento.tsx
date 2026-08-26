'use client';

import { useEffect, useState } from 'react';

import { formatarDinheiro } from '../lib/dinheiro';
import {
  cobrarPorCartao,
  cobrarPorPix,
  observarCobranca,
  type CobrancaDoTotem,
  type SessaoDoAluno,
} from '../lib/kiosk-client';
import { IconeConfirmado } from './icones';

const INTERVALO_DE_POLLING_MS = 3_000;

/** Estados terminais da fatura -- o laço para em qualquer um deles. */
const TERMINAIS = new Set(['PAID', 'CANCELLED', 'REFUNDED']);

type Etapa =
  | { nome: 'escolha' }
  | { nome: 'carregando' }
  | { nome: 'qr'; cobranca: CobrancaDoTotem }
  | { nome: 'confirmado' }
  | { nome: 'falhou' };

/**
 * Pagamento no totem -- `DS-TOTEM.md` §5.6, ADR-043 Decisao 4.
 *
 * DOIS QRs, e o totem nao tem teclado de cartao. No PIX o QR e a cobranca;
 * no cartao o QR abre o CHECKOUT HOSPEDADO no celular do aluno. Em nenhum
 * dos dois o totem ve PAN, CVV ou token -- ele segue fora do escopo PCI
 * (INV-098).
 *
 * `M4-BR-001` -- O RETORNO VISUAL NUNCA CONFIRMA PAGAMENTO. Esta tela so
 * exibe "confirmado" depois que o BACKEND diz que a fatura esta paga, e
 * quem paga a fatura e o webhook do provedor. Nao ha caminho em que tocar
 * um botao aqui libere acesso: a catraca le entitlement, e entitlement e
 * promovido pela cadeia do MVP 2 (regra de arquitetura no 1).
 */
export function Pagamento({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>({ nome: 'escolha' });

  const escolher = async (forma: 'PIX' | 'CARD') => {
    setEtapa({ nome: 'carregando' });

    const cobranca =
      forma === 'PIX'
        ? await cobrarPorPix(sessao.sessionId, sessao.token)
        : await cobrarPorCartao(sessao.sessionId, sessao.token);

    setEtapa(cobranca === null ? { nome: 'falhou' } : { nome: 'qr', cobranca });
  };

  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">Pagamento</h1>

      {etapa.nome === 'escolha' && (
        <EscolhaDeForma
          aoEscolher={(forma) => {
            void escolher(forma);
          }}
        />
      )}

      {etapa.nome === 'carregando' && (
        <p className="corpo" data-testid="pagamento-carregando">
          Preparando a cobrança…
        </p>
      )}

      {etapa.nome === 'qr' && (
        <QrDaCobranca
          sessao={sessao}
          cobranca={etapa.cobranca}
          aoConfirmar={() => setEtapa({ nome: 'confirmado' })}
        />
      )}

      {etapa.nome === 'confirmado' && <Confirmado />}

      {etapa.nome === 'falhou' && (
        <p className="corpo" data-testid="pagamento-falhou">
          Não foi possível gerar a cobrança agora. Procure a recepção.
        </p>
      )}

      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>
    </div>
  );
}

/** As duas formas, lado a lado -- o aluno escolhe (ADR-043, Decisao 4). */
function EscolhaDeForma({ aoEscolher }: { readonly aoEscolher: (f: 'PIX' | 'CARD') => void }) {
  return (
    <div className="escolhaDeForma">
      <button
        type="button"
        className="ctaPrimario"
        data-testid="forma-pix"
        onClick={() => aoEscolher('PIX')}
      >
        Pagar com PIX
      </button>

      <button
        type="button"
        className="botaoSecundario"
        data-testid="forma-cartao"
        onClick={() => aoEscolher('CARD')}
      >
        Pagar com cartão
      </button>

      {/*
        A frase diz onde o cartao e digitado. Sem ela, o aluno procura um
        leitor de cartao no totem -- que nao existe, de proposito.
      */}
      <p className="metadado">
        No cartão, o QR abre a página de pagamento no seu celular. O totem não lê cartão.
      </p>
    </div>
  );
}

function QrDaCobranca({
  sessao,
  cobranca,
  aoConfirmar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly cobranca: CobrancaDoTotem;
  readonly aoConfirmar: () => void;
}) {
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    /*
     * `setTimeout` ENCADEADO, e nao `setInterval`: com intervalo fixo, uma
     * consulta lenta faria a proxima disparar por cima da anterior, e as
     * chamadas se empilhariam enquanto a rede da academia estivesse ruim.
     * Aqui a proxima so e agendada quando a anterior terminou.
     */
    const agendar = () => {
      timer = setTimeout(() => {
        void (async () => {
          const estado = await observarCobranca(
            sessao.sessionId,
            sessao.token,
            cobranca.paymentAttemptId,
          );

          /*
           * `vivo` conferido DEPOIS do `await`: a sessao pode ter encerrado
           * durante a consulta, e chamar `aoConfirmar` num componente ja
           * desmontado mostraria a tela de confirmacao para o PROXIMO aluno.
           */
          if (!vivo) return;

          if (estado !== null && TERMINAIS.has(estado.statusDaFatura)) {
            if (estado.statusDaFatura === 'PAID') aoConfirmar();

            return;
          }

          agendar();
        })();
      }, INTERVALO_DE_POLLING_MS);
    };

    agendar();

    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [sessao.sessionId, sessao.token, cobranca.paymentAttemptId, aoConfirmar]);

  return (
    <div className="blocoDoQr" data-testid="bloco-do-qr">
      {/*
        O QR SEMPRE SOBRE BRANCO (`DS-TOTEM.md` §5.6): sobre o carbono do
        totem, a maioria dos leitores nao encontra o padrao.
      */}
      <div className="cartaoDoQr">
        {/*
          `<img>` cru, e nao `next/image`: a fonte e uma `data:` URI vinda
          do provedor, que o otimizador do Next nao processa -- e o totem
          serve tudo do cache local, sem loader de imagem remota.

          `alt` vazio de proposito: o QR nao e alcancavel por leitor de
          tela, e a instrucao textual logo abaixo e que carrega o
          significado. Um `alt` descritivo aqui leria o data-URI inteiro.
        */}
        <img src={cobranca.qrCodeDataUri} alt="" width={320} height={320} />
      </div>

      {/*
        O VALOR APARECE AQUI, e so aqui: e a etapa de acao deliberada do
        aluno (`DS-TOTEM.md` §9.1). A tela anterior diz que ha pendencia,
        sem dizer quanto.
      */}
      <p className="valorDaCobranca" data-testid="valor-da-cobranca">
        {formatarDinheiro(cobranca.valorEmCentavos, cobranca.moeda)}
      </p>

      <p className="corpo">
        {cobranca.forma === 'PIX'
          ? 'Abra o app do seu banco, escolha PIX e aponte a câmera para o código.'
          : 'Aponte a câmera do seu celular para o código e conclua o pagamento por lá.'}
      </p>

      {/*
        NAO CONFIRMA NADA (`M4-BR-001`). A tela troca sozinha quando o
        backend confirmar; este aviso existe para o aluno nao ficar
        esperando um botao que nao deve existir.
      */}
      <p className="metadado" data-testid="aviso-de-confirmacao">
        Assim que o pagamento cair, esta tela muda sozinha. Não é preciso avisar ninguém.
      </p>
    </div>
  );
}

/** §5.6 -- confirmado, e o que o aluno faz em seguida. */
function Confirmado() {
  return (
    <div className="blocoConfirmado" data-testid="pagamento-confirmado">
      <span style={{ color: 'var(--ah-totem-state-success)' }}>
        <IconeConfirmado tamanho={120} />
      </span>

      <p className="tituloDeTela">Pagamento confirmado</p>

      {/*
        A frase do DS: o acesso ja esta liberado NA CATRACA. O totem nao
        libera nada -- ele conta o que a cadeia do MVP 2 ja fez.
      */}
      <p className="corpo">Seu acesso já está liberado na catraca.</p>
    </div>
  );
}
