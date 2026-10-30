# Building Modules, Plugins and Hosts

Source: "Building on it" (define a module, compose plugins, deploy it). Code below is the docs' **.NET reference implementation**, reproduced so you can mirror its shape in any language. The architecture is language-neutral; for other stacks see `language-patterns.md`.

## Contents
1. A module is five declarations
2. Contracts
3. Handlers and the operation seam
4. Imports / exports
5. Mapped surface
6. A whole module
7. Calling another module
8. Plugin surfaces and connectors
9. Hosts and topology config
10. Moving a module out

---

## 1. Five declarations

1. **Name** — identity other modules and topology address it by. A *value*, not a type.
2. **Contracts** — requests it answers + results.
3. **Handlers** — one per request, resolved from the module's own container.
4. **Imports** — what the deployment must supply (required/optional).
5. **Surface** — which requests are callable from outside.

None mentions a host, machine, or product. If a module's definition needs those, it isn't a module.

```csharp
public sealed class BillsPaymentModule : IModule
{
    public ModuleName Name => ModuleName.BillsPayment;
    public void Configure(IModuleBuilder builder) { /* 2 – 5 go here */ }
}
```

## 2. Contracts

Live **beside the code that answers them**, not in a shared contracts project. Public list is short: requests, results, the module declaration, the typed client. Handlers, operations, storage and domain types are internal.

```csharp
public sealed record RegisterBillerCommand(string Name, string ExternalSystemKey)
    : ICommand<RegisterBillerResponse>, IRequiresPermission
{
    public static string RequiredPermission => "bills.billers.register";
}

public sealed record RegisterBillerResponse(Guid BillerId, string Name, string ExternalSystemKey);
```

Permission (and approval scope, if needed) is declared **on the request**, so every entry point — endpoint, job, consumer — inherits the same check.

## 3. Handlers and the operation seam

```csharp
internal interface IRegisterBillerOperation
{
    IOperation<Result<RegisterBillerResponse>> Register(
        string name, string externalSystemKey, IRequestContext context);
}

internal sealed class RegisterBillerHandler(IRegisterBillerOperation operation)
    : ICommandHandler<RegisterBillerCommand, RegisterBillerResponse>
{
    public ValueTask<Result<RegisterBillerResponse>> HandleAsync(
        RegisterBillerCommand command, IRequestContext context)
        => operation.Register(command.Name, command.ExternalSystemKey, context)
            .ExecuteAsync(context.Current.CancellationToken);
}
```

- Handler and operation interface are `internal`; implementation lives with storage/outbound calls.
- One folder per use case: request, result, operation interface, handler (+ tests). Deleting a use case leaves nothing behind.
- **Failures are returned, not thrown**: `Result` carries a value or an error with a **stable code** and a **retryable flag**. Domain refusals cross boundaries unchanged whether local or remote.

## 4. Imports / exports

```csharp
builder.FromHostService<ISecretsProvider>();          // required: no deployment, no module
builder.FromHostServiceOptional<IApprovalStore>();    // the module can run without one
builder.ContributeHostServices(host => host.AddSettlementSchedule());  // export: module → host
```

Startup refusal message shape (both names are load-bearing):
```
Module 'BillsPayment' requires host service 'ISecretsProvider',
which this deployment does not register.
```

Imports apply **after** `Configure` → deployment displaces local defaults. Register a stand-in as the module default for tests; don't branch.

Export is rare: a host-wide subsystem the module owns (approvals store, a schedule the deployment may choose to run). Never for publishing the module's data.

## 5. Mapped surface

```csharp
builder
    .MapCommand<RegisterBillerCommand, RegisterBillerResponse>()
    .MapQuery<GetBillerQuery, BillerResponse>();
```

The whole of the outside surface; the register the transport reads (mapping makes it reachable — it's not documentation). Unmapped requests are refused by name, identically over network or in-process. Short on purpose: many internal operations, a handful mapped.

## 6. A whole module

```csharp
public sealed class ApprovalsModule : IModule
{
    public ModuleName Name => ModuleName.Approvals;

    public void Configure(IModuleBuilder builder)
    {
        builder.ContributeHostServices(host => host.AddApprovalStore());

        builder
            .AddOperations()
            .AddHandlers(Assemblies)
            .AddDefaultCommandPipeline()
            .MapCommand<DecideApprovalCommand>()
            .MapCommand<WithdrawApprovalCommand>()
            .MapQuery<GetPendingApprovalsQuery, IReadOnlyList<PendingApprovalView>>();

        builder.FromHostService<IApprovalStore>();

        builder.Services.AddScoped<IDecideApprovalOperation, DecideApprovalOperation>();
        builder.Services.AddScoped<IGetPendingApprovalsOperation, GetPendingApprovalsOperation>();
    }
}
```

`AddDefaultCommandPipeline` installs validators, authorizers, behaviours, unit of work. Modules install the pipeline; they don't write one.

## 7. Calling another module

```csharp
internal sealed class ChargesModuleClient(ITransportClient transport) : IChargesModuleClient
{
    public ValueTask<Result<ChargeResponse>> ApplyAsync(Guid paymentId, decimal amount, IRequestContext context)
        => transport.SendCommandAsync(ModuleName.Charges, new ApplyChargeCommand(paymentId, amount), context);
}
```

- Client ships **in the neighbour's contract package** → caller depends on what Charges publishes, never how it's built.
- The calling module installs the client itself: `builder.FromChargesModuleClient();` — hosts don't have to remember which clients their module list implies.
- Cross-module call inside an ambient transaction is refused.
- Write the four steps: check locally → invoke neighbour (commits on its own) → commit locally → reconcile if that fails.

## 8. Plugin surfaces and connectors

Declare the surface:
```csharp
public sealed class BillsPaymentModule : IModule, ISupportsPlugins
{
    public ModuleName Name => ModuleName.BillsPayment;
    public Action<IModuleBuilder>? ConfigurePlugins { get; init; }

    public void Configure(IModuleBuilder builder)
    {
        // ... the module's own registrations: handlers, operations, its store
        ConfigurePlugins?.Invoke(builder);
    }
}
```

The hook gets **the module's own builder** (same container, same configuration step). **Where the hook line sits decides what a plugin may displace**: registrations after the hook win over the plugin. Hook last → plugins can replace module defaults; hook mid-way with registrations after → they can't. Choose deliberately. Host imports land on top of both (rule 8).

A connector = one external system, registering the module-facing interface:
```csharp
extension(IModuleBuilder builder)
{
    public IModuleBuilder AddElectricityBillerConnector()
    {
        builder.FromHostService<IElectricityBillerApi>();
        builder.FromHostService<ElectricityBillerOptions>();

        builder.Services.AddSingleton<IBiller, ElectricityBillerConnector>();
        builder.Services.AddSingleton<IWebhookSignatureVerifier, ElectricityBillerSignatureVerifier>();
        return builder;
    }
}
```
`FromHostService` lines = what installing the plugin costs the deployment (SDK client, credentials) — checked at startup. `AddSingleton` lines = satisfying the module's interfaces. The module knows `IBiller`, not electricity.

Deployment chooses:
```csharp
var app = ModuleHost
    .Create(args, "airtime-api")
    .AddModule<BillsPaymentModule>(plugins => plugins
        .AddAirtimeBillerConnector())
    .Build();
```
vs
```csharp
    .AddModule<BillsPaymentModule>(plugins => plugins
        .AddElectricityBillerConnector()
        .AddWaterBillerConnector()
        .AddCableTvBillerConnector())
```

Module must **not**:
- Name/probe/count which plugin family is installed (by key, capability probe, or registration count).
- Register a fallback connector (looks like it works, reaches nothing). No connector → refuse.
- Put shared behaviour in the plugin (retry policy, sent/received audit, vocabulary mapping belong in the module). A second connector that starts as a copy of the first = something common leaked outward.

Leak progression: a convenience list of named external systems inside the module → something branches on one (which evidence to accept; a vendor-specific limit). Fix: the name belongs to the connector; the limit belongs to deployment config.

## 9. Hosts

```csharp
var app = ModuleHost
    .Create(args, "payments-api")
    .AddModule<BillsPaymentModule>(plugins => plugins
        .AddElectricityBillerConnector()
        .AddWaterBillerConnector())
    .AddModule<BankTransferModule>()
    .AddModule<ChargesModule>()
    .AddModule<TransactionLimitsModule>()
    .AddModule<ApprovalsModule>()
    .PublishesIntegrationEvents()
    .RunsScheduledJobs("Payments")
    .Build();

await app.RunAsync();
```

Builder installs dispatch, isolation, routing, pipeline, auth, health, telemetry. Call order in the file doesn't change application order (steps recorded, run in builder's sequence).

The three non-module decisions:
- `PublishesIntegrationEvents()` — on the bus; **throws outside development** if storage/broker connection absent (a host that thinks it publishes but doesn't looks healthy while neighbours go deaf).
- `RunsScheduledJobs("Payments")` — this host owns the clock; all such hosts must name the same store.
- **Approvals is a module in the list**; hosts with no gated act decline it by name so omission is visibly deliberate.

## 10. Moving a module out (Charges)

New host:
```csharp
var app = ModuleHost
    .Create(args, "charges-api")
    .AddModule<ChargesModule>()
    .PublishesIntegrationEvents()
    .ExposesModuleTransport()   // opens /modules/{name}/execute — explicit decision
    .Build();
```
Old host drops `ChargesModule` from its list, and gets config:
```json
{
  "Services": {
    "Charges": {
      "https": { "0": "https://charges-api.internal:8443/modules/Charges/execute" }
    }
  }
}
```
One entry per non-composed module, keyed by module name; scheme picks transport; multiple addresses = multiple instances.

Call site unchanged:
```csharp
transport.SendCommandAsync(ModuleName.Charges, new ApplyChargeCommand(paymentId, amount), context);
```

Three bites: chatty patterns get expensive; half-success → receiving request must be idempotent (check before the move); missing topology entry raises `Module topology was not found for module 'Charges'` at **first call** as an exception (not a returned refusal) — check the address book by hand on move day. (A better runtime would validate reachable-vs-called modules at startup.)
