import type { Metadata } from 'next';

import { chamarApi } from '../../../../lib/api/server-client';
import { FormularioDeOverride } from './formulario-de-override';

export const metadata: Metadata = {
  title: 'Liberação manual — ArenaHub',
};

interface Unidade {
  id: string;
  name: string;
}

interface Dispositivo {
  id: string;
  kind: string;
  model: string;
  serial: string;
  gymUnitId: string;
  status: string;
}

/**
 * Liberação manual da catraca — `M1-FR-023`.
 *
 * A página carrega no servidor e passa a lista pronta ao formulário: o
 * cliente não descobre unidades nem dispositivos por conta própria, e o
 * escopo de unidade do operador já vem aplicado pela API.
 */
export default async function PaginaDeOverride() {
  const [unidades, dispositivos] = await Promise.all([
    chamarApi<Unidade[]>('/api/v1/units'),
    chamarApi<Dispositivo[]>('/api/v1/devices'),
  ]);

  if (!unidades.ok) {
    return (
      <section aria-labelledby="titulo-override">
        <h1 id="titulo-override">Liberação manual</h1>
        <p role="alert" data-testid="erro-de-permissao">
          Sem permissão para abrir esta tela ({unidades.erro?.code ?? 'erro'}).
        </p>
      </section>
    );
  }

  const listaDeUnidades = unidades.dados ?? [];

  // Só catraca ATIVA entra na lista. Mandar comando para equipamento em
  // manutenção produziria uma liberação que ninguém executa -- e a recepção
  // ficaria esperando um giro que não vem.
  const catracas = (dispositivos.dados ?? [])
    .filter((d) => d.kind === 'TURNSTILE' && d.status === 'ACTIVE')
    .map((d) => ({
      id: d.id,
      model: d.model,
      serial: d.serial,
      gymUnitId: d.gymUnitId,
    }));

  return (
    <section aria-labelledby="titulo-override">
      <h1 id="titulo-override">Liberação manual</h1>

      <p>
        Abre a catraca para alguém, com motivo e responsável registrados. Use quando o
        acesso normal falhar — cadastro pendente, biometria com problema, visitante
        autorizado.
      </p>

      {listaDeUnidades.length === 0 ? (
        <p role="alert" data-testid="sem-unidade">
          Nenhuma unidade disponível para o seu perfil.
        </p>
      ) : catracas.length === 0 ? (
        <p role="alert" data-testid="sem-catraca">
          Nenhuma catraca ativa cadastrada. Cadastre o equipamento antes de liberar
          acesso manualmente.
        </p>
      ) : (
        <FormularioDeOverride unidades={listaDeUnidades} catracas={catracas} />
      )}
    </section>
  );
}
