import { criarPrismaClient } from '../packages/database/dist/index.js';

const db = criarPrismaClient();

const imports = await db.assessmentImport.findMany({
  where: { reviewSessionId: 'ad53ccb6-4b17-495f-8713-bdefe8b5dca4' },
  select: { id: true, tenantId: true, status: true, sourceLabel: true, originalFilename: true },
});

console.log('imports na sessao:', imports.length);
for (const i of imports) console.log(` - ${i.sourceLabel} | ${i.status} | tenant=${i.tenantId}`);

const campos = await db.importedField.count({
  where: { import: { reviewSessionId: 'ad53ccb6-4b17-495f-8713-bdefe8b5dca4' } },
});
console.log('campos:', campos);

await db.$disconnect();
