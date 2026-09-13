import { Archive, ArchiveRestore, Briefcase, Edit, Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { currencies } from "@/lib/constants/currencies"
import { cn } from "@/lib/utils"
import { useCompany, useUpdateProject } from "@/hooks/queries"
import type { Project } from "@/types"

import { ProjectUpsert } from "./project-upsert"

interface ProjectListProps {
  projects: Project[]
  loading: boolean
  selectedProjectId?: string
  onSelect: (project: Project) => void
}

export function ProjectList({ projects, loading, selectedProjectId, onSelect }: ProjectListProps) {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : ""
  const { mutateAsync: updateProject } = useUpdateProject()

  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)

  const toggleArchived = async (project: Project, event: React.MouseEvent) => {
    event.stopPropagation()
    await updateProject({ id: project.id, isArchived: !project.isArchived })
  }

  return (
    <>
      <Card className="gap-0">
        <CardHeader className="border-b flex flex-row items-center justify-between">
          <CardTitle>{t("timeTracking.projects.title")}</CardTitle>
          <Button onClick={() => setCreateOpen(true)} dataCy="project-add-button">
            <Plus className="h-4 w-4 mr-0 md:mr-2" />
            <span className="hidden md:inline-flex">{t("timeTracking.projects.list.add")}</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12" data-cy="project-empty">
              <Briefcase className="mx-auto h-10 w-10 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-foreground">{t("timeTracking.projects.empty")}</h3>
            </div>
          ) : (
            <div className="divide-y">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelect(project)}
                  className={cn(
                    "w-full text-left p-4 flex items-center justify-between gap-4 hover:bg-muted/50",
                    selectedProjectId === project.id && "bg-muted",
                  )}
                  data-cy={`project-item-${project.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground break-words">{project.name}</span>
                      {project.isArchived && (
                        <Badge variant="outline" className="text-xs">
                          {t("timeTracking.projects.archivedBadge")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {project.client.name}
                      {project.hourlyRate != null && (
                        <>
                          {" "}
                          · {project.hourlyRate}
                          {currencySymbol}/{t("timeTracking.units.hourShort")}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      tooltip={t("timeTracking.actions.edit")}
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditProject(project)
                      }}
                      dataCy="project-edit-button"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      tooltip={t(
                        project.isArchived
                          ? "timeTracking.actions.unarchive"
                          : "timeTracking.actions.archive",
                      )}
                      variant="ghost"
                      size="icon"
                      onClick={(e) => toggleArchived(project, e)}
                      dataCy="project-archive-toggle"
                    >
                      {project.isArchived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectUpsert open={createOpen} onOpenChange={setCreateOpen} />
      <ProjectUpsert
        project={editProject}
        open={!!editProject}
        onOpenChange={(open) => {
          if (!open) setEditProject(null)
        }}
      />
    </>
  )
}

export default ProjectList
