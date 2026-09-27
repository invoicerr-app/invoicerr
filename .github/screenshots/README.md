# Screenshots attached to pull requests

Images referenced from a pull request description, kept in the repository rather than behind an
external link: a link to a file hosted elsewhere stops working the day that host does, and a
reviewer reading this PR in two years should still see what changed on screen.

One directory per issue, named `<issue>-<slug>`. Reference them from a PR body by their raw URL
pinned to the commit SHA, never to a branch name, so the link survives the branch being deleted
after the merge.

Keep them small. These are review evidence, not assets the product ships.
