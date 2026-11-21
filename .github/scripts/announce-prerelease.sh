#!/usr/bin/env bash
# Posts the Discord announcement for a published pre-release.
#
# Called by the `announce` job of docker-publish.yml, which `needs:` the job that creates the
# manifest list: a reader who pulls the tag from the announcement would otherwise get "manifest
# unknown" for the minutes the two platform builds and the manifest take, and would still get one
# if the build failed. Running this from the publish workflow is what makes "the image exists"
# true by construction rather than by timing.
#
# DRY_RUN=1 prints the payload instead of sending it, and the webhook is optional: without it the
# script prints a notice and exits 0, so a repository that has not set up Discord still releases.
set -euo pipefail

: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${RELEASE_URL:?RELEASE_URL is required}"
RELEASE_NAME="${RELEASE_NAME:-$RELEASE_TAG}"
RELEASE_BODY="${RELEASE_BODY:-}"

# Discord caps an embed description at 4096 characters and rejects the whole request past that.
# The body is the full generated changelog, so this sends a short prefix and the link carries the
# rest. jq slices by characters, not bytes, so a multi-byte character is never cut in half.
#
# GitHub's generated notes open with an HTML comment naming .github/release.yml; GitHub hides it,
# Discord does not, so sending the body unchanged puts that line at the top of every announcement.
# Comments and the blank lines they leave at the start are dropped before the cut, the same way
# documentation/scripts/changelog-post.mjs drops them for the blog. An unterminated comment is
# dropped to the end of the body rather than left in place.
SUMMARY=$(jq -nr --arg body "$RELEASE_BODY" '
  $body
  | gsub("(?s)<!--.*?-->"; "")
  | sub("(?s)<!--.*$"; "")
  | sub("^\\s+"; "")
  | . as $text
  | $text[0:1500] + (if ($text | length) > 1500 then "..." else "" end)
')

PAYLOAD=$(jq -n \
  --arg content "New pre-release: $RELEASE_NAME" \
  --arg title "$RELEASE_NAME" \
  --arg url "$RELEASE_URL" \
  --arg description "$SUMMARY" \
  '{
    content: $content,
    embeds: [
      {
        title: $title,
        url: $url,
        description: $description,
        color: 15844367
      }
    ]
  }')

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf '%s\n' "$PAYLOAD"
  if [ -n "${DISCORD_RELEASES_WEBHOOK:-}" ]; then
    echo "dry run: payload above, no request sent (webhook is set)" >&2
  else
    echo "dry run: payload above, no request sent (webhook is not set, a real run would skip)" >&2
  fi
  exit 0
fi

if [ -z "${DISCORD_RELEASES_WEBHOOK:-}" ]; then
  echo "::notice::DISCORD_RELEASES_WEBHOOK is not set -- skipping the Discord notification for $RELEASE_TAG."
  exit 0
fi

curl --fail --silent --show-error \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$DISCORD_RELEASES_WEBHOOK"

echo "Announced $RELEASE_TAG on Discord." >&2
