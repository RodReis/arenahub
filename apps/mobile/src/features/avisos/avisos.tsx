import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../ui/Card.js';
import { ICONE_DO_TOM } from '../../ui/icones.js';
import { useTema, type Tom } from '../../ui/theme.js';

export type TipoDeAviso = 'BILLING' | 'ASSESSMENT' | 'MEMBERSHIP' | 'GENERAL';

export interface AvisoDoAluno {
  readonly id: string;
  readonly tipo: TipoDeAviso;
  readonly titulo: string;
  readonly corpo: string;
  /** Rota local JA RESOLVIDA pelo servidor. `null` = aviso que so informa. */
  readonly rota: string | null;
  readonly lido: boolean;
  readonly criadoEm: string;
}

export interface DadosDosAvisos {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly avisos: readonly AvisoDoAluno[];
  readonly naoLidos: number;
}

/**
 * O tom por TIPO de aviso.
 *
 * Fatura em aberto e `warn` porque tem prazo; avaliacao publicada e `info`
 * porque e novidade sem urgencia. O tom nunca e o unico canal -- o icone
 * acompanha (DS-APP §7), entao quem nao separa laranja de azul le o glifo.
 */
const TOM: Record<TipoDeAviso, Tom> = {
  BILLING: 'warn',
  ASSESSMENT: 'info',
  MEMBERSHIP: 'info',
  GENERAL: 'info',
};

/** `2026-09-14T10:00:00.000Z` -> `14/09`. */
function formatarDia(iso: string): string {
  const data = new Date(iso);
  const dia = data.getUTCDate().toString().padStart(2, '0');

  return `${dia}/${(data.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}

/**
 * Caixa de avisos do aluno -- F29, Slice 4.7.
 *
 * ESTA TELA NAO DECIDE NADA. Ela nao filtra expirado (o servidor ja
 * removeu), nao conta nao lidos (vem pronto) e nao monta rota (vem
 * resolvida). Recalcular qualquer um dos tres criaria uma segunda verdade
 * que divergiria da primeira -- e a divergencia so apareceria quando alguem
 * comparasse a bolinha com a lista.
 *
 * A ROTA VEM DO SERVIDOR COMO CAMINHO LOCAL. A tela navega por ela, e por
 * isso o servidor nunca manda URL: `https://` num campo que o app abre seria
 * phishing com a marca da academia em volta.
 */
export function Avisos({
  dados,
  onAbrir,
  testID,
}: {
  dados: DadosDosAvisos;
  /** Recebe o aviso tocado. A tela-rota marca como lido e navega. */
  onAbrir: (aviso: AvisoDoAluno) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  const corpo = {
    color: t.cor.text.secondary,
    fontSize: t.type.body.size, fontFamily: t.fonte(400),
    lineHeight: t.type.body.lineHeight,
  };

  if (dados.status === 'UNAVAILABLE') {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Sem conexão com a academia">
          <Text style={corpo}>
            Não foi possível atualizar agora. Seus avisos aparecem assim que a conexão
            voltar.
          </Text>
        </Card>
      </View>
    );
  }

  if (dados.avisos.length === 0) {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Nenhum aviso">
          <Text testID="avisos-vazio" style={corpo}>
            Quando a academia tiver algo para lhe dizer, aparece aqui.
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View testID={testID} style={estilos.bloco}>
      {dados.avisos.map((aviso) => {
        const Icone = ICONE_DO_TOM[TOM[aviso.tipo]];

        return (
          <Pressable
            key={aviso.id}
            testID={`aviso-${aviso.id}`}
            onPress={() => onAbrir(aviso)}
            accessibilityRole="button"
            // O rotulo diz o estado, nao so o texto: quem usa leitor de tela
            // nao ve o ponto de nao lido.
            accessibilityLabel={`${aviso.lido ? 'Lido' : 'Não lido'}. ${aviso.titulo}. ${aviso.corpo}`}
          >
            <Card semBorda={false}>
              <View style={estilos.cabecalho}>
                <View style={estilos.tituloComIcone}>
                  <Icone />
                  <Text
                    style={{
                      color: t.cor.text.primary,
                      fontSize: t.type.cardTitle.size,
                      lineHeight: t.type.cardTitle.lineHeight,
                      // Nao lido em negrito: peso e o segundo canal, ao lado
                      // do ponto, para quem nao distingue a cor do ponto.
                      fontFamily: t.fonte((aviso.lido ? 400 : 700)),
                    }}
                  >
                    {aviso.titulo}
                  </Text>
                </View>

                <Text style={{ ...corpo, color: t.cor.text.muted }}>
                  {formatarDia(aviso.criadoEm)}
                </Text>
              </View>

              <Text style={corpo}>{aviso.corpo}</Text>

              {!aviso.lido && (
                <View
                  testID={`aviso-${aviso.id}-nao-lido`}
                  style={[estilos.ponto, { backgroundColor: t.cor.accent.solid }]}
                />
              )}
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 12,
  },
  cabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  tituloComIcone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // `flexShrink` para o titulo longo quebrar em vez de empurrar a data
    // para fora da tela.
    flexShrink: 1,
  },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
