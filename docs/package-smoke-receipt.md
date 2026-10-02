# Installed package receipt

Generated 2026-10-02T20:35:29.498Z, Node v26.3.1.

Installed the tarball in an empty directory outside the source tree. The package omitted action.yml. The existing consumer smoke imported the public package, completed a recorded approval, introduced a mandatory finding, and observed CHANGES_REQUESTED in the same result and recorded publication. It passed before and after the CLI break.

CLI smoke: invoking each npm-created executable link without arguments exits 1 through argument validation. The instance CLI validates a deployment, enrolment, and authority selection through the installed binary and emits its two GitHub outputs; its closer also returns “nothing to close” without a token or network call when all jobs succeeded and the selected package published. Replacing the review CLI's installed target with an empty executable changed its exit to 0 and failed exactly that assertion. Restoring the file restored the passing check. This proves installed entrypoint execution, not live service availability or a hosted Action run.

Reproduce: npm pack; node scripts/package-smoke.mjs ./margot-pr-reviewer-0.6.1.tgz.
