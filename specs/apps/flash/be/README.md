# flash-be Specifications

Behaviour scenarios for the `flash-be` API. Every scenario is bound at the unit layer. Scenarios that a layer cannot
prove carry an exemption tag, with the reason and the alternative proof written above the tag.

## Test Targets

| Target                             | Layer       | Binds                                           |
| ---------------------------------- | ----------- | ----------------------------------------------- |
| `npx nx test:unit flash-be`        | unit        | every scenario, no exemptions                   |
| `npx nx test:integration flash-be` | integration | every scenario not tagged `@integration-exempt` |
| `npx nx test:e2e flash-be-e2e`     | end-to-end  | every scenario not tagged `@e2e-exempt`         |

## Directory Map

- [behaviours/](behaviours/README.md) - the Gherkin corpus for the API.
