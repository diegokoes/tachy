/**
 * The contract, re-exported wholesale, and nothing else. A domain is imported
 * from its own subpath (`@tachy/core/knowledge`), so a file's imports say which
 * domains it depends on.
 *
 * packages/api and the CLI reach the contract only through here, so anything
 * the contract owns but core does not pass on is a rule they have to write out
 * by hand - which is how two copies of it come to exist and drift.
 * test/contract/contract-reach.test.ts holds this complete.
 */
export * from "@tachy/contract";
