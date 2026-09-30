# Installed package receipt

Generated 2026-09-30T05:10:57.883Z, Node v22.23.3.

Installed the tarball in an empty directory outside the source tree. The existing consumer smoke imported the public package, completed a recorded approval, introduced a mandatory finding, and observed CHANGES_REQUESTED in the same result and recorded publication. It passed before and after the CLI break.

New CLI smoke: invoking the npm-created executable link without arguments exits 1 through argument validation. Replacing its installed target with an empty executable changed the exit to 0 and failed exactly that assertion. Restoring the file restored the passing check. This proves installed entrypoint execution, not live service availability or a hosted Action run.

Reproduce: npm pack; node scripts/package-smoke.mjs ./margot-pr-reviewer-0.2.0-slice2.tgz.
