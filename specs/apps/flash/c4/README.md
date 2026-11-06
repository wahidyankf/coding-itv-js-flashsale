# C4 model

The as-built C4 model of the flash sale product. It describes the system that runs today, not a proposal. A design
that is not built yet belongs in a plan, not here.

Read the views in order: the system context, the containers, the components of the API, then the sequences. Each view
is Mermaid, and every relationship it draws is also stated in prose in the same file.

## Directory Map

- [context.md](context.md) - C4 level 1: the people and the system around the flash sale product.
- [containers.md](containers.md) - C4 level 2: the deployable units, their data stores, and the constraints between them.
- [components.md](components.md) - C4 level 3: the parts of `flash-be`, their stores, and the ports between them.
- [sequences.md](sequences.md) - the order of calls for reserving and paying, for a hold that ends during payment, and for a Redis outage.
