import { Inject, Injectable } from '@nestjs/common';
import type { TenantContract } from '@arenahub/database';

import { carregarConfig } from '../../config/env.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { gerarPdfDoContrato } from './contrato-pdf.service.js';
import {
  aniversariosVencidos,
  competenciasDaJanela,
  corrigirPorIndice,
} from './domain/correcao-por-indice.js';
import { contarAlunosDoTenant } from './contagem-de-alunos.js';
import { calcularFatura, competenciaDe } from './domain/calculo-da-fatura.js';
import { camposFaltandoParaContrato } from './domain/qualificacao-da-contratante.js';
import { VERSAO_ATUAL_DOS_TERMOS } from './domain/termos-do-contrato.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { PlanoArquivadoError, PlanoNaoEncontradoError } from './saas-plan.use-case.js';

export class ContratoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('TENANT_CONTRACT_NOT_FOUND', 404, 'Contrato não encontrado');
  }
}

export class TenantNaoEncontradoParaContratoError extends ErroDeDominio {
  constructor() {
    super('TENANT_NOT_FOUND', 404, 'Academia não encontrada');
  }
}

/**
 * Contrato imutavel depois de `ACTIVE` -- ADR-052 §8.
 *
 * 409, e nao 422: a requisicao esta bem formada, o que nao pode e o ESTADO.
 * Quem quer outro valor abre contrato novo apontando para este.
 */
export class ContratoImutavelError extends ErroDeDominio {
  constructor() {
    super(
      'TENANT_CONTRACT_IMMUTABLE',
      409,
      'Contrato ativo não muda. Feche um contrato novo referenciando este',
    );
  }
}

export class ContratoJaAtivoNoTenantError extends ErroDeDominio {
  constructor() {
    super(
      'TENANT_CONTRACT_ALREADY_ACTIVE',
      409,
      'Esta academia já tem um contrato vigente. Encerre-o antes de ativar outro',
    );
  }
}

/**
 * A correcao pediu um indice que ninguem cadastrou -- aceite da fatia.
 *
 * Carrega QUAIS competencias faltam: "nao foi possivel corrigir" sem a lista
 * manda o Super Admin procurar mes a mes.
 */
export class IndiceIndisponivelError extends ErroDeDominio {
  constructor(readonly competencias: readonly string[]) {
    super(
      'INDEX_VALUE_MISSING',
      422,
      `Sem valor de índice para ${competencias.join(', ')}. Cadastre no histórico antes de corrigir`,
    );
  }
}

/**
 * Contrato sem qualificacao completa da CONTRATANTE nao ativa -- F70
 * (SPEC-070 §6, §8 invariante 4).
 *
 * Antes desta fatia o gerador imprimia "não informado" e seguia. O aceite
 * muda o comportamento: falta CNPJ, endereco, telefone, responsavel ou CPF
 * do responsavel BLOQUEIA a ativacao, e a mensagem nomeia o campo -- o painel
 * so consegue dizer "falta o endereco" se o backend disser.
 */
export class TenantSemQualificacaoParaContratoError extends ErroDeDominio {
  constructor(readonly camposFaltando: readonly string[]) {
    super(
      'TENANT_CONTRACT_TENANT_INCOMPLETE',
      422,
      `Contrato não pode ativar: falta no cadastro da academia: ${camposFaltando.join(', ')}`,
    );
  }
}

export class ContratoJaAssinadoError extends ErroDeDominio {
  constructor() {
    super(
      'TENANT_CONTRACT_ALREADY_SIGNED',
      409,
      'Este contrato já tem PDF assinado registrado',
    );
  }
}

export interface EntradaDeContrato {
  tenantId: string;
  planId: string;
  indexCode?: string | undefined;
  baseDate: Date;
  anniversaryDay: number;
  anniversaryMonth: number;
  graceDays?: number | undefined;
  issueDay: number;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  /** Contrato que este substitui -- aditivo ou renegociacao. */
  supersedesId?: string | null | undefined;
  /**
   * Superficies contratadas. Ausentes herdam o plano; presentes DIVERGEM dele.
   *
   * Divergir e o caso de uso, nao a excecao: o catalogo traz o padrao e o
   * comercial negocia por cliente (decisao do PI, 11/09/2026). Travar no plano
   * obrigaria a cadastrar um plano novo por concessao comercial.
   */
  mobileEnabled?: boolean | undefined;
  kioskEnabled?: boolean | undefined;
  /**
   * Foro eleito -- F70 (SPEC-070 §3.3, §7 item 3). E negociado por contrato,
   * nunca constante do produto. Ausente aqui e preenchivel ate a ativacao
   * exigir (ver `camposFaltandoParaContrato` -- o foro entra na mesma
   * checagem por ser dado do contrato, nao do tenant).
   */
  foroCidade?: string | undefined;
  foroUf?: string | undefined;
}

/** Chave do PDF no bucket privado. Servidor monta; ninguem envia prefixo. */
export function montarChaveDoContrato(tenantId: string, contratoId: string): string {
  return `tenants/${tenantId}/contracts/${contratoId}.pdf`;
}

/**
 * O prefixo sob o qual o contrato daquele tenant pode morar.
 *
 * Termina em `/` de proposito: sem a barra, `tenants/t1/contracts` casaria
 * com `tenants/t1/contracts-antigo`, e `startsWith` deixaria de significar
 * "esta dentro do diretorio". Mesma regra de `prefixoDeIdentidade`.
 */
export function prefixoDeContrato(tenantId: string): string {
  return `tenants/${tenantId}/contracts/`;
}

/**
 * Chave do PDF ASSINADO -- F70. Sufixo `-signed`, no MESMO diretorio do
 * gerado: os dois convivem sob `prefixoDeContrato`, nunca um sobrescreve o
 * outro (SPEC-070 §3.3, §8 invariante 2).
 */
export function montarChaveDoContratoAssinado(tenantId: string, contratoId: string): string {
  return `tenants/${tenantId}/contracts/${contratoId}-signed.pdf`;
}

/**
 * Contrato entre o ArenaHub e a academia -- F63, ADR-052 §8.
 *
 * ---------------------------------------------------------------------------
 * OS VALORES SAO COPIA, E NAO REFERENCIA.
 * ---------------------------------------------------------------------------
 *
 * `criar` le o plano UMA VEZ e grava os valores nas colunas do contrato. A
 * partir dai o `planId` e so procedencia: nada neste arquivo volta ao
 * `SaasPlan` para saber quanto cobrar. E o aceite da fatia -- alterar o preco
 * do plano nao altera contrato ativo -- e a unica forma de garanti-lo e nao
 * ter o caminho de volta.
 */
@Injectable()
export class TenantContractUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async listarDoTenant(tenantId: string): Promise<TenantContract[]> {
    return this.db.tenantContract.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async porId(id: string): Promise<TenantContract> {
    const contrato = await this.db.tenantContract.findUnique({ where: { id } });

    if (!contrato) throw new ContratoNaoEncontradoError();

    return contrato;
  }

  /**
   * Abre o contrato como `DRAFT`, com os valores copiados do plano.
   *
   * Nasce rascunho de proposito: o PDF sai no fechamento (ADR-052 §8), e
   * documento de rascunho circulando como contrato e pior que documento
   * nenhum.
   */
  async criar(
    contexto: PlatformContext,
    entrada: EntradaDeContrato,
    correlationId: string,
  ): Promise<TenantContract> {
    const [tenant, plano] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: entrada.tenantId }, select: { id: true } }),
      this.db.saasPlan.findUnique({ where: { id: entrada.planId } }),
    ]);

    if (!tenant) throw new TenantNaoEncontradoParaContratoError();
    if (!plano) throw new PlanoNaoEncontradoError();
    if (plano.status === 'ARCHIVED') throw new PlanoArquivadoError();

    const contrato = await this.db.tenantContract.create({
      data: {
        tenantId: entrada.tenantId,
        planId: plano.id,
        // A COPIA. Ver o comentario da classe.
        model: plano.model,
        activeStudentPriceMinor: plano.activeStudentPriceMinor,
        inactiveStudentPriceMinor: plano.inactiveStudentPriceMinor,
        fixedPriceMinor: plano.fixedPriceMinor,
        currency: plano.currency,
        // Superficie: o plano e o PADRAO, a entrada VENCE. Ver `EntradaDeContrato`.
        mobileEnabled: entrada.mobileEnabled ?? plano.mobileEnabled,
        kioskEnabled: entrada.kioskEnabled ?? plano.kioskEnabled,
        indexCode: entrada.indexCode ?? 'IPCA',
        baseDate: entrada.baseDate,
        anniversaryDay: entrada.anniversaryDay,
        anniversaryMonth: entrada.anniversaryMonth,
        ...(entrada.graceDays === undefined ? {} : { graceDays: entrada.graceDays }),
        issueDay: entrada.issueDay,
        startsAt: entrada.startsAt,
        endsAt: entrada.endsAt ?? null,
        supersedesId: entrada.supersedesId ?? null,
        // Termos e foro -- F70. `termsVersion` fixa a versao ATUAL no
        // instante do fechamento do rascunho: e o mesmo momento em que os
        // precos sao copiados do plano (ver comentario da classe), e pela
        // mesma razao -- gravar aqui, e nao na ativacao, impede que editar a
        // versao entre o `criar` e o `ativar` mude o contrato por baixo.
        termsVersion: VERSAO_ATUAL_DOS_TERMOS,
        ...(entrada.foroCidade === undefined ? {} : { foroCidade: entrada.foroCidade }),
        ...(entrada.foroUf === undefined ? {} : { foroUf: entrada.foroUf }),
      },
    });

    await this.auditoria.registrar(
      contexto,
      {
        action: 'tenant_contract.drafted',
        target: 'tenant_contract',
        targetId: contrato.id,
        tenantId: contrato.tenantId,
        metadata: { model: contrato.model, planId: plano.id },
      },
      correlationId,
    );

    return contrato;
  }

  /**
   * Fecha o contrato: gera o PDF, guarda no bucket e ativa.
   *
   * ORDEM: PDF -> storage -> banco. Ativar antes de ter o documento deixaria
   * um contrato `ACTIVE` sem PDF -- exatamente o que o CHECK
   * `tenant_contracts_ativo_tem_documento` recusa, e o erro apareceria como
   * violacao de constraint em vez de falha do gerador.
   */
  async ativar(
    contexto: PlatformContext,
    id: string,
    correlationId: string,
  ): Promise<TenantContract> {
    const contrato = await this.porId(id);

    if (contrato.status !== 'DRAFT') throw new ContratoImutavelError();

    const [tenant, plano] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: contrato.tenantId } }),
      this.db.saasPlan.findUnique({ where: { id: contrato.planId }, select: { name: true } }),
    ]);

    if (!tenant) throw new TenantNaoEncontradoParaContratoError();

    const jaAtivo = await this.db.tenantContract.findFirst({
      where: { tenantId: contrato.tenantId, status: 'ACTIVE' },
      select: { id: true },
    });

    if (jaAtivo) throw new ContratoJaAtivoNoTenantError();

    /*
     * QUALIFICACAO COMPLETA OU NAO ATIVA -- F70 (SPEC-070 §6, §8 invariante
     * 4). Antes desta fatia, CNPJ/endereco/representante ausentes imprimiam
     * "não informado" e o contrato ativava do mesmo jeito. O foro entra na
     * mesma checagem por ser dado NEGOCIADO do contrato (nao constante do
     * produto, ADR-055 §3.3), nao porque falte no tenant.
     */
    const camposFaltando = [
      ...camposFaltandoParaContrato(tenant),
      // `.trim()` pelo mesmo motivo de `camposFaltandoParaContrato`: a coluna
      // e opcional e nada impede uma importacao gravar espaco, que sairia
      // impresso como foro em branco -- pior que ausente, porque nao se ve.
      ...(contrato.foroCidade !== null && contrato.foroCidade.trim().length > 0 ? [] : ['foro']),
    ];

    if (camposFaltando.length > 0) {
      throw new TenantSemQualificacaoParaContratoError(camposFaltando);
    }

    const config = carregarConfig();
    const enderecoTenant = [tenant.addressLine, tenant.addressCity, tenant.addressState]
      .filter((parte): parte is string => Boolean(parte))
      .join(', ');

    /*
     * O VALOR APURADO E A VARIAÇÃO DO ÍNDICE -- pedido do PI em 11/09/2026.
     *
     * A apuracao usa `calcularFatura`, a MESMA funcao pura que a fatura usa
     * (F64). Repetir a multiplicacao aqui criaria uma segunda aritmetica de
     * dinheiro fora do lugar onde ela e testada -- e as duas divergiriam no
     * dia em que uma regra entrasse so numa delas.
     */
    const agora = new Date();
    const [contagem, indiceCorrente] = await Promise.all([
      contarAlunosDoTenant(this.db, contrato.tenantId),
      this.db.indexValue.findFirst({
        where: { code: contrato.indexCode },
        orderBy: { referenceMonth: 'desc' },
      }),
    ]);

    const apurado = calcularFatura(
      {
        model: contrato.model,
        activeStudentPriceMinor: contrato.activeStudentPriceMinor,
        inactiveStudentPriceMinor: contrato.inactiveStudentPriceMinor,
        fixedPriceMinor: contrato.fixedPriceMinor,
      },
      contagem,
    );

    const pdf = await gerarPdfDoContrato({
      numero: contrato.id.slice(0, 8).toUpperCase(),
      tenant: {
        displayName: tenant.displayName,
        legalName: tenant.legalName,
        cnpj: tenant.cnpj,
      },
      // Nome do plano no instante do fechamento -- rotulo copiado para o
      // documento, e nao leitura viva do catalogo.
      planoNome: plano?.name ?? 'Plano',
      model: contrato.model,
      activeStudentPriceMinor: contrato.activeStudentPriceMinor,
      inactiveStudentPriceMinor: contrato.inactiveStudentPriceMinor,
      fixedPriceMinor: contrato.fixedPriceMinor,
      currency: contrato.currency,
      indexCode: contrato.indexCode,
      baseDate: contrato.baseDate,
      anniversaryDay: contrato.anniversaryDay,
      anniversaryMonth: contrato.anniversaryMonth,
      graceDays: contrato.graceDays,
      issueDay: contrato.issueDay,
      mobileEnabled: contrato.mobileEnabled,
      kioskEnabled: contrato.kioskEnabled,
      startsAt: contrato.startsAt,
      endsAt: contrato.endsAt,
      geradoEm: agora,
      apuracao: {
        competencia: competenciaDe(agora).toISOString().slice(0, 7),
        activeCount: apurado.activeCount,
        inactiveCount: apurado.inactiveCount,
        totalMinor: apurado.totalMinor,
      },
      ...(indiceCorrente
        ? {
            indiceCorrente: {
              competencia: indiceCorrente.referenceMonth.toISOString().slice(0, 7),
              variationBasisPoints: indiceCorrente.variationBasisPoints,
            },
          }
        : {}),
      clausulas: {
        termsVersion: contrato.termsVersion,
        contratada: {
          // A checagem acima e do TENANT; a CONTRATADA vem de configuracao
          // (ADR-055 §6) e pode legitimamente faltar ate o PI passar os
          // dados da RRB TRADING (SPEC-070 §7 item 1) -- por isso NAO entra
          // em `camposFaltando`: bloquear a ativacao de todo contrato do
          // ArenaHub por uma variavel de ambiente ainda nao definida
          // impediria fechar contrato nenhum.
          razaoSocial: config.contratada.razaoSocial ?? 'RRB TRADING',
          cnpj: config.contratada.cnpj,
          endereco: config.contratada.endereco,
          representante: config.contratada.representante,
          email: config.contratada.email,
        },
        contratante: {
          razaoSocial: tenant.legalName,
          cnpj: tenant.cnpj,
          endereco: enderecoTenant || null,
          representante: tenant.responsavelNome,
          email: tenant.responsavelEmail,
        },
        foroCidade: contrato.foroCidade,
        foroUf: contrato.foroUf,
      },
    });

    const key = montarChaveDoContrato(contrato.tenantId, contrato.id);

    await this.storage.putPrivateObject({ key, body: pdf, contentType: 'application/pdf' });

    /*
     * `updateMany` com `status: 'DRAFT'` no `where`, e nao `update` por id.
     *
     * Duas ativacoes simultaneas passam as duas pela leitura acima antes de
     * qualquer escrita. Com o filtro de estado na propria escrita, a segunda
     * atualiza zero linhas e vira 409 -- em vez de gravar por cima da
     * primeira. O indice parcial `tenant_contracts_um_ativo_por_tenant`
     * fecha o mesmo buraco entre contratos DIFERENTES do mesmo tenant.
     */
    const alterados = await this.db.tenantContract.updateMany({
      where: { id: contrato.id, status: 'DRAFT' },
      data: { status: 'ACTIVE', documentObjectKey: key },
    });

    if (alterados.count === 0) throw new ContratoImutavelError();

    await this.auditoria.registrar(
      contexto,
      {
        action: 'tenant_contract.activated',
        target: 'tenant_contract',
        targetId: contrato.id,
        tenantId: contrato.tenantId,
      },
      correlationId,
    );

    return this.porId(contrato.id);
  }

  /**
   * Descarta um contrato em RASCUNHO -- F68.
   *
   * APAGA DE VERDADE, e so aqui: rascunho nao e historico. Ele nunca teve PDF,
   * nunca produziu fatura e nunca valeu para ninguem -- guardar um
   * `DISCARDED` na tabela empilharia linha morta na lista do cliente, que e a
   * mesma lista onde se procura o contrato que vale.
   *
   * `ACTIVE` e `TERMINATED` NAO PASSAM POR AQUI, e a recusa e o ponto: o
   * contrato fechado e documento assinado, com PDF gerado e fatura emitida
   * contra ele. O caminho de saida dele e `encerrar`, que preserva a linha.
   *
   * `deleteMany` com `status: 'DRAFT'` no `where`, e nao `delete` por id --
   * pelo mesmo motivo que `ativar` usa `updateMany`: entre a leitura e a
   * escrita cabe um fechamento simultaneo, e apagar por id apagaria um
   * contrato que acabou de virar vigente. Com o filtro na propria escrita,
   * zero linhas viram 409.
   */
  async descartar(
    contexto: PlatformContext,
    id: string,
    motivo: string,
    correlationId: string,
  ): Promise<void> {
    const contrato = await this.porId(id);

    if (contrato.status !== 'DRAFT') throw new ContratoImutavelError();

    const apagados = await this.db.tenantContract.deleteMany({
      where: { id: contrato.id, status: 'DRAFT' },
    });

    if (apagados.count === 0) throw new ContratoImutavelError();

    /*
     * A AUDITORIA FICA depois de a linha sumir: e o unico registro de que o
     * rascunho existiu. Sem ela, um contrato aberto por engano e descartado
     * nao deixaria rastro nenhum de quem o abriu -- nem do motivo.
     *
     * O MOTIVO VAI NO `metadata` porque e ele que responde a pergunta que
     * alguem faz depois ("por que o contrato do cliente X sumiu?"). A tela
     * pede o motivo; grava-lo e o que impede a pergunta de nao ter resposta.
     */
    await this.auditoria.registrar(
      contexto,
      {
        action: 'tenant_contract.discarded',
        target: 'tenant_contract',
        targetId: contrato.id,
        tenantId: contrato.tenantId,
        metadata: { reason: motivo },
      },
      correlationId,
    );
  }

  /** Encerra o contrato vigente. O historico fica: `TERMINATED` nao apaga. */
  async encerrar(
    contexto: PlatformContext,
    id: string,
    encerradoEm: Date,
    correlationId: string,
  ): Promise<TenantContract> {
    const contrato = await this.porId(id);

    if (contrato.status !== 'ACTIVE') throw new ContratoImutavelError();

    await this.db.tenantContract.updateMany({
      where: { id: contrato.id, status: 'ACTIVE' },
      data: { status: 'TERMINATED', endsAt: encerradoEm },
    });

    await this.auditoria.registrar(
      contexto,
      {
        action: 'tenant_contract.terminated',
        target: 'tenant_contract',
        targetId: contrato.id,
        tenantId: contrato.tenantId,
      },
      correlationId,
    );

    return this.porId(contrato.id);
  }

  /** O PDF do contrato, para o painel servir. */
  async lerDocumento(id: string): Promise<{ conteudo: Uint8Array; nome: string }> {
    const contrato = await this.porId(id);

    if (!contrato.documentObjectKey) throw new ContratoNaoEncontradoError();

    /*
     * A chave sai de uma COLUNA, e coluna e dado. Conferir o prefixo antes de
     * ler e o que impede que escrever nessa coluna sirva outro objeto do
     * bucket -- a foto biometrica de um aluno mora no mesmo lugar. Mesma
     * guarda do `branding.service.ts`.
     */
    if (!contrato.documentObjectKey.startsWith(prefixoDeContrato(contrato.tenantId))) {
      throw new ContratoNaoEncontradoError();
    }

    const objeto = await this.storage.getPrivateObject(contrato.documentObjectKey);

    return { conteudo: objeto.body, nome: `contrato-${contrato.id.slice(0, 8)}.pdf` };
  }

  /**
   * O valor corrigido do contrato fixo na data pedida -- ADR-052 §7.
   *
   * NAO GRAVA: e leitura. Quem persiste o valor cobrado e a fatura (F64). Um
   * contrato imutavel que se reescrevesse a cada aniversario deixaria de ser
   * imutavel.
   *
   * Contrato por aluno nao corrige: o preco por aluno acompanha o catalogo do
   * proximo contrato, nao um indice.
   */
  async valorCorrigido(
    id: string,
    agora: Date,
  ): Promise<{ valorMinor: number; aniversariosAplicados: number }> {
    const contrato = await this.porId(id);

    if (contrato.model !== 'FIXED_MONTHLY' || contrato.fixedPriceMinor == null) {
      throw new ContratoNaoEncontradoError();
    }

    const aniversarios = aniversariosVencidos(
      contrato.baseDate,
      contrato.anniversaryDay,
      contrato.anniversaryMonth,
      agora,
    );

    if (aniversarios.length === 0) {
      return { valorMinor: contrato.fixedPriceMinor, aniversariosAplicados: 0 };
    }

    const valores = await this.db.indexValue.findMany({ where: { code: contrato.indexCode } });

    let valorMinor = contrato.fixedPriceMinor;
    let desde = contrato.baseDate;

    /*
     * UM ANIVERSARIO POR VEZ, sobre o valor ja corrigido do anterior.
     *
     * Acumular as 24 competencias de dois anos numa janela so daria o mesmo
     * numero por acaso -- e deixaria de dar no dia em que uma regra de teto
     * ou de arredondamento por aniversario entrasse. Cada aniversario e um
     * reajuste, e reajuste incide sobre o valor vigente.
     */
    for (const aniversario of aniversarios) {
      const competencias = competenciasDaJanela(desde, aniversario);
      const resultado = corrigirPorIndice(valorMinor, valores, competencias);

      if (!resultado.corrigiu) throw new IndiceIndisponivelError(resultado.competenciasFaltando);

      valorMinor = resultado.valorMinor;
      desde = aniversario;
    }

    return { valorMinor, aniversariosAplicados: aniversarios.length };
  }

  /**
   * Sobe o PDF assinado -- F70 (SPEC-070 §3.3, §6, §8 invariante 2).
   *
   * NUNCA SOBRESCREVE `documentObjectKey`: grava numa chave PROPRIA
   * (`montarChaveDoContratoAssinado`) e move `signatureStatus` para
   * `SIGNED`. Os dois arquivos convivem -- o gerado prova o que o sistema
   * emitiu, o assinado prova o que as partes assinaram.
   *
   * SO EM CONTRATO `ACTIVE`: rascunho nao tem PDF gerado para acompanhar, e
   * contrato encerrado ja fechou o ciclo -- assinar um documento que nunca
   * vigorou de fato nao tem para que.
   *
   * IDEMPOTENTE POR ESTADO, e nao por reenvio: um segundo upload sobre
   * contrato ja `SIGNED` e recusado (409), em vez de trocar silenciosamente
   * o arquivo assinado por outro -- o PDF assinado e documento juridico, e
   * versao dele nao e "a ultima que chegou".
   */
  async registrarAssinatura(
    contexto: PlatformContext,
    id: string,
    pdfAssinado: Buffer,
    assinadoEm: Date,
    correlationId: string,
  ): Promise<TenantContract> {
    const contrato = await this.porId(id);

    if (contrato.status !== 'ACTIVE') {
      throw new ErroDeDominio(
        'TENANT_CONTRACT_NOT_ACTIVE',
        409,
        'Só contrato ativo recebe PDF assinado',
      );
    }

    if (contrato.signatureStatus === 'SIGNED') throw new ContratoJaAssinadoError();

    const key = montarChaveDoContratoAssinado(contrato.tenantId, contrato.id);

    await this.storage.putPrivateObject({ key, body: pdfAssinado, contentType: 'application/pdf' });

    const alterados = await this.db.tenantContract.updateMany({
      where: { id: contrato.id, signatureStatus: { not: 'SIGNED' } },
      data: { signatureStatus: 'SIGNED', signedDocumentObjectKey: key, signedAt: assinadoEm },
    });

    if (alterados.count === 0) throw new ContratoJaAssinadoError();

    await this.auditoria.registrar(
      contexto,
      {
        action: 'tenant_contract.signed',
        target: 'tenant_contract',
        targetId: contrato.id,
        tenantId: contrato.tenantId,
      },
      correlationId,
    );

    return this.porId(contrato.id);
  }

  /** O PDF assinado do contrato, para o painel servir -- F70. */
  async lerDocumentoAssinado(id: string): Promise<{ conteudo: Uint8Array; nome: string }> {
    const contrato = await this.porId(id);

    if (!contrato.signedDocumentObjectKey) throw new ContratoNaoEncontradoError();

    // Mesma guarda de pertencimento de `lerDocumento`: a chave sai de coluna,
    // e coluna e dado.
    if (!contrato.signedDocumentObjectKey.startsWith(prefixoDeContrato(contrato.tenantId))) {
      throw new ContratoNaoEncontradoError();
    }

    const objeto = await this.storage.getPrivateObject(contrato.signedDocumentObjectKey);

    return { conteudo: objeto.body, nome: `contrato-${contrato.id.slice(0, 8)}-assinado.pdf` };
  }
}
