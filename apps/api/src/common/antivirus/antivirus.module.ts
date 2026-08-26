import { Global, Module } from '@nestjs/common';

import { FakeMalwareScannerAdapter } from './fake-malware-scanner.adapter.js';
import { MALWARE_SCANNER } from './malware-scanner.port.js';

/**
 * Antivirus do boundary como porta injetavel (ADR-017, `M3-FR-009`).
 *
 * MUDOU DE LUGAR NA F51, e nao de comportamento: a porta e o dublê nasceram
 * em `modules/health/provider/` porque so o laudo de bioimpedancia enviava
 * arquivo. O totem passou a enviar video (ADR-042, Decisao 7 -- "toda midia
 * enviada passa pelo antivirus do boundary"), e a alternativa seria
 * `kiosk-admin` importar de dentro de `health`: um modulo alcancando o
 * interior de outro, que e o que a regra de arquitetura no 9 impede.
 *
 * `@Global` pelo mesmo motivo do `StorageModule`: quem envia arquivo escaneia,
 * e sao varios modulos. O provider e registrado pelo TOKEN -- trocar o dublê
 * por ClamAV nao toca em caso de uso nenhum.
 *
 * O DUBLÊ e o adapter registrado hoje, e isso e deliberado: o antivirus real
 * ainda nao existe, e `docs/TESTING.md` coloca o dublê no boundary. Trocar o
 * `useExisting` e a fatia inteira de integracao.
 */
@Global()
@Module({
  providers: [
    FakeMalwareScannerAdapter,
    { provide: MALWARE_SCANNER, useExisting: FakeMalwareScannerAdapter },
  ],
  exports: [MALWARE_SCANNER, FakeMalwareScannerAdapter],
})
export class AntivirusModule {}
