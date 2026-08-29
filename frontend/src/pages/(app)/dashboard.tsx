import { useTranslation } from "react-i18next"

/**
 * Le tableau de bord, réduit à ce qui subsiste.
 *
 * Il affichait les derniers devis, les dernières factures, le chiffre d'affaires et les
 * encaissements — tout venait des documents légaux, supprimés sur décision explicite. Plutôt que de
 * laisser une page qui référence des écrans disparus, on dit ce qui s'est passé : une page vide
 * sans explication ressemble à une panne.
 *
 * Il n'y a rien à reconstruire ici tant que le modèle de document qui remplace l'ancien n'est pas
 * décidé. Ce fichier est le point de reprise.
 */
export default function Dashboard() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
      <p className="text-muted-foreground max-w-2xl text-sm">{t("dashboard.rebuilding")}</p>
    </div>
  )
}
