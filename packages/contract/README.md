# @tachy/contract

What the browser and the server must agree on: the controlled vocabularies, the
relevance grades, the credential shapes, the export naming rules.

The SPA cannot import `@tachy/core` — core opens Postgres and reads the
filesystem on import. Before this package existed the shared rules were copied
into `packages/web` by hand and kept in step by comments, which is how
`validateCredential` and the admin panel came to disagree about what a valid
Anthropic key looks like.

**This package has no dependencies, and must never gain any.** No `zod`, no
`node:*`, no DOM, no `@tachy/core`. It is bundled into the SPA, so a dependency
here is a dependency the browser downloads, and a `node:` import here breaks the
web build. Everything in it is a constant, a type, or a pure function.

`@tachy/core` re-exports all of it, so server code keeps importing from
`@tachy/core` as before.
