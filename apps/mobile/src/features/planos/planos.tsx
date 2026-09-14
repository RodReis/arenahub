import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { stateLabel, type Tone } from '@arenahub/ui/domain';

import { Badge } from '../../ui/Badge.js';
import { Botao } from '../../ui/Botao.js';
import { CardDeLista, LinhaDeLista } from '../../ui/CardDeLista.js';
import { EstadoDeEspera } from '../../ui/EstadoDeEspera.js';
import { ICONE_DO_TOM } from '../../ui/icones.js';
import { Segmentado } from '../../ui/Segmentado.js';
import { Indisponivel, TituloDaTela } from '../../ui/Tela.js';
import { ARTES } from '../../ui/artes.js';
import { rgba, useTema, type Tom } from '../../ui/theme.js';
import type { StatusDaTentativa } from '../financeiro/usar-status-da-tentativa.js';
import type { DadosDaCobranca, DadosDoFinanceiro, DadosDoPlano, InvoiceDoApp, SituacaoDoPlano } from './tipos.js';

/**
 * Faturas que o aluno pode pagar pelo app -- espelha `podeTransicionar` do
 * `criar-cobranca-pix.use-case.ts`. So decide se MOSTRA o pagamento; o
 * backend recusa de qualquer forma (`M4-BR-008`).
 */
const STATUS_PAGAVEL = new Set(['OPEN', 'OVERDUE']);

const APARENCIA_DO_PLANO: Record<SituacaoDoPlano, { texto: string; tom: Tom }> = {
  ACTIVE: { texto: 'Ativo', tom: 'ok' },
  SCHEDULED: { texto: 'Agendado', tom: 'info' },
  SUSPENDED: { texto: 'Suspenso', tom: 'warn' },
  REVOKED: { texto: 'Cancelado', tom: 'err' },
  EXPIRED: { texto: 'Vencido', tom: 'err' },
};

const TOM_DO_TONE: Record<Tone, Tom> = {
  success: 'ok',
  warning: 'warn',
  danger: 'err',
  info: 'info',
  risk: 'warn',
  neutral: 'info',
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function data(iso: string): { dia: string; mes: string; ano: string; nomeDoMes: string } {
  const d = new Date(iso);
  return {
    dia: d.getUTCDate().toString().padStart(2, '0'),
    mes: (d.getUTCMonth() + 1).toString().padStart(2, '0'),
    ano: d.getUTCFullYear().toString(),
    nomeDoMes: MESES[d.getUTCMonth()] ?? '',
  };
}

/**
 * `12990` centavos -> `R$ 129,90`.
 *
 * INTEIRO ATE O FIM (regra de arquitetura 6): reais e centavos saem de divisao
 * inteira e resto, nunca de `valor / 100` em ponto flutuante. So BRL chega ao
 * app hoje; outra moeda aparece com o proprio codigo em vez de `R$` errado.
 */
export function formatarDinheiro(centavos: number, moeda: string): string {
  const sinal = centavos < 0 ? '−' : '';
  const absoluto = Math.abs(Math.trunc(centavos));
  const reais = Math.trunc(absoluto / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  const resto = (absoluto % 100).toString().padStart(2, '0');

  return `${sinal}${moeda === 'BRL' ? 'R$' : moeda} ${reais},${resto}`;
}

export interface PagamentoDoApp {
  readonly iniciar: (invoiceId: string, metodo: 'pix' | 'checkout') => Promise<DadosDaCobranca>;
  readonly onCopiar: (copiaECola: string) => void;
  readonly onAbrirCheckout: (url: string) => void;
}

/**
 * Aba Planos do App Mobile v2 -- plano atual, fatura a pagar e historico.
 *
 * ESTA TELA NAO DERIVA ESTADO (`M4-FR-006`, `M4-BR-008`): situacao do plano e
 * status da fatura vem prontos. Nao ha `if (vencimento < hoje)` aqui.
 *
 * O FORMULARIO DE CARTAO DO PROTOTIPO NAO EXISTE AQUI, e nao existira: o app
 * nunca coleta numero, validade ou CVV (INV-098). "Cartão" abre o checkout
 * hospedado do PROVEDOR, e o retorno dele nao confirma nada (`M4-BR-001`).
 */
export function Planos({
  plano,
  financeiro,
  cobranca,
  statusDaTentativa,
  pagamento,
  onCobranca,
  onPagamentoConcluido,
  testID,
}: {
  plano: DadosDoPlano | null;
  financeiro: DadosDoFinanceiro | null;
  /** A cobranca em curso -- vive na rota para o polling sobreviver a troca de aba de pagamento. */
  cobranca: DadosDaCobranca | null;
  statusDaTentativa: StatusDaTentativa | null;
  pagamento: PagamentoDoApp;
  onCobranca: (cobranca: DadosDaCobranca | null) => void;
  onPagamentoConcluido: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  const aPagar =
    financeiro !== null && financeiro.status !== 'UNAVAILABLE'
      ? [...financeiro.invoices]
          .filter((invoice) => STATUS_PAGAVEL.has(invoice.status))
          .sort((a, b) => a.vencimentoEm.localeCompare(b.vencimentoEm) || a.invoiceId.localeCompare(b.invoiceId))[0]
      : undefined;

  const pagas =
    financeiro !== null && financeiro.status !== 'UNAVAILABLE'
      ? [...financeiro.invoices]
          .filter((invoice) => invoice.pagoEm !== null)
          .sort((a, b) => (b.pagoEm ?? '').localeCompare(a.pagoEm ?? '') || a.invoiceId.localeCompare(b.invoiceId))
      : [];

  return (
    <View testID={testID} style={estilos.pilha}>
      <TituloDaTela>Planos</TituloDaTela>

      {plano === null || plano.status === 'UNAVAILABLE' ? (
        <Indisponivel oQue="Seu plano" testID="plano-indisponivel" />
      ) : (
        <CartaoDoPlano dados={plano} />
      )}

      {financeiro === null || financeiro.status === 'UNAVAILABLE' ? (
        <Indisponivel oQue="Suas faturas" testID="financeiro-indisponivel" />
      ) : aPagar ? (
        <PagamentoDaFatura
          invoice={aPagar}
          cobranca={cobranca}
          status={statusDaTentativa}
          pagamento={pagamento}
          onCobranca={onCobranca}
          onConcluido={onPagamentoConcluido}
        />
      ) : null}

      {financeiro !== null && financeiro.status !== 'UNAVAILABLE' ? (
        <CardDeLista titulo="Histórico de pagamentos" testID="historico-pagamentos">
          {pagas.length === 0 ? (
            <LinhaDeLista primeira>
              <Text style={{ color: t.cor.text.muted, fontSize: 13, fontFamily: t.fonte(400) }}>
                Nenhum pagamento registrado ainda.
              </Text>
            </LinhaDeLista>
          ) : (
            pagas.map((invoice, indice) => {
              const venc = data(invoice.vencimentoEm);
              const pago = data(invoice.pagoEm ?? invoice.vencimentoEm);
              const rotulo = stateLabel('invoice', invoice.status);
              const tom = rotulo ? TOM_DO_TONE[rotulo.tone] : 'ok';
              const Icone = ICONE_DO_TOM[tom];

              return (
                <LinhaDeLista key={invoice.invoiceId} primeira={indice === 0} testID={`pagamento-${invoice.invoiceId}`}>
                  <View style={estilos.flex}>
                    <Text style={{ color: t.cor.text.primary, fontSize: 14, fontFamily: t.fonte(500) }}>
                      {`Fatura de ${venc.nomeDoMes}`}
                    </Text>
                    <Text style={{ color: t.cor.text.muted, fontSize: 12, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
                      {`Pago em ${pago.dia}/${pago.mes}/${pago.ano}`}
                    </Text>
                  </View>
                  <Text style={{ color: t.cor.text.secondary, fontSize: 14, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
                    {formatarDinheiro(invoice.valorEmCentavos, invoice.moeda)}
                  </Text>
                  <Badge tom={tom} texto={rotulo?.label ?? invoice.status} icone={<Icone tom={tom} tamanho={12} />} />
                </LinhaDeLista>
              );
            })
          )}
        </CardDeLista>
      ) : null}
    </View>
  );
}

function CartaoDoPlano({ dados }: { dados: DadosDoPlano }) {
  const t = useTema();

  if (!dados.plano) {
    return (
      <View style={[estilos.semPlano, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
        <Text style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>Sem plano ativo</Text>
        <Text testID="plano-vazio" style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
          Não encontramos nenhum plano no seu cadastro. Fale com a recepção da academia.
        </Text>
      </View>
    );
  }

  const { situacao, nome, inicioEm, fimEm } = dados.plano;
  const aparencia = APARENCIA_DO_PLANO[situacao];
  const Icone = ICONE_DO_TOM[aparencia.tom];
  const inicio = data(inicioEm);
  const fim = data(fimEm);

  return (
    <View testID="cartao-plano" style={[estilos.plano, { borderRadius: t.radius.card + 2 }]}>
      <Image
        source={ARTES.cartao3d}
        style={[StyleSheet.absoluteFill, estilos.planoArte]}
        resizeMode="cover"
      />
      <LinearGradient
        colors={[rgba(t.cor.bg.app, 0.9), rgba(t.cor.bg.app, 0.6), rgba(t.cor.bg.app, 0.2)]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={estilos.linhaEntre}>
        <Text style={{ color: t.cor.accent.text, fontSize: 11, letterSpacing: 1.3, fontFamily: t.fonte(700) }}>PLANO ATUAL</Text>
        <Badge tom={aparencia.tom} texto={aparencia.texto} icone={<Icone tom={aparencia.tom} />} testID="plano-situacao" />
      </View>

      <View>
        <Text
          testID={nome === null ? 'plano-nome-ausente' : 'plano-nome'}
          style={{ color: t.cor.text.onImage, fontSize: 24, letterSpacing: -0.5, fontFamily: t.fonte(800) }}
        >
          {/* Cortesia, visitante, dependente: nao ha plano a nomear -- e nao se inventa um. */}
          {nome ?? 'Acesso sem plano assinado'}
        </Text>
        <Text style={{ color: t.cor.text.onImageMuted, fontSize: 14, lineHeight: 20, marginTop: 4, maxWidth: 250, fontFamily: t.fonte(400) }}>
          {situacao === 'ACTIVE'
            ? 'Seu acesso está liberado.'
            : situacao === 'SCHEDULED'
              ? `Seu acesso começa em ${inicio.dia}/${inicio.mes}/${inicio.ano}.`
              : 'Fale com a recepção para regularizar seu acesso.'}
        </Text>
      </View>

      <View style={estilos.planoRodape}>
        <Text style={{ color: t.cor.text.secondary, fontSize: 12, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
          Desde <Text style={{ color: t.cor.text.onImage, fontFamily: t.fonte(700) }}>{`${inicio.dia}/${inicio.mes}/${inicio.ano}`}</Text>
        </Text>
        <Text style={{ color: t.cor.text.secondary, fontSize: 12, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
          Até <Text style={{ color: t.cor.text.onImage, fontFamily: t.fonte(700) }}>{`${fim.dia}/${fim.mes}/${fim.ano}`}</Text>
        </Text>
      </View>
    </View>
  );
}

function PagamentoDaFatura({
  invoice,
  cobranca,
  status,
  pagamento,
  onCobranca,
  onConcluido,
}: {
  invoice: InvoiceDoApp;
  cobranca: DadosDaCobranca | null;
  status: StatusDaTentativa | null;
  pagamento: PagamentoDoApp;
  onCobranca: (cobranca: DadosDaCobranca | null) => void;
  onConcluido: () => void;
}) {
  const t = useTema();
  const [metodo, setMetodo] = useState<'pix' | 'checkout'>('pix');
  const [iniciando, setIniciando] = useState(false);
  const [erro, setErro] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const venc = data(invoice.vencimentoEm);
  const rotulo = stateLabel('invoice', invoice.status);
  const tom = rotulo ? TOM_DO_TONE[rotulo.tone] : 'info';
  const Icone = ICONE_DO_TOM[tom];
  const valor = formatarDinheiro(invoice.valorEmCentavos, invoice.moeda);

  const iniciar = (alvo: 'pix' | 'checkout') => {
    setErro(false);
    setIniciando(true);
    void pagamento
      .iniciar(invoice.invoiceId, alvo)
      .then((nova) => {
        onCobranca(nova);
        if (alvo === 'checkout' && nova.checkoutUrl) {
          pagamento.onAbrirCheckout(nova.checkoutUrl);
          setAguardando(true);
        }
      })
      .catch(() => setErro(true))
      .finally(() => setIniciando(false));
  };

  const cabecalho = (
    <View
      testID="fatura-a-pagar"
      style={[estilos.fatura, { backgroundColor: t.cor.bg.raised, borderRadius: t.radius.card }]}
    >
      <View style={estilos.linhaEntre}>
        <Text style={{ color: t.cor.text.secondary, fontSize: 13, fontFamily: t.fonte(400) }}>{`Fatura de ${venc.nomeDoMes}`}</Text>
        <Badge tom={tom} texto={rotulo?.label ?? invoice.status} icone={<Icone tom={tom} />} testID="fatura-status" />
      </View>
      <View style={estilos.linhaBase}>
        <Text style={{ color: t.cor.text.primary, fontSize: 30, fontVariant: ['tabular-nums'], fontFamily: t.fonte(700) }}>{valor}</Text>
        <Text style={{ color: t.cor.text.secondary, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
          {`${invoice.status === 'OVERDUE' ? 'venceu' : 'vence'} em ${venc.dia}/${venc.mes}`}
        </Text>
      </View>
    </View>
  );

  if (status?.status === 'SUCCEEDED') {
    return (
      <>
        {cabecalho}
        <View style={[estilos.centro, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
          <Badge tom="ok" texto="Pagamento confirmado" icone={<ICONE_DO_TOM.ok tom="ok" />} testID="pagamento-confirmado" />
          <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: t.fonte(400) }}>
            A academia recebeu o pagamento desta fatura.
          </Text>
          <Botao titulo="Concluir" emCard onPress={onConcluido} testID="botao-concluir-pagamento" />
        </View>
      </>
    );
  }

  if (status?.status === 'FAILED') {
    return (
      <>
        {cabecalho}
        <View style={[estilos.centro, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
          <Text style={{ color: t.cor.text.primary, fontSize: 18, fontFamily: t.fonte(700) }}>Pagamento não concluído</Text>
          <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: t.fonte(400) }}>
            Tente novamente ou escolha outra forma de pagamento.
          </Text>
          <Botao
            titulo="Tentar de novo"
            emCard
            onPress={() => {
              setAguardando(false);
              onCobranca(null);
            }}
            testID="botao-tentar-de-novo"
          />
        </View>
      </>
    );
  }

  if (aguardando && cobranca) {
    return (
      <>
        {cabecalho}
        {/* Espera NUNCA diz "Pago" -- so o webhook confirma (`M4-BR-001`). */}
        <EstadoDeEspera prazo="poucos segundos" onVoltar={() => setAguardando(false)} testID="pagamento-aguardando" />
      </>
    );
  }

  return (
    <>
      {cabecalho}
      <Segmentado
        opcoes={[
          { valor: 'pix', rotulo: 'PIX' },
          { valor: 'checkout', rotulo: 'Cartão' },
        ]}
        valor={metodo}
        onMudar={setMetodo}
        testID="metodo"
      />

      <View style={[estilos.metodo, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card, borderColor: t.cor.border.hairline }]}>
        {erro ? (
          <Text testID="pagamento-erro" style={{ color: t.cor.state.err, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(500) }}>
            Não foi possível iniciar o pagamento agora. Tente novamente.
          </Text>
        ) : null}

        {metodo === 'pix' ? (
          cobranca && cobranca.copiaECola ? (
            <>
              <View style={[estilos.qr, { backgroundColor: t.cor.optico.qrBackground }]}>
                <Image
                  testID="cobranca-qr"
                  source={{ uri: cobranca.qrCodeDataUri }}
                  style={estilos.qrImagem}
                  accessibilityLabel="QR code de pagamento PIX"
                />
              </View>
              <View style={[estilos.copiaECola, { backgroundColor: t.cor.bg.app, borderColor: t.cor.border.hairline }]}>
                <Text numberOfLines={1} style={{ flex: 1, color: t.cor.text.secondary, fontSize: 12, fontFamily: t.mono }}>
                  {cobranca.copiaECola}
                </Text>
                <Pressable
                  onPress={() => {
                    pagamento.onCopiar(cobranca.copiaECola ?? '');
                    setCopiado(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Copiar código PIX"
                  testID="cobranca-copiar"
                  hitSlop={8}
                  style={({ pressed }) => [estilos.copiar, { backgroundColor: pressed ? t.cor.border.hairline : t.cor.bg.raised }]}
                >
                  <Text style={{ color: t.cor.accent.text, fontSize: 12, fontFamily: t.fonte(600) }}>{copiado ? 'copiado' : 'copiar'}</Text>
                </Pressable>
              </View>
              <Botao titulo="Já fiz o PIX" onPress={() => setAguardando(true)} testID="botao-ja-fiz-pix" />
            </>
          ) : (
            <>
              <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
                Gere o código e pague pelo app do seu banco. A confirmação chega sozinha.
              </Text>
              <Botao titulo="Gerar código PIX" onPress={() => iniciar('pix')} carregando={iniciando} testID="pagamento-pix" />
            </>
          )
        ) : (
          <>
            <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
              O pagamento com cartão abre a página segura do provedor de pagamento. O app não pede nem guarda os dados do cartão.
            </Text>
            <Botao titulo={`Pagar ${valor}`} onPress={() => iniciar('checkout')} carregando={iniciando} testID="pagamento-checkout" />
          </>
        )}
      </View>
    </>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 14,
  },
  flex: {
    flex: 1,
  },
  linhaEntre: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  linhaBase: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  plano: {
    minHeight: 176,
    paddingVertical: 18,
    paddingHorizontal: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    gap: 12,
  },
  planoArte: {
    width: '100%',
    height: '100%',
  },
  planoRodape: {
    flexDirection: 'row',
    gap: 16,
  },
  semPlano: {
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 8,
  },
  fatura: {
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 8,
  },
  metodo: {
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  centro: {
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 12,
  },
  qr: {
    alignSelf: 'center',
    borderRadius: 12,
    padding: 14,
  },
  qrImagem: {
    width: 180,
    height: 180,
  },
  copiaECola: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 8,
  },
  copiar: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
});
