import { criarPrismaClient } from '../packages/database/dist/index.js';

const db = criarPrismaClient();
const SESSAO = '39a13ab9-9008-4cdc-81fa-b8692f153090';

const imports = await db.assessmentImport.findMany({
  where: { reviewSessionId: SESSAO },
  select: { sourceLabel: true, status: true, assessmentId: true },
});

console.log('arquivos da sessao:');
for (const i of imports) console.log(` - ${i.sourceLabel} | ${i.status} | avaliacao=${i.assessmentId?.slice(0, 8) ?? '—'}`);

const avaliacaoId = imports.find((i) => i.assessmentId)?.assessmentId;

if (avaliacaoId) {
  const av = await db.bodyAssessment.findUnique({
    where: { id: avaliacaoId },
    include: { measurements: { select: { type: true, canonicalValue: true } } },
  });

  console.log(`\navaliacao ${av?.status}, ${av?.measurements.length} medidas:`);
  for (const m of av?.measurements ?? []) console.log(` - ${m.type} = ${m.canonicalValue}`);
}

await db.$disconnect();
