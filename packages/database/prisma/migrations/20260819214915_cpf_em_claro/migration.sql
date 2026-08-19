/*
  Warnings:

  - You are about to drop the column `cpf_last3` on the `students` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "students" DROP COLUMN "cpf_last3",
ADD COLUMN     "cpf" TEXT;
