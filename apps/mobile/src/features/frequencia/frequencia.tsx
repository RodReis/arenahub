import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Ausente } from '../../ui/Ausente.js';
import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

/** Os mesmos nomes da API e do painel -- vocabulario proprio obrigaria traduzir. */
export const PERIODOS = ['30D', '90D', '6M', '1Y'] as const;

export type PeriodoDaFrequencia = (typeof PERIODOS)[number];

export interface DadosDaFrequencia {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly periodo: string;
  readonly granularidade: string;
  readonly totalDeSessoes: number;
  readonly totalDePassagens: number;
  readonly baldes: readonly { rotulo: string; sessoes: number; passagens: number }[];
  readonly consistencia: {
    readonly semanasComSessao: number;
    readonly semanasElegiveis: number;
    readonly proporcao: number | null;
  };
}

const ROTULO_DO_PERIODO: Record<PeriodoDaFrequencia, string> = {
  '30D': '30 dias',
  '90D': '90 dias',
  '6M': '6 meses',
  '1Y': '1 ano',
};

/** `2026-W36` -> `Semana 36`; `2026-08` -> `08/2026`; `2026` fica como esta. */
function rotuloLegivel(rotulo: string): string {
  const semana = /^(\d{4})-W(\d{2})$/.exec(rotulo);
  if (semana) return `Semana ${semana[2]}`;

  const mes = /^(\d{4})-(\d{2})$/.exec(rotulo);
  if (mes) return `${mes[2]}/${mes[1]}`;

  return rotulo;
}

/**
 * Frequencia do aluno -- Slice 4.2, `M4-FR-008`.
 *
 * O NUMERO PRINCIPAL E DIAS TREINADOS, e nao passagens: o aluno pensa a
 * propria rotina em dias ("treinei tres vezes essa semana"), e quem entrou
 * duas vezes na terca treinou um dia. A contagem de passagens fica ao lado,
 * como auditoria do agrupamento -- e sempre >= a de dias.
 *
 * NADA E CALCULADO AQUI (`M4-FR-008`: "frequencia derivada pelo backend"). A
 * tela recebe os agregados prontos do `AttendanceService`, que os deriva
 * desde a F18. Somar baldes no cliente produziria um segundo numero para a
 * mesma pergunta, e ele divergiria do painel na primeira regra nova.
 */
export function Frequencia({
  dados,
  onTrocarPeriodo,
  testID,
}: {
  dados: DadosDaFrequencia;
  onTrocarPeriodo: (periodo: PeriodoDaFrequencia) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  const corpo = {
    color: t.cor.text.secondary,
    fontSize: t.type.body.size, fontFamily: t.fonte(400),
    lineHeight: t.type.body.lineHeight,
  };

  const seletor = (
    <View style={estilos.seletor}>
      {PERIODOS.map((periodo) => {
        const ativo = dados.periodo === periodo;

        return (
          <Pressable
            key={periodo}
            testID={`periodo-${periodo}`}
            accessibilityRole="button"
            accessibilityState={{ selected: ativo }}
            accessibilityLabel={`Período de ${ROTULO_DO_PERIODO[periodo]}`}
            onPress={() => onTrocarPeriodo(periodo)}
            style={{
              paddingHorizontal: 14,
              /*
               * `size.segment` (40), e nao `size.badge` (26): badge e rotulo
               * que so se le, e isto se TOCA. 26px fica abaixo do `touchMin`
               * do proprio design system, e o alvo pequeno erra na mao de
               * quem esta com o celular em pe na academia.
               */
              height: t.size.segment,
              justifyContent: 'center',
              borderRadius: t.radius.pill,
              borderWidth: 1,
              // `border.default`, e nao `hairline`: hairline e fio de
              // separacao entre linhas, e some como contorno de controle.
              borderColor: ativo ? t.cor.accent.solid : t.cor.border.default,
              // `accent.tint` e o fundo translucido; `accent.soft` e cor de
              // TEXTO claro, e usa-la de fundo derrubaria o contraste.
              backgroundColor: ativo ? t.cor.accent.tint : 'transparent',
            }}
          >
            <Text
              style={{
                color: ativo ? t.cor.text.primary : t.cor.text.secondary,
                fontSize: t.type.meta.size,
                fontFamily: t.fonte((ativo ? 600 : 400)),
              }}
            >
              {ROTULO_DO_PERIODO[periodo]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (dados.status === 'UNAVAILABLE') {
    return (
      <View testID={testID} style={estilos.bloco}>
        {seletor}
        <Card titulo="Sem conexão com a academia">
          <Text style={corpo}>
            Não foi possível atualizar agora. Sua frequência aparece assim que a
            conexão voltar.
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View testID={testID} style={estilos.bloco}>
      {seletor}

      {dados.totalDeSessoes === 0 ? (
        <Card titulo="Nenhum treino no período">
          <Text testID="frequencia-vazia" style={corpo}>
            Não há entrada registrada nesse período. Assim que você treinar, ela
            aparece aqui.
          </Text>
        </Card>
      ) : (
        <>
          <Card titulo="Dias treinados" destaque>
            <Text
              testID="frequencia-total"
              style={{
                color: t.cor.text.primary,
                fontSize: t.type.screenTitle.size, fontFamily: t.fonte(700),
                lineHeight: t.type.screenTitle.lineHeight,
              }}
            >
              {dados.totalDeSessoes}
            </Text>
            <Text style={corpo}>
              {dados.totalDePassagens}{' '}
              {dados.totalDePassagens === 1 ? 'entrada registrada' : 'entradas registradas'}
            </Text>
          </Card>

          <Card titulo="Consistência">
            {dados.consistencia.proporcao === null ? (
              // Sem semana elegivel nao ha o que medir. "0%" afirmaria que o
              // aluno nao treinou -- ausencia nao e zero (DS-APP §10 regra 5).
              <Ausente motivo="sem período a medir" testID="consistencia-ausente" />
            ) : (
              <Text style={corpo}>
                {dados.consistencia.semanasComSessao} de{' '}
                {dados.consistencia.semanasElegiveis} semanas com treino
              </Text>
            )}
          </Card>

          <Card titulo="Por período">
            {dados.baldes.map((balde) => (
              <View key={balde.rotulo} testID={`balde-${balde.rotulo}`} style={estilos.linha}>
                <Text style={corpo}>{rotuloLegivel(balde.rotulo)}</Text>
                <Text style={corpo}>
                  {balde.sessoes} {balde.sessoes === 1 ? 'dia' : 'dias'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  seletor: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
