/**
 * Ponto de entrada do pacote de banco.
 *
 * Exporta a factory do client e o tipo gerado. Nenhum repositorio, nenhum
 * caso de uso e nenhuma entidade -- isso e escopo das fatias, nao do
 * bootstrap.
 *
 * REGRA DE ARQUITETURA No 2, para quando a primeira entidade chegar:
 * repositorio recebe `TenantContext` obrigatorio, e o tenant vem da
 * identidade autenticada -- nunca do corpo da requisicao nem do payload de
 * webhook. Este arquivo nao pode dificultar isso; por enquanto so nao
 * atrapalha.
 */
export { criarPrismaClient, type PrismaClientArenaHub } from './client.js';

/**
 * O client gerado, para quem precisa ESTENDE-LO em vez de instancia-lo --
 * caso do `PrismaService` do NestJS, que amarra `$connect`/`$disconnect` ao
 * ciclo de vida do modulo.
 *
 * Quem so precisa de uma conexao usa `criarPrismaClient`.
 */
export { PrismaClient, Prisma } from './generated/client.js';
export { PrismaPg } from '@prisma/adapter-pg';

/**
 * Tipos das entidades. Sem eles, um repositorio fora deste pacote nao
 * consegue NOMEAR o que devolve -- o TypeScript reclama de tipo inferido
 * nao portavel (TS2742) e exige anotacao.
 */
export type {
  AccessEvent,
  AccessEventCorrection,
  AccessPassage,
  AccessPolicy,
  AdministrativeBlock,
  AuditLog,
  DataExportJob,
  BiometricAccessLog,
  BiometricIdentity,
  ConsentDocument,
  ConsentRecord,
  Device,
  DeviceCommand,
  DeviceSyncJob,
  DeviceUser,
  EdgeCredential,
  EdgeNode,
  Entitlement,
  EntitlementUnitWindow,
  GymUnit,
  InboxReceipt,
  Invitation,
  OutboxEvent,
  Permission,
  Plan,
  PlanAccessWindow,
  PlanUnit,
  Role,
  RolePermission,
  Session,
  ReplayNonce,
  Student,
  StudentAddress,
  StudentContact,
  StudentSequence,
  StudentTimelineEvent,
  ManualAccessOverride,
  OperationalAlert,
  Subscription,
  Tenant,
  TenantMembership,
  TenantPrivacySettings,
  User,
  UserRole,
} from './generated/client.js';

/**
 * Enums de status, para o dominio comparar sem string solta.
 *
 * Exportados como TIPO, nao como valor: o dominio declara os proprios
 * literais (funcao pura nao importa client de banco), e estes servem para
 * amarrar a assinatura de repositorio ao que o Prisma realmente aceita.
 */
export type {
  AccessMethod,
  AccessMode,
  AccessOutcome,
  AccessReason,
  BiometricAccessKind,
  BiometricAccessPurpose,
  BiometricIdentityState,
  ConsentDecision,
  ConsentDocumentType,
  ConsentSubjectKind,
  DataExportStatus,
  DeviceCommandState,
  DeviceKind,
  DeviceStatus,
  DeviceSyncJobState,
  DeviceSyncOperation,
  DeviceUserState,
  EdgeNodeStatus,
  EntitlementSource,
  EntitlementStatus,
  OperationalAlertSeverity,
  OperationalAlertState,
  PassageState,
  StudentContactType,
  StudentStatus,
  StudentTimelineEventType,
  SubscriptionStatus,
} from './generated/client.js';
