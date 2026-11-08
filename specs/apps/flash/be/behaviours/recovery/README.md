# Recovery

Scenarios for getting Redis back in line with Postgres after Redis loses its state.

## Directory Map

- [rebuild.feature](rebuild.feature) - the reservation state is rebuilt from Postgres, so a lost Redis never frees a held item or lets a buyer hold again, and a reserve that waits too long for another instance's rebuild is refused.
