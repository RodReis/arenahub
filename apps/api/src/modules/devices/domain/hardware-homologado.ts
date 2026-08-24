/**
 * Hardware homologado para sincronizacao biometrica.
 *
 * ESTA LISTA E PROVISORIA E O CODIGO SABE DISSO.
 *
 * O plano de apoio manda derivar `docs/operations/smart-access/
 * supported-hardware.md` da evidencia do gate fisico `M1-HW-01` -- que ainda
 * NAO foi atravessado. Enquanto a bancada nao assinar a decisao, a fatia
 * roda em SIMULATOR_READY, e o que existe aqui e o minimo para o inventario
 * recusar hardware desconhecido com codigo estavel em vez de aceitar
 * qualquer coisa.
 *
 * Quando o gate passar, esta lista sai do codigo e vem do documento de
 * homologacao. Nao acrescente modelo aqui sem evidencia de bancada: o
 * proposito da checagem e justamente impedir que um leitor nao testado
 * chegue a producao pela porta do cadastro.
 */

/** Modelo homologado, com as versoes de firmware aceitas. */
export interface ModeloHomologado {
  kind: 'FACIAL_READER' | 'TURNSTILE';
  model: string;
  /**
   * Firmwares aceitos. Lista vazia = qualquer firmware, e isso e um DEBITO
   * explicito: o plano proibe "any model", e a versao exata sai do gate.
   */
  firmwares: readonly string[];
}

/**
 * Homologado pela bancada do MVP 0 (F1-F5): Topdata Inner Fit instalado na
 * unidade, leitor AYTI11108174.
 *
 * A CATRACA entrou em 24/08/2026, por decisao do PI. Ela nao veio de
 * suposicao: o inventario foi lido no teclado/LCD do proprio equipamento
 * pelo PI, no local, e esta registrado em
 * `docs/field-notes/2026-08-15-hardware-arena-positiva.md` §2.1 --
 * modelo **Topdata Inner**, serial **247000797**, firmware **7.05.00**,
 * respondendo na porta 3570 do canal SDK (`EasyInner.dll`).
 *
 * E a MESMA catraca da bancada que homologou o leitor facial: os dois
 * equipamentos sao do par instalado na unidade, e o ciclo facial ao vivo de
 * 17/08 girou justamente esta catraca (30 comandos, 28 giros confirmados por
 * sensor). O que faltava era o registro no codigo, nao a evidencia.
 */
export const HARDWARE_HOMOLOGADO: readonly ModeloHomologado[] = [
  { kind: 'FACIAL_READER', model: 'Inner Fit', firmwares: [] },
  { kind: 'TURNSTILE', model: 'Inner', firmwares: [] },
];

export type ResultadoDeHomologacao =
  | { homologado: true }
  | { homologado: false; motivo: 'DEVICE_UNSUPPORTED_HARDWARE' };

/**
 * O dispositivo pode ser cadastrado?
 *
 * Hardware desconhecido responde codigo estavel, nunca 500 generico: quem
 * esta instalando precisa saber que o modelo nao passou pela bancada, e nao
 * que "deu erro no servidor".
 */
export function verificarHomologacao(
  dispositivo: { kind: string; model: string; firmware?: string | undefined },
  catalogo: readonly ModeloHomologado[] = HARDWARE_HOMOLOGADO,
): ResultadoDeHomologacao {
  const modelo = catalogo.find(
    (candidato) =>
      candidato.kind === dispositivo.kind &&
      candidato.model.toLowerCase() === dispositivo.model.trim().toLowerCase(),
  );

  if (!modelo) return { homologado: false, motivo: 'DEVICE_UNSUPPORTED_HARDWARE' };

  // Lista vazia aceita qualquer firmware -- debito registrado acima.
  if (modelo.firmwares.length === 0) return { homologado: true };

  if (!dispositivo.firmware || !modelo.firmwares.includes(dispositivo.firmware)) {
    return { homologado: false, motivo: 'DEVICE_UNSUPPORTED_HARDWARE' };
  }

  return { homologado: true };
}

/**
 * Gera o identificador do aluno DENTRO do leitor.
 *
 * NAO DERIVA DO CPF (INV-012) nem da matricula: quem tiver acesso fisico ao
 * equipamento le a lista de usuarios, e um `enrollid` que carrega documento
 * transforma o leitor numa base de CPF.
 *
 * O numero e sequencial por dispositivo porque o protocolo do leitor exige
 * inteiro; a unicidade real e garantida pela constraint
 * `(deviceId, externalUserId)` (INV-025). Recebe o proximo valor por
 * parametro para continuar puro.
 */
export function formatarExternalUserId(sequencial: number): string {
  if (!Number.isInteger(sequencial) || sequencial <= 0) {
    throw new Error('sequencial de external_user_id precisa ser inteiro positivo');
  }

  return String(sequencial);
}
