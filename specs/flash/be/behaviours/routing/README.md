# Routing

Scenarios for requests the API cannot serve: paths it has no route for and bodies it cannot read.

## Directory Map

- [unknown-routes.feature](unknown-routes.feature) - a path with no route gets a 404, and a body the API cannot read is refused with a named error.
