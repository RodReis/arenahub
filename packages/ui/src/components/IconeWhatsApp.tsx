import { BRAND } from '../tokens.generated.js';

/**
 * Logo oficial do WhatsApp -- fora do catalogo monocromatico de `Icon.tsx`
 * de proposito (issue #118, pedido do PI).
 *
 * TODO OUTRO ICONE do sistema usa `currentColor` (regra de lint 2: nada de
 * cor propria fora do papel semantico). Este e a excecao deliberada: e um
 * LOGO DE MARCA, nao um simbolo do design system -- o verde e o branco sao
 * o que faz a recepcao reconhecer "WhatsApp" de relance, e diluir isso em
 * `currentColor` apagaria a marca que o botao existe para comunicar.
 *
 * As duas cores vem de `BRAND` (`tokens.generated.ts`, gerado a partir de
 * `tokens/primitive.json`), nunca hex cru aqui -- regra de lint 1 proibe hex
 * literal fora de `packages/ui/tokens`, sem excecao nominal para este arquivo.
 *
 * Traçado oficial (Meta Brand Resource Center): circulo verde, fone branco.
 */
export function IconeWhatsApp() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="12" fill={BRAND.whatsapp} />
      <path
        fill={BRAND.whatsappGlifo}
        d="M17.47 14.38c-.3-.15-1.77-.87-2.04-.97-.27-.1-.48-.15-.68.15-.2.3-.78.97-.96 1.17-.18.2-.35.22-.65.08-.3-.15-1.28-.47-2.43-1.5-.9-.8-1.51-1.79-1.68-2.09-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.64-.93-2.24-.24-.59-.5-.51-.68-.52-.18-.01-.38-.01-.58-.01-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.9 1.23 3.1.15.2 2.12 3.24 5.14 4.54.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.29.18-1.42-.08-.13-.28-.2-.58-.35z"
      />
      <path
        fill={BRAND.whatsappGlifo}
        d="M12.02 3.5A8.44 8.44 0 0 0 3.6 11.9c0 1.5.4 2.96 1.14 4.24L3.5 20.5l4.48-1.17a8.4 8.4 0 0 0 4.03 1.03h.01a8.44 8.44 0 0 0 8.4-8.44 8.4 8.4 0 0 0-2.47-5.96 8.36 8.36 0 0 0-5.93-2.46zm0 15.44h-.01a7.03 7.03 0 0 1-3.58-.98l-.26-.15-2.66.7.71-2.6-.17-.27a7.02 7.02 0 0 1-1.08-3.75 7.05 7.05 0 0 1 7.05-7.03 7 7 0 0 1 4.95 2.05 6.97 6.97 0 0 1 2.06 4.96 7.05 7.05 0 0 1-7.01 7.07z"
      />
    </svg>
  );
}
