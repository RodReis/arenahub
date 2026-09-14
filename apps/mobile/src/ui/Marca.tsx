import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTema } from './theme.js';
import { Traco } from './traco.js';

/**
 * Marca da academia do App Mobile v2: moldura em gradiente, miolo escuro e o
 * glifo do halter com pulso. O miolo usa `brand.frame`, que o DS-APP §2.1
 * mantem escuro nos DOIS temas.
 */
export function Marca({ tamanho = 36 }: { tamanho?: number }) {
  const t = useTema();

  return (
    <LinearGradient
      colors={[t.cor.brand.markFrom, t.cor.brand.markMid, t.cor.brand.markTo]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: tamanho, height: tamanho, borderRadius: tamanho * 0.3, padding: 1 }}
    >
      <View
        style={[
          estilos.miolo,
          { backgroundColor: t.cor.brand.frame, borderRadius: tamanho * 0.3 - 1 },
        ]}
      >
        <Traco nome="marca" cor={t.cor.accent.ink} tamanho={tamanho * 0.6} espessura={1.8} />
      </View>
    </LinearGradient>
  );
}

/** Avatar com iniciais -- anel em gradiente opcional (Perfil). */
export function Avatar({
  nome,
  tamanho = 42,
  anel = false,
}: {
  nome: string;
  tamanho?: number;
  anel?: boolean;
}) {
  const t = useTema();
  const iniciais = iniciaisDe(nome);

  const miolo = (
    <View
      style={[
        estilos.centro,
        {
          width: anel ? tamanho - 4 : tamanho,
          height: anel ? tamanho - 4 : tamanho,
          borderRadius: tamanho,
          backgroundColor: t.cor.bg.raised,
          borderWidth: anel ? 0 : 1,
          borderColor: t.cor.border.hairline,
        },
      ]}
    >
      <Text
        style={{
          color: t.cor.accent.text,
          fontSize: Math.round(tamanho * (anel ? 0.31 : 0.33)),
          fontFamily: t.fonte(anel ? 800 : 700),
        }}
      >
        {iniciais}
      </Text>
    </View>
  );

  if (!anel) return miolo;

  return (
    <LinearGradient
      colors={[t.cor.brand.markFrom, t.cor.brand.markMid, t.cor.brand.markTo]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[estilos.centro, { width: tamanho, height: tamanho, borderRadius: tamanho }]}
    >
      {miolo}
    </LinearGradient>
  );
}

/** "Rodrigo Reis" -> "RR"; "Ana" -> "A". Nunca inventa segunda letra. */
export function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/u).filter(Boolean);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';

  return `${primeira}${ultima}`.toUpperCase();
}

const estilos = StyleSheet.create({
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miolo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
