# Release checklist

## Before the branch

- Freeze feature merges
- Confirm CI green on the default branch
- Draft release notes from merged pull requests

## The long part

- Verify migrations apply from a clean database
- Verify migrations apply on top of the previous release
- Run the full test suite on the release branch
- Run the smoke test against a staging deploy
- Check bundle size against the previous release
- Check every documented environment variable still exists
- Confirm secrets are absent from build artifacts
- Confirm rollback deploys the previous tag cleanly
- Update version numbers in every manifest
- Tag the release candidate
- Deploy the candidate to staging
- Hold for one business day of staging traffic
- Re-run the smoke test after the hold
- Promote the tag to production
- Watch error rates for the first hour
- Announce in the release channel

## After

- Close the milestone
- File follow-ups discovered during the hold

1. First retrospective item gets written down
2. Second item gets an owner
3. Third item gets a deadline
