/**
 * Aviso sonoro na recusa de identificacao -- `sessao.avisoSonoroNaRecusa`.
 *
 * O campo existia no contrato (`kiosk-config.ts`) e no painel desde a F50, com
 * `true` por padrao, e NENHUM consumidor no totem: a academia marcava a caixa e
 * o totem seguia mudo. Esta fatia (F44) fecha isso.
 *
 * POR QUE SINTETIZADO, e nao um arquivo de audio: um `<audio src>` exige asset
 * (mais um caminho para 404 no modo quiosque) e esbarra na politica de autoplay
 * -- som que nasce de um toque na tela passa, som que nasce de uma RESPOSTA DE
 * REDE, como esta recusa, nao tem gesto associado e o navegador pode barrar.
 * `AudioContext` criado sob demanda, no mesmo tick do toque que originou a
 * tentativa, e o caminho que sobrevive aos dois problemas sem asset nenhum.
 *
 * DOIS TONS DESCENDENTES, nao um bipe agudo: o totem fica na recepcao com fila
 * atras. Um bipe de erro agudo anuncia a recusa para quem esta na fila; a queda
 * curta e grave e audivel por quem esta na frente da tela sem virar aviso
 * publico. Volume em 0.08 pelo mesmo motivo -- o `DS-TOTEM.md` §3.4 ja fixa que
 * esta superficie nunca DEPENDE de audio, entao o som e reforco, nunca o canal.
 *
 * NUNCA LANCA. `AudioContext` falta em navegador antigo, e um dispositivo sem
 * saida de audio rejeita o `resume()`. Recusa muda e degradacao aceitavel; o
 * Toast continua sendo o canal de verdade. Erro aqui nao pode derrubar a tela.
 *
 * ponytail: um `AudioContext` por recusa, sem `close()`. O Chrome limita
 * contextos simultaneos por pagina (~6), entao um aluno que erre o CPF muitas
 * vezes NA MESMA carga da pagina pode esgotar o teto -- e ai o `catch` acima
 * absorve e a recusa fica muda, que e a degradacao ja prevista. Aceitavel
 * hoje porque a sessao do totem e curta (60 s) e a pagina recarrega no
 * reinicio por publicacao. Fechar o contexto apos o `stop()` do ultimo tom e
 * a saida, se acumulo em sessao longa virar problema observado.
 */
const VOLUME = 0.08;
const TONS_HZ = [440, 330] as const;
const DURACAO_DO_TOM_S = 0.12;

type FabricaDeContexto = () => AudioContext;

function fabricaPadrao(): AudioContext | null {
  const Ctor =
    typeof globalThis.AudioContext === 'function' ? globalThis.AudioContext : null;

  return Ctor === null ? null : new Ctor();
}

/**
 * Toca a recusa. `ligado === false` e o caminho mais comum de todos: a unidade
 * desmarcou a caixa, e a funcao tem de sair ANTES de tocar em `AudioContext`
 * -- instanciar audio para depois nao usar acorda a saida de som do aparelho a
 * toa.
 *
 * `fabrica` existe para o teste; em producao o padrao e o unico caminho.
 */
export function tocarAvisoDeRecusa(
  ligado: boolean,
  fabrica: FabricaDeContexto | null = null,
): void {
  if (!ligado) return;

  try {
    const contexto = fabrica === null ? fabricaPadrao() : fabrica();

    if (contexto === null) return;

    TONS_HZ.forEach((hz, indice) => {
      const inicio = contexto.currentTime + indice * DURACAO_DO_TOM_S;
      const fim = inicio + DURACAO_DO_TOM_S;

      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();

      oscilador.frequency.value = hz;
      // `setValueAtTime` + rampa: cortar o ganho no seco estala (clique de
      // descontinuidade na forma de onda), e num totem silencioso o estalo e
      // mais perceptivel que o proprio tom.
      ganho.gain.setValueAtTime(VOLUME, inicio);
      ganho.gain.exponentialRampToValueAtTime(0.0001, fim);

      oscilador.connect(ganho);
      ganho.connect(contexto.destination);
      oscilador.start(inicio);
      oscilador.stop(fim);
    });
  } catch {
    // Ver o cabecalho: recusa muda e melhor que tela derrubada.
  }
}
