# Deployment Topology: <system / customer / environment>

## Hosts
| Host | Composes (modules + plugin families) | Publishes events | Runs jobs (schedule store) | Exposes module transport | Why this grouping (evidence) |
|---|---|---|---|---|---|
| payments-api | BillsPayment[electricity, water], BankTransfer, Charges, TransactionLimits, Approvals | yes | yes (Payments) | no | quiet rails share; shared rules composed, not called |
| mobile-money-api | MobileMoney[wallet-a, wallet-b], Charges, TransactionLimits, Approvals | yes | no | no | afternoon peak; separate release cadence |

## Address book (one entry per module a host does NOT compose)
```json
{
  "Services": {
    "<Module>": { "https": { "0": "https://<host>.internal:8443/modules/<Module>/execute" } }
  }
}
```
Checklist on every topology change:
- [ ] Every module that any composed module calls is either composed or has an address (missing entries fail at first call, not startup)
- [ ] Hosts serving remote callers call `ExposesModuleTransport` (or equivalent)
- [ ] Exactly the intended hosts run jobs; all name the same schedule store
- [ ] Cross-host contracts changed only additively since last release (or a second contract added)
- [ ] Chatty call patterns reviewed for modules moving apart (no per-row remote calls in loops)
- [ ] Receiving requests on new remote paths are idempotent

## Alternative shapes from the same build
- Monolith (dev / on-prem / single tenant): all modules in one host, no address book.
- Fully split: one module per host.
