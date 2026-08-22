/**
 * Popula uma sessão de revisão no banco de DESENVOLVIMENTO para inspeção
 * visual da tela. Descartável — não é seed nem fixture de teste.
 */
import { criarPrismaClient } from '../packages/database/dist/index.js';

const db = criarPrismaClient();
const STUDENT = '073c08cd-ddea-487c-9075-3d56e1e77cc5';

const aluno = await db.student.findUniqueOrThrow({ where: { id: STUDENT } });
const usuario = await db.user.findFirstOrThrow({ where: { email: 'dono@arena-positiva.test' } });

const sessionId = crypto.randomUUID();

async function importar(nome, sourceLabel, campos, atributos) {
  const imp = await db.assessmentImport.create({
    data: {
      tenantId: aluno.tenantId,
      studentId: STUDENT,
      status: 'EXTRACTED',
      originalFilename: nome,
      fileType: nome.endsWith('.pdf') ? 'PDF' : 'CSV',
      fileSizeBytes: 2048,
      objectKey: `dev/${sessionId}/${nome}`,
      scanResult: 'CLEAN',
      extractor: 'laudo-bioimpedancia@1',
      uploadedByUserId: usuario.id,
      reviewSessionId: sessionId,
      sourceLabel,
      ...(atributos ? { extractedAttributes: atributos } : {}),
    },
  });

  for (const c of campos) {
    await db.importedField.create({
      data: {
        tenantId: aluno.tenantId,
        importId: imp.id,
        type: c.type,
        state: 'PENDING',
        extractedValue: c.valor,
        extractedUnit: c.unidade ?? null,
        sourceLabel,
        referenceMin: c.min ?? null,
        referenceMax: c.max ?? null,
        standardPercent: c.pct ?? null,
      },
    });
  }

  return imp.id;
}

await importar('Relatorio de medicao CF610_G.csv', 'CF610_G', [
  { type: 'WEIGHT', valor: 88.4, unidade: 'KG', min: 60.6, max: 82.0 },
  { type: 'SKELETAL_MUSCLE_MASS', valor: 37.2, unidade: 'KG', min: 30.6, max: 37.4 },
  { type: 'BODY_FAT_MASS', valor: 20.1, unidade: 'KG', min: 8.6, max: 17.2 },
  { type: 'TOTAL_BODY_WATER', valor: 48.9, unidade: 'L', min: 40.0, max: 48.8 },
  { type: 'SEGMENTAL_FAT_MASS_ARM_LEFT', valor: 1.1, unidade: 'KG', pct: 190.5 },
  { type: 'SEGMENTAL_FAT_MASS_ARM_RIGHT', valor: 1.2, unidade: 'KG', pct: 205.0 },
  { type: 'SEGMENTAL_FAT_MASS_TRUNK', valor: 10.4, unidade: 'KG', pct: 230.1 },
  { type: 'SEGMENTAL_MUSCLE_MASS_TRUNK', valor: 29.1, unidade: 'KG', pct: 100.8 },
  { type: 'SEGMENTAL_MUSCLE_MASS_LEG_LEFT', valor: 10.9, unidade: 'KG', pct: 104.3 },
  { type: 'VISCERAL_FAT_LEVEL', valor: 8, unidade: null, min: 1, max: 9 },
  { type: 'BASAL_METABOLIC_RATE', valor: 1810, unidade: 'KCAL', min: 1894, max: 2232 },
]);

// Peso CONCORDA (88.4) -> deduplica. Gordura DIVERGE (20.1 vs 23.9) -> escolha humana.
await importar('Relatorio de analise Unique Health.csv', 'Unique Health', [
  { type: 'WEIGHT', valor: 88.4, unidade: 'KG', min: 61, max: 82 },
  { type: 'BODY_FAT_MASS', valor: 23.9, unidade: 'KG', min: 8.6, max: 17.2 },
  { type: 'BONE_MASS', valor: 3.6, unidade: 'KG', min: 3.1, max: 3.8 },
  { type: 'BODY_CELL_MASS', valor: 44.0, unidade: 'KG', min: 35.6, max: 43.5 },
  { type: 'SUBCUTANEOUS_FAT_PERCENT', valor: 20.1, unidade: 'PERCENT', min: 8.6, max: 16.7 },
  { type: 'SKELETAL_MUSCLE_PERCENT', valor: 42.1, unidade: 'PERCENT', min: 33.1, max: 40.5 },
  { type: 'WAIST_HIP_RATIO', valor: 0.88, unidade: null, min: 0.8, max: 0.9 },
  { type: 'EXTRACELLULAR_WATER', valor: 18.9, unidade: 'L', min: 15.2, max: 18.6 },
  { type: 'HEART_RATE', valor: 84, unidade: null, min: 55, max: 100 },
]);

await importar(
  'ECG 30s.pdf',
  'ECG 30s',
  [{ type: 'HEART_RATE', valor: 92, unidade: null, min: 55, max: 100 }],
  { ecgFinding: 'Ritmo nao classificado', ecgTags: ['Atividade:Alta'], ecgDurationSeconds: 30 },
);

console.log(`SESSAO=${sessionId}`);
console.log(`URL=http://localhost:3001/students/${STUDENT}/health/imports/${sessionId}`);

await db.$disconnect();
