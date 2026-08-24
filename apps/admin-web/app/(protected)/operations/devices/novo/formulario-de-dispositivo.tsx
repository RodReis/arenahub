'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../../formulario.module.css';

import { cadastrarDispositivo, type EstadoDoDispositivo } from '../../../../actions/devices';

interface Unidade {
  id: string;
  name: string;
}

interface Props {
  readonly unidades: readonly Unidade[];
}

const ESTADO_INICIAL: EstadoDoDispositivo = {};

/**
 * Os modelos homologados.
 *
 * Espelha `hardware-homologado.ts` na API, que é quem manda: cadastrar
 * qualquer outro devolve `DEVICE_UNSUPPORTED_HARDWARE`. Lista em vez de
 * campo livre porque digitar a marca errada só produziria esse erro depois
 * de preencher a tela inteira.
 *
 * Os dois são o par instalado na unidade da bancada do MVP 0 — leitor facial
 * `AYTI11108174` e catraca serial `247000797`, inventariados no local pelo
 * PI (`docs/field-notes/2026-08-15-hardware-arena-positiva.md`).
 */
const MODELOS = [
  {
    kind: 'FACIAL_READER',
    model: 'Inner Fit',
    rotulo: 'Topdata Inner Fit — leitor facial',
  },
  { kind: 'TURNSTILE', model: 'Inner', rotulo: 'Topdata Inner — catraca' },
] as const;

function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-dispositivo">
      {pending ? 'Cadastrando…' : 'Cadastrar dispositivo'}
    </Button>
  );
}

/**
 * Cadastro de dispositivo.
 *
 * `POST /devices` existe na API com homologação de hardware e auditoria, e
 * nunca teve chamador. Não há seed de dispositivo e o edge-agent não se
 * auto-registra — até aqui, um leitor só entrava por `curl`.
 */
export function FormularioDeDispositivo({ unidades }: Props) {
  const [estado, acao] = useActionState(cadastrarDispositivo, ESTADO_INICIAL);

  /*
   * O modelo é estado porque o `kind` deriva dele -- ver o campo oculto lá
   * embaixo. `estado.valores` tem prioridade para não perder a escolha
   * quando o cadastro falha.
   */
  const [modeloEscolhido, setModeloEscolhido] = useState(
    estado.valores?.['model'] ?? MODELOS[0].model,
  );

  const kindDoModelo =
    MODELOS.find((modelo) => modelo.model === modeloEscolhido)?.kind ?? MODELOS[0].kind;

  useToastDeErro(estado.erro, 'error', 'erro-do-dispositivo');

  if (unidades.length === 0) {
    return (
      <p data-testid="sem-unidades">
        Nenhuma unidade cadastrada. <a href="/units/nova">Cadastre uma unidade</a> antes de instalar
        um dispositivo — todo leitor pertence a uma.
      </p>
    );
  }

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="dispositivo-cadastrado">
        <p>
          Dispositivo <strong>{estado.sucesso.serial}</strong> cadastrado.
        </p>
        <p>
          <a href="/operations/devices">Ver a lista de dispositivos</a>
        </p>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <SelectField
        id="unidade-do-dispositivo"
        name="gymUnitId"
        label="Unidade"
        defaultValue={estado.valores?.['gymUnitId'] ?? unidades[0]?.id ?? ''}
        required
        data-testid="campo-unidade-do-dispositivo"
      >
        {unidades.map((unidade) => (
          <option key={unidade.id} value={unidade.id}>
            {unidade.name}
          </option>
        ))}
      </SelectField>

      {/*
        MODELO E TIPO viajam juntos: a homologação da API valida o PAR
        (`kind` + `model`), não cada um sozinho. Dois selects separados
        deixariam montar "TURNSTILE + Inner Fit", que é recusado -- e pior,
        deixariam a recepção escolher um par que não existe sem nada na tela
        avisando.
      */}
      <SelectField
        id="modelo-do-dispositivo"
        name="model"
        label="Modelo"
        value={modeloEscolhido}
        onChange={(evento) => setModeloEscolhido(evento.target.value)}
        required
        data-testid="campo-modelo-do-dispositivo"
      >
        {MODELOS.map((modelo) => (
          <option key={modelo.model} value={modelo.model}>
            {modelo.rotulo}
          </option>
        ))}
      </SelectField>

      {/*
        `kind` DERIVA do modelo, e é por isso que o select é controlado: com
        dois modelos na lista (leitor facial e catraca), um `kind` fixo
        mandaria `FACIAL_READER` junto com a catraca e a API recusaria o par.
      */}
      <input type="hidden" name="kind" value={kindDoModelo} />

      <Field
        id="serie-do-dispositivo"
        name="serial"
        label="Número de série"
        defaultValue={estado.valores?.['serial'] ?? ''}
        maxLength={80}
        required
        hint="Está na etiqueta do equipamento. Ex.: AYTI11108174."
        data-testid="campo-serie-do-dispositivo"
      />

      <Field
        id="firmware-do-dispositivo"
        name="firmware"
        label="Firmware"
        defaultValue={estado.valores?.['firmware'] ?? ''}
        maxLength={40}
        hint="Opcional. Informe se souber a versão instalada."
        data-testid="campo-firmware-do-dispositivo"
      />

      {/*
        A LISTA DE HOMOLOGAÇÃO É PROVISÓRIA e o código da API diz isso ao
        lado dela: quando o gate `M1-HW-01` passar, ela sai do código e vem
        do documento de homologação. Dizer aqui evita a recepção comprar um
        equipamento supondo que o painel aceita qualquer um.
      */}
      <p role="note" className={estilos['nota']}>
        Só os equipamentos homologados na bancada aparecem aqui — hoje, o leitor facial e a catraca
        Topdata Inner instalados na unidade. Outros modelos entram quando passarem pelo gate de
        hardware.
      </p>

      <div className={estilos['acoes']}>
        <BotaoDeCadastro />
        <Button href="/operations/devices" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
