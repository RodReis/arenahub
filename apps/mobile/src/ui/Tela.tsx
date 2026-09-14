import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from './Card.js';
import { rgba, useTema } from './theme.js';
import { LinearGradient } from 'expo-linear-gradient';
import { Traco } from './traco.js';

/**
 * Casca de rolagem de uma tela do App Mobile v2: fundo `bg/app`, calha de
 * 20 px, respiro superior da safe area (58 px no minimo, DS-APP §1) e 14 px
 * entre blocos -- o ritmo vertical do prototipo.
 *
 * Puxar para atualizar chama `onAtualizar` quando a tela tem de onde reler.
 */
export function Tela({
  children,
  onAtualizar,
  testID,
}: {
  children: ReactNode;
  onAtualizar?: (() => Promise<void>) | undefined;
  testID?: string | undefined;
}) {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const [atualizando, setAtualizando] = useState(false);

  return (
    <View style={[estilos.raiz, { backgroundColor: t.cor.bg.app }]}>
    <ScrollView
      testID={testID}
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop) },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onAtualizar ? (
          <RefreshControl
            refreshing={atualizando}
            tintColor={t.cor.accent.solid}
            colors={[t.cor.accent.solid]}
            progressBackgroundColor={t.cor.bg.surface}
            onRefresh={() => {
              setAtualizando(true);
              void onAtualizar().finally(() => setAtualizando(false));
            }}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
    {/*
      Anteparo da barra de status: o conteudo rola por baixo do relogio, e sem
      ele o texto de um card encavalava nos icones do sistema (visto no
      emulador). Solido no topo e some em 12 px, para nao cortar seco.
    */}
    <LinearGradient
      pointerEvents="none"
      colors={[t.cor.bg.app, t.cor.bg.app, rgba(t.cor.bg.app, 0)]}
      locations={[0, 0.7, 1]}
      style={[estilos.anteparo, { height: inset.top + 12 }]}
    />
    </View>
  );
}

/** Titulo de tela -- 24/800, tracking negativo do prototipo. */
export function TituloDaTela({ children }: { children: string }) {
  const t = useTema();

  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.cor.text.primary,
        fontSize: 24,
        lineHeight: 30,
        letterSpacing: -0.5,
        fontFamily: t.fonte(800),
      }}
    >
      {children}
    </Text>
  );
}

/** "‹ Evolução" -- volta de uma tela de detalhe. */
export function Voltar({ rotulo, onPress }: { rotulo: string; onPress: () => void }) {
  const t = useTema();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Voltar para ${rotulo}`}
      hitSlop={8}
      style={estilos.voltar}
      testID="voltar"
    >
      <Traco nome="voltar" cor={t.cor.accent.text} tamanho={15} />
      <Text style={{ color: t.cor.accent.text, fontSize: 14, fontFamily: t.fonte(600) }}>{rotulo}</Text>
    </Pressable>
  );
}

/** Indicador centralizado enquanto a primeira leitura nao voltou. */
export function Carregando() {
  const t = useTema();

  return (
    <View style={estilos.carregando} testID="carregando">
      <ActivityIndicator size="large" color={t.cor.accent.solid} />
    </View>
  );
}

/**
 * Falha de leitura -- `M4-NFR-002`: shell util, sem dado antigo.
 *
 * O texto diz O QUE nao carregou, porque "algo deu errado" nao ajuda o aluno
 * a decidir se tenta de novo ou vai a recepcao.
 */
export function Indisponivel({ oQue, testID }: { oQue: string; testID?: string }) {
  const t = useTema();

  return (
    <Card titulo="Sem conexão com a academia" testID={testID}>
      <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
        {`Não foi possível atualizar agora. ${oQue} aparece assim que a conexão voltar.`}
      </Text>
    </Card>
  );
}

const estilos = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  anteparo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  voltar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    alignSelf: 'flex-start',
  },
  carregando: {
    paddingVertical: 80,
    alignItems: 'center',
  },
});
