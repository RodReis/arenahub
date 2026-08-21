'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Button, useToastDeErro } from '@arenahub/ui';

import { enviarArquivos, type EstadoDoEnvio } from '../../../../actions/assessment-imports';
import estilos from './health.module.css';

const ESTADO_INICIAL: EstadoDoEnvio = {};

/**
 * Tipos que a API aceita (`arquivo-de-importacao.ts`).
 *
 * O `accept` é conveniência do seletor, NÃO validação: o tipo real é
 * decidido no servidor pela assinatura dos primeiros bytes, porque extensão
 * é controlada por quem envia.
 */
const TIPOS_ACEITOS = '.csv,.pdf,.png,.jpg,.jpeg';

interface Props {
  readonly studentId: string;
}

/**
 * Envio dos laudos do mês.
 *
 * MÚLTIPLOS ARQUIVOS DE UMA VEZ, de propósito: a medição da academia produz
 * três arquivos do MESMO instante (balança, app da balança, ECG), e enviá-los
 * um a um abriria três sessões -- três avaliações separadas para uma medição
 * só, que é o defeito que esta fatia existe para impedir.
 *
 * Nada é gravado como histórico aqui: o upload extrai e abre a revisão. Só a
 * confirmação campo a campo cria a avaliação (INV-103).
 */
export function EnvioDeLaudos({ studentId }: Props) {
  const [estado, acao] = useActionState(enviarArquivos, ESTADO_INICIAL);
  const [nomes, setNomes] = useState<readonly string[]>([]);
  const quantidade = nomes.length;
  const entrada = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useToastDeErro(estado.erro, 'error', `erro-envio-${studentId}`);

  const sessaoCriada = estado.sucesso?.sessionId;

  /*
    Sucesso leva direto à revisão: o avaliador acabou de enviar para
    conferir, e devolvê-lo a esta tela o obrigaria a procurar a sessão que
    ele mesmo acabou de criar.

    Em efeito, e não no corpo do componente: navegar durante o render é
    efeito colateral no meio da renderização, e o React avisa (ou dispara
    duas vezes em modo estrito).
  */
  useEffect(() => {
    if (sessaoCriada === undefined) return;

    if (entrada.current !== null) entrada.current.value = '';
    setNomes([]);

    router.push(`/students/${studentId}/health/imports/${sessaoCriada}`);
  }, [sessaoCriada, studentId, router]);

  return (
    <form action={acao} data-testid="envio-de-laudos" className={estilos['envio']}>
      <input type="hidden" name="studentId" value={studentId} />

      <h2 className={estilos['tituloDoEnvio']}>Laudos da avaliação</h2>

      <p className={estilos['ajudaDoEnvio']}>
        Envie os arquivos da mesma medição juntos — balança, análise e ECG. Eles viram{' '}
        <strong>uma</strong> avaliação, gravada e disponível para o aluno na hora.
      </p>

      <div className={estilos['linhaDoEnvio']}>
        {/*
          O `input[type=file]` nativo escreve "Choose Files / No file chosen"
          em INGLÊS -- texto do navegador, que o HTML não deixa traduzir, e a
          interface do ArenaHub é pt-BR (`CLAUDE.md`). Por isso ele fica
          visualmente escondido e um `<label>` estilizado o dispara: o label
          nativo já abre o seletor no clique e no Enter, sem JavaScript, e
          continua sendo o rótulo acessível do campo.
        */}
        <input
          ref={entrada}
          id="arquivos-do-laudo"
          name="arquivos"
          type="file"
          multiple
          accept={TIPOS_ACEITOS}
          className={estilos['seletorNativo']}
          onChange={(evento) =>
            setNomes(Array.from(evento.target.files ?? [], (arquivo) => arquivo.name))
          }
          data-testid="seletor-de-laudos"
        />

        <label htmlFor="arquivos-do-laudo" className={estilos['botaoDeEscolher']}>
          Escolher arquivos
        </label>

        <span className={estilos['nomesDosArquivos']} data-testid="arquivos-escolhidos">
          {nomes.length === 0 ? 'Nenhum arquivo escolhido' : nomes.join(', ')}
        </span>

        <BotaoDeEnvio quantidade={quantidade} />
      </div>
    </form>
  );
}

function BotaoDeEnvio({ quantidade }: { readonly quantidade: number }) {
  const { pending } = useFormStatus();
  const semArquivo = quantidade === 0;

  return (
    <>
      <Button type="submit" variant="solid" disabled={pending || semArquivo}>
        {pending
          ? 'Enviando…'
          : semArquivo
            ? 'Enviar laudos'
            : `Enviar ${quantidade} arquivo${quantidade > 1 ? 's' : ''}`}
      </Button>

      {/*
        Botão desabilitado sem explicação é beco sem saída: quem olha não
        sabe se falta escolher arquivo, se falta permissão, ou se quebrou.
      */}
      {semArquivo && !pending ? (
        <span className={estilos['motivoDoBotao']} data-testid="motivo-envio-bloqueado">
          Escolha ao menos um arquivo para habilitar o envio.
        </span>
      ) : null}
    </>
  );
}
