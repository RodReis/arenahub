import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';

/**
 * Erros de dominio de reserva/presenca -- F78 (SPEC-078, ADR-061).
 */

/**
 * A aula foi cancelada nesta data.
 */
export class OcorrenciaCanceladaError extends ErroDeDominio {
  constructor() {
    super('CLASS_OCCURRENCE_CANCELLED', 409, 'Esta aula foi cancelada nesta data');
  }
}

/**
 * O plano do aluno nao inclui esta modalidade.
 */
export class AulaNaoInclusaNoPlanoError extends ErroDeDominio {
  constructor() {
    super('CLASS_NOT_INCLUDED_IN_PLAN', 422, 'O plano do aluno nao inclui esta modalidade');
  }
}

/**
 * Nao ha vagas para esta aula nesta data.
 */
export class AulaLotadaError extends ErroDeDominio {
  constructor() {
    super('CLASS_FULL', 409, 'Nao ha vagas para esta aula nesta data');
  }
}

/**
 * Aluno nao tem assinatura ativa.
 */
export class AlunoSemAssinaturaAtivaError extends ErroDeDominio {
  constructor() {
    super('STUDENT_HAS_NO_ACTIVE_SUBSCRIPTION', 422, 'Aluno nao tem assinatura ativa');
  }
}
