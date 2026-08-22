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

/**
 * UM CAMPO POR LAUDO — e a razão não é organização, é correção.
 *
 * O OCR de imagem devolve `BIOIMPEDANCE` para toda foto: balança e app de
 * análise chegavam à API indistinguíveis, e a precedência do ADR-041 ("o
 * medido vence o derivado") não tinha em que se apoiar. A primeira medição
 * real travou por isso — `mais de um valor aceito para BODY_FAT_MASS`, e
 * nenhuma avaliação publicada.
 *
 * Quem anexa sabe qual arquivo é qual. Cada campo DECLARA o tipo, e a
 * miniatura de exemplo ao lado mostra a cara do laudo esperado — quem está
 * no balcão reconhece de relance em vez de ler um rótulo e torcer.
 *
 * `obrigatorio` marca a balança: ela mediu o corpo, e sem ela não há
 * avaliação (`sessaoPodeConfirmar` recusa com `BIOIMPEDANCE_REQUIRED`). Os
 * outros dois entram quando existirem.
 */
const LAUDOS = [
  {
    tipo: 'BIOIMPEDANCE',
    id: 'laudo-balanca',
    titulo: 'Relatório de medição',
    aparelho: 'Balança de bioimpedância',
    exemplo: '/exemplos-de-laudo/exemplo-balanca.png',
    obrigatorio: true,
  },
  {
    tipo: 'BIOIMPEDANCE_ANALYSIS',
    id: 'laudo-analise',
    titulo: 'Análise de composição',
    aparelho: 'App da balança',
    exemplo: '/exemplos-de-laudo/exemplo-analise.png',
    obrigatorio: false,
  },
  {
    tipo: 'ECG',
    id: 'laudo-ecg',
    titulo: 'Eletrocardiograma',
    aparelho: 'Aparelho de ECG',
    exemplo: '/exemplos-de-laudo/exemplo-ecg.png',
    obrigatorio: false,
  },
] as const;

interface Props {
  readonly studentId: string;
}

/**
 * Envio dos laudos da avaliação.
 *
 * A avaliação é PUBLICADA no envio (ADR-039): o upload extrai os valores e
 * grava a avaliação, sem conferência campo a campo. A tela que abre em
 * seguida mostra o que foi gravado — não pede permissão para gravar.
 */
export function EnvioDeLaudos({ studentId }: Props) {
  const [estado, acao] = useActionState(enviarArquivos, ESTADO_INICIAL);
  const [escolhidos, setEscolhidos] = useState<Readonly<Record<string, string>>>({});
  const entradas = useRef<Record<string, HTMLInputElement | null>>({});
  const router = useRouter();

  useToastDeErro(estado.erro, 'error', `erro-envio-${studentId}`);

  const sessaoCriada = estado.sucesso?.sessionId;
  const temBalanca = escolhidos['BIOIMPEDANCE'] !== undefined;
  const quantidade = Object.keys(escolhidos).length;

  /*
    Sucesso leva direto à avaliação: quem enviou quer ver o que foi gravado,
    e devolvê-lo a esta tela o obrigaria a procurar a sessão que ele mesmo
    acabou de criar.

    Em efeito, e não no corpo do componente: navegar durante o render é
    efeito colateral no meio da renderização, e o React avisa (ou dispara
    duas vezes em modo estrito).
  */
  useEffect(() => {
    if (sessaoCriada === undefined) return;

    for (const entrada of Object.values(entradas.current)) {
      if (entrada !== null) entrada.value = '';
    }
    setEscolhidos({});

    router.push(`/students/${studentId}/health/imports/${sessaoCriada}`);
  }, [sessaoCriada, studentId, router]);

  return (
    <form action={acao} data-testid="envio-de-laudos" className={estilos['envio']}>
      <input type="hidden" name="studentId" value={studentId} />

      <div className={estilos['cabecalhoDoEnvio']}>
        <h2 className={estilos['tituloDoEnvio']}>Laudos da avaliação</h2>
        <p className={estilos['ajudaDoEnvio']}>
          Cada laudo no seu campo — é assim que o sistema sabe qual valor vale quando os aparelhos
          discordam. Os três viram <strong>uma</strong> avaliação, publicada na hora.
        </p>
      </div>

      <ul className={estilos['laudos']}>
        {LAUDOS.map((laudo) => {
          const nome = escolhidos[laudo.tipo];

          return (
            <li key={laudo.tipo} className={estilos['laudo']} data-testid={`campo-${laudo.id}`}>
              {/*
                A miniatura é o rótulo de verdade: quem está no balcão
                reconhece o laudo pela cara, não pelo nome do aparelho.
                `aria-hidden` porque o texto ao lado já diz o mesmo — para
                leitor de tela ela seria repetição.
              */}
              <img
                className={estilos['exemploDoLaudo']}
                src={laudo.exemplo}
                alt=""
                aria-hidden="true"
                width={320}
                height={214}
                loading="lazy"
              />

              <div className={estilos['dadosDoLaudo']}>
                <p className={estilos['tituloDoLaudo']}>
                  {laudo.titulo}
                  {laudo.obrigatorio ? (
                    <span className={estilos['obrigatorio']}> · obrigatório</span>
                  ) : null}
                </p>
                <p className={estilos['aparelhoDoLaudo']}>{laudo.aparelho}</p>

                {/*
                  O `input[type=file]` nativo escreve "Choose File / No file
                  chosen" em INGLÊS — texto do navegador, que o HTML não
                  deixa traduzir. Por isso ele fica visualmente escondido e o
                  `<label>` estilizado o dispara: o label nativo já abre o
                  seletor no clique e no Enter, sem JavaScript, e continua
                  sendo o rótulo acessível do campo.
                */}
                <input
                  ref={(elemento) => {
                    entradas.current[laudo.tipo] = elemento;
                  }}
                  id={laudo.id}
                  name={`arquivo-${laudo.tipo}`}
                  type="file"
                  accept={TIPOS_ACEITOS}
                  className={estilos['seletorNativo']}
                  onChange={(evento) => {
                    const arquivo = evento.target.files?.[0];

                    setEscolhidos((anterior) => {
                      if (arquivo === undefined) {
                        const { [laudo.tipo]: _removido, ...resto } = anterior;

                        return resto;
                      }

                      return { ...anterior, [laudo.tipo]: arquivo.name };
                    });
                  }}
                  data-testid={`seletor-${laudo.id}`}
                />

                <label htmlFor={laudo.id} className={estilos['botaoDeEscolher']}>
                  {nome === undefined ? 'Escolher arquivo' : 'Trocar arquivo'}
                </label>

                <p
                  className={nome === undefined ? estilos['semArquivo'] : estilos['comArquivo']}
                  data-testid={`escolhido-${laudo.id}`}
                >
                  {nome ?? 'Nenhum arquivo'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <BotaoDeEnvio quantidade={quantidade} temBalanca={temBalanca} />
    </form>
  );
}

function BotaoDeEnvio({
  quantidade,
  temBalanca,
}: {
  readonly quantidade: number;
  readonly temBalanca: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <div className={estilos['rodapeDoEnvio']}>
      <Button type="submit" variant="solid" disabled={pending || !temBalanca}>
        {pending
          ? 'Enviando…'
          : quantidade === 0
            ? 'Enviar laudos'
            : `Enviar ${quantidade} arquivo${quantidade > 1 ? 's' : ''}`}
      </Button>

      {/*
        Botão desabilitado sem explicação é beco sem saída: quem olha não
        sabe se falta escolher arquivo, se falta permissão, ou se quebrou.
      */}
      {!temBalanca && !pending ? (
        <span className={estilos['motivoDoBotao']} data-testid="motivo-envio-bloqueado">
          O relatório da balança é obrigatório — sem ele não há medição para publicar.
        </span>
      ) : null}
    </div>
  );
}
