import { criarPrismaClient } from '../packages/database/dist/index.js';

const db = criarPrismaClient();

const recentes = await db.assessmentImport.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: {
    reviewSessionId: true,
    sourceLabel: true,
    originalFilename: true,
    status: true,
    objectKey: true,
    createdAt: true,
  },
});

for (const i of recentes) {
  console.log(
    `${i.createdAt.toISOString()} | ${i.originalFilename} | ${i.status} | sessao=${i.reviewSessionId?.slice(0, 8)} | key=${i.objectKey ? 'sim' : 'nao'}`,
  );
}

await db.$disconnect();
