'use server';

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Envio dos laudos da avaliacao (ADR-039).
 *
 * UMA acao: mandar os arquivos da mesma medicao. A API extrai, consolida e
 * PUBLICA a avaliacao no ultimo arquivo da sessao -- nao ha mais acao de
 * revisao aqui (ver a nota abaixo).
 */

const MENSAGEM: Record<string, string> = {
  VALIDATION_FAILED: 'Confira os dados informados.',
  IMPORT_NOT_FOUND: 'Importacao nao encontrada nesta academia.',
  SESSION_NOT_FOUND: 'Sessao de revisao nao encontrada.',
  BIOIMPEDANCE_REQUIRED: 'Falta o arquivo da balanca de bioimpedancia nesta medicao.',
  FORBIDDEN: 'Seu perfil nao tem permissao para esta acao.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

/*
 * As acoes de REVISAO MANUAL sairam com o ADR-039.
 *
 * `revisarCampo`, `confirmarSessao` e `descartarSessao` existiam para a tela
 * de conferencia campo a campo: escolher qual valor vale numa divergencia,
 * confirmar a sessao inteira, descartar a extracao. Com a publicacao
 * automatica nao ha mais tela que as chame -- a avaliacao nasce publicada no
 * upload.
 *
 * As ROTAS da API continuam existindo (`POST .../fields/:fieldId`,
 * `.../confirm`, `.../discard`): elas sao o caminho manual de fallback
 * quando a publicacao automatica falha, e a fila da F22 as usa. O que morreu
 * foi o consumidor no painel, nao a capacidade.
 */

/**
 * Os TIPOS de laudo, na ordem de envio.
 *
 * A BALANCA vai primeiro de proposito: e o arquivo obrigatorio, o que MEDIU
 * o corpo, e quem cria a sessao. Se o envio falhar no meio, o que sobrou na
 * sessao e a medicao de verdade -- nao o app de analise sozinho, que so
 * deriva numeros de uma medicao que nao esta la.
 */
const TIPOS_DE_LAUDO = ['BIOIMPEDANCE', 'BIOIMPEDANCE_ANALYSIS', 'ECG'] as const;

export interface EstadoDoEnvio {
  erro?: string;
  sucesso?: { sessionId: string; enviados: number };
}

/**
 * Envia os laudos da medicao e abre UMA sessao com todos.
 *
 * Cada arquivo chega num campo PROPRIO do formulario (`arquivo-<TIPO>`), e
 * o tipo viaja DECLARADO para a API. E o que permite a precedencia do
 * ADR-041 funcionar: o OCR de imagem devolve `BIOIMPEDANCE` para toda foto,
 * entao balanca e app de analise chegavam indistinguiveis e a regra "o
 * medido vence o derivado" nao tinha em que se apoiar.
 *
 * O primeiro arquivo cria a sessao; os demais entram nela pelo
 * `reviewSessionId` que a API devolveu. Em serie, e nao em paralelo, de
 * proposito: a sessao so existe DEPOIS que o primeiro upload responde, e
 * disparar os tres juntos abriria tres sessoes -- exatamente as tres
 * avaliacoes separadas que esta fatia existe para impedir.
 *
 * Falha no meio NAO desfaz o que subiu: os arquivos ja processados ficam na
 * sessao. Apagar seria pior -- quem enviou tres laudos e viu o terceiro
 * falhar prefere ficar com os dois que subiram a recomecar do zero.
 */
export async function enviarArquivos(
  _anterior: EstadoDoEnvio,
  formulario: FormData,
): Promise<EstadoDoEnvio> {
  const studentId = formulario.get('studentId');

  if (typeof studentId !== 'string' || studentId === '') {
    return { erro: 'Aluno não informado.' };
  }

  const laudos: { tipo: (typeof TIPOS_DE_LAUDO)[number]; arquivo: File }[] = [];

  for (const tipo of TIPOS_DE_LAUDO) {
    const arquivo = formulario.get(`arquivo-${tipo}`);

    if (arquivo instanceof File && arquivo.size > 0) laudos.push({ tipo, arquivo });
  }

  if (laudos.length === 0) {
    return { erro: 'Escolha ao menos um arquivo.' };
  }

  // A balanca e o unico obrigatorio: ela mediu o corpo. Sem ela a API
  // recusaria a sessao (`BIOIMPEDANCE_REQUIRED`) DEPOIS de ja ter guardado
  // os arquivos -- barrar aqui evita subir dado de saude que nao vai virar
  // avaliacao nenhuma.
  if (!laudos.some((laudo) => laudo.tipo === 'BIOIMPEDANCE')) {
    return { erro: 'O relatório da balança é obrigatório — sem ele não há medição para publicar.' };
  }

  let sessionId: string | undefined;
  let enviados = 0;

  for (const [indice, laudo] of laudos.entries()) {
    const ultimo = indice === laudos.length - 1;
    const envio = new FormData();
    envio.append('file', laudo.arquivo);
    if (sessionId !== undefined) envio.append('reviewSessionId', sessionId);
    // Só o ÚLTIMO publica (ADR-039). Marcar todos faria o primeiro arquivo
    // confirmar a sessão sozinho, criando uma avaliação com um laudo só --
    // e os demais chegariam numa sessão já fechada.
    envio.append('ultimoDaSessao', ultimo ? 'true' : 'false');
    // O tipo DECLARADO -- a informação que o OCR não consegue dar.
    envio.append('tipoDeLaudo', laudo.tipo);
    envio.append('sourceLabel', laudo.arquivo.name.replace(/\.[^.]+$/, '').slice(0, 120));

    const resposta = await chamarApi<{ reviewSessionId: string }>(
      `/api/v1/students/${studentId}/assessment-imports`,
      { metodo: 'POST', formulario: envio },
    );

    if (!resposta.ok) {
      const detalhe = mensagemDe(resposta.erro?.code, 'Não foi possível enviar o arquivo.');

      return {
        erro:
          enviados === 0
            ? detalhe
            : `${detalhe} ${enviados} arquivo(s) já entraram na sessão.`,
        ...(sessionId === undefined ? {} : { sucesso: { sessionId, enviados } }),
      };
    }

    sessionId ??= resposta.dados?.reviewSessionId;
    enviados += 1;
  }

  if (sessionId === undefined) {
    return { erro: 'A API não devolveu a sessão de revisão.' };
  }

  revalidatePath(`/students/${studentId}/health`);

  return { sucesso: { sessionId, enviados } };
}
