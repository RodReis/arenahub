import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DevicesModule } from '../devices/devices.module.js';
import { IamModule } from '../iam/iam.module.js';
import { TeamModule } from '../team/team.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { StudentCredentialRepository } from './student-credential.repository.js';
import { StudentPhotoService } from './student-photo.service.js';
import { StudentRepository } from './student.repository.js';
import { StudentsController } from './students.controller.js';

@Module({
  // `TenancyModule` porque a unidade de origem do aluno (F45) tem de existir
  // NESTE tenant antes de virar FK -- e quem sabe responder isso e o dono da
  // tabela, nao o `students` lendo `gym_units` por conta propria.
  // `IamModule` pelo mesmo motivo do `TenancyModule`: o consultor responsavel
  // tem de ser membro DESTE tenant, e quem sabe responder isso e o dono de
  // `TenantMembership`.
  // `TeamModule` -- F82: troca de profile e a mesma escrita de
  // `/team/:id/profile`, exportada de la para nao duplicar transacao.
  // `DevicesModule` -- #475: sugestao de proximo numero de catraca livre
  // precisa do que o leitor tem (`DeviceReaderNumber`) e do que ja esta
  // vinculado (`DeviceUser`), e quem sabe responder isso e o dono das duas
  // tabelas, nao `students` lendo por conta propria.
  imports: [TenancyModule, IamModule, TeamModule, DevicesModule],
  controllers: [StudentsController],
  providers: [
    StudentRepository,
    TenantContextService,
    StudentPhotoService,
    StudentCredentialRepository,
  ],
  // Exportado porque `membership` precisa consultar o aluno -- por provider
  // publico, nunca lendo a tabela do outro modulo (regra de arquitetura 9).
  // `StudentCredentialRepository` -- #468: o vinculo legado do leitor casa o
  // numero do equipamento com o aluno, pela mesma regra.
  // `StudentPhotoService` -- #503: a foto que vem do leitor facial entra pela
  // mesma porta do upload do painel (formato, antivirus, storage).
  exports: [StudentRepository, StudentCredentialRepository, StudentPhotoService],
})
export class StudentsModule {}
