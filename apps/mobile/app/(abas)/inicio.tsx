import { useCallback, useMemo } from 'react';
import { Linking } from 'react-native';
import { router } from 'expo-router';

import { usarRecurso } from '@/api/usar-recurso';
import { useSessao } from '@/auth/sessao';
import type { DadosDosAvisos, AvisoDoAluno } from '@/features/avisos/avisos';
import type { DadosDoEngajamento } from '@/features/eventos/eventos';
import type { DadosDaFrequencia } from '@/features/frequencia/frequencia';
import { Home, type DadosDaHome, type DesafioEmDestaque } from '@/features/inicio/home';
import { Carregando, Tela } from '@/ui/Tela';

/**
 * Aba Início -- App Mobile v2.
 *
 * QUATRO LEITURAS, E SO A PRIMEIRA SEGURA A TELA. A Home (saudacao e versao)
 * decide se ha tela; avisos, frequencia e engajamento chegam cada um por si e
 * nenhum derruba os outros -- a mesma decisao da F29 para o contador de avisos,
 * agora estendida aos blocos novos.
 *
 * Falha da Home vira `UNAVAILABLE`, e nao tela de erro: o `M4-NFR-002` pede
 * shell util durante indisponibilidade.
 */
export default function Inicio() {
  const { cliente } = useSessao();
  const home = usarRecurso<DadosDaHome>('/api/v1/mobile/home');
  const avisos = usarRecurso<DadosDosAvisos>('/api/v1/mobile/avisos');
  const frequencia = usarRecurso<DadosDaFrequencia>('/api/v1/mobile/frequencia?periodo=90D&granularidade=SEMANAL');
  const engajamento = usarRecurso<DadosDoEngajamento>('/api/v1/mobile/engajamento');

  const atualizar = useCallback(async () => {
    await Promise.all([home.recarregar(), avisos.recarregar(), frequencia.recarregar(), engajamento.recarregar()]);
  }, [home, avisos, frequencia, engajamento]);

  const desafio = useMemo<DesafioEmDestaque | null | undefined>(() => {
    if (engajamento.estado.tipo !== 'PRONTO') return undefined;
    const lista = engajamento.estado.dados.desafios;
    if (!lista || lista.length === 0) return null;

    // O que termina primeiro -- mesma escolha da vitrine do totem (ADR-048).
    const [primeiro] = [...lista].sort((a, b) => a.fim.localeCompare(b.fim) || a.id.localeCompare(b.id));
    return primeiro ? { titulo: primeiro.titulo, meta: primeiro.meta, fim: primeiro.fim, inscrito: primeiro.inscrito } : null;
  }, [engajamento.estado]);

  const abrirAviso = useCallback(
    (aviso: AvisoDoAluno) => {
      if (!aviso.lido) {
        // Marcacao nao bloqueia a navegacao -- mesma regra de `app/avisos.tsx`.
        void cliente.post(`/api/v1/mobile/avisos/${aviso.id}/lido`, {}).catch(() => undefined);
      }
      router.push((aviso.rota ?? '/avisos'));
    },
    [cliente],
  );

  if (home.estado.tipo === 'CARREGANDO') {
    return (
      <Tela>
        <Carregando />
      </Tela>
    );
  }

  const dados: DadosDaHome =
    home.estado.tipo === 'PRONTO'
      ? {
          ...home.estado.dados,
          ...(avisos.estado.tipo === 'PRONTO' ? { naoLidos: avisos.estado.dados.naoLidos } : {}),
        }
      : {
          // Sem conteudo, mas COM shell. A ausencia aparece como ausencia.
          asOf: new Date().toISOString(),
          status: 'UNAVAILABLE',
          saudacao: '',
          versionPolicy: { state: 'SUPPORTED', updateUrl: null },
        };

  return (
    <Tela onAtualizar={atualizar} testID="tela-inicio">
      <Home
        dados={dados}
        complementos={{
          avisos: avisos.estado.tipo === 'PRONTO' ? avisos.estado.dados.avisos : undefined,
          frequencia: frequencia.estado.tipo === 'PRONTO' ? frequencia.estado.dados : undefined,
          sequencia: engajamento.estado.tipo === 'PRONTO' ? engajamento.estado.dados.consistencia.atual : undefined,
          desafio,
        }}
        onAtualizarApp={() => {
          const url = dados.versionPolicy.updateUrl;
          if (url) void Linking.openURL(url);
        }}
        onVerPerfil={() => router.navigate('/perfil')}
        onVerFrequencia={() => router.push('/frequencia')}
        onVerAvisos={() => router.push('/avisos')}
        onAbrirAviso={abrirAviso}
        onVerDesafios={() => router.navigate('/eventos')}
        testID="home"
      />
    </Tela>
  );
}
