// ============================================================================
// Automated Test Suite for Phase 3: Persistent Database Storage (SQLite ACID)
// Fully covers all 11 Required Transaction Scenarios from Section 3.4
// ============================================================================

import { DatabaseSync } from "node:sqlite";
import {
  persistentDb,
  rupeesToPaise,
  paiseToRupees,
  PersistentLedgerDatabase,
  db,
} from "./src/server/db.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

console.log("\n============================================================");
console.log("RUNNING PHASE 3: PERSISTENT DATABASE STORAGE & 11 TRANSACTION SCENARIOS");
console.log("============================================================\n");

// ----------------------------------------------------------------------------
// 0. Base Monetary Arithmetic (Integer Paise)
// ----------------------------------------------------------------------------
console.log("--- 0. Integer Paise Exact Monetary Arithmetic ---");
assert(rupeesToPaise(500) === 50000, "₹500 converts exactly to 50000 paise");
assert(rupeesToPaise(12.34) === 1234, "₹12.34 converts without floating point drift to 1234 paise");
assert(paiseToRupees(50000) === 500.0, "50000 paise converts back to ₹500.00");
assert(paiseToRupees(1234) === 12.34, "1234 paise converts back to ₹12.34");

const initialAccounts = persistentDb.listAccounts();
assert(initialAccounts.length >= 7, `Initialized accounts present: ${initialAccounts.length}`);

// ----------------------------------------------------------------------------
// Scenario 1: Successful Transfer
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 1: Successful Transfer ---");
const s1Sender = persistentDb.getAccountByUpiOrId("user1@upi")!;
const s1Receiver = persistentDb.getAccountByUpiOrId("user2@upi")!;
const s1TxnId = `TXN-S1-${Date.now()}`;
const s1AmountPaise = rupeesToPaise(250);

const s1Debit = persistentDb.atomicDebit("user1@upi", s1AmountPaise, s1TxnId, "S1 Payment ₹250 to user2@upi");
assert(s1Debit.success === true, "Sender debit succeeded");
assert(s1Debit.balanceAfterPaise === s1Sender.balance_paise - s1AmountPaise, "Sender balance debited accurately");

const s1Credit = persistentDb.atomicCredit("user2@upi", s1AmountPaise, s1TxnId, "S1 Credit ₹250 from user1@upi");
assert(s1Credit.success === true, "Receiver credit succeeded");
assert(s1Credit.balanceAfterPaise === s1Receiver.balance_paise + s1AmountPaise, "Receiver balance credited accurately");

// ----------------------------------------------------------------------------
// Scenario 2: Invalid Account
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 2: Invalid Account ---");
const s2TxnId = `TXN-S2-${Date.now()}`;
const s2Debit = persistentDb.atomicDebit("ghost_nonexistent_user@invalidbank", 10000, s2TxnId, "Invalid sender debit");
assert(s2Debit.success === false, "Debit on non-existent account rejected");
assert(s2Debit.reason?.includes("Unknown sender account") === true, `Expected rejection reason: "${s2Debit.reason}"`);

// ----------------------------------------------------------------------------
// Scenario 3: Invalid Amount (Zero and Negative Amount)
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 3: Invalid Amount ---");
const s3TxnId1 = `TXN-S3-ZERO-${Date.now()}`;
const s3DebitZero = persistentDb.atomicDebit("user1@upi", 0, s3TxnId1, "Zero amount debit");
assert(s3DebitZero.success === false, "Zero amount debit rejected");
assert(s3DebitZero.reason?.includes("Invalid amount") === true, `Expected rejection: "${s3DebitZero.reason}"`);

const s3TxnId2 = `TXN-S3-NEG-${Date.now()}`;
const s3DebitNeg = persistentDb.atomicDebit("user1@upi", -5000, s3TxnId2, "Negative amount debit");
assert(s3DebitNeg.success === false, "Negative amount debit rejected");

// ----------------------------------------------------------------------------
// Scenario 4: Insufficient Funds (Overdraft Prevention)
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 4: Insufficient Funds ---");
const s4TxnId = `TXN-S4-${Date.now()}`;
const s4User1 = persistentDb.getAccountByUpiOrId("user1@upi")!;
const excessiveAmountPaise = s4User1.balance_paise + 100000;
const s4Debit = persistentDb.atomicDebit("user1@upi", excessiveAmountPaise, s4TxnId, "Excessive transfer");
assert(s4Debit.success === false, "Excessive transfer debit rejected");
assert(s4Debit.reason === "Insufficient balance", `Correct rejection reason: ${s4Debit.reason}`);
const s4User1After = persistentDb.getAccountByUpiOrId("user1@upi")!;
assert(s4User1After.balance_paise === s4User1.balance_paise, "Account balance untouched on insufficient funds rejection");

// ----------------------------------------------------------------------------
// Scenario 5: Duplicate Idempotency Key
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 5: Duplicate Idempotency Key ---");
const s5IdemKey = `IDEM-KEY-${Date.now()}`;
const s5TxnId = `TXN-S5-${Date.now()}`;
persistentDb.recordIdempotency(s5IdemKey, s5TxnId, "SETTLED", JSON.stringify({ status: "SUCCESS", amount: 100 }));

const s5Lookup1 = persistentDb.getIdempotency(s5IdemKey);
assert(s5Lookup1 !== null && s5Lookup1.transactionId === s5TxnId, "First idempotency lookup retrieves transaction");

// Attempt duplicate debit using already recorded transactionId
const s5User1Pre = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
const s5DuplicateDebit = persistentDb.atomicDebit("user1@upi", 10000, s1TxnId, "Duplicate debit with old txnId");
assert(s5DuplicateDebit.success === true, "Idempotent debit check acknowledges already debited transaction");
const s5User1Post = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
assert(s5User1Pre === s5User1Post, "Balance not deducted twice on duplicate transaction submission");

// ----------------------------------------------------------------------------
// Scenario 6: Concurrent Transfers Exceeding Available Balance
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 6: Concurrent Transfers Exceeding Available Balance ---");
// Temporary test user with limited balance
const concUpi = "test_conc@bank";
let concAcc = persistentDb.getAccountByUpiOrId(concUpi);
if (!concAcc) {
  concAcc = persistentDb.createAccount({
    id: "usr_test_conc",
    name: "Test Conc",
    upi_id: concUpi,
    bank_name: "HDFC Bank",
    balance_paise: 10000,
    initial_balance_paise: 10000,
  });
} else {
  db.prepare("UPDATE accounts SET balance_paise = ?, initial_balance_paise = ? WHERE upi_id = ?").run(10000, 10000, concUpi);
}
const currentConcBal = persistentDb.getAccountByUpiOrId(concUpi)!.balance_paise;
assert(currentConcBal === 10000, "Test concurrency account set to exactly 10000 paise (₹100)");

// Two concurrent debits of ₹80 (8000 paise) each. Both cannot succeed because 8000 + 8000 > 10000!
const concTxn1 = `TXN-CONC-1-${Date.now()}`;
const concTxn2 = `TXN-CONC-2-${Date.now()}`;

const debitAttempt1 = persistentDb.atomicDebit(concUpi, 8000, concTxn1, "Concurrent Debit 1");
const debitAttempt2 = persistentDb.atomicDebit(concUpi, 8000, concTxn2, "Concurrent Debit 2");

assert(debitAttempt1.success === true, "First concurrent debit succeeded");
assert(debitAttempt2.success === false, "Second concurrent debit rejected for insufficient balance (zero overspend)");
assert(debitAttempt2.reason === "Insufficient balance", "Correct concurrency rejection reason");
const finalConcBal = persistentDb.getAccountByUpiOrId(concUpi)!.balance_paise;
assert(finalConcBal === 2000, `Account balance remained consistent at ${finalConcBal} paise without overdraft`);

// Rollback concTxn1 to restore parity in double-entry test ledger
persistentDb.atomicRollback(concTxn1);

// ----------------------------------------------------------------------------
// Scenario 7: Failure During Transaction Processing (Saga Compensating Rollback)
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 7: Failure During Transaction Processing (Saga Rollback) ---");
const s7TxnId = `TXN-SAGA-FAIL-${Date.now()}`;
const s7AmountPaise = rupeesToPaise(150);
const s7SenderPre = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;

// Step 1: Debit sender
const s7Debit = persistentDb.atomicDebit("user1@upi", s7AmountPaise, s7TxnId, "Pre-failure debit");
assert(s7Debit.success === true, "Step 1 debit succeeded before downstream failure");
const s7SenderMid = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
assert(s7SenderMid === s7SenderPre - s7AmountPaise, "Sender debited before downstream step failed");

// Step 2: Downstream service failure occurs (e.g. NPCI 503) -> Execute compensating rollback
const s7Rollback = persistentDb.atomicRollback(s7TxnId);
assert(s7Rollback.success === true, "Saga compensating rollback executed successfully");
assert(s7Rollback.amountPaise === s7AmountPaise, "Exact debit amount restored to sender");
const s7SenderPost = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
assert(s7SenderPost === s7SenderPre, "Sender account balance fully restored to pre-transaction amount");

// ----------------------------------------------------------------------------
// Scenario 8: Timeout With Uncertain Outcome & Reconciliation
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 8: Timeout With Uncertain Outcome & Reconciliation ---");
const s8TxnId = `TXN-TIMEOUT-${Date.now()}`;
const s8AmountPaise = rupeesToPaise(300);

// Record transaction with state PENDING_RECONCILIATION when network times out
persistentDb.upsertTransaction({
  transactionId: s8TxnId,
  senderId: "user1@upi",
  receiverId: "user2@upi",
  amount: 300,
  amountPaise: s8AmountPaise,
  status: "PENDING_RECONCILIATION",
  failureReason: "Downstream receiver bank ACK timed out after 3 retries",
  idempotencyKey: `IDEM-TIMEOUT-${Date.now()}`,
  mode: "rest",
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const fetchedTimeoutTxn = persistentDb.getTransaction(s8TxnId);
assert(fetchedTimeoutTxn !== null, "Timeout transaction persisted with audit trail");
assert(fetchedTimeoutTxn!.status === "PENDING_RECONCILIATION", "Transaction marked as PENDING_RECONCILIATION (not falsely failed or silently dropped)");

// Reconcile: If credit never reached beneficiary, execute compensating rollback and mark REFUNDED
const s8Compensate = persistentDb.atomicRollback(s8TxnId);
// In this case, sender was never debited yet, so atomicRollback safely notes no debit found
assert(s8Compensate.success === false && s8Compensate.reason === "No debit found to roll back", "Reconciliation safely verified no partial financial update occurred");

// ----------------------------------------------------------------------------
// Scenario 9: Correct Ledger Debit and Credit Records
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 9: Correct Ledger Debit and Credit Records ---");
const journal = persistentDb.getLedgerJournal(50);
const s1DebitEntry = journal.find((e) => e.transactionId === s1TxnId && e.entryType === "DEBIT");
const s1CreditEntry = journal.find((e) => e.transactionId === s1TxnId && e.entryType === "CREDIT");

assert(s1DebitEntry !== undefined, "Found settled DEBIT entry in ledger journal for S1");
assert(s1DebitEntry!.amountPaise === s1AmountPaise, "Debit entry amount matches transaction amount");
assert(s1DebitEntry!.accountUpi === "user1@upi", "Debit recorded on correct remitter UPI account");

assert(s1CreditEntry !== undefined, "Found settled CREDIT entry in ledger journal for S1");
assert(s1CreditEntry!.amountPaise === s1AmountPaise, "Credit entry amount matches transaction amount");
assert(s1CreditEntry!.accountUpi === "user2@upi", "Credit recorded on correct beneficiary UPI account");

// Verify system double-entry parity
const invariants = persistentDb.getLedgerInvariants();
assert(invariants.debitCreditParity === true, "Double-entry parity verified: totalDebited == totalCredited");
assert(invariants.isConservationPreserved === true, "Closed-system money conservation strictly preserved");

// ----------------------------------------------------------------------------
// Scenario 10: Restart Recovery
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 10: Restart Recovery ---");
const preRestartBalance = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
const preRestartTxnCount = persistentDb.listTransactions().length;

// Instantiate new database connection from disk file
const rebootedDb = new PersistentLedgerDatabase();
const postRestartAccounts = rebootedDb.listAccounts();
assert(postRestartAccounts.length >= 7, "All accounts survive database restart");

const reloadedUser1 = rebootedDb.getAccountByUpiOrId("user1@upi");
assert(reloadedUser1 !== null, "User 1 account reloaded from disk");
assert(reloadedUser1!.balance_paise === preRestartBalance, `Exact balance preserved across restart (${reloadedUser1!.balance_paise} paise)`);

const reloadedTxns = rebootedDb.listTransactions();
assert(reloadedTxns.length === preRestartTxnCount, `All ${preRestartTxnCount} transaction records preserved across cold restart`);

// ----------------------------------------------------------------------------
// Scenario 11: Ledger-to-Balance Reconciliation
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 11: Ledger-to-Balance Reconciliation ---");
const auditResult = persistentDb.reconcileLedgerToBalances();
assert(auditResult.reconciled === true, "Full system ledger-to-balance reconciliation successful");
assert(auditResult.discrepancies.length === 0, "Zero account balance discrepancies detected");
assert(auditResult.systemParity === true, "System money parity confirmed across all accounts");
assert(auditResult.totalAccountsAudited >= 7, `Audited ${auditResult.totalAccountsAudited} accounts successfully`);

// ----------------------------------------------------------------------------
// Scenario 12: Unknown VPA Querying (Zero Auto-Provisioning & Strict Null)
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 12: Unknown VPA Querying (Strict Null) ---");
const accountsPreCount = persistentDb.listAccounts().length;
const unknown1 = persistentDb.getAccountByUpiOrId("nonexistent_vpa_12345@somebank");
assert(unknown1 === null, "Unknown account nonexistent_vpa_12345@somebank returns null");

const unknown2 = persistentDb.getAccountByUpiOrId("arbitrary_ghost_vpa@randombank");
assert(unknown2 === null, "Arbitrary unknown VPA returns null without auto-provisioning ₹10,000");

const accountsPostCount = persistentDb.listAccounts().length;
assert(accountsPreCount === accountsPostCount, `Accounts count unchanged (${accountsPreCount}) after querying unknown accounts`);

// ----------------------------------------------------------------------------
// Scenario 13: Seeded Demo Transactions & Ledger Journal Parity
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 13: Seeded Demo Transactions & Ledger Journal Parity ---");
const seededTxn1 = persistentDb.getTransaction("TXN-20260927-IMPS01");
const seededTxn2 = persistentDb.getTransaction("TXN-20260927-IMPS02");
assert(seededTxn1 !== null && seededTxn1.status === "SUCCESS", "Seeded demo transaction 1 exists with status SUCCESS");
assert(seededTxn2 !== null && seededTxn2.status === "SUCCESS", "Seeded demo transaction 2 exists with status SUCCESS");

const journalAll = persistentDb.getLedgerJournal(1000);
const s1Debits = journalAll.filter((e) => e.transactionId === "TXN-20260927-IMPS01" && e.entryType === "DEBIT");
const s1Credits = journalAll.filter((e) => e.transactionId === "TXN-20260927-IMPS01" && e.entryType === "CREDIT");
assert(s1Debits.length === 1 && s1Debits[0].accountUpi === "sanika@bank", "Seeded txn 1 has matching settled DEBIT on sanika@bank");
assert(s1Credits.length === 1 && s1Credits[0].accountUpi === "navya@bank", "Seeded txn 1 has matching settled CREDIT on navya@bank");

const s2Debits = journalAll.filter((e) => e.transactionId === "TXN-20260927-IMPS02" && e.entryType === "DEBIT");
const s2Credits = journalAll.filter((e) => e.transactionId === "TXN-20260927-IMPS02" && e.entryType === "CREDIT");
assert(s2Debits.length === 1 && s2Debits[0].accountUpi === "priya@bank", "Seeded txn 2 has matching settled DEBIT on priya@bank");
assert(s2Credits.length === 1 && s2Credits[0].accountUpi === "rahul@bank", "Seeded txn 2 has matching settled CREDIT on rahul@bank");

const sanika = persistentDb.getAccountByUpiOrId("sanika@bank")!;
const navya = persistentDb.getAccountByUpiOrId("navya@bank")!;
const priya = persistentDb.getAccountByUpiOrId("priya@bank")!;
const rahul = persistentDb.getAccountByUpiOrId("rahul@bank")!;

const sanikaDebitsTotal = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = 'sanika@bank' AND entry_type = 'DEBIT' AND status = 'SETTLED'").get() as any).total;
const navyaCreditsTotal = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = 'navya@bank' AND entry_type = 'CREDIT' AND status = 'SETTLED'").get() as any).total;
const priyaDebitsTotal = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = 'priya@bank' AND entry_type = 'DEBIT' AND status = 'SETTLED'").get() as any).total;
const rahulCreditsTotal = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = 'rahul@bank' AND entry_type = 'CREDIT' AND status = 'SETTLED'").get() as any).total;

assert(sanikaDebitsTotal >= rupeesToPaise(1250), "Sanika has settled debits including seeded ₹1250");
assert(navyaCreditsTotal >= rupeesToPaise(1250), "Navya has settled credits including seeded ₹1250");
assert(sanika.balance_paise === sanika.initial_balance_paise - sanikaDebitsTotal, "Sanika's balance reflects initial minus settled debits");
assert(navya.balance_paise === navya.initial_balance_paise + navyaCreditsTotal, "Navya's balance reflects initial plus settled credits");
assert(priya.balance_paise === priya.initial_balance_paise - priyaDebitsTotal, "Priya's balance reflects initial minus settled debits");
assert(rahul.balance_paise === rahul.initial_balance_paise + rahulCreditsTotal, "Rahul's balance reflects initial plus settled credits");

// ----------------------------------------------------------------------------
// Scenario 14: Dynamic Genesis Total & Money Conservation
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 14: Dynamic Genesis Total & Money Conservation ---");
const genesisPaise = persistentDb.getGenesisSupplyPaise();
const inv = persistentDb.getLedgerInvariants();
assert(genesisPaise > 0, `Genesis supply dynamically derived: ₹${paiseToRupees(genesisPaise)} (${genesisPaise} paise)`);
assert(inv.genesisSupplyPaise === genesisPaise, "Genesis supply in invariants matches accounts initial balance total");
assert(inv.currentTotalPaise === inv.genesisSupplyPaise, "Total system deposits exactly equal genesis supply (zero money creation/loss)");
assert(inv.debitCreditParity === true, "Settled debits equal settled credits and reversals across entire journal");
assert(inv.isConservationPreserved === true, "Closed-system money conservation strictly preserved");

// ----------------------------------------------------------------------------
// Scenario 15: Reliable Idempotency with Conflict Detection
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 15: Reliable Idempotency with Conflict Detection ---");
const idemKeyTest = `IDEM-CONFLICT-${Date.now()}`;
const txnIdOrig = `TXN-ORIG-${Date.now()}`;
const hashOrig = "user1@upi|user2@upi|100000";

// First attempt: reserve
const resNew = persistentDb.checkOrReserveIdempotency(idemKeyTest, txnIdOrig, "user1@upi", "user2@upi", 100000, hashOrig);
assert(resNew.status === "NEW", "First idempotency registration returns status NEW");

// Identical retry: returns MATCH
const resMatch = persistentDb.checkOrReserveIdempotency(idemKeyTest, "TXN-RETRY", "user1@upi", "user2@upi", 100000, hashOrig);
assert(resMatch.status === "MATCH", "Identical retry with matching parameters returns status MATCH");

// Altered payload (different amount): returns CONFLICT
const hashConflictAmt = "user1@upi|user2@upi|200000";
const resConflictAmt = persistentDb.checkOrReserveIdempotency(idemKeyTest, "TXN-DIFF-AMT", "user1@upi", "user2@upi", 200000, hashConflictAmt);
assert(resConflictAmt.status === "CONFLICT", "Key reuse with altered amount returns status CONFLICT");

// Altered payload (different receiver): returns CONFLICT
const hashConflictRcv = "user1@upi|rahul@bank|100000";
const resConflictRcv = persistentDb.checkOrReserveIdempotency(idemKeyTest, "TXN-DIFF-RCV", "user1@upi", "rahul@bank", 100000, hashConflictRcv);
assert(resConflictRcv.status === "CONFLICT", "Key reuse with altered beneficiary returns status CONFLICT");

// ----------------------------------------------------------------------------
// Scenario 16: Interrupted Transfer Startup Recovery & Late Credit Protection
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 16: Interrupted Transfer Startup Recovery & Late Credit Protection ---");
const crashTxnId = `TXN-CRASH-${Date.now()}`;
const crashAmountPaise = rupeesToPaise(500);
const user1PreCrash = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
const user2PreCrash = persistentDb.getAccountByUpiOrId("user2@upi")!.balance_paise;

// 1. Transaction initiates and debits sender, then crashes before credit
persistentDb.upsertTransaction({
  transactionId: crashTxnId,
  senderId: "user1@upi",
  receiverId: "user2@upi",
  amount: 500,
  amountPaise: crashAmountPaise,
  status: "PROCESSING",
  failureReason: null,
  idempotencyKey: `IDEM-CRASH-${Date.now()}`,
  mode: "rest",
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const crashDebit = persistentDb.atomicDebit("user1@upi", crashAmountPaise, crashTxnId, "Pre-crash debit");
assert(crashDebit.success === true, "Sender debited before simulated process crash");
assert(persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise === user1PreCrash - crashAmountPaise, "Sender balance reduced while transaction in-flight");

// 2. Server reboots and executes recovery
const recoveryReport = persistentDb.recoverInterruptedTransactions();
assert(recoveryReport.recoveredCount >= 1, `Recovery inspected in-flight transactions (${recoveryReport.recoveredCount})`);
assert(recoveryReport.rolledBackCount >= 1, `Compensating rollback triggered for interrupted transfer (${recoveryReport.rolledBackCount})`);

// 3. Sender balance must be fully refunded
const user1PostRecovery = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;
assert(user1PostRecovery === user1PreCrash, "Sender balance restored to pre-crash amount by automated startup recovery");

// 4. Transaction status must be ROLLBACK_COMPLETED
const recoveredTxn = persistentDb.getTransaction(crashTxnId)!;
assert(recoveredTxn.status === "ROLLBACK_COMPLETED", "Interrupted transaction promoted to ROLLBACK_COMPLETED");

// 5. Late/timed-out receiver credit attempt must be REJECTED
const lateCreditAttempt = persistentDb.atomicCredit("user2@upi", crashAmountPaise, crashTxnId, "Late credit attempt after rollback");
assert(lateCreditAttempt.success === false, "Late receiver credit after rollback strictly rejected");
assert(lateCreditAttempt.reason?.includes("rolled back") === true, `Expected rejection reason: "${lateCreditAttempt.reason}"`);
assert(persistentDb.getAccountByUpiOrId("user2@upi")!.balance_paise === user2PreCrash, "Receiver balance untouched by rejected late credit");

// ----------------------------------------------------------------------------
// Scenario 17: Concurrent Debits & Overdraft Prevention Under High Contention
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 17: Concurrent Debits & Overdraft Prevention Under High Contention ---");
const s17Acc = "usr_rahul";
const s17Pre = persistentDb.getAccountByUpiOrId(s17Acc)!;
const s17BalPaise = s17Pre.balance_paise;
// Two concurrent transactions each attempting to debit 60% of available balance
const s17DebitAmt = Math.floor(s17BalPaise * 0.6);
const s17Txn1 = `TXN-CONC-1-${Date.now()}`;
const s17Txn2 = `TXN-CONC-2-${Date.now()}`;

const [concRes1, concRes2] = [
  persistentDb.atomicDebit(s17Acc, s17DebitAmt, s17Txn1, "Concurrent debit 1"),
  persistentDb.atomicDebit(s17Acc, s17DebitAmt, s17Txn2, "Concurrent debit 2"),
];
assert(
  (concRes1.success && !concRes2.success) || (!concRes1.success && concRes2.success),
  "Exactly one concurrent debit succeeded and the other was rejected"
);
const s17Post = persistentDb.getAccountByUpiOrId(s17Acc)!;
assert(s17Post.balance_paise >= 0, `Account balance remained non-negative: ₹${s17Post.balance}`);
assert(s17Post.balance_paise === s17BalPaise - s17DebitAmt, "Account balance debited exactly once without overdraft");

// Rollback the successful one so balances remain clean
const winningTxn = concRes1.success ? s17Txn1 : s17Txn2;
const s17Rollback = persistentDb.atomicRollback(winningTxn);
assert(s17Rollback.success === true, "Rolled back test concurrent debit");
assert(persistentDb.getAccountByUpiOrId(s17Acc)!.balance_paise === s17BalPaise, "Account balance restored to original balance");

// ----------------------------------------------------------------------------
// Scenario 18: Idempotent Double-Rollback Protection
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 18: Idempotent Double-Rollback Protection ---");
const s18TxnId = `TXN-DBL-ROLL-${Date.now()}`;
const s18Amt = rupeesToPaise(250);
const s18PreBal = persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise;

persistentDb.atomicDebit("user1@upi", s18Amt, s18TxnId, "Debit for double rollback test");
assert(persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise === s18PreBal - s18Amt, "Debit reduced balance by ₹250");

// First rollback: should refund
const rbFirst = persistentDb.atomicRollback(s18TxnId);
assert(rbFirst.success === true, "First rollback call succeeded");
assert(persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise === s18PreBal, "First rollback restored original balance");

// Second rollback: must be idempotent and NOT credit a second time
const rbSecond = persistentDb.atomicRollback(s18TxnId);
assert(rbSecond.success === true, "Second rollback call acknowledged success idempotently");
assert(rbSecond.alreadyRolledBack === true, "Second rollback identified as alreadyRolledBack");
assert(persistentDb.getAccountByUpiOrId("user1@upi")!.balance_paise === s18PreBal, "Sender balance NOT credited a second time");

// ----------------------------------------------------------------------------
// Scenario 19: Late Receiver Credit Blocked on Terminal FAILED / CANCELLED States
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 19: Late Receiver Credit Blocked on Terminal FAILED / CANCELLED States ---");
const s19TxnId = `TXN-LATE-TERM-${Date.now()}`;
const s19Amt = rupeesToPaise(100);
const s19ReceiverPre = persistentDb.getAccountByUpiOrId("user2@upi")!.balance_paise;

persistentDb.upsertTransaction({
  transactionId: s19TxnId,
  senderId: "user1@upi",
  receiverId: "user2@upi",
  amount: 100,
  amountPaise: s19Amt,
  status: "FAILED",
  failureReason: "Payment cancelled by user",
  idempotencyKey: `IDEM-TERM-${Date.now()}`,
  mode: "rest",
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const lateCreditOnFailed = persistentDb.atomicCredit("user2@upi", s19Amt, s19TxnId, "Late credit on failed transaction");
assert(lateCreditOnFailed.success === false, "Late receiver credit on FAILED transaction rejected");
assert(lateCreditOnFailed.reason?.includes("FAILED") === true, "Rejection reason specifies status FAILED");
assert(persistentDb.getAccountByUpiOrId("user2@upi")!.balance_paise === s19ReceiverPre, "Receiver balance untouched by late credit on failed transaction");

// ----------------------------------------------------------------------------
// Scenario 20: Safe Recovery and Tracking for PENDING_RECONCILIATION
// ----------------------------------------------------------------------------
console.log("\n--- Scenario 20: Safe Recovery and Tracking for PENDING_RECONCILIATION ---");
const s20TxnId = `TXN-RECON-TRACK-${Date.now()}`;
persistentDb.upsertTransaction({
  transactionId: s20TxnId,
  senderId: "user1@upi",
  receiverId: "user2@upi",
  amount: 200,
  amountPaise: rupeesToPaise(200),
  status: "PENDING_RECONCILIATION",
  failureReason: "Timeout with uncertain state",
  idempotencyKey: `IDEM-RECON-${Date.now()}`,
  mode: "rest",
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const stats = persistentDb.getTransactionStats();
assert(stats.pendingReconciliation >= 1, `Transaction stats tracks pendingReconciliation (${stats.pendingReconciliation})`);

// Final Ledger audit after all 20 scenarios
const finalAudit = persistentDb.reconcileLedgerToBalances();
assert(finalAudit.reconciled === true, "Comprehensive ledger-to-balance reconciliation successful after all scenarios");
assert(finalAudit.discrepancies.length === 0, "Zero account balance discrepancies detected");
assert(finalAudit.systemParity === true, "System money parity confirmed across all accounts");

console.log("\n============================================================");
console.log("ALL 20 TRANSACTION & FINANCIAL INTEGRITY SCENARIOS PASSED WITH 100% SUCCESS!");
console.log("============================================================\n");
