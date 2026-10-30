// Minimal Capability Topology runtime — an ILLUSTRATIVE ADAPTATION (not the docs' .NET runtime).
// Demonstrates: per-module containers, imports applied after configure, startup refusal,
// mapped surface, ordered pipeline, returned refusals, location-transparent transport,
// topology from config, plugin hook. Zero dependencies. Run with Node >= 22.18 (type stripping).

// ---------- Result: refusals are values, never thrown (rule 15) ----------
export type Refusal = { code: string; message: string; retryable: boolean };
export type Result<T> = { ok: true; value: T } | { ok: false; error: Refusal };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const refuse = (code: string, message: string, retryable = false): Result<never> =>
  ({ ok: false, error: { code, message, retryable } });

// ---------- Contracts: named, typed, location-free ----------
export type RequestKind = "command" | "query";
export interface Request<TResult> {
  readonly type: string;             // stable contract name, e.g. "charges.apply"
  readonly __result?: TResult;       // phantom type for the result
}
export interface RequestDeclaration {
  type: string;
  kind: RequestKind;
  permission?: string;               // declared ON the request (governance)
  approvalScope?: string;            // family of decisions
}
export interface RequestContext {
  userId?: string;
  permissions: ReadonlySet<string>;
  tenant?: string;
  correlationId: string;             // identity/tenant/correlation — NO deployment facts
}

// ---------- Per-module container ----------
type Factory = (c: Container) => unknown;
export class Container {
  private factories = new Map<string, Factory>();
  private instances = new Map<string, unknown>();
  register(token: string, f: Factory) { this.factories.set(token, f); this.instances.delete(token); }
  has(token: string) { return this.factories.has(token); }
  resolve<T>(token: string): T {
    if (!this.instances.has(token)) {
      const f = this.factories.get(token);
      if (!f) throw new Error(`Unresolved service '${token}'`); // a bug, not a domain refusal
      this.instances.set(token, f(this));
    }
    return this.instances.get(token) as T;
  }
}

// ---------- Handlers, validators, behaviours ----------
export type Handler = (req: any, ctx: RequestContext) => Promise<Result<unknown>>;
export type Validator = (req: any) => Refusal | null;
export type Next = () => Promise<Result<unknown>>;
export type Behaviour = (req: any, ctx: RequestContext, decl: RequestDeclaration, next: Next) => Promise<Result<unknown>>;
export interface UnitOfWork { run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> }
const noopUnitOfWork: UnitOfWork = { run: (w) => w() }; // shape is the same with or without a store

// ---------- Module builder: the five declarations ----------
export class ModuleBuilder {
  readonly services = new Container();
  readonly requiredImports: string[] = [];
  readonly optionalImports: string[] = [];
  readonly exports: Array<(host: Container) => void> = [];
  readonly surface = new Map<string, RequestDeclaration>();
  readonly handlers = new Map<string, string>();       // request type -> handler token
  readonly validators = new Map<string, Validator[]>();
  readonly behaviours: Behaviour[] = [];               // registration order = nesting (first = outermost)
  readonly clientsNeeded: string[] = [];

  fromHostService(token: string) { this.requiredImports.push(token); return this; }
  fromHostServiceOptional(token: string) { this.optionalImports.push(token); return this; }
  contributeHostServices(fn: (host: Container) => void) { this.exports.push(fn); return this; }
  handle(decl: RequestDeclaration, handlerToken: string, mapped = true) {
    this.handlers.set(decl.type, handlerToken);
    if (mapped) this.surface.set(decl.type, decl);
    return this;
  }
  validate(type: string, v: Validator) {
    const list = this.validators.get(type) ?? []; list.push(v); this.validators.set(type, list); return this;
  }
  addBehaviour(b: Behaviour) { this.behaviours.push(b); return this; }
}

export interface Module {
  readonly name: string;                               // a value, not a type
  configure(b: ModuleBuilder): void;
  configurePlugins?: (b: ModuleBuilder) => void;       // declared plugin surface (optional)
}

// ---------- Composed module: owns container + pipeline ----------
class ComposedModule {
  readonly name: string; readonly b: ModuleBuilder;
  constructor(name: string, b: ModuleBuilder) { this.name = name; this.b = b; }

  // Pipeline order: resolve -> validate -> authorize -> behaviours[... gate] -> unit of work -> handler
  async dispatch(req: Request<unknown>, ctx: RequestContext): Promise<Result<unknown>> {
    const decl = this.b.surface.get(req.type);
    if (!decl) return refuse("boundary.undeclared", `Module '${this.name}' does not answer '${req.type}'`);
    const handler = this.b.services.resolve<Handler>(this.b.handlers.get(req.type)!);

    if (decl.kind === "query") {
      // Reads: resolve -> behaviours -> handler. NO permission check: restrict reads at the exposing edge.
      return this.chain(req, ctx, decl, () => handler(req, ctx));
    }
    for (const v of this.b.validators.get(req.type) ?? []) { const r = v(req); if (r) return { ok: false, error: r }; }
    if (decl.permission && !ctx.permissions.has(decl.permission))
      return refuse("auth.forbidden", `Missing permission '${decl.permission}'`);
    const uow = this.b.services.has("UnitOfWork") ? this.b.services.resolve<UnitOfWork>("UnitOfWork") : noopUnitOfWork;
    return this.chain(req, ctx, decl, () => uow.run(() => handler(req, ctx)));
  }

  private chain(req: any, ctx: RequestContext, decl: RequestDeclaration, inner: Next): Promise<Result<unknown>> {
    const run = (i: number): Promise<Result<unknown>> =>
      i === this.b.behaviours.length ? inner() : this.b.behaviours[i](req, ctx, decl, () => run(i + 1));
    return run(0);
  }
}

// ---------- Topology & transport (location transparency) ----------
export interface Topology { composed: Set<string>; addresses: Record<string, string[]> }
export interface Transport {
  send<T>(module: string, req: Request<T>, ctx: RequestContext): Promise<Result<T>>;
}

class TopologyTransport implements Transport {
  private rr = new Map<string, number>();
  private local: Map<string, ComposedModule>; private topology: Topology;
  constructor(local: Map<string, ComposedModule>, topology: Topology) { this.local = local; this.topology = topology; }
  async send<T>(module: string, req: Request<T>, ctx: RequestContext): Promise<Result<T>> {
    const target = this.local.get(module);
    if (target) return target.dispatch(req, ctx) as Promise<Result<T>>; // in-process: same object, no serialization
    const addrs = this.topology.addresses[module];
    if (!addrs?.length) return refuse("topology.missing", `No topology entry for module '${module}'`);
    const i = (this.rr.get(module) ?? 0) % addrs.length; this.rr.set(module, i + 1);
    try {
      const res = await fetch(addrs[i], {
        method: "POST", headers: { "content-type": "application/json", "x-correlation-id": ctx.correlationId },
        body: JSON.stringify({ request: req, ctx: { ...ctx, permissions: [...ctx.permissions] } }),
      });
      return (await res.json()) as Result<T>;        // refusals arrive as the same data shape
    } catch (e) {
      return refuse("transport.unavailable", String(e), true);
    }
  }
}

// ---------- Host: a list of modules + deployment choices ----------
export class ModuleHost {
  private entries: Array<{ module: Module; plugins?: (b: ModuleBuilder) => void }> = [];
  readonly hostServices = new Container();
  readonly name: string; private topology: Omit<Topology, "composed">;
  constructor(name: string, topology: Omit<Topology, "composed">) { this.name = name; this.topology = topology; }

  addModule(module: Module, plugins?: (b: ModuleBuilder) => void) { this.entries.push({ module, plugins }); return this; }

  build() {
    const local = new Map<string, ComposedModule>();
    const builders: Array<[Module, ModuleBuilder]> = [];
    // 1. modules configure themselves (plugins via the module's own hook, on the module's own builder)
    for (const { module, plugins } of this.entries) {
      const b = new ModuleBuilder();
      const m = plugins ? { ...module, configurePlugins: plugins } : module;
      m.configure(b);
      m.configurePlugins?.(b);
      b.exports.forEach((fn) => fn(this.hostServices));
      builders.push([module, b]);
    }
    // 2. imports applied AFTER configure: deployment displaces module defaults (rule 8)
    const missing: string[] = [];
    for (const [module, b] of builders) {
      for (const t of b.requiredImports) {
        if (!this.hostServices.has(t)) missing.push(`Module '${module.name}' requires host service '${t}', which this deployment does not register.`);
        else b.services.register(t, () => this.hostServices.resolve(t));
      }
      for (const t of b.optionalImports)
        if (this.hostServices.has(t)) b.services.register(t, () => this.hostServices.resolve(t));
      local.set(module.name, new ComposedModule(module.name, b));
    }
    if (missing.length) throw new Error("Host refused to start:\n" + missing.join("\n")); // rule 12
    const transport = new TopologyTransport(local, { composed: new Set(local.keys()), ...this.topology });
    for (const [, b] of builders) b.services.register("Transport", () => transport);
    return {
      transport,
      // endpoint body for /modules/{name}/execute — explicit opt-in (ExposesModuleTransport)
      async execute(moduleName: string, body: { request: Request<unknown>; ctx: any }) {
        const m = local.get(moduleName);
        if (!m) return refuse("boundary.wrong-host", `Module '${moduleName}' is not composed in this host`);
        return m.dispatch(body.request, { ...body.ctx, permissions: new Set(body.ctx.permissions) });
      },
    };
  }
}
