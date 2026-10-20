Refresh the Review Board artifact (https://claude.ai/code/artifact/0046c5b3-553a-4015-8bd7-5961e06c0c27) from GitHub. Do only the steps below. Do not modify GitHub, do not edit any file in this repository, and do not send notifications.

1. Run `/Users/amishra/services/claude-ui/review-board/refresh.sh`. Its last lines read `repos=N core=X common=Y failed=M prs=P` and, if any failed, `FAILED: <names>`. The repo set changes between runs (common repos come and go with the authors in `authors.txt`), so write whatever is in `out/repos.txt`. If M is greater than 5, stop and report the failure; write nothing.

2. The script left one JSON file per repo in `/Users/amishra/services/claude-ui/review-board/out/<repo>.json` and the repo list in `out/repos.txt`. Write each file into the artifact database with the Artifact tool, action `write_db`, `db_op` `batch`, collection `repos`, `doc_id` the repo name, `op` `set`, and `file_path` the JSON file. Use batches of at most 50 writes. Skip repos named in FAILED (their old data stays).

3. List the `repos` collection with `read_db`. Delete any `repos` document whose id is not in `out/repos.txt` (a repo that left the scope rules).

4. List the `claims` collection with `read_db`. A claim's doc id is `<repo>__<number>`. Delete a claim when its repo did not fail and its number is not in that repo's `prs` in the matching `out/<repo>.json` (the PR was merged, closed, approved or drafted). Keep every other claim untouched. Never create or edit a claim.

5. Final answer, three lines at most: repos written, total PRs, claims deleted, plus any FAILED repo names.
