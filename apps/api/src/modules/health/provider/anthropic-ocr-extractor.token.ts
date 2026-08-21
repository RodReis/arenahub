/**
 * Token do OCR real da Anthropic, injetado como `DocumentExtractor | null`
 * (ver `health.module.ts`). `null` quando `ANTHROPIC_API_KEY` nao esta
 * configurada -- o roteador cai para o dublê nesse caso.
 */
export const ANTHROPIC_OCR_EXTRACTOR = Symbol('ANTHROPIC_OCR_EXTRACTOR');
