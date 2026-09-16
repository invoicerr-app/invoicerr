{{/*
Chart name, truncated/sanitized per Helm convention.
*/}}
{{- define "invoicerr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name — <release>-<chart> unless the release name already contains the chart
name, or fullnameOverride is set. Standard Helm chart boilerplate.
*/}}
{{- define "invoicerr.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "invoicerr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels / selector labels — standard Helm boilerplate, applied to every resource in this
chart so `kubectl get all -l app.kubernetes.io/instance=<release>` finds everything.
*/}}
{{- define "invoicerr.labels" -}}
helm.sh/chart: {{ include "invoicerr.chart" . }}
{{ include "invoicerr.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end -}}

{{- define "invoicerr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "invoicerr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Component-scoped names/labels — every Deployment/Service/PVC in this chart is one of api, worker,
redis, postgres or ocr, and needs its own name + its own selector so e.g. the api and worker
Deployments (same chart, same release) never collide on Service selection.
*/}}
{{- define "invoicerr.componentFullname" -}}
{{- printf "%s-%s" (include "invoicerr.fullname" .context) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "invoicerr.componentLabels" -}}
{{ include "invoicerr.labels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "invoicerr.componentSelectorLabels" -}}
{{ include "invoicerr.selectorLabels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "invoicerr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "invoicerr.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The Secret this chart's Deployments read BETTER_AUTH_SECRET / CREDENTIALS_ENCRYPTION_KEY /
DATABASE_URL / DATABASE_URL_UNPOOLED / REDIS_PASSWORD / ARCHIVE_S3_* from.
`.Values.existingSecret` is the production path (a Secret you manage outside this chart, or via
your own orchestration/secrets tooling); left empty, this resolves to a chart-owned name that
either `generateSecret.enabled: true` renders (templates/secret.yaml — dev/kind only, see that
file's own header) or that you create yourself out of band with this exact name before installing.
*/}}
{{- define "invoicerr.secretName" -}}
{{- default (printf "%s-secret" (include "invoicerr.fullname" .)) .Values.existingSecret -}}
{{- end -}}

{{/*
Redis host/port — the bundled Deployment's own Service unless `redis.external.host` points this
chart at a managed instance instead, in which case no Redis resources render at all.
*/}}
{{- define "invoicerr.redisHost" -}}
{{- if .Values.redis.external.host -}}
{{- .Values.redis.external.host -}}
{{- else -}}
{{- include "invoicerr.componentFullname" (dict "context" . "component" "redis") -}}
{{- end -}}
{{- end -}}

{{- define "invoicerr.redisPort" -}}
{{- if .Values.redis.external.host -}}
{{- .Values.redis.external.port -}}
{{- else -}}
{{- 6379 -}}
{{- end -}}
{{- end -}}

{{/*
DATABASE_URL for the BUNDLED, dev/kind-only Postgres (postgresql.enabled=true). Plaintext
credentials straight from values.yaml here are deliberate and match this chart's dev-only
docker-compose.yml counterpart (same default invoicerr/invoicerr credentials) — production never
takes this path, since postgresql.enabled defaults to false and the real DATABASE_URL then comes
from existingSecret instead (see values.yaml's own comments on both).
*/}}
{{- define "invoicerr.bundledDatabaseUrl" -}}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "invoicerr.componentFullname" (dict "context" . "component" "postgres")) .Values.postgresql.auth.database -}}
{{- end -}}

{{/*
OCR engine base URL — the bundled ocr Deployment's own Service, reachable only when
`ocr.enabled: true`. No external/managed-OCR escape hatch: this is our own image
(ghcr.io/invoicerr-app/ocr-image), never a third-party endpoint.
*/}}
{{- define "invoicerr.ocrServiceUrl" -}}
{{- printf "http://%s:%v" (include "invoicerr.componentFullname" (dict "context" . "component" "ocr")) .Values.ocr.service.port -}}
{{- end -}}
