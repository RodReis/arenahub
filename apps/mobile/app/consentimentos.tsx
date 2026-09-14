import { useCallback, useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import {
  Consentimentos,
  type Consentimento,
  type DadosDosConsentimentos,
} from '@/features/consentimentos/consentimentos';
import { Ausente } from '@/ui/Ausente';
import { Tela, TituloDaTela, Voltar } from '@/ui/Tela';
import { useTema } from '@/ui/theme';

/**
 * Rota protegida das permissoes -- Slice 4.4, `M4-BR-009`.
 *
 * A DECISAO NAO E OTIMISTA: o switch so muda depois que o servidor confirma.
 * Mostrar "revogado" antes da confirmacao diria ao aluno que o processamento
 * parou quando ele pode nao ter parado -- e revogacao de consentimento e
 * exatamente onde essa mentira custa caro (ADR-008).
 */
export default function TelaDosConsentimentos() {
  const t = useTema();
  const { estado, cliente } = useSessao();

  const [dados, setDados] = useState<DadosDosConsentimentos | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados((await cliente.get('/api/v1/mobile/consentimentos')) as DadosDosConsentimentos);
      setIndisponivel(false);
    } catch {
      setDados(null);
      setIndisponivel(true);
    }
  }, [cliente]);

  useEffect(() => {
    if (estado.tipo === 'AUTENTICADO') void carregar();
  }, [estado.tipo, carregar]);

  const decidir = useCallback(
    (tipo: string, conceder: boolean) => {
      setSalvando(tipo);

      void (async () => {
        try {
          const atualizado = (await cliente.put('/api/v1/mobile/consentimentos', {
            tipo,
            conceder,
          })) as Consentimento;

          // Troca SO a linha decidida, com o que o servidor devolveu: recarregar
          // a lista inteira aqui piscaria a tela toda por causa de um switch.
          setDados((atual) =>
            atual === null
              ? atual
              : {
                  ...atual,
                  consentimentos: atual.consentimentos.map((c) =>
                    c.tipo === tipo ? atualizado : c,
                  ),
                },
          );
        } catch {
          // Falhou: recarrega do servidor em vez de adivinhar o estado. O
          // switch volta para o que a academia de fato registrou.
          await carregar();
        } finally {
          setSalvando(null);
        }
      })();
    },
    [cliente, carregar],
  );

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  if (estado.tipo === 'CARREGANDO' || (!dados && !indisponivel)) {
    return (
      <View style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <ActivityIndicator size="large" color={t.cor.accent.solid} />
      </View>
    );
  }

  return (
    <Tela>
      <Voltar rotulo="Voltar" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/perfil'))} />
      <TituloDaTela>Permissões e privacidade</TituloDaTela>
      {dados === null ? (
        <Ausente
          motivo="Não foi possível carregar suas permissões agora. Tente de novo em instantes."
          testID="consentimentos-indisponivel"
        />
      ) : (
        <Consentimentos
          dados={dados}
          onMudar={decidir}
          salvando={salvando}
          testID="consentimentos"
        />
      )}
    </Tela>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
