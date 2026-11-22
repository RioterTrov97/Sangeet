# Changesets

Each user-visible change adds a changeset: a small Markdown file in this folder that names the version bump and
describes the change in one or two sentences for testers. Create one with `npx changeset`, or write it by hand:

```md
---
"sangeet": minor
---

Lyrics now follow the song on the TV.
```

`patch` for fixes, `minor` for features, `major` for breaking changes (for example a remote protocol change old
phones or TVs cannot handle). On every push to main, the **Version** workflow folds pending changesets into one release PR
(version bump in package.json plus CHANGELOG.md) that grows until you merge it; the merge starts **Release**, which
ships that version. See docs/INSTALL.md.
