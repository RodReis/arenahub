import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { DeviceUserState } from '@arenahub/database';

import type { ContextoDoEdge } from '../edge-auth/edge-auth.service.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { DeviceReaderNumberRepository } from '../devices/device-reader-number.repository.js';
import { ConsentRepository } from '../privacy/consent.repository.js';
import { StudentCredentialRepository } from '../students/student-credential.repository.js';
import { BiometricIdentityRepository } from './biometric-identity.repository.js';

/**
 * Vinculo dos alunos legados a partir do que o leitor ja tem -- #468.
 *
 * O leitor da Arena Positiva chegou com os cadastros faciais do sistema
 * anterior. O numero de cada aluno no leitor esta na credencial do cadastro
 * (coluna CATRACA), mas a decisao de acesso resolve por `DeviceUser`
 * (INV-026) -- e sem vinculo todo aluno legado era `UNKNOWN_EXTERNAL_USER`.
 *
 * Decisoes do PI (30/09/2026): importar o vinculo a partir do leitor; o
 * consentimento que a identidade exige nasce marcado como LEGADO.
 *
 * A REGRA QUE ESTE ARQUIVO GUARDA: so vincula quando o numero aponta para
 * UM aluno, e cada aluno tem UM numero por leitor. Na duvida, nao vincula e
 * devolve o caso para a recepcao -- vinculo errado e catraca aberta para a
 * pessoa errada.
 */

export interface ResultadoDoVinculoLegado {
  linked: number;
  alreadyLinked: number;
  /** Numero que nenhum aluno tem no cadastro. */
  withoutStudent: string[];
  /** Numero que dois ou mais alunos tem -- ninguem e vinculado. */
  ambiguous: string[];
  /** Numero de um aluno que ja tem OUTRO numero neste leitor. */
  studentAlreadyLinked: string[];
  /**
   * Numero de aluno sem identidade ativa quando nao ha termo biometrico
   * vigente -- sem termo nao ha consentimento, e sem consentimento a
   * identidade nao nasce (INV-017).
   */
  withoutConsentDocument: string[];
  /**
   * SEMPRE VAZIO desde o ADR-064: recusa e identidade encerrada nao barram
   * mais a importacao. O campo fica porque o Edge ja em campo le esta chave
   * -- tira-la quebraria o log do vinculo sem ganho nenhum.
   */
  refusedOrRevoked: string[];
}

/**
 * Formato do `enrollid` (#601): so digitos, ate 18 (o leitor esta no modo "18
 * digitos"). Em producao, em 06/10/2026, os 433 numeros do leitor batiam --
 * o maior com 5 digitos. O que nao bate e DESCARTADO em silencio, nunca
 * recusa o lote: um numero estranho derrubaria o vinculo de todos os outros.
 */
const FORMATO_DO_NUMERO = /^\d{1,18}$/;

@Injectable()
export class VincularCadastroLegadoUseCase {
  private readonly logger = new Logger(VincularCadastroLegadoUseCase.name);

  constructor(
    private readonly dispositivos: DeviceRepository,
    private readonly numerosDoLeitor: DeviceReaderNumberRepository,
    private readonly credenciais: StudentCredentialRepository,
    private readonly consentimentos: ConsentRepository,
    private readonly identidades: BiometricIdentityRepository,
  ) {}

  async executar(
    edge: ContextoDoEdge,
    entrada: { deviceSerial: string; externalUserIds: readonly string[] },
    correlationId: string,
    agora: Date,
  ): Promise<ResultadoDoVinculoLegado> {
    const leitor = await this.dispositivos.resolverDoEdgePorSerial(edge, entrada.deviceSerial);

    if (!leitor) throw new NotFoundException({ code: 'DEVICE_NOT_IN_SCOPE' });

    // Registra o que o leitor TEM, com ou sem aluno vinculado -- #475. Antes
    // do vinculo: mesmo o numero que fica `withoutStudent` abaixo precisa
    // ficar visivel para "proximo numero livre" nao sugerir um que o
    // equipamento ja usa.
    const numeros = entrada.externalUserIds.filter((n) => FORMATO_DO_NUMERO.test(n));
    const foraDoFormato = entrada.externalUserIds.length - numeros.length;

    // So a contagem vai para o log: o numero e identificador de pessoa no leitor.
    if (foraDoFormato > 0) {
      this.logger.warn(
        `Leitor ${leitor.id}: ${foraDoFormato} numero(s) fora do formato descartado(s).`,
      );
    }

    const { ignorados } = await this.numerosDoLeitor.registrarLote(
      edge.tenantId,
      leitor.id,
      [...new Set(numeros)],
      agora,
    );

    if (ignorados > 0) {
      this.logger.warn(
        `Leitor ${leitor.id} no teto de numeros registrados: ${ignorados} numero(s) novo(s) nao registrado(s).`,
      );
    }

    return this.vincularNoLeitor(
      edge.tenantId,
      { id: leitor.id, serial: entrada.deviceSerial },
      numeros,
      correlationId,
      agora,
    );
  }

  /**
   * Vinculo imediato quando a recepcao grava o numero -- spec 2026-10-03.
   *
   * O leitor ja informou este numero antes (cadastro feito direto no
   * equipamento, `DeviceReaderNumber`). Sem isto o vinculo so fechava no
   * proximo reinicio do Edge: o `senduser` ja tinha sido confirmado e o
   * `getuserlist` roda uma vez por execucao.
   */
  async vincularNumero(
    tenantId: string,
    numero: string,
    correlationId: string,
    agora: Date,
  ): Promise<{ linkedReaders: number }> {
    // Dono do numero: so UM aluno. Zero ou varios -> nao toca em leitor.
    const donos = new Set(
      (await this.credenciais.encontrarPorNumeros(tenantId, [numero])).map((l) => l.studentId),
    );
    const [dono] = [...donos];

    if (donos.size !== 1 || dono === undefined) return { linkedReaders: 0 };

    const leitores = await this.numerosDoLeitor.leitoresComNumero(tenantId, numero);
    let linkedReaders = 0;

    for (const leitor of leitores) {
      await this.vincularNoLeitor(
        tenantId,
        { id: leitor.deviceId, serial: leitor.serial },
        [numero],
        correlationId,
        agora,
      );

      // `alreadyLinked` so diz que o numero tem ALGUM DeviceUser no leitor --
      // pode ser de outro aluno. Conta o leitor so se o numero resolve para o dono.
      const vinculado = await this.identidades.alunoDoNumero(tenantId, leitor.deviceId, numero);
      if (vinculado === dono) linkedReaders += 1;
    }

    return { linkedReaders };
  }

  /**
   * Vinculo no PRIMEIRO reconhecimento -- incidente de 05/10/2026 (numero 861).
   *
   * O leitor reconheceu um numero que ainda nao tem `DeviceUser` neste
   * leitor, mas que pode estar na credencial do cadastro. Antes, a decisao
   * saia `UNKNOWN_EXTERNAL_USER` e o vinculo automatico nascia 27 ms DEPOIS:
   * aluna em dia barrada na catraca.
   *
   * NAO AFROUXA NADA: e o mesmo `vincularNoLeitor` que o `getuserlist` roda a
   * cada reinicio do Edge, com as mesmas travas (numero de UM aluno, um
   * numero por aluno no leitor, termo vigente). So antecipa o que o proximo
   * reinicio faria. Devolve se o numero passou a resolver para alguem.
   */
  async vincularNoReconhecimento(
    tenantId: string,
    deviceId: string,
    numero: string,
    correlationId: string,
    agora: Date,
  ): Promise<boolean> {
    const serial = await this.dispositivos.serialDoDispositivo(tenantId, deviceId);

    if (serial === null) return false;

    const resultado = await this.vincularNoLeitor(
      tenantId,
      { id: deviceId, serial },
      [numero],
      correlationId,
      agora,
    );

    return resultado.linked + resultado.alreadyLinked > 0;
  }

  private async vincularNoLeitor(
    tenantId: string,
    leitor: { id: string; serial: string },
    numeros: readonly string[],
    correlationId: string,
    agora: Date,
  ): Promise<ResultadoDoVinculoLegado> {
    const resultado: ResultadoDoVinculoLegado = {
      linked: 0,
      alreadyLinked: 0,
      withoutStudent: [],
      ambiguous: [],
      studentAlreadyLinked: [],
      withoutConsentDocument: [],
      refusedOrRevoked: [],
    };

    const vinculos = await this.identidades.vinculosDoDispositivo(tenantId, leitor.id);
    const numerosVinculados = new Set(vinculos.map((v) => v.externalUserId));
    // Aluno ja com numero neste leitor: um segundo numero violaria
    // `@@unique([deviceId, identityId])` -- e seria cadastro duplicado.
    const linhasDoAluno = new Map<string, { externalUserId: string; state: DeviceUserState }[]>();
    for (const v of vinculos) {
      linhasDoAluno.set(v.studentId, [...(linhasDoAluno.get(v.studentId) ?? []), v]);
    }
    // Estado desconhecido (outra chamada vinculou na corrida): nunca reapontavel.
    const vinculoDesconhecido = (numero: string) => [{ externalUserId: numero, state: 'PENDING' as const }];

    const pendentes: string[] = [];
    for (const numero of new Set(numeros)) {
      if (numerosVinculados.has(numero)) resultado.alreadyLinked += 1;
      else pendentes.push(numero);
    }

    const linhas = await this.credenciais.encontrarPorNumeros(tenantId, pendentes);
    const donos = new Map<string, Map<string, Date>>();
    for (const linha of linhas) {
      const alunos = donos.get(linha.externalId) ?? new Map<string, Date>();
      alunos.set(linha.studentId, linha.birthDate);
      donos.set(linha.externalId, alunos);
    }

    // Documento lido UMA vez e so quando alguem precisar de identidade nova.
    let documento: { id: string } | null | undefined;

    for (const numero of pendentes) {
      const alunos = donos.get(numero);

      if (!alunos) {
        resultado.withoutStudent.push(numero);
        continue;
      }

      if (alunos.size > 1) {
        resultado.ambiguous.push(numero);
        continue;
      }

      const [[studentId, birthDate]] = [...alunos.entries()] as [[string, Date]];

      const linhas = linhasDoAluno.get(studentId);
      if (linhas !== undefined) {
        // Troca de numero: so quando o aluno tem UM vinculo neste leitor, ele
        // esta SYNCED e o numero dele nao e mais credencial -- o vinculo antigo
        // esta morto, reaponta. Se o antigo AINDA e credencial (cartao + facial
        // com numeros diferentes), sao dois cadastros vivos e o leitor so aceita
        // um. Qualquer outro caso (PENDING, REMOVAL_PENDING, REMOVED, varias
        // linhas) volta para a recepcao: reapontar mudaria o alvo de um
        // senduser/deluser futuro.
        const [unica] = linhas;
        if (linhas.length === 1 && unica !== undefined && unica.state === 'SYNCED') {
          const credenciaisDoAluno = await this.credenciais.listarNumerosDoAluno(
            tenantId,
            studentId,
          );

          if (!credenciaisDoAluno.includes(unica.externalUserId)) {
            try {
              const reapontou = await this.identidades.reapontarNumero(
                tenantId,
                leitor.id,
                studentId,
                numero,
                correlationId,
              );

              if (reapontou) {
                linhasDoAluno.set(studentId, [{ externalUserId: numero, state: 'SYNCED' }]);
                resultado.linked += 1;
                continue;
              }
            } catch (erro: unknown) {
              // Outra chamada tomou este numero entre a leitura e a escrita:
              // a constraint unica decidiu. Mesmo tratamento do vincularLegado.
              if (!violouUnicidade(erro)) throw erro;

              linhasDoAluno.set(studentId, vinculoDesconhecido(numero));
              resultado.alreadyLinked += 1;
              continue;
            }
          }
        }

        resultado.studentAlreadyLinked.push(numero);
        continue;
      }

      const ativa = await this.identidades.encontrarAtiva({ tenantId }, studentId);
      let consentRecordId: string | null = null;

      if (!ativa) {
        const contexto = { tenantId };

        /*
         * ADR-064 (decisao do PI, 01/10/2026): quem esta na base do leitor
         * facial e aluno ou professor ja cadastrado pela academia, e entra
         * com consentimento ACEITO -- inclusive quem tinha recusa registrada
         * ou identidade encerrada. A importacao nao barra mais por isso; o
         * consentimento legado aceito passa a ser a decisao vigente.
         */
        const decisao = await this.consentimentos.encontrarDecisaoVigente(
          contexto,
          studentId,
          'BIOMETRIC',
        );

        // Consentimento aceito e valido ja existe -- inclusive o legado de
        // uma tentativa anterior que caiu antes do vinculo. Reusa: criar
        // outro so empilharia registros e marcaria o anterior de substituido.
        const aceitoValido =
          decisao?.decision === 'ACCEPTED' &&
          decisao.supersededAt === null &&
          decisao.documentRetiredAt === null;

        if (aceitoValido) {
          consentRecordId = decisao.id;
        } else {
          documento ??= await this.consentimentos.encontrarDocumentoVigente(
            contexto,
            'BIOMETRIC',
            agora,
          );

          if (!documento) {
            resultado.withoutConsentDocument.push(numero);
            continue;
          }

          const registro = await this.consentimentos.registrarConsentimentoLegado(
            tenantId,
            {
              studentId,
              documentId: documento.id,
              subjectAgeYears: idadeEmAnos(birthDate, agora),
              evidence: {
                origem: 'CADASTRO_FACIAL_LEGADO',
                deviceSerial: leitor.serial,
                externalUserId: numero,
              },
            },
            correlationId,
            agora,
          );
          consentRecordId = registro.id;
        }
      }

      try {
        await this.identidades.vincularLegado(
          tenantId,
          {
            studentId,
            deviceId: leitor.id,
            externalUserId: numero,
            identidadeAtivaId: ativa?.id ?? null,
            consentRecordId,
          },
          correlationId,
          agora,
        );
      } catch (erro: unknown) {
        // Outra chamada vinculou este numero (ou este aluno) entre a leitura
        // e a escrita. A constraint unica decidiu -- e o vinculo existe.
        // Abortar o lote inteiro por isso deixaria o resto sem vinculo.
        if (!violouUnicidade(erro)) throw erro;

        resultado.alreadyLinked += 1;
        linhasDoAluno.set(studentId, vinculoDesconhecido(numero));
        continue;
      }

      linhasDoAluno.set(studentId, [{ externalUserId: numero, state: 'SYNCED' }]);
      resultado.linked += 1;
    }

    return resultado;
  }
}

/** `P2002` do Prisma: constraint unica violada. */
function violouUnicidade(erro: unknown): boolean {
  return (
    typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002'
  );
}

/** Anos completos na data -- a idade que o consentimento congela (INV-143). */
export function idadeEmAnos(nascimento: Date, agora: Date): number {
  let anos = agora.getUTCFullYear() - nascimento.getUTCFullYear();
  const aindaNaoFez =
    agora.getUTCMonth() < nascimento.getUTCMonth() ||
    (agora.getUTCMonth() === nascimento.getUTCMonth() &&
      agora.getUTCDate() < nascimento.getUTCDate());

  if (aindaNaoFez) anos -= 1;

  return anos;
}
