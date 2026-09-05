import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

import { carregarConfig } from '../../config/env.js';

/**
 * Envio do convite por e-mail -- issue #277.
 *
 * O PI pediu em 05/09/2026 (*"tem q inviar o convite por email"*) e escolheu
 * o **Resend** como provedor.
 *
 * O ENVIO NAO PODE DERRUBAR O CONVITE. Quando este servico e chamado, o
 * convite JA FOI CRIADO e o link JA VALE -- desfaze-lo porque o provedor de
 * e-mail recusou trocaria uma falha parcial (o link existe, entrega-se a
 * mao) por uma total. Por isso nada aqui lanca: o resultado diz se saiu, e
 * quem chama decide o que mostrar.
 *
 * SEM CHAVE, NAO ENVIA E NAO QUEBRA. Mesmo criterio da chave da Anthropic
 * (`ANTHROPIC_API_KEY`): exigi-la tiraria do ar a criacao de usuario inteira
 * por falta de uma variavel que nao trava mais nada.
 */
export interface ResultadoDoEnvio {
  enviado: boolean;
  /**
   * Por que nao saiu, quando nao saiu.
   *
   * Codigo estavel, nao a frase do provedor: a tela traduz, e a mensagem do
   * Resend muda sem aviso. `SEM_CHAVE` e diferente de `RECUSADO` -- o
   * primeiro e configuracao pendente, o segundo e o provedor dizendo nao.
   */
  motivo?: 'SEM_CHAVE' | 'RECUSADO';
}

@Injectable()
export class EmailDeConviteService {
  private readonly log = new Logger(EmailDeConviteService.name);

  /*
   * Cliente construido UMA VEZ, no arranque. Constru-lo por envio criaria um
   * agente HTTP novo a cada convite, e a chave seria lida de `process.env` em
   * pontos diferentes do ciclo de vida.
   */
  private readonly cliente: Resend | null;
  private readonly remetente: string;
  private readonly urlDoPainel: string;

  constructor() {
    const config = carregarConfig();

    this.cliente = config.email.resendApiKey === null ? null : new Resend(config.email.resendApiKey);
    this.remetente = config.email.remetente;
    this.urlDoPainel = config.email.urlDoPainel;
  }

  /**
   * Manda o convite. NUNCA lanca -- ver o bloco no topo do arquivo.
   *
   * O TOKEN EM CLARO entra na URL, e e a unica copia que existe: o banco so
   * guarda o hash. Por isso ele NAO pode ir para log nenhum, nem em erro
   * (`CLAUDE.md`, Convencoes: nunca logar token nem PII).
   */
  async enviar(email: string, token: string): Promise<ResultadoDoEnvio> {
    if (this.cliente === null) {
      /*
       * Aviso, nao erro: em desenvolvimento a chave costuma faltar de
       * proposito, e um `error` a cada convite ensinaria a ignorar o log.
       */
      this.log.warn('RESEND_API_KEY ausente -- convite criado sem envio de e-mail.');

      return { enviado: false, motivo: 'SEM_CHAVE' };
    }

    const link = `${this.urlDoPainel}/convite/${token}`;

    try {
      const resposta = await this.cliente.emails.send({
        from: this.remetente,
        to: email,
        subject: 'Seu acesso ao painel da academia',
        text: this.corpoEmTexto(link),
        html: this.corpoEmHtml(link),
      });

      if (resposta.error) {
        /*
         * O Resend devolve o erro NO CORPO, com status 200 -- nao lanca. Sem
         * esta checagem, recusa por dominio nao verificado (o caso mais
         * provavel hoje) passaria por envio bem-sucedido, e o convite ficaria
         * esperando um e-mail que nunca saiu.
         *
         * `resposta.error.message` no log e SEGURO: e a frase do provedor
         * ("domain not verified"), nao o corpo do e-mail nem o token.
         */
        this.log.error(`Resend recusou o envio do convite: ${resposta.error.message}`);

        return { enviado: false, motivo: 'RECUSADO' };
      }

      return { enviado: true };
    } catch (erro) {
      // Rede fora, DNS, timeout. So a mensagem -- o `erro` inteiro pode
      // trazer o corpo da requisicao, e nele esta o link com o token.
      this.log.error(
        `Falha de rede ao enviar o convite: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
      );

      return { enviado: false, motivo: 'RECUSADO' };
    }
  }

  /**
   * VERSAO EM TEXTO, e nao so HTML: cliente de e-mail que bloqueia HTML
   * mostraria uma mensagem vazia, e o convite tem prazo de 24 horas para ser
   * usado.
   */
  private corpoEmTexto(link: string): string {
    return [
      'Você foi convidado para o painel da academia.',
      '',
      'Abra o link abaixo para definir sua senha e entrar:',
      link,
      '',
      'O convite vale por 24 horas e pode ser usado uma única vez.',
      'Se você não esperava este e-mail, ignore-o: sem abrir o link, nada acontece.',
    ].join('\n');
  }

  /**
   * HTML DELIBERADAMENTE POBRE -- sem CSS externo, sem imagem, sem fonte.
   * Cliente de e-mail nao e navegador: remove `<style>`, bloqueia imagem por
   * padrao e ignora metade do CSS. O que sobrevive em todos e texto, link e
   * atributo `style` na propria tag.
   *
   * O LINK APARECE COMO TEXTO tambem, e nao so no `href`: quem desconfia do
   * botao precisa poder LER para onde ele vai antes de clicar -- e e assim
   * que se distingue um convite legitimo de phishing.
   */
  private corpoEmHtml(link: string): string {
    return [
      '<p>Você foi convidado para o painel da academia.</p>',
      '<p>Abra o link abaixo para definir sua senha e entrar:</p>',
      `<p><a href="${link}">${link}</a></p>`,
      '<p>O convite vale por 24 horas e pode ser usado uma única vez.</p>',
      '<p>Se você não esperava este e-mail, ignore-o: sem abrir o link, nada acontece.</p>',
    ].join('\n');
  }
}
