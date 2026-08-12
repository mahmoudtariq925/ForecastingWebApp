# Bundled fonts

| Family | Weights | Licence |
|---|---|---|
| Poppins | 300, 400, 500, 600, 700 | [SIL Open Font License 1.1](https://openfontlicense.org) |
| JetBrains Mono | 400, 500, 600 | [SIL Open Font License 1.1](https://openfontlicense.org) |

Latin and Latin Extended subsets, `woff2`, taken from the Google Fonts
distribution. Both families are OFL, which permits bundling and redistribution
with the application.

They are served from the app rather than from `fonts.googleapis.com` on
purpose. A third-party font request is a dependency the app cannot control: if
the CDN is blocked — a corporate proxy, an offline demo, a locked-down network
— the page renders in a fallback face whose metrics differ, and a dense
forecast grid reflows after first paint. Self-hosting makes the type
deterministic and removes an external request from every page load.

To change a weight or subset, refetch the `woff2` from Google Fonts and update
the matching `@font-face` block at the top of `src/index.css`.
