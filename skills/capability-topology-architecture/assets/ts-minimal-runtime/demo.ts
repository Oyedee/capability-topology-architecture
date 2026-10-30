// Demo: the same modules run as one host, then split into two hosts — no module code changes.
// Run: node demo.ts   (Node >= 22.18)
import { createServer } from "node:http";
import {
  ModuleHost, ok, refuse,
  type Module, type Request, type RequestContext, type Result, type Transport, type Behaviour,
} from "./runtime.ts";

// ===================== Charges module (contract package + internals) =====================
// --- public contract ---
export interface ApplyCharge extends Request<{ fee: number }> { type: "charges.apply"; paymentId: string; amount: number }
export const ChargesClient = (t: Transport) => ({
  apply: (paymentId: string, amount: number, ctx: RequestContext) =>
    t.send<{ fee: number }>("Charges", { type: "charges.apply", paymentId, amount } as ApplyCharge, ctx),
});
// --- internal: operation seam (one interface per use case) ---
interface ApplyChargeOperation { apply(paymentId: string, amount: number): Promise<Result<{ fee: number }>> }
const applied = new Map<string, number>(); // module-owned store (in-memory default)
const ChargesModule: Module = {
  name: "Charges",
  configure(b) {
    b.services.register("ApplyChargeOperation", (): ApplyChargeOperation => ({
      async apply(paymentId, amount) {
        if (applied.has(paymentId)) return ok({ fee: applied.get(paymentId)! }); // idempotent: own already-done check
        const fee = Math.min(Math.round(amount * 0.015), 2000);
        applied.set(paymentId, fee);
        return ok({ fee });
      },
    }));
    b.services.register("ApplyChargeHandler", (c) => {
      const op = c.resolve<ApplyChargeOperation>("ApplyChargeOperation"); // exactly one dependency
      return (req: ApplyCharge) => op.apply(req.paymentId, req.amount);
    });
    b.validate("charges.apply", (r: ApplyCharge) => (r.amount > 0 ? null : { code: "charges.invalid-amount", message: "Amount must be positive", retryable: false }));
    b.handle({ type: "charges.apply", kind: "command", permission: "charges.apply" }, "ApplyChargeHandler");
  },
};

// ===================== Bills Payment module (has a plugin surface) =====================
interface PayBill extends Request<{ reference: string; fee: number }> { type: "bills.pay"; paymentId: string; billerKey: string; amount: number }
interface Biller { key: string; pay(amount: number): Promise<Result<{ reference: string }>> }

// Approval gate as the innermost behaviour (simplified: holds above threshold)
const approvalGate: Behaviour = async (req, ctx, decl, next) =>
  decl.approvalScope && req.amount > 500_000 && !ctx.permissions.has("approved:" + req.paymentId)
    ? refuse("governance.awaiting-approval", `Held for scope '${decl.approvalScope}'`, true)
    : next();

const BillsPaymentModule: Module = {
  name: "BillsPayment",
  configure(b) {
    b.fromHostService("SecretsProvider");             // required import
    b.addBehaviour(approvalGate);
    b.services.register("PayBillHandler", (c) => {
      // the operation for this use case (inlined for brevity) — reaches Charges via typed client, no address
      const charges = ChargesClient(c.resolve<Transport>("Transport"));
      const billers = (): Biller[] => (c.has("Billers") ? c.resolve<Biller[]>("Billers") : []); // NO default connector
      return async (req: PayBill, ctx: RequestContext) => {
        const biller = billers().find((x) => x.key === req.billerKey);
        if (!biller) return refuse("bills.biller-not-installed", `No connector for '${req.billerKey}'`);
        const fee = await charges.apply(req.paymentId, req.amount, ctx);   // step: invoke neighbour (commits on its own)
        if (!fee.ok) return fee;                                           // refusal crosses unchanged
        const paid = await biller.pay(req.amount);
        if (!paid.ok) return paid;                                         // (reconciler would handle fee-without-payment)
        return ok({ reference: paid.value.reference, fee: fee.value.fee });
      };
    });
    b.handle({ type: "bills.pay", kind: "command", permission: "bills.pay", approvalScope: "payments.release-above-limit" }, "PayBillHandler");
  },
};

// ===================== Plugins (connectors) — chosen by the deployment =====================
const addAirtimeConnectors = (b: any) => {
  b.fromHostService("AirtimeApiKey");                 // what installing it costs the deployment
  b.services.register("Billers", (): Biller[] => [{ key: "mtn-airtime", pay: async () => ok({ reference: "AIR-001" }) }]);
};

// ===================== Run =====================
const ctx: RequestContext = { userId: "u1", permissions: new Set(["bills.pay", "charges.apply"]), correlationId: "c-1" };
const pay = (t: Transport, id: string, amount: number) =>
  t.send("BillsPayment", { type: "bills.pay", paymentId: id, billerKey: "mtn-airtime", amount } as PayBill, ctx);

function withSecrets(h: ModuleHost) {
  h.hostServices.register("SecretsProvider", () => ({}));
  h.hostServices.register("AirtimeApiKey", () => "k");
  return h;
}

// 1) Missing required import → refused at startup, naming module + service
try {
  new ModuleHost("broken", { addresses: {} }).addModule(BillsPaymentModule, addAirtimeConnectors).build();
} catch (e) { console.log("1. startup refusal →", (e as Error).message.split("\n")[1]); }

// 2) One host (monolith): Charges resolves in-process
const mono = withSecrets(new ModuleHost("payments-api", { addresses: {} }))
  .addModule(BillsPaymentModule, addAirtimeConnectors).addModule(ChargesModule).build();
console.log("2. monolith        →", JSON.stringify(await pay(mono.transport, "p1", 10_000)));
console.log("   held for approval →", JSON.stringify(await pay(mono.transport, "p2", 900_000)));
console.log("   validation refusal →", JSON.stringify(await mono.transport.send("Charges", { type: "charges.apply", paymentId: "x", amount: -1 } as ApplyCharge, ctx)));

// 3) Split: Charges in its own host; payments host gets only an address. Module code unchanged.
const chargesHost = new ModuleHost("charges-api", { addresses: {} }).addModule(ChargesModule).build();
const server = createServer(async (rq, rs) => {
  let body = ""; for await (const ch of rq) body += ch;
  const name = rq.url!.split("/")[2];               // /modules/{name}/execute
  rs.setHeader("content-type", "application/json");
  rs.end(JSON.stringify(await chargesHost.execute(name, JSON.parse(body))));
}).listen(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as any).port;
const split = withSecrets(new ModuleHost("payments-api", {
  addresses: { Charges: [`http://127.0.0.1:${port}/modules/Charges/execute`] },   // topology = config
})).addModule(BillsPaymentModule, addAirtimeConnectors).build();
console.log("3. split over HTTP →", JSON.stringify(await pay(split.transport, "p3", 10_000)));
console.log("   remote refusal  →", JSON.stringify(await split.transport.send("Charges", { type: "charges.apply", paymentId: "y", amount: -5 } as ApplyCharge, ctx)));

// 4) Same module, no connector family installed → explicit refusal, not a silent default
const noPlugins = withSecrets(new ModuleHost("bare", { addresses: {} })).addModule(BillsPaymentModule).addModule(ChargesModule).build();
console.log("4. no plugin       →", JSON.stringify(await pay(noPlugins.transport, "p4", 1_000)));
server.close();
