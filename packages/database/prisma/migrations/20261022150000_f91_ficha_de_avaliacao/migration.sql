-- F91: ficha de avaliacao do professor. Pressao (par sistolica/diastolica) e
-- VO2max entram como medida DA AVALIACAO, publicadas junto com ela (INV-102).
-- So acrescenta valor ao enum: nenhuma linha existente muda.
ALTER TYPE "body_measurement_type" ADD VALUE IF NOT EXISTS 'BLOOD_PRESSURE_SYSTOLIC';
ALTER TYPE "body_measurement_type" ADD VALUE IF NOT EXISTS 'BLOOD_PRESSURE_DIASTOLIC';
ALTER TYPE "body_measurement_type" ADD VALUE IF NOT EXISTS 'VO2_MAX';
