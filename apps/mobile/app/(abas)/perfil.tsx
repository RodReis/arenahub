import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { usarRecurso } from '@/api/usar-recurso';
import { useSessao } from '@/auth/sessao';
import { APP_VERSION } from '@/config';
import { Perfil, type DadosDoPerfil } from '@/features/perfil/perfil';
import type { DadosDoPlano } from '@/features/planos/tipos';
import { Botao } from '@/ui/Botao';
import { Folha } from '@/ui/Folha';
import { Carregando, Tela } from '@/ui/Tela';
import { useTema } from '@/ui/theme';

/**
 * Aba Perfil -- App Mobile v2.
 *
 * SAIR PEDE CONFIRMACAO (PRODUCT.md: "logout exige confirmacao"): o botao fica
 * no fim da rolagem, onde o polegar chega sem querer, e sair apaga a sessao do
 * aparelho -- voltar custa digitar a senha.
 */
export default function TelaDoPerfil() {
  const t = useTema();
  const { sair } = useSessao();
  const perfil = usarRecurso<DadosDoPerfil>('/api/v1/mobile/perfil');
  const plano = usarRecurso<DadosDoPlano>('/api/v1/mobile/plano');
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const atualizar = useCallback(async () => {
    await Promise.all([perfil.recarregar(), plano.recarregar()]);
  }, [perfil, plano]);

  if (perfil.estado.tipo === 'CARREGANDO') {
    return (
      <Tela>
        <Carregando />
      </Tela>
    );
  }

  return (
    <>
      <Tela onAtualizar={atualizar} testID="tela-perfil">
        <Perfil
          perfil={perfil.estado.tipo === 'PRONTO' ? perfil.estado.dados : null}
          plano={plano.estado.tipo === 'PRONTO' ? (plano.estado.dados.plano?.nome ?? null) : null}
          versao={APP_VERSION}
          onIr={(destino) => router.push(`/${destino}` as never)}
          onSair={() => setConfirmandoSaida(true)}
          testID="perfil"
        />
      </Tela>

      <Folha aberta={confirmandoSaida} onFechar={() => setConfirmandoSaida(false)} testID="folha-sair">
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 18, fontFamily: t.fonte(700) }}>
            Sair da conta?
          </Text>
          <Text style={{ color: t.cor.text.secondary, fontSize: 14, lineHeight: 20, fontFamily: t.fonte(400) }}>
            Para voltar você vai precisar do e-mail e da senha.
          </Text>
        </View>
        <Botao
          titulo="Sair da conta"
          variante="destrutivo"
          carregando={saindo}
          onPress={() => {
            setSaindo(true);
            void sair().finally(() => setSaindo(false));
          }}
          testID="botao-confirmar-sair"
        />
        <Botao titulo="Cancelar" variante="neutro" emCard onPress={() => setConfirmandoSaida(false)} />
      </Folha>
    </>
  );
}
