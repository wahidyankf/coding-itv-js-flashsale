# flash-web Specifications

Behaviour scenarios for the `flash-web` app. The same binding rules as the API apply: unit for every scenario,
integration and end-to-end for the scenarios their layer can prove.

## Test Targets

| Target                              | Layer       | Binds                                           |
| ----------------------------------- | ----------- | ----------------------------------------------- |
| `npx nx test:unit flash-web`        | unit        | every scenario, no exemptions                   |
| `npx nx test:integration flash-web` | integration | every scenario not tagged `@integration-exempt` |
| `npx nx test:e2e flash-web-e2e`     | end-to-end  | every scenario not tagged `@e2e-exempt`         |

## Directory Map

- [behaviours/](behaviours/README.md) - the Gherkin corpus for the web app.
