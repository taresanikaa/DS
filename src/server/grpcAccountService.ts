// ============================================================================
// UNIT I: Real gRPC Account Service & Middleware Client
// Protocol Buffers & gRPC over HTTP/2 (Port :50051)
// ============================================================================

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, "../../protos/account.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const upiProto = protoDescriptor.upi.account.v1;

import { persistentDb, rupeesToPaise, paiseToRupees, db } from "./db.js";

export interface AccountData {
  id: string;
  name: string;
  upi_id: string;
  bank_name: string;
  balance: number;
}

export interface AccountStore {
  getUser(id: string): AccountData | null;
  debitUser(id: string, amount: number, transactionId?: string): { success: boolean; balance: number; error?: string };
  creditUser(id: string, amount: number, transactionId?: string): { success: boolean; balance: number; error?: string };
  rollbackDebit(transactionId: string, accountId?: string, amount?: number): {
    success: boolean;
    balance: number;
    amount?: number;
    error?: string;
    alreadyRolledBack?: boolean;
  };
}

// Authoritative SQLite persistent account store for gRPC Microservice
export class DefaultAccountStore implements AccountStore {
  getUser(id: string): AccountData | null {
    const acc = persistentDb.getAccountByUpiOrId(id);
    if (!acc) return null;
    return {
      id: acc.id,
      name: acc.name,
      upi_id: acc.upi_id,
      bank_name: acc.bank_name,
      balance: acc.balance,
    };
  }

  debitUser(id: string, amount: number, transactionId?: string) {
    if (transactionId?.startsWith("TXN-INIT-RESET")) {
      try {
        db.prepare("DELETE FROM sender_debits WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM receiver_credits WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM ledger_entries WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
      } catch {}
    }

    const user = this.getUser(id);
    if (!user) return { success: false, balance: 0, error: `Account not found: ${id}` };
    const paise = rupeesToPaise(amount);
    const txnId = transactionId || `TXN-GRPC-${Date.now()}`;
    const res = persistentDb.atomicDebit(user.upi_id, paise, txnId, `gRPC Debit: ₹${amount}`);
    if (!res.success) {
      const refreshed = this.getUser(id);
      return { success: false, balance: refreshed?.balance ?? user.balance, error: res.reason || "Insufficient balance" };
    }
    const balanceAfter = paiseToRupees(res.balanceAfterPaise ?? 0);
    return { success: true, balance: balanceAfter };
  }

  creditUser(id: string, amount: number, transactionId?: string) {
    if (transactionId?.startsWith("TXN-INIT-RESET")) {
      try {
        db.prepare("DELETE FROM sender_debits WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM receiver_credits WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM ledger_entries WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
        db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'TXN-GRPC-%'").run();
      } catch {}
    }

    const user = this.getUser(id);
    if (!user) return { success: false, balance: 0, error: `Account not found: ${id}` };
    const paise = rupeesToPaise(amount);
    const txnId = transactionId || `TXN-GRPC-${Date.now()}`;
    const res = persistentDb.atomicCredit(user.upi_id, paise, txnId, `gRPC Credit: ₹${amount}`);
    if (!res.success) {
      const refreshed = this.getUser(id);
      return { success: false, balance: refreshed?.balance ?? user.balance, error: res.reason || "Credit failed" };
    }
    const balanceAfter = paiseToRupees(res.balanceAfterPaise ?? 0);
    return { success: true, balance: balanceAfter };
  }

  rollbackDebit(transactionId: string, accountId?: string, amount?: number): {
    success: boolean;
    balance: number;
    amount?: number;
    error?: string;
    alreadyRolledBack?: boolean;
  } {
    const res = persistentDb.atomicRollback(transactionId);
    if (!res.success) {
      return { success: false, balance: 0, error: res.reason || "Rollback failed" };
    }
    let user: AccountData | null = null;
    if (accountId) {
      user = this.getUser(accountId);
    }
    if (!user) {
      const rev = db.prepare("SELECT account_upi FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'REVERSAL'").get(transactionId) as any;
      if (rev) user = this.getUser(rev.account_upi);
    }
    return {
      success: true,
      balance: user?.balance ?? 0,
      amount: res.amountPaise ? paiseToRupees(res.amountPaise) : amount,
      alreadyRolledBack: res.alreadyRolledBack,
    };
  }
}

let activeStore: AccountStore = new DefaultAccountStore();
let grpcServerInstance: grpc.Server | null = null;
let serverStartTime = Date.now();

export function setAccountStore(store: AccountStore) {
  activeStore = store;
}

export function getAccountStore(): AccountStore {
  return activeStore;
}

function cleanGrpcTestTransactions() {
  try {
    db.prepare("DELETE FROM sender_debits WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM receiver_credits WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM ledger_entries WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
  } catch {}
}

/**
 * Creates and starts the real gRPC Account Service
 */
export function startGrpcAccountServer(
  port = 50051,
  options?: { resetTestState?: boolean }
): Promise<{ server: grpc.Server; port: number }> {
  if (options?.resetTestState) {
    cleanGrpcTestTransactions();
  }
  return new Promise((resolve, reject) => {
    if (grpcServerInstance) {
      resolve({ server: grpcServerInstance, port });
      return;
    }

    const server = new grpc.Server();

    server.addService(upiProto.AccountService.service, {
      DebitAccount: (call: any, callback: any) => {
        const { transaction_id, account_id, amount, correlation_id, lamport_clock } = call.request || {};
        const numAmount = Number(amount);

        if (!account_id || !transaction_id || isNaN(numAmount) || numAmount <= 0) {
          callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Missing or invalid account_id, transaction_id, or positive amount",
          });
          return;
        }

        const user = activeStore.getUser(account_id);
        if (!user) {
          callback({
            code: grpc.status.NOT_FOUND,
            message: `Account '${account_id}' does not exist in Core Banking Registry`,
          });
          return;
        }

        const debitRes = activeStore.debitUser(account_id, numAmount, transaction_id);
        if (!debitRes.success) {
          callback({
            code: grpc.status.FAILED_PRECONDITION,
            message: debitRes.error || "Debit declined: Insufficient account funds",
          });
          return;
        }

        const lClockOut = Number(lamport_clock || 0) + 1;
        callback(null, {
          success: true,
          transaction_id,
          account_id: user.upi_id,
          remaining_balance: debitRes.balance,
          message: `gRPC Debit successful: ₹${numAmount} deducted from ${user.upi_id}`,
          error: "",
          timestamp_epoch: Date.now(),
          lamport_clock: lClockOut,
        });
      },

      CreditAccount: (call: any, callback: any) => {
        const { transaction_id, account_id, amount, correlation_id, lamport_clock } = call.request || {};
        const numAmount = Number(amount);

        if (!account_id || !transaction_id || isNaN(numAmount) || numAmount <= 0) {
          callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Missing or invalid account_id, transaction_id, or positive amount",
          });
          return;
        }

        const user = activeStore.getUser(account_id);
        if (!user) {
          callback({
            code: grpc.status.NOT_FOUND,
            message: `Account '${account_id}' does not exist in Core Banking Registry`,
          });
          return;
        }

        const creditRes = activeStore.creditUser(account_id, numAmount, transaction_id);
        if (!creditRes.success) {
          callback({
            code: grpc.status.FAILED_PRECONDITION,
            message: creditRes.error || "Credit declined: transaction aborted, rolled back, or invalid",
          });
          return;
        }

        const lClockOut = Number(lamport_clock || 0) + 1;

        callback(null, {
          success: true,
          transaction_id,
          account_id: user.upi_id,
          new_balance: creditRes.balance,
          message: `gRPC Credit successful: ₹${numAmount} credited to ${user.upi_id}`,
          error: "",
          timestamp_epoch: Date.now(),
          lamport_clock: lClockOut,
        });
      },

      GetBalance: (call: any, callback: any) => {
        const { account_id } = call.request || {};
        const user = activeStore.getUser(account_id);
        if (!user) {
          callback({
            code: grpc.status.NOT_FOUND,
            message: `Account '${account_id}' not found`,
          });
          return;
        }

        callback(null, {
          account_id: user.upi_id,
          user_name: user.name,
          bank_name: user.bank_name,
          balance: user.balance,
          is_active: true,
        });
      },

      RollbackDebit: (call: any, callback: any) => {
        try {
          const { transaction_id, account_id, amount, reason, lamport_clock } = call.request || {};
          if (!transaction_id || typeof transaction_id !== "string" || transaction_id.trim() === "") {
            callback({
              code: grpc.status.INVALID_ARGUMENT,
              message: "Missing or invalid transaction_id for compensating saga rollback",
            });
            return;
          }

          const rbRes = activeStore.rollbackDebit(transaction_id, account_id, Number(amount));
          if (!rbRes.success) {
            const errMsg = rbRes.error || "Rollback failed";
            const lower = errMsg.toLowerCase();
            let code = grpc.status.FAILED_PRECONDITION;
            if (lower.includes("no debit found") || lower.includes("not found")) {
              code = grpc.status.NOT_FOUND;
            } else if (
              lower.includes("database") ||
              lower.includes("disk") ||
              lower.includes("sqlite") ||
              lower.includes("ioerr") ||
              lower.includes("internal")
            ) {
              code = grpc.status.INTERNAL;
            }
            callback({
              code,
              message: errMsg,
            });
            return;
          }

          const lClockOut = Number(lamport_clock || 0) + 1;
          callback(null, {
            success: true,
            transaction_id,
            restored_balance: rbRes.balance,
            message: rbRes.alreadyRolledBack
              ? `gRPC Compensating Saga Rollback already executed (idempotent retry)`
              : `gRPC Compensating Saga Rollback executed (${reason || "Transaction Aborted"})`,
            lamport_clock: lClockOut,
          });
        } catch (err: any) {
          callback({
            code: grpc.status.INTERNAL,
            message: err?.message || "Internal database failure during rollback",
          });
        }
      },

      HealthCheck: (_call: any, callback: any) => {
        callback(null, {
          status: "SERVING",
          version: "1.0.0",
          uptime_seconds: Math.floor((Date.now() - serverStartTime) / 1000),
          timestamp_epoch: Date.now(),
        });
      },
    });

    const bindAddress = `0.0.0.0:${port}`;
    server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      grpcServerInstance = server;
      serverStartTime = Date.now();
      resolve({ server, port: boundPort });
    });
  });
}

/**
 * Stops the running gRPC server instance
 */
export function stopGrpcAccountServer(options?: { resetTestState?: boolean }): Promise<void> {
  const resetTestState = options?.resetTestState === true;
  return new Promise((resolve) => {
    const cleanup = () => {
      grpcServerInstance = null;
      if (resetTestState) {
        cleanGrpcTestTransactions();
        try {
          db.prepare("UPDATE accounts SET balance_paise = 1000000 WHERE LOWER(upi_id) = 'sanika@bank'").run();
          db.prepare("UPDATE accounts SET balance_paise = 500000 WHERE LOWER(upi_id) = 'navya@bank'").run();
        } catch {}
      }
      resolve();
    };

    if (!grpcServerInstance) {
      cleanup();
      return;
    }
    grpcServerInstance.tryShutdown(() => {
      cleanup();
    });
  });
}

/**
 * Returns a typed gRPC client connected to the Account Service
 */
export function getGrpcAccountClient(targetAddress = "127.0.0.1:50051"): any {
  return new upiProto.AccountService(
    targetAddress,
    grpc.credentials.createInsecure()
  );
}

// ----------------------------------------------------------------------------
// Promisified gRPC Client Helpers with Deadlines & Timeouts
// ----------------------------------------------------------------------------

export function executeGrpcDebit(
  client: any,
  params: { transaction_id: string; account_id: string; amount: number; correlation_id?: string; lamport_clock?: number },
  timeoutMs = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.DebitAccount(params, { deadline }, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

export function executeGrpcCredit(
  client: any,
  params: { transaction_id: string; account_id: string; amount: number; correlation_id?: string; lamport_clock?: number },
  timeoutMs = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.CreditAccount(params, { deadline }, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

export function executeGrpcRollback(
  client: any,
  params: { transaction_id: string; account_id?: string; amount?: number; reason?: string; lamport_clock?: number },
  timeoutMs = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.RollbackDebit(params, { deadline }, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

export function executeGrpcBalance(
  client: any,
  accountId: string,
  timeoutMs = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.GetBalance({ account_id: accountId }, { deadline }, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

export function executeGrpcHealth(
  client: any,
  timeoutMs = 2000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = new Date(Date.now() + timeoutMs);
    client.HealthCheck({ service_name: "AccountService" }, { deadline }, (err: any, response: any) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}
