# Contributing to this fork

This repository is a personal fork of [d-eniz/jupymd](https://github.com/d-eniz/jupymd), maintained to fit one person's Obsidian vault and workflow. It isn't set up to take outside pull requests, and pushing back to upstream is disabled. If you're looking to contribute to JupyMD generally, please go to the [upstream repository](https://github.com/d-eniz/jupymd) and its [contribution guidelines](https://github.com/d-eniz/jupymd/blob/master/CONTRIBUTING.md) instead.

The notes below exist to keep this fork consistent with itself over time, particularly across merges from upstream.

### Commits

- Use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/). The release workflow generates changelogs directly from commit history, so descriptive, correctly-typed messages (`feat:`, `fix:`, `chore:`, etc.) directly become the release notes.
- Keep commits to one logical change at a time.

### Versioning and releases

- Don't hand-edit `manifest.json`, `versions.json`, or the `version` field in `package.json`. The [release workflow](.github/workflows/release.yml) bumps these automatically via `npm version` when manually triggered, commits them, tags the release, and stages a draft GitHub release. Hand-editing them risks conflicting with that automation and with version bumps merged in from upstream.
- Expect merge conflicts in these version files when pulling from upstream, since both this fork and upstream bump them independently. Resolve by taking whichever version is actually intended for the next release here, not by trying to reconcile the numbers.

### Automated tests

See [test/README.md](test/README.md) for setup and test commands. CI (`.github/workflows/test.yml`) runs on macOS against the latest Obsidian release, and only on manual trigger or as a gate before a release build — it doesn't run on every push, since this isn't reviewing incoming PRs. Check other platforms or older Obsidian versions locally if a change might affect them.
