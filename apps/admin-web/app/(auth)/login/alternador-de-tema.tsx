'use client';

import { useEffect, useState } from 'react';

import estilos from './login.module.css';

type Tema = 'claro' | 'escuro';

const CHAVE_DE_ARMAZENAMENTO = 'ah-login-tema';

/**
 * Sol/lua do lado do formulário -- so no login sem tenant (F71,
 * DS-PAINEL.md §2.8b). Escreve `data-pa-tema` no `<html>`: `login.module.css`
 * lê esse atributo para redefinir os tokens `--ah-*` só dentro de
 * `.trabalhoSemTenant`, então o resto do app nunca vê o atributo.
 *
 * `ponytail`: sem script anti-FOUC bloqueante -- o padrão é claro (mesmo de
 * hoje) até o `useEffect` ler o `localStorage`, então quem já escolheu
 * escuro vê um flash de claro no primeiro paint. Aceitável para um adorno de
 * tela de marketing; upgrade se algum dia isto virar tema do painel inteiro.
 */
export function AlternadorDeTema() {
  const [tema, setTema] = useState<Tema>('claro');

  useEffect(() => {
    const salvo = window.localStorage.getItem(CHAVE_DE_ARMAZENAMENTO);

    if (salvo === 'claro' || salvo === 'escuro') setTema(salvo);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-pa-tema', tema);
  }, [tema]);

  const alternar = () => {
    const proximo: Tema = tema === 'claro' ? 'escuro' : 'claro';

    setTema(proximo);
    window.localStorage.setItem(CHAVE_DE_ARMAZENAMENTO, proximo);
  };

  const rotulo = tema === 'claro' ? 'Usar tema escuro' : 'Usar tema claro';

  return (
    <button
      type="button"
      className={estilos['botaoDeTema']}
      onClick={alternar}
      title={rotulo}
      aria-label={rotulo}
    >
      {tema === 'claro' ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
