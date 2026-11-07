# Documentation

This folder helps you use, change, and understand the flash sale project. It follows the
[Diátaxis](https://diataxis.fr/) model: each page does one job, and the four jobs sit in four folders.

## Where to start

Pick the path that matches what you want to do now. Each step links the next one, so you never need the whole folder.

```mermaid
flowchart LR
  accTitle: Reading paths through the docs
  accDescr: A newcomer runs the tutorial, then reads the crash courses for the tools they will touch, then the explanation pages. Someone who wants to change the code starts at the code map, follows a how-to guide, and looks facts up in the reference. Someone who reviews the design reads the design choices in the root README, then the decision records. All three paths end in the specs, which win when a page disagrees with them.
  new["New to the project"]
  change["Changing the code"]
  review["Reviewing the design"]
  tutorial["Tutorial: run it locally"]
  courses["Crash courses"]
  explain["Explanation"]
  map["Code map"]
  howto["How-to guides"]
  ref["Reference"]
  choices["Design choices<br/>in the root README"]
  adr["Decision records"]
  specs["Specs"]
  new --> tutorial --> courses --> explain
  change --> map --> howto --> ref
  review --> choices --> adr
  explain --> specs
  ref --> specs
  adr --> specs
  classDef start fill:#0173B2,stroke:#000000,color:#FFFFFF
  classDef page fill:#029E73,stroke:#000000,color:#000000
  classDef truth fill:#DE8F05,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class new,change,review start
  class tutorial,courses,explain,map,howto,ref,choices,adr page
  class specs truth
```

Reviewing the design? Read the [design choices and trade-offs](../README.md#design-choices-and-trade-offs) in the root
README, then the [decision records](explanation/decisions/README.md).

## Directory Map

- [tutorials/](tutorials/README.md) - learn by doing: run the project from a fresh clone, then one crash course per tool
  and pattern in the stack.
- [how-to/](how-to/README.md) - solve one task: short guides for people who already know the basics.
- [reference/](reference/README.md) - look up facts: endpoints, test layers, the load test, retry policies and where code
  lives.
- [explanation/](explanation/README.md) - understand why: how each part works, and the decision records behind it.

## Specs win

The behaviour and architecture of the product are in [specs/](../specs/README.md). The Gherkin scenarios there are
the canonical statement of what the system must do. If a page here disagrees with a spec, the spec is right and the
page is a bug.

Contributor rules are in [AGENTS.md](../AGENTS.md), not here.
