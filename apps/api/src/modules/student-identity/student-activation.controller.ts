import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { Public } from '../../common/security/public.decorator.js';
import { StudentAccountRepository } from './student-account.repository.js';
import { StudentIdentityService } from './student-identity.service.js';
import { ativacaoConsultaDto, ativacaoSelfServiceDto } from './dto/mobile-auth.dto.js';

const ESQUEMA_DA_CONSULTA = {
  type: 'object',
  properties: {
    nomeCompleto: { type: 'string' },
    cpfFormatado: { type: 'string' },
    dataNascimento: { type: 'string' },
    plano: { type: 'string' },
    local: { type: 'string' },
    dataInicio: { type: 'string' },
    activationRef: { type: 'string' },
  },
  required: [
    'nomeCompleto',
    'cpfFormatado',
    'dataNascimento',
    'plano',
    'local',
    'dataInicio',
    'activationRef',
  ],
};

const ESQUEMA_DA_SESSAO = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    sessionId: { type: 'string' },
    expiraEm: { type: 'number' },
  },
  required: ['accessToken', 'refreshToken', 'sessionId', 'expiraEm'],
};

/**
 * Primeiro acesso self-service -- SPEC-071, ADR-057, issue #333.
 *
 * Prefixo PROPRIO (`.../activation`, nao `.../auth`) porque SPEC-071 §7
 * assim define: sao dois passos (consulta, depois confirmacao com senha)
 * distintos do login e da recuperacao existentes em `student-auth.controller.ts`.
 */
@Controller('api/v1/mobile/activation')
export class StudentActivationController {
  constructor(
    private readonly identidade: StudentIdentityService,
    private readonly contas: StudentAccountRepository,
  ) {}

  /**
   * Consulta -- localiza o aluno por CPF + nascimento e devolve os dados da
   * tela de confirmacao (SPEC-071 §6.3) mais um `activationRef` de curta
   * duracao. NAO abre sessao.
   */
  @Public()
  @Post('lookup')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Aluno localizado.', schema: ESQUEMA_DA_CONSULTA })
  async consultar(@Body() corpo: unknown) {
    const entrada = ativacaoConsultaDto.parse(corpo);
    const tenantId = await this.contas.resolverTenantPorSlug(entrada.tenantSlug);

    return this.identidade.consultarAtivacao({
      tenantId,
      cpf: entrada.cpf,
      dataNascimento: entrada.dataNascimento,
    });
  }

  /**
   * Confirmacao -- o `activationRef` da consulta prova o CPF + nascimento;
   * aqui so falta a senha. Ja abre sessao (o aluno nao loga de novo).
   */
  @Public()
  @Post('self-service')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Conta ativada, sessao aberta.', schema: ESQUEMA_DA_SESSAO })
  async confirmar(@Body() corpo: unknown) {
    const entrada = ativacaoSelfServiceDto.parse(corpo);

    return this.identidade.confirmarAtivacao({
      activationRef: entrada.activationRef,
      senha: entrada.senha,
      agora: new Date(),
    });
  }
}
