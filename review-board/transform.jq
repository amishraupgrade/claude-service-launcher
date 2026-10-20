# Args: $r repo name, $t sync time (epoch ms), $common true for author-discovered repos,
# $only array of lowercase logins (empty = keep every author).
{
  name: $r,
  syncedAt: $t,
  common: $common,
  prs: [
    .[]
    | select(.isDraft == false and .reviewDecision != "APPROVED")
    | select(($only | length) == 0 or (.author.login | ascii_downcase | IN($only[])))
    | {
        n: .number,
        t: .title,
        a: .author.login,
        rd: (if .reviewDecision == "" then "REVIEW_REQUIRED" else .reviewDecision end),
        c: (
          if (.statusCheckRollup | length) == 0 then "none"
          elif ([.statusCheckRollup[] | select(.conclusion == "FAILURE" or .state == "FAILURE" or .state == "ERROR")] | length) > 0 then "failing"
          elif ([.statusCheckRollup[] | select(.status == "IN_PROGRESS" or .status == "QUEUED" or .state == "PENDING")] | length) > 0 then "pending"
          else "passing" end
        ),
        cr: .createdAt,
        u: .updatedAt,
        ad: .additions,
        de: .deletions,
        f: .changedFiles,
        rr: [.reviewRequests[] | (.login // .name)],
        l: [.labels[].name]
      }
  ]
}
