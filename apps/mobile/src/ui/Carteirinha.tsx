import { StyleSheet, Text, View } from 'react-native';
import { APP_FONT } from '@arenahub/ui/app-tokens';
import { Botao } from './Botao.js';
import { useTema } from './theme.js';

/**
 * Sheet da carteirinha -- DS-APP.md §4.8 e §5.4.
 *
 * O QR CARREGA UM TOKEN DE USO UNICO, SEM DADO PESSOAL, e o app **diz isso ao
 * aluno** na propria tela (§4.8). Nao e texto decorativo: e o que torna a
 * promessa verificavel por quem esta segurando o celular na catraca.
 *
 * O componente nao aceita CPF, e-mail, telefone nem valor. Aceita `nome` (que
 * o proprio titular esta lendo na tela dele) e `matricula`, que e identificador
 * opaco. O QR recebe o token JA PRONTO -- o app nao o gera nem o deriva de
 * dado do aluno, porque quem emite token de acesso e o servidor (regra de
 * arquitetura 1: a catraca decide por entitlement, nunca pelo que o celular
 * afirma).
 *
 * O `segundosParaRenovar` vem de fora pelo mesmo motivo: o app nao tem
 * relogio de autoridade. Ele exibe o que o servidor disse que falta.
 */
export function Carteirinha({
  nome,
  matricula,
  plano,
  unidade,
  qr,
  segundosParaRenovar,
  onFechar,
  testID,
}: {
  nome: string;
  /** Identificador opaco -- nunca CPF (§5.4). */
  matricula: string;
  plano: string;
  unidade: string;
  /** O desenho do QR ja pronto. Token de uso unico, emitido pelo servidor. */
  qr: React.ReactNode;
  segundosParaRenovar: number;
  onFechar: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View testID={testID} style={[estilos.overlay, { backgroundColor: t.cor.scrim.default }]}>
      <View
        style={[
          estilos.painel,
          {
            backgroundColor: t.cor.bg.surface,
            borderTopLeftRadius: t.radius.sheet,
            borderTopRightRadius: t.radius.sheet,
          },
        ]}
      >
        <View
          accessibilityElementsHidden
          style={[estilos.alca, { backgroundColor: t.cor.border.default }]}
        />

        <View style={estilos.identidade}>
          <View style={estilos.identidadeTexto}>
            <Text
              numberOfLines={1}
              style={{
                color: t.cor.text.primary,
                fontSize: t.type.cardTitle.size,
                lineHeight: t.type.cardTitle.lineHeight,
                fontWeight: '600',
              }}
            >
              {nome}
            </Text>
            {/* Matricula em mono -- §2.5: identificador nao usa a fonte de texto. */}
            <Text
              style={{
                color: t.cor.text.muted,
                fontSize: t.type.meta.size,
                lineHeight: t.type.meta.lineHeight,
                fontFamily: APP_FONT.mono,
              }}
            >
              {matricula}
            </Text>
          </View>
          <Text
            style={{
              color: t.cor.text.muted,
              fontSize: t.type.meta.size,
              lineHeight: t.type.meta.lineHeight,
              textAlign: 'right',
            }}
          >
            {`${plano}\n${unidade}`}
          </Text>
        </View>

        {/*
          O QR SEMPRE sobre branco (§4.8) -- requisito optico do leitor, nao
          escolha de design: por isso `optico.qrBackground` e igual nos dois
          temas e nao acompanha a identidade do tenant.
        */}
        <View
          style={[
            estilos.blocoDoQr,
            { borderRadius: t.radius.card, backgroundColor: t.cor.optico.qrBackground },
          ]}
        >
          {qr}
        </View>

        <View style={estilos.renovacao}>
          <View style={[estilos.trilho, { backgroundColor: t.cor.bg.app }]}>
            <View
              style={[
                estilos.preenchimento,
                {
                  backgroundColor: t.cor.accent.hover,
                  width: `${Math.max(0, Math.min(100, (segundosParaRenovar / 30) * 100))}%`,
                },
              ]}
            />
          </View>
          <Text
            style={{
              color: t.cor.text.muted,
              fontSize: t.type.meta.size,
              lineHeight: t.type.meta.lineHeight,
              textAlign: 'center',
            }}
          >
            {`Código renova em ${segundosParaRenovar} s · token de uso único, sem dados pessoais`}
          </Text>
        </View>

        <Botao titulo="Fechar" variante="neutro" emCard onPress={onFechar} />
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  painel: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
    alignItems: 'stretch',
  },
  alca: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  identidade: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  identidadeTexto: {
    flex: 1,
    gap: 2,
  },
  blocoDoQr: {
    alignSelf: 'center',
    padding: 16,
  },
  renovacao: {
    gap: 8,
  },
  trilho: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  preenchimento: {
    height: 4,
    borderRadius: 2,
  },
});
