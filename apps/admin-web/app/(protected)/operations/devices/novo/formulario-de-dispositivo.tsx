'use client';

import { useActionState } from 'react';
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
 * O único modelo homologado hoje.
 *
 * Vem da bancada do MVP 0 (F1–F5): Topdata Inner Fit instalado na unidade.
 * A API recusa qualquer outro com `DEVICE_UNSUPPORTED_HARDWARE`, e oferecer
 * campo livre de modelo faria a recepção digitar a marca da catraca que
 * comprou para receber um erro depois de preencher tudo.
 */
const MODELOS = [{ kind: 'FACIAL_READER', model: 'Inner Fit', rotulo: 'Topdata Inner Fit — leitor facial' }] as const;

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
        deixariam montar "TURNSTILE + Inner Fit", que é recusado.
      */}
      <SelectField
        id="modelo-do-dispositivo"
        name="model"
        label="Modelo"
        defaultValue={estado.valores?.['model'] ?? MODELOS[0].model}
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
        `kind` acompanha o modelo escolhido. Com um modelo só na lista, ele é
        fixo -- quando a homologação crescer, isto vira um `onChange` que lê
        o par do `MODELOS`.
      */}
      <input type="hidden" name="kind" value={MODELOS[0].kind} />

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
        A LISTA DE HOMOLOGAÇÃO É PROVISÓRIA e depende do gate físico
        `M1-HW-01`. Dizer isso aqui evita a recepção concluir que o sistema
        não aceita a catraca que a academia comprou -- ele ainda não aceita.
      */}
      <p role="note" className={estilos['nota']}>
        Só o leitor facial Topdata Inner Fit está homologado até agora. Catraca e outros modelos
        entram quando passarem pelo gate de hardware.
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
