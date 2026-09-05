'use client';

import { useEffect, useState } from 'react';

import { Button, useToast } from '@arenahub/ui';

import estilos from '../dialogo.module.css';
import proprios from './convite.module.css';

/**
 * O link do convite, pronto para entregar — issue #276.
 *
 * Nasceu na #274 como TEXTO do caminho relativo (`/convite/TOKEN`), e o PI
 * viu o problema na tela: *"não dá para fazer nada com esse link?"*. Colar
 * `/convite/TOKEN` no WhatsApp não vira link, e quem recebe teria de saber o
 * domínio do painel para montar o endereço à mão.
 *
 * POR QUE O CAMINHO RELATIVO ERA A ESCOLHA CERTA -- e por que deixou de ser.
 *
 * O Server Component NÃO SABE em que domínio está sendo servido: pode ser
 * `localhost`, o domínio de produção ou um túnel. Montar a URL lá daria um
 * link certo por acidente e errado quando alguém acessasse por outro
 * endereço. A restrição é real.
 *
 * O que faltou na #274 foi notar que ISTO AQUI é cliente, e no cliente
 * `window.location.origin` responde a pergunta com certeza -- é o endereço
 * pelo qual a própria pessoa chegou ao painel.
 */
interface Props {
  readonly caminho: string;
}

export function LinkDoConvite({ caminho }: Props) {
  const { show } = useToast();

  /*
   * `useEffect` e não leitura direta: `window` não existe no servidor, e o
   * HTML que ele gera precisa bater com o do primeiro render do cliente --
   * senão o React acusa divergência de hidratação e descarta a árvore.
   *
   * Antes do efeito rodar, mostra-se o CAMINHO. Não é degradação: é a mesma
   * informação, e o efeito completa no primeiro quadro.
   */
  const [origem, setOrigem] = useState('');

  useEffect(() => {
    setOrigem(window.location.origin);
  }, []);

  const url = origem === '' ? caminho : `${origem}${caminho}`;

  async function copiar(): Promise<void> {
    /*
     * `navigator.clipboard` é OPCIONAL: exige contexto seguro (HTTPS ou
     * localhost) e pode ser negado pela política do navegador. Sem a guarda,
     * um `TypeError` subiria da promessa e o clique não faria nada nem
     * diria por quê -- e o link continua ali, selecionável à mão.
     */
    if (!navigator.clipboard) {
      /*
       * FRASE PRÓPRIA, diferente da do `catch` abaixo -- e não é capricho de
       * texto: sem a guarda, `undefined.writeText` lança `TypeError`, o
       * `catch` pega e mostra a SUA frase. Se as duas fossem iguais, o teste
       * desta guarda passaria com ela removida, provando nada.
       *
       * A frase também é mais útil: aqui o navegador nunca vai oferecer
       * clipboard (falta contexto seguro), então "tente de novo" seria
       * mentira.
       */
      show(
        'warn',
        'Seu navegador não oferece a área de transferência. Selecione o link e copie à mão.',
        'copia-do-convite',
      );

      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      /*
       * `info` e nao um tom de sucesso: o dicionario tem `info | warn |
       * error`, e inventar um quarto aqui criaria uma escala paralela que
       * nenhuma outra tela usa.
       */
      show('info', 'Link copiado.', 'copia-do-convite');
    } catch {
      show('warn', 'Não foi possível copiar. Selecione o link e copie à mão.', 'copia-do-convite');
    }
  }

  return (
    <>
      {/*
        LINK DE VERDADE, e não texto: serve para conferir que o convite
        funciona antes de entregá-lo.

        `rel="noopener noreferrer"` com `target="_blank"`: sem `noopener` a
        aba aberta ganha `window.opener` e pode navegar esta; `noreferrer`
        evita mandar a URL do painel (que carrega o token) no cabeçalho
        `Referer`.
      */}
      <a
        className={proprios['link']}
        href={caminho}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="link-do-convite"
      >
        {url}
      </a>

      {/*
        O AVISO É PARTE DA FUNÇÃO DO LINK, não enfeite. O convite é de USO
        ÚNICO -- `aceitar` marca `ACCEPTED` na mesma transação que cria o
        usuário. Quem clicar para "só conferir" e definir uma senha QUEIMA o
        convite da outra pessoa, e a saída seria convidar de novo.
      */}
      <p className={estilos['notaDoDialogo']} role="note">
        Abrir o link só confere que ele funciona. Se você definir uma senha, o convite é gasto — ele
        vale uma vez só.
      </p>

      <div className={proprios['acoesDoLink']}>
        <Button type="button" onClick={() => void copiar()} data-testid="copiar-link-do-convite">
          Copiar link
        </Button>
      </div>
    </>
  );
}
