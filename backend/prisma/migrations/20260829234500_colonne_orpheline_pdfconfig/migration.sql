-- La migration précédente a supprimé la table `PDFConfig` mais laissé la colonne qui la
-- référençait : `CASCADE` retire la contrainte de clé étrangère, pas la colonne. Elle restait
-- NOT NULL, donc toute création de société échouait — trouvé en rejouant les tests e2e survivants.
ALTER TABLE "Company" DROP COLUMN IF EXISTS "pDFConfigId";
