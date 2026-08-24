import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TenantDateTime } from './TenantDateTime.js';

describe('TenantDateTime', () => {
  /**
   * O teste que da razao ao componente existir.
   *
   * O mesmo instante em fusos diferentes tem de produzir textos diferentes.
   * As quatro implementacoes que este componente substitui hardcodavam
   * `America/Sao_Paulo` -- numa academia com filial em Manaus, todo evento
   * seria lido com uma hora de erro.
   */
  it('formata no timezone da UNIDADE, nao no do navegador', () => {
    // 03:30 UTC = 00:30 em Sao_Paulo, ainda no dia 16.
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="datetime" />,
    );

    expect(screen.getByText(/16\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/00:30/)).toBeInTheDocument();
  });

  it('o mesmo instante em Manaus cai no dia anterior', () => {
    // 03:30 UTC = 23:30 em Manaus, dia 15.
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Manaus" format="datetime" />,
    );

    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/23:30/)).toBeInTheDocument();
  });

  it('usa <time> com o instante legivel por maquina', () => {
    const { container } = render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" />,
    );

    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-16T03:30:00Z');
  });

  it('formato date omite a hora', () => {
    render(<TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="date" />);

    expect(screen.getByText('16/08/2026')).toBeInTheDocument();
  });

  it('formato time omite a data', () => {
    render(<TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="time" />);

    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('data ausente nao vira epoch zero', () => {
    render(<TenantDateTime iso={null} timeZone="America/Sao_Paulo" />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });

  /**
   * REGRESSAO das quatro implementacoes substituidas: todas checavam
   * `Number.isFinite(data.getTime())` e caiam para `—`. Sem esta guarda, uma
   * string invalida renderiza "Invalid Date" na tela da recepcao.
   */
  it('data invalida vira travessao, nunca "Invalid Date"', () => {
    render(<TenantDateTime iso="nao-e-data" timeZone="America/Sao_Paulo" />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
    expect(screen.queryByText(/Invalid/)).not.toBeInTheDocument();
  });

  /**
   * DATA PURA NAO CONVERTE FUSO -- bug que o PI viu em 24/08/2026.
   *
   * Nascimento gravado como 16/07 aparecia **15/07** na ficha (que
   * reinterpretava a data como meia-noite UTC e a puxava tres horas para
   * tras) e **16/07** no formulario de edicao, que lia a string crua. Duas
   * telas, o mesmo dado, dias diferentes -- e salvar pelo formulario
   * gravaria o dia que ELE mostrava.
   *
   * O schema Prisma ja avisava, em comentario ao lado do campo: "data de
   * nascimento nao tem hora nem fuso. Gravar como timestamp faria 01/01
   * virar 31/12 na conversao de timezone".
   */
  it('data pura YYYY-MM-DD nao anda um dia para tras', () => {
    render(<TenantDateTime iso="1999-07-16" timeZone="America/Sao_Paulo" format="date" />);

    expect(screen.getByText('16/07/1999')).toBeInTheDocument();
  });

  /**
   * A MESMA data pura em QUALQUER fuso e o mesmo dia -- e o que "pura"
   * significa. Em Manaus (UTC-4) o erro seria identico ao de Sao Paulo.
   */
  it('data pura e o mesmo dia em qualquer fuso', () => {
    render(<TenantDateTime iso="2026-01-01" timeZone="America/Manaus" format="date" />);

    expect(screen.getByText('01/01/2026')).toBeInTheDocument();
  });

  /**
   * A GUARDA NAO PODE VAZAR PARA INSTANTE: `dueAt`, `startsAt` e
   * `assessedAt` sao timestamps reais e DEVEM converter. Se o regex de data
   * pura pegasse instante junto, a recepcao de Manaus voltaria a ver o
   * horario de Sao Paulo -- exatamente o bug que este componente nasceu
   * para matar.
   */
  it('instante com hora continua convertendo o fuso', () => {
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Manaus" format="date" />,
    );

    // 03:30 UTC = 23:30 do dia 15 em Manaus.
    expect(screen.getByText('15/08/2026')).toBeInTheDocument();
  });
});
