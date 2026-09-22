# Source review — script-runner

## Revision and method

Inspected public commit: [`a25978d34119438761036d93eaeb1c9d60ed3b90`](https://github.com/NickCirv/script-runner/commit/a25978d34119438761036d93eaeb1c9d60ed3b90). Source tree: `097543156233c20294caeffddb05dab23a6b7832`. Capture scope: all eligible text files; 6 of 6 eligible files.

This review read captured implementation and documentation. It did not install dependencies, execute project commands, call project APIs, check package publication or establish live CI status. Examples are source-derived, not captured execution transcripts.

## Claim ledger

| Claim | Evidence | Status |
| --- | --- | --- |
| Package-manager detection, subprocesses and name-based persistence | [index.js](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/index.js) | Verified in inspected source; execution unverified |

## Findings and verification gaps

Selected scripts execute with the user’s normal permissions and can perform arbitrary project-defined work. History is stored under a home-directory filename based on package name, so same-name projects can share records. Lockfile detection is a heuristic and only recognizes the coded filenames, including bun.lockb. `-h` means history, not help.

The captured smoke test only asks Node to syntax-check the entrypoint. It does not exercise behavior, integrations or failure paths. Neither that test nor installation was run in this review.

| Dimension | Result |
| --- | --- |
| Purpose and documented commands | Partially verified: static source inspection |
| Clean installation and examples | Unverified |
| Test suite and live CI | Unverified |
| Performance and security guarantees | Unverified |
| Publication | Local documentation only |

## Documentation inventory

- [README.md](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/README.md) — Rewritten; historic section anchors retained where practical.
- [LICENSE](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/LICENSE) — protected document preserved unchanged.

## Captured source inventory

- [LICENSE](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/LICENSE) — Git blob `05b804beeec7d1a6c933d087387ba4adf6463d93`.
- [README.md](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/README.md) — Git blob `afc66bbb070ac90d64b2179ddcc8d63ef6418119`.
- [package.json](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/package.json) — Git blob `48ecb978bcda6d7e79bcc765245c3ef7bf3ac437`.
- [.github/workflows/ci.yml](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/.github/workflows/ci.yml) — Git blob `44515034a394670de44454a7a1bd2c7ef0c9836e`.
- [index.js](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/index.js) — Git blob `9e77a2b65b0007d64e3b66a7ab6b31be980d0b13`.
- [test/smoke.test.js](https://github.com/NickCirv/script-runner/blob/a25978d34119438761036d93eaeb1c9d60ed3b90/test/smoke.test.js) — Git blob `ebbccaaf2583b4850575f835313e4b0afd21bff7`.

## Scope boundary

Capture excludes lockfiles, binary artwork, generated output, vendored dependencies and files above the acquisition size limit. The tree records their existence; no verification claim is made for omitted content. Protected documents and historical records are not replaced.

## Reference coverage

Added [command reference](REFERENCE.md) from the argument parser, command handlers and source-defined help at the pinned revision. README examples remain unexecuted.
