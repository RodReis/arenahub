import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Avatar } from '../../ui/Marca.js';
import { Botao } from '../../ui/Botao.js';
import { Card } from '../../ui/Card.js';
import { CardDeLista, LinhaDeLista } from '../../ui/CardDeLista.js';
import { ARTES } from '../../ui/artes.js';
import { nomeParaExibir } from '../../ui/nome.js';
import { rgba, useTema } from '../../ui/theme.js';
import { Traco, type NomeDoTraco } from '../../ui/traco.js';
import type { AvisoDoAluno, TipoDeAviso } from '../avisos/avisos.js';
import type { DadosDaFrequencia } from '../frequencia/frequencia.js';

export interface DadosDaHome {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly saudacao: string;
  readonly versionPolicy: {
    readonly state: 'SUPPORTED' | 'GRACE' | 'BLOCKED';
    readonly updateUrl: string | null;
  };
  /**
   * Avisos nao lidos -- F29.
   *
   * OPCIONAL: vem de uma segunda chamada, e a Home tem de renderizar antes
   * dela voltar. `undefined` e "ainda nao sei", que e diferente de zero.
   */
  readonly naoLidos?: number;
}

/** O desafio aberto que a Home anuncia -- o que termina primeiro. */
export interface DesafioEmDestaque {
  readonly titulo: string;
  readonly meta: number;
  /** `AAAA-MM-DD` */
  readonly fim: string;
  readonly inscrito: boolean;
}

/**
 * As leituras SECUNDARIAS da Home. Cada uma chega por conta propria e nenhuma
 * derruba a tela: `undefined` = ainda carregando ou falhou, e o bloco some em
 * vez de mostrar zero (ausencia nao e zero, DS-APP §10 regra 5).
 */
export interface ComplementosDaHome {
  readonly avisos?: readonly AvisoDoAluno[] | undefined;
  readonly frequencia?: DadosDaFrequencia | undefined;
  /** Semanas seguidas treinando (consistencia F32). */
  readonly sequencia?: number | undefined;
  readonly desafio?: DesafioEmDestaque | null | undefined;
}

const TRACO_DO_AVISO: Record<TipoDeAviso, NomeDoTraco> = {
  BILLING: 'cartao',
  ASSESSMENT: 'balanca',
  MEMBERSHIP: 'calendario',
  GENERAL: 'sino',
};

/** "Boa tarde, Ana" -> ["Boa tarde,", "Ana"]. O servidor ja escolheu o periodo. */
function partirSaudacao(saudacao: string): { periodo: string; nome: string } {
  const indice = saudacao.indexOf(',');
  if (indice < 0) return { periodo: '', nome: saudacao };

  return { periodo: saudacao.slice(0, indice + 1), nome: nomeParaExibir(saudacao.slice(indice + 1)) };
}

/** `2026-09-27` -> `27/09`, sem relogio nem fuso -- e uma data civil. */
function diaMes(dataCivil: string): string {
  const [, mes, dia] = dataCivil.split('-');
  return `${dia ?? ''}/${mes ?? ''}`;
}

/** `2026-09-14T10:00:00.000Z` -> `14/09`. */
function diaMesDoInstante(iso: string): string {
  const data = new Date(iso);
  return `${data.getUTCDate().toString().padStart(2, '0')}/${(data.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

/**
 * Home do App Mobile v2.
 *
 * INDISPONIVEL MOSTRA O SHELL, NUNCA O DADO ANTIGO (`M4-NFR-002`).
 *
 * A Home NAO RECALCULA NADA (`M4-BR-008`): nao ha `if (vencimento < hoje)`
 * aqui. O backend manda o estado pronto e a tela escolhe cor e icone.
 *
 * O botao "Abrir carteirinha" do prototipo NAO esta aqui: a carteirinha com
 * QR foi cortada pelo PI na F24 e segue sem executor (`M4-FR-007`).
 */
export function Home({
  dados,
  complementos = {},
  onAtualizarApp,
  onVerPerfil,
  onVerFrequencia,
  onVerAvisos,
  onAbrirAviso,
  onVerDesafios,
  testID,
}: {
  dados: DadosDaHome;
  complementos?: ComplementosDaHome;
  onAtualizarApp: () => void;
  onVerPerfil: () => void;
  onVerFrequencia: () => void;
  onVerAvisos: () => void;
  onAbrirAviso: (aviso: AvisoDoAluno) => void;
  onVerDesafios: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  if (dados.versionPolicy.state === 'BLOCKED') {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Atualize o aplicativo">
          <Text style={[estilos.corpo, { color: t.cor.text.secondary, fontFamily: t.fonte(400) }]}>
            Esta versão não é mais compatível. Atualize para continuar usando.
          </Text>
          <Botao titulo="Atualizar agora" emCard onPress={onAtualizarApp} testID="botao-atualizar" />
        </Card>
      </View>
    );
  }

  if (dados.status === 'UNAVAILABLE') {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Text accessibilityRole="header" style={[estilos.nome, { color: t.cor.text.primary, fontFamily: t.fonte(800) }]}>
          Clínica de Musculação
        </Text>
        <Card titulo="Sem conexão com a academia">
          <Text style={[estilos.corpo, { color: t.cor.text.secondary, fontFamily: t.fonte(400) }]}>
            Não foi possível atualizar agora. Seus dados aparecem assim que a conexão voltar.
          </Text>
        </Card>
      </View>
    );
  }

  const { periodo, nome } = partirSaudacao(dados.saudacao);
  const { avisos, frequencia, sequencia, desafio } = complementos;

  return (
    <View testID={testID} style={estilos.bloco}>
      <View style={estilos.saudacao}>
        <View style={estilos.flex}>
          <Text style={{ color: t.cor.text.muted, fontSize: 13, fontFamily: t.fonte(400) }}>{periodo}</Text>
          <Text accessibilityRole="header" style={[estilos.nome, { color: t.cor.text.primary, fontFamily: t.fonte(800) }]}>
            {nome}
          </Text>
        </View>
        <Pressable onPress={onVerPerfil} accessibilityRole="button" accessibilityLabel="Abrir perfil" testID="botao-perfil">
          <Avatar nome={nome} />
        </Pressable>
      </View>

      {desafio ? <BannerDoDesafio desafio={desafio} onPress={onVerDesafios} /> : null}

      {frequencia && frequencia.status === 'AVAILABLE' ? (
        <CartaoDeFrequencia frequencia={frequencia} sequencia={sequencia} onPress={onVerFrequencia} />
      ) : null}

      {avisos ? (
        <CardDeLista
          titulo="Avisos da academia"
          acao={{
            rotulo: dados.naoLidos !== undefined && dados.naoLidos > 0 ? `Ver todos (${dados.naoLidos})` : 'Ver todos',
            onPress: onVerAvisos,
            testID: 'botao-avisos',
          }}
          testID="home-avisos"
        >
          {avisos.length === 0 ? (
            <LinhaDeLista primeira>
              <Text style={{ color: t.cor.text.muted, fontSize: 13, fontFamily: t.fonte(400) }}>
                Quando a academia tiver algo para lhe dizer, aparece aqui.
              </Text>
            </LinhaDeLista>
          ) : (
            avisos.slice(0, 3).map((aviso, indice) => (
              <LinhaDeLista
                key={aviso.id}
                primeira={indice === 0}
                onPress={() => onAbrirAviso(aviso)}
                accessibilityLabel={`${aviso.lido ? 'Lido' : 'Não lido'}. ${aviso.titulo}`}
                testID={`home-aviso-${aviso.id}`}
              >
                <View style={[estilos.iconeDoAviso, { backgroundColor: t.cor.bg.raised }]}>
                  <Traco nome={TRACO_DO_AVISO[aviso.tipo]} cor={t.cor.accent.ink} tamanho={15} />
                </View>
                <View style={estilos.flex}>
                  <Text
                    numberOfLines={2}
                    style={{ color: t.cor.text.primary, fontSize: 14, lineHeight: 19, fontFamily: t.fonte(aviso.lido ? 500 : 700) }}
                  >
                    {aviso.titulo}
                  </Text>
                  <Text numberOfLines={1} style={{ color: t.cor.text.muted, fontSize: 12, fontFamily: t.fonte(400) }}>
                    {`${aviso.corpo} · ${diaMesDoInstante(aviso.criadoEm)}`}
                  </Text>
                </View>
                {!aviso.lido ? <View style={[estilos.ponto, { backgroundColor: t.cor.accent.solid }]} /> : null}
              </LinhaDeLista>
            ))
          )}
        </CardDeLista>
      ) : null}
    </View>
  );
}

function BannerDoDesafio({ desafio, onPress }: { desafio: DesafioEmDestaque; onPress: () => void }) {
  const t = useTema();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Desafio da academia: ${desafio.titulo}. Até ${diaMes(desafio.fim)}.`}
      testID="home-desafio"
      style={({ pressed }) => [estilos.banner, { borderRadius: t.radius.card + 2, opacity: pressed ? 0.9 : 1 }]}
    >
      <Image
        source={ARTES.hero3d}
        style={[StyleSheet.absoluteFill, estilos.bannerArte]}
        resizeMode="cover"
      />
      <LinearGradient colors={[rgba(t.cor.bg.app, 0.1), rgba(t.cor.bg.app, 0.85)]} style={StyleSheet.absoluteFill} />
      <View style={estilos.bannerTexto}>
        <View
          style={[
            estilos.selo,
            { backgroundColor: rgba(t.cor.accent.gradientFrom, 0.22), borderColor: rgba(t.cor.accent.text, 0.4) },
          ]}
        >
          <Text style={{ color: t.cor.accent.soft, fontSize: 10, letterSpacing: 1, fontFamily: t.fonte(700) }}>
            {desafio.inscrito ? 'SEU DESAFIO' : 'DESAFIO DA ACADEMIA'}
          </Text>
        </View>
        <Text style={{ color: t.cor.text.onImage, fontSize: 17, lineHeight: 22, fontFamily: t.fonte(700) }}>
          {desafio.titulo}
        </Text>
        <Text style={{ color: t.cor.text.onImageMuted, fontSize: 12, fontFamily: t.fonte(400) }}>
          {`Até ${diaMes(desafio.fim)} · meta de ${desafio.meta} ${desafio.meta === 1 ? 'treino' : 'treinos'}`}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Frequencia de 90 dias em barras semanais.
 *
 * SEMANAL, e nao diaria como o prototipo desenha: a API agrega por semana no
 * minimo (`GRANULARIDADES`), e reconstruir dias no cliente a partir de
 * semanas inventaria em que dia o aluno foi. A barra e proporcional ao maior
 * balde do periodo; semana vazia e um traco baixo, nunca invisivel.
 */
function CartaoDeFrequencia({
  frequencia,
  sequencia,
  onPress,
}: {
  frequencia: DadosDaFrequencia;
  sequencia: number | undefined;
  onPress: () => void;
}) {
  const t = useTema();
  const maior = Math.max(1, ...frequencia.baldes.map((balde) => balde.sessoes));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Frequência dos últimos 90 dias: ${frequencia.totalDeSessoes} treinos. Abrir detalhes.`}
      testID="home-frequencia"
      style={({ pressed }) => [
        estilos.frequencia,
        {
          backgroundColor: pressed ? t.cor.bg.raised : t.cor.bg.surface,
          borderRadius: t.radius.card,
          borderColor: t.cor.border.hairline,
        },
      ]}
    >
      <View style={estilos.linhaEntre}>
        <Text style={{ color: t.cor.text.primary, fontSize: 16, fontFamily: t.fonte(600) }}>Frequência · 90 dias</Text>
        <Text style={{ color: t.cor.text.secondary, fontSize: 13, fontVariant: ['tabular-nums'], fontFamily: t.fonte(400) }}>
          {`${frequencia.totalDeSessoes} ${frequencia.totalDeSessoes === 1 ? 'treino' : 'treinos'}`}
        </Text>
      </View>

      {frequencia.baldes.length > 0 || frequencia.consistencia.semanasElegiveis > 0 ? (
      <View style={estilos.barras} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/*
          Sem balde nenhum, o trilho continua com um traco por semana elegivel:
          zero treino e um fato do periodo, e a semana vazia se desenha baixa,
          nunca some (a revisao final pegou o grafico sumindo inteiro).
        */}
        {(frequencia.baldes.length > 0
          ? frequencia.baldes
          : Array.from({ length: frequencia.consistencia.semanasElegiveis }, (_, i) => ({ rotulo: `vazia-${i}`, sessoes: 0, passagens: 0 }))
        ).map((balde) => (
          <View
            key={balde.rotulo}
            style={[
              estilos.barra,
              balde.sessoes === 0
                ? { height: 8, backgroundColor: t.cor.bg.raised }
                : { height: `${Math.max(18, (balde.sessoes / maior) * 100)}%`, backgroundColor: t.cor.accent.solid },
            ]}
          />
        ))}
      </View>
      ) : null}

      <View style={[estilos.rodape, { borderTopColor: t.cor.border.hairline }]}>
        {sequencia !== undefined && sequencia > 0 ? (
          <>
            <Traco nome="chama" cor={t.cor.state.warn} tamanho={16} />
            <Text style={{ color: t.cor.text.primary, fontSize: 14, fontFamily: t.fonte(400) }}>
              {`${sequencia} ${sequencia === 1 ? 'semana seguida' : 'semanas seguidas'} treinando`}
            </Text>
          </>
        ) : (
          <Text style={{ color: t.cor.text.secondary, fontSize: 14, fontFamily: t.fonte(400) }}>
            {frequencia.consistencia.proporcao === null
              ? 'Ainda sem semana completa para medir'
              : `${frequencia.consistencia.semanasComSessao} de ${frequencia.consistencia.semanasElegiveis} semanas com treino`}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  flex: {
    flex: 1,
  },
  corpo: {
    fontSize: 14,
    lineHeight: 20,
  },
  saudacao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nome: {
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  banner: {
    minHeight: 168,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 16,
  },
  bannerArte: {
    width: '100%',
    height: '100%',
  },
  bannerTexto: {
    gap: 6,
  },
  selo: {
    alignSelf: 'flex-start',
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  frequencia: {
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
  },
  linhaEntre: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barras: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 56,
  },
  barra: {
    flex: 1,
    borderRadius: 3,
  },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  iconeDoAviso: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
