import { redirect } from 'next/navigation';

/** Só há um relatório por enquanto; quando houver mais, esta vira o índice. */
export default function PaginaDeRelatorios(): never {
  redirect('/reports/students');
}
