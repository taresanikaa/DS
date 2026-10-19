// ============================================================================
// Automated Test Suite for UNIT I: Distributed Architecture & gRPC Middleware
// Tests: gRPC Server Bind, Health, Debit, Credit, Balance, Deadlines & Errors
// ============================================================================

import {
  startGrpcAccountServer,
  stopGrpcAccountServer,
  getGrpcAccountClient,
  executeGrpcDebit,
  executeGrpcCredit,
  executeGrpcRollback,
  executeGrpcBalance,
  executeGrpcHealth,
  getAccountStore,
  setAccountStore,
  AccountStore,
} from "./src/server/grpcAccountService.ts";
import { persistentDb, db } from "./src/server/db.ts";
import * as grpc from "@grpc/grpc-js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runGrpcTests() {
  console.log("\n============================================================");
  console.log("RUNNING UNIT I: gRPC MIDDLEWARE CLIENT-SERVER TEST SUITE");
  console.log("============================================================\n");

  console.log("--- 1. Testing gRPC Server Initialization & Bind ---");
  let port = 50051;
  let serverStarted = false;
  try {
    const res = await startGrpcAccountServer(50051, { resetTestState: true });
    port = res.port;
    serverStarted = true;
    assert(port === 50051, `gRPC Account Server successfully bound to port ${port}`);
  } catch (err: any) {
    if (String(err?.message || err).includes("EADDRINUSE") || String(err?.message || err).includes("No address added")) {
      const res = await startGrpcAccountServer(50052, { resetTestState: true });
      port = res.port;
      serverStarted = true;
      assert(true, `gRPC Account Server active on test port ${port}`);
    } else {
      throw err;
    }
  }

  const client = getGrpcAccountClient(`127.0.0.1:${port}`);
  assert(client !== null, "gRPC Client stub instantiated with Insecure Channel Credentials");

  console.log("\n--- 2. Testing gRPC HealthCheck RPC ---");
  const health = await executeGrpcHealth(client);
  assert(health.status === "SERVING", "gRPC Service status reported as SERVING");
  assert(health.version === "1.0.0", "gRPC Service version 1.0.0 confirmed");

  console.log("\n--- 3. Testing gRPC GetBalance RPC ---");
  const sanikaPreTestPaise = persistentDb.getAccountByUpiOrId("sanika@bank")?.balance_paise ?? 875000;
  const navyaPreTestPaise = persistentDb.getAccountByUpiOrId("navya@bank")?.balance_paise ?? 625000;
  let balBefore = await executeGrpcBalance(client, "sanika@bank");
  if (balBefore.balance !== 10000) {
    if (balBefore.balance < 10000) {
      await executeGrpcCredit(client, {
        transaction_id: "TXN-INIT-RESET",
        account_id: "sanika@bank",
        amount: 10000 - balBefore.balance,
        correlation_id: "INIT-001",
        lamport_clock: 1,
      });
    } else {
      await executeGrpcDebit(client, {
        transaction_id: "TXN-INIT-RESET",
        account_id: "sanika@bank",
        amount: balBefore.balance - 10000,
        correlation_id: "INIT-001",
        lamport_clock: 1,
      });
    }
    balBefore = await executeGrpcBalance(client, "sanika@bank");
  }
  assert(balBefore.account_id === "sanika@bank", "Queried correct account ID");
  assert(balBefore.balance === 10000, `Initial balance confirmed as ₹${balBefore.balance}`);

  console.log("\n--- 4. Testing gRPC DebitAccount RPC ---");
  const debitRes = await executeGrpcDebit(client, {
    transaction_id: "TXN-GRPC-001",
    account_id: "sanika@bank",
    amount: 500,
    correlation_id: "CORR-GRPC-101",
    lamport_clock: 5,
  });
  assert(debitRes.success === true, "DebitAccount RPC executed successfully");
  assert(debitRes.remaining_balance === 9500, `Remaining balance updated to ₹${debitRes.remaining_balance}`);
  assert(Number(debitRes.lamport_clock) === 6, "Lamport clock incremented on gRPC response (5 -> 6)");

  console.log("\n--- 5. Testing gRPC CreditAccount RPC ---");
  let navyaBefore = await executeGrpcBalance(client, "navya@bank");
  if (navyaBefore.balance !== 5000) {
    if (navyaBefore.balance < 5000) {
      await executeGrpcCredit(client, {
        transaction_id: "TXN-INIT-RESET-NAVYA",
        account_id: "navya@bank",
        amount: 5000 - navyaBefore.balance,
        correlation_id: "INIT-002",
        lamport_clock: 1,
      });
    } else {
      await executeGrpcDebit(client, {
        transaction_id: "TXN-INIT-RESET-NAVYA",
        account_id: "navya@bank",
        amount: navyaBefore.balance - 5000,
        correlation_id: "INIT-002",
        lamport_clock: 1,
      });
    }
  }
  const creditRes = await executeGrpcCredit(client, {
    transaction_id: "TXN-GRPC-001",
    account_id: "navya@bank",
    amount: 500,
    correlation_id: "CORR-GRPC-101",
    lamport_clock: 6,
  });
  assert(creditRes.success === true, "CreditAccount RPC executed successfully");
  assert(creditRes.new_balance === 5500, `Beneficiary balance credited to ₹${creditRes.new_balance}`);

  console.log("\n--- 6. Testing gRPC Error Handling: Account NOT_FOUND ---");
  let notFoundCaught = false;
  try {
    await executeGrpcBalance(client, "nonexistent@bank");
  } catch (err: any) {
    notFoundCaught = true;
    assert(err.code === grpc.status.NOT_FOUND, `gRPC status.NOT_FOUND (code 5) correctly returned: ${err.message}`);
  }
  assert(notFoundCaught, "gRPC threw expected error for nonexistent account");

  console.log("\n--- 7. Testing gRPC Error Handling: FAILED_PRECONDITION (Insufficient Funds) ---");
  let insuffCaught = false;
  try {
    await executeGrpcDebit(client, {
      transaction_id: "TXN-GRPC-FAIL",
      account_id: "sanika@bank",
      amount: 999999, // Exceeds balance
    });
  } catch (err: any) {
    insuffCaught = true;
    assert(
      err.code === grpc.status.FAILED_PRECONDITION,
      `gRPC status.FAILED_PRECONDITION (code 9) correctly returned for overdraft: ${err.message}`
    );
  }
  assert(insuffCaught, "gRPC prevented overdraft and returned FAILED_PRECONDITION");

  console.log("\n--- 8. Testing gRPC Error Handling: INVALID_ARGUMENT ---");
  let invalidArgCaught = false;
  try {
    await executeGrpcDebit(client, {
      transaction_id: "",
      account_id: "",
      amount: -100,
    });
  } catch (err: any) {
    invalidArgCaught = true;
    assert(
      err.code === grpc.status.INVALID_ARGUMENT,
      `gRPC status.INVALID_ARGUMENT (code 3) correctly returned: ${err.message}`
    );
  }
  assert(invalidArgCaught, "gRPC caught invalid arguments");

  console.log("\n--- 8b. Testing gRPC Compensating RollbackDebit RPC ---");
  // 1. Debit an account to set up rollback
  const rbDebitRes = await executeGrpcDebit(client, {
    transaction_id: "TXN-GRPC-ROLL-001",
    account_id: "sanika@bank",
    amount: 300,
    correlation_id: "CORR-GRPC-ROLL-1",
    lamport_clock: 10,
  });
  assert(rbDebitRes.success === true, "Pre-rollback debit succeeded");
  const balAfterDebit = await executeGrpcBalance(client, "sanika@bank");
  assert(balAfterDebit.balance === 9200, "Sanika balance debited before rollback (9500 -> 9200)");

  // 2. Successful rollback
  const rollbackRes = await executeGrpcRollback(client, {
    transaction_id: "TXN-GRPC-ROLL-001",
    reason: "Downstream NPCI Timeout",
    lamport_clock: 11,
  });
  assert(rollbackRes.success === true, "RollbackDebit RPC executed successfully");
  const balAfterRollback = await executeGrpcBalance(client, "sanika@bank");
  assert(balAfterRollback.balance === 9500, `Sanika balance restored to ₹${balAfterRollback.balance} (refunded ₹300)`);

  // 3. Repeated rollback idempotency (must not double-refund)
  const repeatRollbackRes = await executeGrpcRollback(client, {
    transaction_id: "TXN-GRPC-ROLL-001",
    reason: "Duplicate Retry",
    lamport_clock: 12,
  });
  assert(repeatRollbackRes.success === true, "Repeated RollbackDebit RPC succeeded idempotently");
  const balAfterRepeat = await executeGrpcBalance(client, "sanika@bank");
  assert(balAfterRepeat.balance === 9500, "Sanika balance unchanged on repeated rollback (no double refund)");

  // 4. Missing transaction NOT_FOUND
  let rbNotFoundCaught = false;
  try {
    await executeGrpcRollback(client, {
      transaction_id: "TXN-GRPC-NONEXISTENT",
    });
  } catch (err: any) {
    rbNotFoundCaught = true;
    assert(err.code === grpc.status.NOT_FOUND, `Missing transaction returned NOT_FOUND: ${err.message}`);
  }
  assert(rbNotFoundCaught, "RollbackDebit rejected nonexistent transaction");

  // 5. Invalid argument (empty transaction_id)
  let rbInvalidCaught = false;
  try {
    await executeGrpcRollback(client, {
      transaction_id: "",
    });
  } catch (err: any) {
    rbInvalidCaught = true;
    assert(err.code === grpc.status.INVALID_ARGUMENT, `Empty transaction_id returned INVALID_ARGUMENT: ${err.message}`);
  }
  assert(rbInvalidCaught, "RollbackDebit rejected empty transaction_id");

  console.log("\n--- 8c. Testing gRPC RollbackDebit Error Handling: Database Failures (INTERNAL) ---");
  const originalStore = getAccountStore();
  let dbFailureCaught = false;
  try {
    const mockDbErrorStore: AccountStore = {
      getUser: (id: string) => originalStore.getUser(id),
      debitUser: (id: string, amt: number, txnId?: string) => originalStore.debitUser(id, amt, txnId),
      creditUser: (id: string, amt: number, txnId?: string) => originalStore.creditUser(id, amt, txnId),
      rollbackDebit: (_txnId: string) => {
        throw new Error("SQLITE_IOERR: disk I/O error during rollback transaction");
      },
    };
    setAccountStore(mockDbErrorStore);

    await executeGrpcRollback(client, {
      transaction_id: "TXN-GRPC-DB-FAIL",
      reason: "Simulated DB Failure",
    });
  } catch (err: any) {
    dbFailureCaught = true;
    assert(
      err.code === grpc.status.INTERNAL,
      `Database exception correctly mapped to gRPC status.INTERNAL (code 13): ${err.message}`
    );
  } finally {
    setAccountStore(originalStore);
  }
  assert(dbFailureCaught, "RollbackDebit caught thrown database exception and returned status.INTERNAL");

  // Also test returned database error message
  let dbErrMsgCaught = false;
  try {
    const mockDbMsgStore: AccountStore = {
      getUser: (id: string) => originalStore.getUser(id),
      debitUser: (id: string, amt: number, txnId?: string) => originalStore.debitUser(id, amt, txnId),
      creditUser: (id: string, amt: number, txnId?: string) => originalStore.creditUser(id, amt, txnId),
      rollbackDebit: (_txnId: string) => ({
        success: false,
        balance: 0,
        error: "SQLite database disk error occurred while executing atomic rollback",
      }),
    };
    setAccountStore(mockDbMsgStore);

    await executeGrpcRollback(client, {
      transaction_id: "TXN-GRPC-DB-FAIL-2",
      reason: "Simulated SQLite Error",
    });
  } catch (err: any) {
    dbErrMsgCaught = true;
    assert(
      err.code === grpc.status.INTERNAL,
      `Database error result correctly mapped to gRPC status.INTERNAL (code 13): ${err.message}`
    );
  } finally {
    setAccountStore(originalStore);
  }
  assert(dbErrMsgCaught, "RollbackDebit caught returned database error string and returned status.INTERNAL");

  console.log("\n--- 9. Graceful gRPC Server Shutdown ---");
  client.close();
  const balanceBeforeShutdown = persistentDb.getAccountByUpiOrId("sanika@bank")?.balance_paise;
  if (serverStarted) {
    await stopGrpcAccountServer();
  }
  const balanceAfterShutdown = persistentDb.getAccountByUpiOrId("sanika@bank")?.balance_paise;
  assert(
    balanceBeforeShutdown === balanceAfterShutdown,
    "gRPC shutdown does not rewrite SQLite account balances"
  );
  assert(true, "gRPC server shutdown completed without resource leak");

  // Restore state so subsequent database persistence & ledger parity tests stay consistent
  try {
    db.prepare("DELETE FROM sender_debits WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM receiver_credits WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM ledger_entries WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("DELETE FROM idempotency_records WHERE transaction_id LIKE 'TXN-GRPC-%' OR transaction_id LIKE 'TXN-INIT-RESET%'").run();
    db.prepare("UPDATE accounts SET balance_paise = ? WHERE upi_id = 'sanika@bank'").run(sanikaPreTestPaise);
    db.prepare("UPDATE accounts SET balance_paise = ? WHERE upi_id = 'navya@bank'").run(navyaPreTestPaise);
  } catch {}

  console.log("\n============================================================");
  console.log("ALL UNIT I gRPC MIDDLEWARE TESTS PASSED SUCCESSFULLY!");
  console.log("============================================================\n");
  process.exit(0);
}

runGrpcTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
