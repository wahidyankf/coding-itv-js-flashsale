# Recovery

Scenarios for getting Redis back in line with Postgres after Redis loses its state.

## Directory Map

- [rebuild.feature](rebuild.feature) - the reservation state is rebuilt from Postgres, so a lost Redis never frees a held item.
