'use client';

import { CONFIG_PADRAO_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';
import { useCallback, useEffect, useState } from 'react';

import { Atrator } from '../components/atrator';
import { IdentificacaoCpf } from '../components/identificacao-cpf';
import { MinhaArea } from '../components/minha-area';
import { BarraDeSessao, RodapeDeSessao } from '../components/rodape-de-sessao';
import { Toast } from '../components/toast';
import { abrirSessao, carregarConfig, type SessaoDoAluno } from '../lib/kiosk-client';
import { limparEstadoDaSessao, useSessao } from '../lib/use-sessao';

/**
 * O totem inteiro -- tres estados numa rota so.
 *
 * Uma rota, e nao tres: navegacao por URL num quiosque deixa historico, e
 * historico com sessao de aluno e o botao "voltar" reabrindo a tela do
 * anterior. Estado em memoria morre com a limpeza.
 *
 * Decisao 4 do PI: mensagem UNICA e neutra para toda falha de identificacao
 * -- CPF inexistente, aluno de outro tenant, status nao elegivel e erro de
 * rede dizem a MESMA coisa. Distinguir revelaria a quem digitasse um CPF
 * qualquer se aquela pessoa treina aqui.
 */
const FALHA_DE_IDENTIFICACAO = 'Não foi possível entrar. Procure a recepção.';

type Etapa = 'atrator' | 'cpf';

export default function Totem() {
  const [config, setConfig] = useState<KioskConfig>(CONFIG_PADRAO_DO_TOTEM);
  const [etapa, setEtapa] = useState<Etapa>('atrator');
  const [sessao, setSessao] = useState<SessaoDoAluno | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Marca, accent, duracao e modulos vem da config DESDE O PRIMEIRO COMMIT
  // (ADR-042, Decisao 0) -- mesmo que hoje so exista o padrao do seed.
  useEffect(() => {
    void carregarConfig().then(({ config: carregada }) => {
      setConfig(carregada);
    });
  }, []);

  const voltarAoInicio = useCallback(() => {
    setSessao(null);
    setEtapa('atrator');
  }, []);

  const confirmar = useCallback(async (cpf: string) => {
    setOcupado(true);
    setErro(null);

    const aberta = await abrirSessao(cpf);

    setOcupado(false);

    if (aberta === null) {
      setErro(FALHA_DE_IDENTIFICACAO);
      return;
    }

    setSessao(aberta);
  }, []);

  // Limpa tambem ao SAIR da pagina (recarregar, fechar, tela apagando): sem
  // isto, o unico caminho de limpeza seria o encerramento voluntario.
  useEffect(() => {
    return () => {
      limparEstadoDaSessao();
    };
  }, []);

  if (sessao !== null) {
    return (
      <TelaDeSessao
        sessao={sessao}
        config={config}
        aoEncerrar={voltarAoInicio}
      />
    );
  }

  return (
    <>
      {etapa === 'atrator' ? (
        <Atrator
          config={config}
          aoEntrar={() => {
            setEtapa('cpf');
          }}
        />
      ) : (
        <IdentificacaoCpf
          ocupado={ocupado}
          aoConfirmar={(cpf) => {
            void confirmar(cpf);
          }}
          aoVoltar={voltarAoInicio}
        />
      )}
      <Toast
        mensagem={erro}
        aoSumir={() => {
          setErro(null);
        }}
      />
    </>
  );
}

/**
 * Componente proprio para a sessao viva porque `useSessao` so pode rodar
 * quando ela EXISTE -- chamar um hook condicionalmente no componente de cima
 * quebraria a regra dos hooks; montar o hook com sessao nula obrigaria o
 * hook inteiro a tratar um estado que nao ocorre.
 */
function TelaDeSessao({
  sessao,
  config,
  aoEncerrar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly config: KioskConfig;
  readonly aoEncerrar: () => void;
}) {
  const { segundosRestantes, fracaoRestante, estender, encerrar } = useSessao(
    sessao,
    aoEncerrar,
    config.sessao.duracaoSegundos,
  );

  return (
    <div className="tela">
      <BarraDeSessao fracaoRestante={fracaoRestante} />
      <MinhaArea sessao={sessao} config={config} />
      <RodapeDeSessao
        segundosRestantes={segundosRestantes}
        aoEstender={estender}
        aoEncerrar={encerrar}
      />
    </div>
  );
}
