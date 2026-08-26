import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@arenahub/ui';
import {
  CONFIG_PADRAO_DO_TOTEM,
  MAXIMO_DE_PATROCINADORES,
  ROTULO_PADRAO_DE_PATROCINIO,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { AbaDeBlocos } from './aba-de-blocos';
import { blocoNovo } from './blocos';

/*
 * A Server Action fala com `chamarApi`, que e `server-only`. O mock existe
 * para o modulo carregar em `jsdom` -- mesmo padrao de
 * `formulario-de-configuracao.test.tsx`.
 */
vi.mock('../../../../actions/kiosk-midia', () => ({
  enviarMidiaAction: vi.fn(),
}));

function comBlocos(
  itens: KioskConfig['blocos']['itens'],
  patrocinio?: Partial<KioskConfig['patrocinio']>,
): KioskConfig {
  return {
    ...CONFIG_PADRAO_DO_TOTEM,
    blocos: { tempoPorBlocoSegundos: 12, itens },
    patrocinio: { ...CONFIG_PADRAO_DO_TOTEM.patrocinio, ...patrocinio },
  };
}

function renderizar(rascunho: KioskConfig) {
  // TIPADOS, e nao `vi.fn()` cru: sem o tipo, `mock.calls[0][0].itens` e
  // `any` -- e uma asserção sobre `any` passa mesmo quando o campo nem
  // existe mais, que e teste verde provando nada.
  const aoMudarBlocos = vi.fn<(blocos: KioskConfig['blocos']) => void>();
  const aoMudarPatrocinio = vi.fn<(patrocinio: KioskConfig['patrocinio']) => void>();

  render(
    <ToastProvider>
      <AbaDeBlocos
        rascunho={rascunho}
        kioskDeviceId="k1"
        aoMudarBlocos={aoMudarBlocos}
        aoMudarPatrocinio={aoMudarPatrocinio}
        aoFalhar={vi.fn()}
      />
    </ToastProvider>,
  );

  return { aoMudarBlocos, aoMudarPatrocinio };
}

describe('AbaDeBlocos -- ordem do rodizio', () => {
  it('reordenar devolve a lista na nova ordem, e ela E a ordem do rodizio', async () => {
    const usuario = userEvent.setup();
    const itens = [blocoNovo('VIDEO', 'a'), blocoNovo('EVENTOS', 'b')];
    const { aoMudarBlocos } = renderizar(comBlocos(itens));

    await usuario.click(screen.getByTestId('subir-EVENTOS'));

    expect(aoMudarBlocos).toHaveBeenCalledTimes(1);
    expect(aoMudarBlocos.mock.calls[0]?.[0].itens.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('subir a primeira e descer a ultima ficam desabilitados', () => {
    renderizar(comBlocos([blocoNovo('VIDEO', 'a'), blocoNovo('EVENTOS', 'b')]));

    expect(screen.getByTestId('subir-VIDEO')).toBeDisabled();
    expect(screen.getByTestId('descer-EVENTOS')).toBeDisabled();
    expect(screen.getByTestId('descer-VIDEO')).toBeEnabled();
  });

  it('so oferece acrescentar os tipos que ainda nao estao na lista', () => {
    renderizar(comBlocos([blocoNovo('VIDEO', 'a')]));

    expect(screen.queryByTestId('acrescentar-VIDEO')).toBeNull();
    expect(screen.getByTestId('acrescentar-EVENTOS')).toBeInTheDocument();
  });

  it('bloco acrescentado nasce DESLIGADO', async () => {
    const usuario = userEvent.setup();
    const { aoMudarBlocos } = renderizar(comBlocos([]));

    await usuario.click(screen.getByTestId('acrescentar-INSTAGRAM'));

    expect(aoMudarBlocos.mock.calls[0]?.[0].itens[0]?.habilitado).toBe(false);
  });
});

describe('AbaDeBlocos -- video e a origem do Instagram', () => {
  it('o campo de link existe e esta DESABILITADO, com o motivo em tela', () => {
    renderizar(comBlocos([blocoNovo('VIDEO', 'a')]));

    const campo = screen.getByTestId('link-a');

    expect(campo).toBeDisabled();
    expect(screen.getByText(/Indisponível nesta versão/i)).toBeInTheDocument();
  });

  it('avisa que a midia e copiada no salvamento -- a Meta nao garante o resto', () => {
    renderizar(comBlocos([blocoNovo('VIDEO', 'a')]));

    expect(
      screen.getByText(/mudanças posteriores no Instagram não se refletem no totem/i),
    ).toBeInTheDocument();
  });

  it('diz que nao ha video enquanto nao ha chave', () => {
    renderizar(comBlocos([blocoNovo('VIDEO', 'a')]));

    expect(screen.getByTestId('estado-midia-a')).toHaveTextContent('Nenhum vídeo enviado ainda');
  });
});

describe('AbaDeBlocos -- faixa de patrocinadores (ADR-042, Decisao 4)', () => {
  it('mostra o rotulo PADRAO quando o campo esta vazio -- nunca faixa sem rotulo', () => {
    renderizar(comBlocos([], { rotulo: '' }));

    expect(screen.getByTestId('campo-rotuloDoPatrocinio')).toHaveValue('');
    expect(screen.getByText(new RegExp(ROTULO_PADRAO_DE_PATROCINIO, 'i'))).toBeInTheDocument();
  });

  it('para de oferecer patrocinador ao chegar no limite', () => {
    const marcas = Array.from({ length: MAXIMO_DE_PATROCINADORES }, (_, i) => ({
      nome: `Marca ${i}`,
      logotipoUrl: null,
    }));

    renderizar(comBlocos([], { marcas }));

    expect(screen.queryByTestId('acrescentar-patrocinador')).toBeNull();
    expect(screen.getByText(/Limite de 6 patrocinadores/i)).toBeInTheDocument();
  });

  it('NAO oferece campo de contagem, clique, campanha nem periodo', () => {
    renderizar(comBlocos([], { marcas: [{ nome: 'Marca', logotipoUrl: null }] }));

    // A ausencia E a decisao: contador na faixa produziria o numero em que
    // um contrato de patrocinio se apoia (ADR-042, Decisao 4).
    expect(screen.queryByLabelText(/impress|clique|campanha|veicula|período/i)).toBeNull();
  });
});

describe('AbaDeBlocos -- indicadores da unidade', () => {
  it('avisa que "treinando agora" e ESTIMATIVA, porque a catraca so registra entrada', () => {
    renderizar(comBlocos([blocoNovo('INFORMACOES', 'i')]));

    expect(screen.getByText(/é uma estimativa/i)).toBeInTheDocument();
    expect(screen.getByText(/registra a entrada e não a saída/i)).toBeInTheDocument();
  });
});
