import { Injectable } from '@nestjs/common';

import { carregarConfig } from '../../config/env.js';
import {
  resolverFuncionalidade,
  resolverVersao,
  type FuncionalidadeDeCanal,
  type RespostaDaVersao,
} from './domain/politica-de-versao.js';

/**
 * ---------------------------------------------------------------------------
 * A POLITICA VIVE NO SERVIDOR -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * O app pergunta "posso rodar?" e "isto esta ligado?"; ele nao responde
 * sozinho. Um aplicativo que carrega a propria versao minima julga com a
 * regra do dia em que foi publicado -- e a versao antiga e justamente a que
 * precisa ser bloqueada.
 *
 * DE ONDE VEM A CONFIGURACAO. Variavel de ambiente, lida a cada chamada e
 * nao no arranque: desligar o pagamento no app as 22h de um sabado nao pode
 * exigir redeploy. O custo e ler `process.env` por requisicao, que e
 * irrelevante perto de uma consulta ao banco.
 *
 * TODA AUSENCIA FECHA. Sem `MOBILE_MIN_VERSION`, ninguem passa; sem flag de
 * funcionalidade, ela fica desligada. O modo de falha oposto -- abrir na
 * duvida -- transforma erro de deploy em ausencia silenciosa de controle.
 */
@Injectable()
export class PoliticaDeCanalService {
  /**
   * Esta versao do app ainda roda?
   *
   * `versaoDoApp` vem do header `x-app-version`. Ausente ou malformado
   * resulta em `BLOCKED`: cliente que nao se identifica e cliente
   * desconhecido, e liberar o desconhecido esvazia a politica -- bastaria
   * omitir o header para escapar dela.
   */
  resolverVersao(versaoDoApp: string | undefined, agora: Date): RespostaDaVersao {
    const canais = carregarConfig().canais;

    return resolverVersao(
      versaoDoApp ?? '',
      {
        minima: canais.versaoMinima ?? '',
        ...(canais.carenciaAte === null ? {} : { carenciaAte: new Date(canais.carenciaAte) }),
        ...(canais.urlDeAtualizacao === null
          ? {}
          : { urlDeAtualizacao: canais.urlDeAtualizacao }),
      },
      agora,
    );
  }

  /**
   * Esta funcionalidade esta ligada para este tenant?
   *
   * Hoje so o lado GLOBAL existe em configuracao; o lado do tenant fica
   * ligado por padrao. A assimetria e deliberada e ja esta na regra pura: o
   * global desligado nunca e reaberto pelo tenant, porque freio que o freado
   * solta nao e freio. Quando a tabela de flag por tenant existir, e so
   * passar o valor lido -- a regra nao muda.
   */
  ligada(funcionalidade: FuncionalidadeDeCanal): boolean {
    const globais = carregarConfig().canais.funcionalidades;

    return resolverFuncionalidade({ global: globais[funcionalidade], tenant: true });
  }
}
