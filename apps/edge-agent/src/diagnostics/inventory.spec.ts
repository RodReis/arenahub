import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { parse as parseYaml } from 'yaml';

import { esquemaInventario, pendenciasDoGate } from '../bancada/inventory-schema.js';

// A partir da raiz do pacote: o Jest roda com cwd em apps/edge-agent.
const CAMINHO = resolve(process.cwd(), '../../infra/bancada/inventory.yaml');

describe('inventario da bancada', () => {
  it('o arquivo versionado e valido contra o schema', () => {
    // Se este teste quebrar, o inventario e o schema divergiram -- e o
    // inventario e evidencia de gate, nao rascunho.
    const bruto: unknown = parseYaml(readFileSync(CAMINHO, 'utf8'));

    expect(() => esquemaInventario.parse(bruto)).not.toThrow();
  });

  it('registra o leitor facial observado na bancada', () => {
    const inv = esquemaInventario.parse(parseYaml(readFileSync(CAMINHO, 'utf8')));
    const facial = inv.dispositivos.find((d) => d.tipo === 'leitor-facial');

    expect(facial?.identificador).toBe('AYTI11108174');
    expect(facial?.rede?.ip).toBe('192.168.2.188');
  });

  it('nao confunde biometria digital com leitor facial', () => {
    // No software Topdata, "biometria" e DIGITAL, e esta desmarcada. O facial
    // e equipamento separado. Tratar os dois como a mesma coisa faz o
    // inventario mentir sobre o que a bancada tem.
    const inv = esquemaInventario.parse(parseYaml(readFileSync(CAMINHO, 'utf8')));
    const catraca = inv.dispositivos.find((d) => d.tipo === 'catraca');

    expect(catraca?.entradas?.biometriaDigital).toBe(false);
    expect(catraca?.entradas?.leitorFacial).toBe(true);
  });

  it('aponta as pendencias do gate em vez de escondê-las', () => {
    const inv = esquemaInventario.parse(parseYaml(readFileSync(CAMINHO, 'utf8')));

    // Enquanto o gate nao fechar, o diagnostico tem de dizer. Gate silencioso
    // e o mesmo que gate ausente.
    expect(pendenciasDoGate(inv).length).toBeGreaterThan(0);
  });

  it('rejeita numero de serie inventado como string vazia', () => {
    // "nao se substitui hardware real por suposicao" (PRD §4): o campo aceita
    // valor real ou null. String vazia seria palpite disfarcado.
    const bruto = parseYaml(readFileSync(CAMINHO, 'utf8')) as Record<string, unknown>;
    const dispositivos = (bruto['dispositivos'] as Record<string, unknown>[]).map((d, i) =>
      i === 0 ? { ...d, numeroSerie: '' } : d,
    );

    expect(() => esquemaInventario.parse({ ...bruto, dispositivos })).toThrow();
  });
});
