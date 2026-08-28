import { Inject, Injectable } from '@nestjs/common';
import type { BlocoDaTelaPublica, KioskConfig } from '@arenahub/api-contracts';

import {
  OBJECT_STORAGE,
  chaveDeMidiaPertenceA,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import type { ConfiguracaoResolvida } from './kiosk-config.service.js';

/**
 * Vida da URL assinada.
 *
 * Uma hora e generoso para um download que acontece uma vez no boot, e curto
 * o bastante para que um endereco copiado da tela do totem nao vire link
 * publico permanente do video da academia.
 */
const VALIDADE_SEGUNDOS = 60 * 60;

/**
 * Troca `midiaKey` por URL assinada na configuracao servida ao totem (F51).
 *
 * ---------------------------------------------------------------------------
 * ASSINA NO BOOT, NUNCA NA TELA.
 * ---------------------------------------------------------------------------
 *
 * `M3.5-FR-005` manda servir toda midia do cache local, sem rede na tela
 * publica. O totem baixa o video UMA VEZ, quando le a configuracao, e a
 * partir dai exibe do cache. Se a assinatura acontecesse no momento de
 * exibir, a hero passaria a depender da rede a cada volta do rodizio -- que
 * e exatamente o que o requisito impede.
 *
 * A chave e conferida contra o prefixo do tenant e da unidade antes de virar
 * assinatura: `midiaKey` vem do payload da configuracao, que e dado de
 * banco, e assinar sem conferir entregaria objeto alheio a quem editasse o
 * payload -- inclusive por uma camada de TENANT apontando para a unidade de
 * outro.
 *
 * Chave que nao pertence, ou storage que falhou, viram `midiaUrl: null` e o
 * bloco some do rodizio: uma tela publica com quadrado preto no lugar do
 * video e pior do que uma tela publica sem aquele bloco.
 *
 * A CHAVE permanece intacta na resposta: quem a apaga e o painel, e so o
 * painel. Zera-la aqui faria uma falha temporaria do storage virar perda
 * permanente do video na proxima gravacao do rascunho.
 */
@Injectable()
export class KioskMediaLinkService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort) {}

  async resolverMidias(
    contexto: ContextoDoKiosk,
    resolvida: ConfiguracaoResolvida,
  ): Promise<ConfiguracaoResolvida> {
    const { itens } = resolvida.config.blocos;
    const { marcas } = resolvida.config.patrocinio;

    const temVideo = itens.some((bloco) => bloco.tipo === 'VIDEO' && bloco.midiaKey !== null);
    const temLogotipo = marcas.some((marca) => marca.logotipoKey !== null);

    // Nada a assinar: devolve o objeto ORIGINAL, sem copia. Vale a pena
    // porque a tela publica sem video nem logotipo e o caso comum.
    if (!temVideo && !temLogotipo) return resolvida;

    const [resolvidos, marcasResolvidas] = await Promise.all([
      temVideo
        ? Promise.all(itens.map(async (bloco) => this.resolverBloco(bloco, contexto)))
        : Promise.resolve(itens),
      temLogotipo
        ? Promise.all(marcas.map(async (marca) => this.resolverLogotipo(marca, contexto)))
        : Promise.resolve(marcas),
    ]);

    return {
      version: resolvida.version,
      config: {
        ...resolvida.config,
        blocos: { ...resolvida.config.blocos, itens: resolvidos },
        patrocinio: { ...resolvida.config.patrocinio, marcas: marcasResolvidas },
      },
    };
  }

  /**
   * Chave do logotipo -> URL assinada, com as MESMAS tres travas do video.
   *
   * Nao e simetria estetica: sao os tres modos de falha que este servico ja
   * aprendeu a tratar -- chave de tenant alheio (nunca assinada), storage
   * fora do ar (cai em `null`, a faixa mostra o nome) e a CHAVE preservada
   * na resposta, para que falha temporaria nao vire perda permanente na
   * proxima gravacao do rascunho.
   */
  private async resolverLogotipo(
    marca: KioskConfig['patrocinio']['marcas'][number],
    contexto: ContextoDoKiosk,
  ): Promise<KioskConfig['patrocinio']['marcas'][number]> {
    if (marca.logotipoKey === null) return { ...marca, logotipoUrlAssinada: null };

    if (!chaveDeMidiaPertenceA(marca.logotipoKey, contexto.tenantId, contexto.gymUnitId)) {
      return { ...marca, logotipoUrlAssinada: null };
    }

    try {
      const { downloadUrl } = await this.storage.createPrivateDownload({
        key: marca.logotipoKey,
        expiresInSeconds: VALIDADE_SEGUNDOS,
        // COM a extensao da chave: `fileName` vira
        // `content-disposition: attachment; filename="..."`, e um nome sem
        // extensao daria "logotipo" solto a quem salvasse o arquivo. A
        // chave ja carrega a extensao certa desde que `montarChaveDeMidia`
        // passou a derivá-la do `content-type`.
        fileName: `logotipo.${marca.logotipoKey.split('.').pop() ?? 'png'}`,
      });

      return { ...marca, logotipoUrlAssinada: downloadUrl };
    } catch {
      return { ...marca, logotipoUrlAssinada: null };
    }
  }

  private async resolverBloco(
    bloco: BlocoDaTelaPublica,
    contexto: ContextoDoKiosk,
  ): Promise<BlocoDaTelaPublica> {
    if (bloco.tipo !== 'VIDEO' || bloco.midiaKey === null) return bloco;

    // A MESMA funcao que monta a chave decide se ela pertence -- duas
    // implementacoes do formato divergiriam na primeira barra esquecida.
    if (!chaveDeMidiaPertenceA(bloco.midiaKey, contexto.tenantId, contexto.gymUnitId)) {
      return { ...bloco, midiaUrl: null };
    }

    try {
      const { downloadUrl } = await this.storage.createPrivateDownload({
        key: bloco.midiaKey,
        expiresInSeconds: VALIDADE_SEGUNDOS,
        fileName: 'midia.mp4',
      });

      return { ...bloco, midiaUrl: downloadUrl };
    } catch {
      // Storage fora do ar nao derruba a tela publica inteira: o bloco de
      // video perde a origem e sai do rodizio, os outros continuam.
      return { ...bloco, midiaUrl: null };
    }
  }
}
