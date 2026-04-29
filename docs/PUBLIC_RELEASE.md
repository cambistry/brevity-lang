# Public Release Checklist

Use this before making the repository public.

## Front Door

- README leads with CAM and links to the documentation map.
- CAM has its own introductory document.
- Syntax details are linked out of the README instead of crowding the front
  page.
- The feature index links only to existing local docs.
- The design notes are indexed as a journal, not presented as final
  specification.

## Repository Hygiene

- Add a `LICENSE` file if MIT is the intended license.
- Remove local artifacts such as `.DS_Store` and crash dumps before publishing.
- Decide whether `kanban/` should be public as-is or moved behind a clearer
  contributor-facing roadmap.
- Decide whether `convert_steps.py` and `convert_tests2.py` are still useful
  enough to keep at the root.
- Fill in `author` or repository metadata in `package.json` if the package will
  be published to npm.

## Verification

- Run the local markdown-link check.
- Run `npm run lint`.
- Run the target-specific tests that are practical before release.
- Skim the README in a rendered Markdown view.

## Positioning

- Say clearly that Brevity is early and experimental.
- Present CAM as the central model.
- Avoid implying that the repository already contains a full distributed
  cluster runtime.
- Keep examples conservative and close to implemented behavior.
