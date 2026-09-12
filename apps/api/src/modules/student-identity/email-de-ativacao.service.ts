import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

import { carregarConfig } from '../../config/env.js';

/**
 * Convite de ativacao e recuperacao de senha do ALUNO -- F23.
 *
 * Espelha `iam/email-de-convite.service.ts`, inclusive nos dois contratos que
 * la ja valem e que nao se negociam aqui:
 *
 * O ENVIO NAO PODE DERRUBAR O TOKEN. Quando este servico e chamado, o token
 * JA FOI EMITIDO e ja vale -- desfaze-lo porque o provedor recusou trocaria
 * uma falha parcial (o link existe, entrega-se na recepcao) por uma total.
 * Por isso NADA aqui lanca: o resultado diz se saiu, e quem chama decide.
 *
 * SEM CHAVE, NAO ENVIA E NAO QUEBRA. Em desenvolvimento a chave costuma
 * faltar de proposito; exigi-la tiraria do ar a ativacao inteira.
 *
 * O LINK E DEEP LINK DO APP (`arenahub://`), nao URL do painel: quem abre e o
 * aluno no celular, e o token so vale dentro do aplicativo.
 */
export interface ResultadoDoEnvio {
  enviado: boolean;
  /** Codigo estavel, nunca a frase do provedor -- ela muda sem aviso. */
  motivo?: 'SEM_CHAVE' | 'RECUSADO';
}

const ESQUEMA_DO_APP = 'arenahub';

@Injectable()
export class EmailDeAtivacaoService {
  private readonly log = new Logger(EmailDeAtivacaoService.name);

  private readonly cliente: Resend | null;
  private readonly remetente: string;

  constructor() {
    const config = carregarConfig();
    this.cliente =
      config.email.resendApiKey === null ? null : new Resend(config.email.resendApiKey);
    this.remetente = config.email.remetente;
  }

  async enviarAtivacao(dados: {
    destino: string;
    token: string;
    validoAte: Date;
  }): Promise<ResultadoDoEnvio> {
    return this.enviar({
      destino: dados.destino,
      assunto: 'Ative seu acesso ao aplicativo da academia',
      caminho: 'ativar',
      token: dados.token,
      chamada: 'Abra o link abaixo no seu celular para criar sua senha e entrar:',
      validoAte: dados.validoAte,
    });
  }

  async enviarRecuperacao(dados: {
    destino: string;
    token: string;
    validoAte: Date;
  }): Promise<ResultadoDoEnvio> {
    return this.enviar({
      destino: dados.destino,
      assunto: 'Redefinir a senha do aplicativo',
      caminho: 'recuperar',
      token: dados.token,
      chamada: 'Abra o link abaixo no seu celular para escolher uma senha nova:',
      validoAte: dados.validoAte,
    });
  }

  /**
   * NUNCA lanca -- ver o bloco no topo do arquivo.
   *
   * O TOKEN EM CLARO entra na URL e e a unica copia que existe: o banco so
   * guarda o hash. Ele NAO pode ir para log nenhum, nem dentro de erro
   * (`CLAUDE.md`, Convencoes: nunca logar token nem PII). Por isso os
   * `catch` abaixo registram so `erro.message`, e nunca o objeto inteiro --
   * o objeto de erro do cliente HTTP costuma trazer a requisicao junto, e
   * nela esta o link.
   */
  private async enviar(dados: {
    destino: string;
    assunto: string;
    caminho: 'ativar' | 'recuperar';
    token: string;
    chamada: string;
    validoAte: Date;
  }): Promise<ResultadoDoEnvio> {
    if (this.cliente === null) {
      this.log.warn('RESEND_API_KEY ausente -- token emitido sem envio de e-mail.');
      return { enviado: false, motivo: 'SEM_CHAVE' };
    }

    const link = `${ESQUEMA_DO_APP}://${dados.caminho}?token=${dados.token}`;

    try {
      const resposta = await this.cliente.emails.send({
        from: this.remetente,
        to: dados.destino,
        subject: dados.assunto,
        text: this.corpoEmTexto(dados.chamada, link, dados.validoAte),
        html: this.corpoEmHtml(dados.chamada, link, dados.validoAte),
      });

      if (resposta.error) {
        // O Resend devolve o erro NO CORPO, com status 200 -- nao lanca. Sem
        // esta checagem, recusa por dominio nao verificado (o caso mais
        // provavel hoje) passaria por envio bem-sucedido, e a tela afirmaria
        // ao aluno que o e-mail saiu.
        this.log.error(`Resend recusou o envio: ${resposta.error.message}`);
        return { enviado: false, motivo: 'RECUSADO' };
      }

      return { enviado: true };
    } catch (erro) {
      this.log.error(
        `Falha de rede ao enviar: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
      );
      return { enviado: false, motivo: 'RECUSADO' };
    }
  }

  /**
   * VERSAO EM TEXTO, e nao so HTML: cliente que bloqueia HTML mostraria uma
   * mensagem vazia, e o link tem prazo.
   */
  private corpoEmTexto(chamada: string, link: string, validoAte: Date): string {
    return [
      chamada,
      '',
      link,
      '',
      `O link vale ate ${this.formatar(validoAte)}.`,
      '',
      'Se voce nao pediu isso, ignore esta mensagem.',
    ].join('\n');
  }

  private corpoEmHtml(chamada: string, link: string, validoAte: Date): string {
    return [
      `<p>${chamada}</p>`,
      `<p><a href="${link}">Abrir no aplicativo</a></p>`,
      `<p>O link vale até ${this.formatar(validoAte)}.</p>`,
      '<p>Se você não pediu isso, ignore esta mensagem.</p>',
    ].join('\n');
  }

  /**
   * Data no fuso de Sao Paulo.
   *
   * O aluno le "vale ate 14:30", e 14:30 tem de ser o relogio dele -- UTC
   * cru diria tres horas a mais e faria o link parecer vencido.
   */
  private formatar(quando: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(quando);
  }
}
