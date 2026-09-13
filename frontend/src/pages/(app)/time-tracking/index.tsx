import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useProjects } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import type { Project } from "@/types"

import { ProjectList } from "./_components/project-list"
import { TimeEntryList } from "./_components/time-entry-list"

/**
 * TODO_FEATURES.md rank 11 ("suivi du temps & facturation de projets"). Two panels, generic on
 * purpose the way every other CRUD screen in this app is (articles, clients): the left/top one lists
 * Projects (this company's billing buckets per client — see Project's own schema comment for why that
 * layer exists), the bottom one shows the SELECTED project's own logged time and is where an invoice
 * gets generated from a subset of its unbilled entries.
 */
export default function TimeTrackingPage() {
  const { t } = useTranslation()
  usePageHeader(t("sidebar.navigation.timeTracking"))

  const { data: projects = [], isLoading } = useProjects()
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)

  // Keeps the selected project's own data fresh after an edit (rate change, archive) without a
  // second fetch — the same "read the live row back out of the list query" pattern
  // documents/[typeId].tsx already holds for its own dialog target.
  const liveSelectedProject = selectedProject
    ? (projects.find((project) => project.id === selectedProject.id) ?? selectedProject)
    : null

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="time-tracking-page">
      <ProjectList
        projects={projects}
        loading={isLoading}
        selectedProjectId={liveSelectedProject?.id}
        onSelect={setSelectedProject}
      />

      {liveSelectedProject && <TimeEntryList project={liveSelectedProject} />}
    </div>
  )
}
