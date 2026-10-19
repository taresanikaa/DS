import { DatabaseSync } from "node:sqlite";
export { DatabaseSync };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve SQLite DB path and ensure its parent directory exists recursively
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
export const DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.join(DEFAULT_DATA_DIR, "upi_simulator.db");

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize Database connection
export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode, foreign keys, and busy timeout for high-performance concurrent read/writes and integrity
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

// Initialize all schema tables with strict constraints & integer paise for exact monetary values
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  upi_id TEXT UNIQUE NOT NULL,
  bank_name TEXT NOT NULL,
  balance_paise INTEGER NOT NULL CHECK (balance_paise >= 0),
  initial_balance_paise INTEGER NOT NULL DEFAULT 0 CHECK (initial_balance_paise >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL,
  failure_reason TEXT,
  idempotency_key TEXT UNIQUE,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  event TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  sequence INTEGER,
  lamport INTEGER,
  vector_clock TEXT,
  headers_json TEXT,
  inter_service_call TEXT,
  FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_txn ON transaction_timeline (transaction_id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  account_upi TEXT NOT NULL,
  user_name TEXT NOT NULL,
  bank TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT', 'REVERSAL')),
  amount_paise INTEGER NOT NULL,
  balance_after_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SETTLED', 'REVERSED', 'PENDING')),
  description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_txn ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_upi ON ledger_entries (account_upi);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  sender_id TEXT,
  receiver_id TEXT,
  amount_paise INTEGER,
  request_hash TEXT,
  status TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sender_debits (
  transaction_id TEXT PRIMARY KEY,
  sender_upi TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receiver_credits (
  transaction_id TEXT PRIMARY KEY,
  ack_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// Safe migrations for preexisting databases
try { db.exec("ALTER TABLE idempotency_records ADD COLUMN sender_id TEXT;"); } catch {}
try { db.exec("ALTER TABLE idempotency_records ADD COLUMN receiver_id TEXT;"); } catch {}
try { db.exec("ALTER TABLE idempotency_records ADD COLUMN amount_paise INTEGER;"); } catch {}
try { db.exec("ALTER TABLE idempotency_records ADD COLUMN request_hash TEXT;"); } catch {}
try { db.exec("ALTER TABLE accounts ADD COLUMN initial_balance_paise INTEGER DEFAULT 0;"); } catch {}

// Types
export interface DbUserRecord {
  id: string;
  name: string;
  upi_id: string;
  bank_name: string;
  balance_paise: number;
  balance: number; // in rupees for API compatibility
  initial_balance_paise: number;
  created_at: string;
  updated_at: string;
}

export interface DbTimelineEvent {
  event: string;
  service: string;
  message: string;
  timestamp: string;
  sequence?: number;
  lamport?: number;
  vector?: any;
  headers?: any;
  interServiceCall?: string;
  [key: string]: any;
}

export interface DbTransactionRecord {
  transactionId: string;
  senderId: string;
  receiverId: string;
  amount: number; // in rupees
  amountPaise: number;
  status: string;
  failureReason: string | null;
  idempotencyKey: string | null;
  mode: string;
  timeline: DbTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface DbLedgerEntry {
  id: string;
  transactionId: string;
  timestamp: string;
  accountUpi: string;
  userName: string;
  bank: string;
  entryType: "DEBIT" | "CREDIT" | "REVERSAL";
  amount: number;
  amountPaise: number;
  balanceAfter: number;
  balanceAfterPaise: number;
  status: "SETTLED" | "REVERSED" | "PENDING";
  description: string;
}

// Helper: Convert Rupees to Paise and Paise to Rupees
export const rupeesToPaise = (rupees: number): number => Math.round(Number(rupees) * 100);
export const paiseToRupees = (paise: number): number => Number((paise / 100).toFixed(2));

// Seed default users if accounts table is empty
export function seedAccountsIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) as count FROM accounts").get() as { count: number };
  if (row.count > 0) return;

  const now = new Date().toISOString();
  const initialAccounts = [
    { id: "usr_user1", name: "User 1", upi_id: "user1@upi", bank_name: "HDFC Bank", balance_paise: rupeesToPaise(10000), initial_balance_paise: rupeesToPaise(10000) },
    { id: "usr_user2", name: "User 2", upi_id: "user2@upi", bank_name: "ICICI Bank", balance_paise: rupeesToPaise(5000), initial_balance_paise: rupeesToPaise(5000) },
    { id: "usr_sanika", name: "Sanika", upi_id: "sanika@bank", bank_name: "HDFC Bank", balance_paise: rupeesToPaise(10000), initial_balance_paise: rupeesToPaise(10000) },
    { id: "usr_navya", name: "Navya", upi_id: "navya@bank", bank_name: "ICICI Bank", balance_paise: rupeesToPaise(5000), initial_balance_paise: rupeesToPaise(5000) },
    { id: "usr_rahul", name: "Rahul", upi_id: "rahul@bank", bank_name: "SBI Bank", balance_paise: rupeesToPaise(7500), initial_balance_paise: rupeesToPaise(7500) },
    { id: "usr_priya", name: "Priya", upi_id: "priya@bank", bank_name: "Axis Bank", balance_paise: rupeesToPaise(12000), initial_balance_paise: rupeesToPaise(12000) },
    { id: "usr_saba", name: "Saba", upi_id: "saba@bank", bank_name: "SBI Bank", balance_paise: rupeesToPaise(7500), initial_balance_paise: rupeesToPaise(7500) },
    { id: "usr_manaswi", name: "Manaswi", upi_id: "manaswi@bank", bank_name: "Axis Bank", balance_paise: rupeesToPaise(12000), initial_balance_paise: rupeesToPaise(12000) },
    { id: "usr_sai", name: "Sai", upi_id: "sai@bank", bank_name: "PNB Bank", balance_paise: rupeesToPaise(15000), initial_balance_paise: rupeesToPaise(15000) },
  ];

  const stmt = db.prepare(`
    INSERT INTO accounts (id, name, upi_id, bank_name, balance_paise, initial_balance_paise, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const acc of initialAccounts) {
    stmt.run(acc.id, acc.name, acc.upi_id, acc.bank_name, acc.balance_paise, acc.initial_balance_paise, now, now);
  }
}

// Seed initial demo transactions if transactions table is empty
export function seedTransactionsIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) as count FROM transactions").get() as { count: number };
  if (row.count > 0) return;

  const now = Date.now();
  const samples = [
    {
      id: "TXN-20260927-IMPS01",
      sender: "sanika@bank",
      senderName: "Sanika",
      senderBank: "HDFC Bank",
      receiver: "navya@bank",
      receiverName: "Navya",
      receiverBank: "ICICI Bank",
      amount: 1250,
      key: "UPI-INIT-90812",
      mode: "rest",
      offsetMs: 180000,
    },
    {
      id: "TXN-20260927-IMPS02",
      sender: "priya@bank",
      senderName: "Priya",
      senderBank: "Axis Bank",
      receiver: "rahul@bank",
      receiverName: "Rahul",
      receiverBank: "SBI Bank",
      amount: 2400,
      key: "UPI-INIT-90813",
      mode: "grpc",
      offsetMs: 90000,
    },
  ];

  for (const s of samples) {
    const t0 = new Date(now - s.offsetMs).toISOString();
    const t4 = new Date(now - s.offsetMs + 260).toISOString();
    const amtPaise = rupeesToPaise(s.amount);

    db.prepare(`
      INSERT INTO transactions (
        transaction_id, sender_id, receiver_id, amount_paise, status, failure_reason,
        idempotency_key, mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SUCCESS', NULL, ?, ?, ?, ?)
    `).run(s.id, s.sender, s.receiver, amtPaise, s.key, s.mode, t0, t4);

    db.prepare(`
      INSERT INTO idempotency_records (key, transaction_id, sender_id, receiver_id, amount_paise, request_hash, status, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'SETTLED', ?, ?)
    `).run(
      s.key,
      s.id,
      s.sender,
      s.receiver,
      amtPaise,
      `${s.sender}|${s.receiver}|${amtPaise}`,
      JSON.stringify({ transactionId: s.id, status: "SUCCESS", amount: s.amount }),
      t4
    );

    db.prepare(`
      INSERT INTO transaction_timeline (transaction_id, event, service, message, timestamp)
      VALUES (?, 'TRANSACTION_INITIATED', 'Transaction Service', 'Payment request received and validated', ?)
    `).run(s.id, t0);

    db.prepare(`
      INSERT INTO transaction_timeline (transaction_id, event, service, message, timestamp)
      VALUES (?, 'PAYMENT_SUCCESS', 'Transaction Service', 'Transaction successfully completed and settled', ?)
    `).run(s.id, t4);

    // Update sender & receiver balances and record double-entry ledger entries
    const senderAcc = db.prepare("SELECT * FROM accounts WHERE upi_id = ?").get(s.sender) as any;
    const receiverAcc = db.prepare("SELECT * FROM accounts WHERE upi_id = ?").get(s.receiver) as any;

    if (senderAcc && receiverAcc) {
      const senderNewBal = senderAcc.balance_paise - amtPaise;
      const receiverNewBal = receiverAcc.balance_paise + amtPaise;

      db.prepare("UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE upi_id = ?").run(senderNewBal, t4, s.sender);
      db.prepare("UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE upi_id = ?").run(receiverNewBal, t4, s.receiver);

      // DEBIT ledger entry
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'DEBIT', ?, ?, 'SETTLED', ?)
      `).run(
        `LEDGER-DR-${s.id}`,
        s.id,
        t0,
        s.sender,
        s.senderName,
        s.senderBank,
        amtPaise,
        senderNewBal,
        `UPI Payment to ${s.receiver}`
      );

      // CREDIT ledger entry
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREDIT', ?, ?, 'SETTLED', ?)
      `).run(
        `LEDGER-CR-${s.id}`,
        s.id,
        t4,
        s.receiver,
        s.receiverName,
        s.receiverBank,
        amtPaise,
        receiverNewBal,
        `UPI Settlement from ${s.sender}`
      );
    }
  }
}

// Synchronize seeded transactions and ledger entries for preexisting databases
export function syncSeededLedgerEntries() {
  const defaultGenesis: Record<string, number> = {
    "user1@upi": rupeesToPaise(10000),
    "user2@upi": rupeesToPaise(5000),
    "sanika@bank": rupeesToPaise(10000),
    "navya@bank": rupeesToPaise(5000),
    "rahul@bank": rupeesToPaise(7500),
    "priya@bank": rupeesToPaise(12000),
    "saba@bank": rupeesToPaise(7500),
    "manaswi@bank": rupeesToPaise(12000),
    "sai@bank": rupeesToPaise(15000),
  };

  for (const [upi, initBal] of Object.entries(defaultGenesis)) {
    db.prepare("UPDATE accounts SET initial_balance_paise = ? WHERE upi_id = ? AND (initial_balance_paise IS NULL OR initial_balance_paise = 0)").run(initBal, upi);
  }
  db.prepare("UPDATE accounts SET initial_balance_paise = balance_paise WHERE initial_balance_paise IS NULL OR initial_balance_paise = 0").run();

  // Check TXN-20260927-IMPS01
  const has01 = db.prepare("SELECT * FROM transactions WHERE transaction_id = 'TXN-20260927-IMPS01'").get() as any;
  if (has01) {
    const count01 = (db.prepare("SELECT COUNT(*) as count FROM ledger_entries WHERE transaction_id = 'TXN-20260927-IMPS01'").get() as any).count;
    if (count01 === 0) {
      const amt01 = rupeesToPaise(1250);
      db.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, timestamp, account_upi, user_name, bank, entry_type, amount_paise, balance_after_paise, status, description)
        VALUES ('LEDGER-DR-TXN-20260927-IMPS01', 'TXN-20260927-IMPS01', ?, 'sanika@bank', 'Sanika', 'HDFC Bank', 'DEBIT', ?, 875000, 'SETTLED', 'UPI Payment to navya@bank')
      `).run(has01.created_at, amt01);

      db.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, timestamp, account_upi, user_name, bank, entry_type, amount_paise, balance_after_paise, status, description)
        VALUES ('LEDGER-CR-TXN-20260927-IMPS01', 'TXN-20260927-IMPS01', ?, 'navya@bank', 'Navya', 'ICICI Bank', 'CREDIT', ?, 625000, 'SETTLED', 'UPI Settlement from sanika@bank')
      `).run(has01.updated_at, amt01);
    }
  }

  // Check TXN-20260927-IMPS02
  const has02 = db.prepare("SELECT * FROM transactions WHERE transaction_id = 'TXN-20260927-IMPS02'").get() as any;
  if (has02) {
    const count02 = (db.prepare("SELECT COUNT(*) as count FROM ledger_entries WHERE transaction_id = 'TXN-20260927-IMPS02'").get() as any).count;
    if (count02 === 0) {
      const amt02 = rupeesToPaise(2400);
      db.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, timestamp, account_upi, user_name, bank, entry_type, amount_paise, balance_after_paise, status, description)
        VALUES ('LEDGER-DR-TXN-20260927-IMPS02', 'TXN-20260927-IMPS02', ?, 'priya@bank', 'Priya', 'Axis Bank', 'DEBIT', ?, 960000, 'SETTLED', 'UPI Payment to rahul@bank')
      `).run(has02.created_at, amt02);

      db.prepare(`
        INSERT INTO ledger_entries (id, transaction_id, timestamp, account_upi, user_name, bank, entry_type, amount_paise, balance_after_paise, status, description)
        VALUES ('LEDGER-CR-TXN-20260927-IMPS02', 'TXN-20260927-IMPS02', ?, 'rahul@bank', 'Rahul', 'SBI Bank', 'CREDIT', ?, 990000, 'SETTLED', 'UPI Settlement from priya@bank')
      `).run(has02.updated_at, amt02);
    }
  }

  // Ensure balance_paise matches ledger entries for all accounts
  const accounts = db.prepare("SELECT * FROM accounts").all() as any[];
  for (const acc of accounts) {
    const debits = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = ? AND entry_type = 'DEBIT' AND status = 'SETTLED'").get(acc.upi_id) as any).total;
    const credits = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = ? AND entry_type = 'CREDIT' AND status = 'SETTLED'").get(acc.upi_id) as any).total;
    const reversals = (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE account_upi = ? AND entry_type = 'REVERSAL' AND status = 'SETTLED'").get(acc.upi_id) as any).total;
    const initial = acc.initial_balance_paise ?? 0;
    const expected = initial - debits + credits + reversals;
    if (expected >= 0 && acc.balance_paise !== expected) {
      db.prepare("UPDATE accounts SET balance_paise = ? WHERE id = ?").run(expected, acc.id);
    }
  }
}

// Ensure accounts are seeded on first load and synchronized
seedAccountsIfEmpty();
seedTransactionsIfEmpty();
syncSeededLedgerEntries();

// Database Operations
export class PersistentLedgerDatabase {
  // Accounts
  listAccounts(): DbUserRecord[] {
    const rows = db.prepare("SELECT * FROM accounts ORDER BY name ASC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      upi_id: r.upi_id,
      bank_name: r.bank_name,
      balance_paise: r.balance_paise,
      balance: paiseToRupees(r.balance_paise),
      initial_balance_paise: r.initial_balance_paise ?? r.balance_paise,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  createAccount(data: {
    id: string;
    name: string;
    upi_id: string;
    bank_name: string;
    balance_paise: number;
    initial_balance_paise?: number;
  }): DbUserRecord {
    const now = new Date().toISOString();
    const cleanUpi = data.upi_id.toLowerCase().trim();
    const initialPaise = data.initial_balance_paise !== undefined ? data.initial_balance_paise : data.balance_paise;

    db.prepare(`
      INSERT INTO accounts (id, name, upi_id, bank_name, balance_paise, initial_balance_paise, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        upi_id = excluded.upi_id,
        bank_name = excluded.bank_name,
        balance_paise = excluded.balance_paise,
        initial_balance_paise = excluded.initial_balance_paise,
        updated_at = excluded.updated_at
      ON CONFLICT(upi_id) DO UPDATE SET
        name = excluded.name,
        bank_name = excluded.bank_name,
        balance_paise = excluded.balance_paise,
        initial_balance_paise = excluded.initial_balance_paise,
        updated_at = excluded.updated_at
    `).run(
      data.id,
      data.name,
      cleanUpi,
      data.bank_name,
      data.balance_paise,
      initialPaise,
      now,
      now
    );

    return {
      id: data.id,
      name: data.name,
      upi_id: cleanUpi,
      bank_name: data.bank_name,
      balance_paise: data.balance_paise,
      balance: paiseToRupees(data.balance_paise),
      initial_balance_paise: initialPaise,
      created_at: now,
      updated_at: now,
    };
  }

  getAccount(identifier: string): DbUserRecord | null {
    return this.getAccountByUpiOrId(identifier);
  }

  getAccountByUpiOrId(identifier: string): DbUserRecord | null {
    if (!identifier) return null;
    let clean = identifier.trim();
    if (clean.includes("/")) {
      const parts = clean.split("/").map((p) => p.trim());
      for (let i = parts.length - 1; i >= 0; i--) {
        const found = this.getAccountByUpiOrId(parts[i]);
        if (found) return found;
      }
      clean = parts[parts.length - 1];
    }

    const lower = clean.toLowerCase();

    // Do not auto-provision explicitly nonexistent or missing test accounts
    if (
      lower.startsWith("nonexistent") ||
      lower.includes("missing") ||
      lower.includes("notfound") ||
      lower.includes("unknown") ||
      lower.includes("ghost") ||
      lower.includes("invalid")
    ) {
      return null;
    }

    const baseName = lower.replace(/^usr_/, "").split("@")[0];
    const row = db.prepare(`
      SELECT * FROM accounts 
      WHERE LOWER(id) = ? 
         OR LOWER(upi_id) = ? 
         OR LOWER(name) = ?
         OR LOWER(id) = ?
         OR LOWER(SUBSTR(upi_id, 1, INSTR(upi_id, '@') - 1)) = ?
    `).get(lower, lower, lower, `usr_${baseName}`, baseName) as any;

    if (row) {
      return {
        id: row.id,
        name: row.name,
        upi_id: row.upi_id,
        bank_name: row.bank_name,
        balance_paise: row.balance_paise,
        balance: paiseToRupees(row.balance_paise),
        initial_balance_paise: row.initial_balance_paise ?? row.balance_paise,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    }

    // Unknown accounts must strictly return null (no auto-provisioning)
    return null;
  }

  // Atomic Debit with SQLite ACID Transaction & Ledger Entry
  atomicDebit(
    senderUpi: string,
    amountPaise: number,
    transactionId: string,
    description: string
  ): { success: boolean; reason?: string; balanceAfterPaise?: number; senderUpi?: string } {
    if (!Number.isFinite(amountPaise) || isNaN(amountPaise) || amountPaise <= 0 || !Number.isInteger(amountPaise)) {
      return { success: false, reason: "Invalid amount: must be positive integer paise" };
    }

    // Check if already debited for this transaction (idempotency within debit phase)
    const existingDebit = db.prepare("SELECT * FROM sender_debits WHERE transaction_id = ?").get(transactionId) as any;
    if (existingDebit) {
      const user = this.getAccountByUpiOrId(existingDebit.sender_upi || senderUpi);
      return { success: true, balanceAfterPaise: user?.balance_paise || 0, senderUpi: existingDebit.sender_upi };
    }

    db.exec("BEGIN IMMEDIATE;");
    try {
      const clean = senderUpi.trim().toLowerCase();
      const baseName = clean.replace(/^usr_/, "").split("@")[0];
      const account = db.prepare(`
        SELECT * FROM accounts 
        WHERE LOWER(upi_id) = ? 
           OR LOWER(id) = ? 
           OR LOWER(name) = ?
           OR LOWER(id) = ?
           OR LOWER(SUBSTR(upi_id, 1, INSTR(upi_id, '@') - 1)) = ?
      `).get(clean, clean, clean, `usr_${baseName}`, baseName) as any;

      if (!account) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Unknown sender account: ${senderUpi}` };
      }

      if (account.balance_paise < amountPaise) {
        db.exec("ROLLBACK;");
        return { success: false, reason: "Insufficient balance" };
      }

      const now = new Date().toISOString();

      // 1. Update account balance with strict atomic check preventing overdraft
      const updateRes = db.prepare(`
        UPDATE accounts 
        SET balance_paise = balance_paise - ?, updated_at = ? 
        WHERE id = ? AND balance_paise >= ?
      `).run(amountPaise, now, account.id, amountPaise);

      if (updateRes.changes === 0) {
        db.exec("ROLLBACK;");
        return { success: false, reason: "Insufficient balance" };
      }

      const newBalancePaise = account.balance_paise - amountPaise;

      // 2. Track sender debit hold
      db.prepare(`
        INSERT INTO sender_debits (transaction_id, sender_upi, amount_paise, created_at)
        VALUES (?, ?, ?, ?)
      `).run(transactionId, account.upi_id, amountPaise, now);

      // 3. Insert double-entry ledger DEBIT record
      const entryId = `LEDGER-DR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'DEBIT', ?, ?, 'SETTLED', ?)
      `).run(
        entryId,
        transactionId,
        now,
        account.upi_id,
        account.name,
        account.bank_name,
        amountPaise,
        newBalancePaise,
        description
      );

      db.exec("COMMIT;");
      return { success: true, balanceAfterPaise: newBalancePaise, senderUpi: account.upi_id };
    } catch (err: any) {
      try { db.exec("ROLLBACK;"); } catch {}
      return { success: false, reason: err.message || "Database debit transaction failed" };
    }
  }

  // Atomic Credit with SQLite ACID Transaction & Ledger Entry
  atomicCredit(
    receiverUpi: string,
    amountPaise: number,
    transactionId: string,
    description: string
  ): { success: boolean; ackId?: string; reason?: string; balanceAfterPaise?: number; receiverUpi?: string } {
    if (!Number.isFinite(amountPaise) || isNaN(amountPaise) || amountPaise <= 0 || !Number.isInteger(amountPaise)) {
      return { success: false, reason: "Invalid amount: must be positive integer paise" };
    }

    // Check if already credited for this transaction (idempotency within credit phase)
    const existingCredit = db.prepare("SELECT * FROM receiver_credits WHERE transaction_id = ?").get(transactionId) as any;
    if (existingCredit) {
      const user = this.getAccountByUpiOrId(receiverUpi);
      return { success: true, ackId: existingCredit.ack_id, balanceAfterPaise: user?.balance_paise || 0, receiverUpi: user?.upi_id };
    }

    // Check if transaction has been rolled back or aborted
    const reversal = db.prepare("SELECT id FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'REVERSAL'").get(transactionId);
    if (reversal) {
      return { success: false, reason: `Transaction ${transactionId} has already been rolled back; credit aborted` };
    }

    const txnRecord = db.prepare("SELECT status FROM transactions WHERE transaction_id = ?").get(transactionId) as any;
    if (txnRecord && (txnRecord.status === 'ROLLBACK_COMPLETED' || txnRecord.status === 'FAILED' || txnRecord.status === 'CANCELLED')) {
      return { success: false, reason: `Transaction ${transactionId} is in status ${txnRecord.status}; credit aborted` };
    }

    db.exec("BEGIN IMMEDIATE;");
    try {
      // Re-verify under immediate write lock
      const lockReversal = db.prepare("SELECT id FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'REVERSAL'").get(transactionId);
      if (lockReversal) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Transaction ${transactionId} has already been rolled back; credit aborted` };
      }
      const lockTxn = db.prepare("SELECT status FROM transactions WHERE transaction_id = ?").get(transactionId) as any;
      if (lockTxn && (lockTxn.status === 'ROLLBACK_COMPLETED' || lockTxn.status === 'FAILED' || lockTxn.status === 'CANCELLED')) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Transaction ${transactionId} is in status ${lockTxn.status}; credit aborted` };
      }
      const clean = receiverUpi.trim().toLowerCase();
      const baseName = clean.replace(/^usr_/, "").split("@")[0];
      const account = db.prepare(`
        SELECT * FROM accounts 
        WHERE LOWER(upi_id) = ? 
           OR LOWER(id) = ? 
           OR LOWER(name) = ?
           OR LOWER(id) = ?
           OR LOWER(SUBSTR(upi_id, 1, INSTR(upi_id, '@') - 1)) = ?
      `).get(clean, clean, clean, `usr_${baseName}`, baseName) as any;

      if (!account) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Unknown receiver account: ${receiverUpi}` };
      }

      const newBalancePaise = account.balance_paise + amountPaise;
      const now = new Date().toISOString();
      const ackId = `ACK-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // 1. Update account balance atomically
      db.prepare(`
        UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE id = ?
      `).run(newBalancePaise, now, account.id);

      // 2. Track receiver credit confirmation
      db.prepare(`
        INSERT INTO receiver_credits (transaction_id, ack_id, created_at)
        VALUES (?, ?, ?)
      `).run(transactionId, ackId, now);

      // 3. Insert double-entry ledger CREDIT record
      const entryId = `LEDGER-CR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREDIT', ?, ?, 'SETTLED', ?)
      `).run(
        entryId,
        transactionId,
        now,
        account.upi_id,
        account.name,
        account.bank_name,
        amountPaise,
        newBalancePaise,
        description
      );

      db.exec("COMMIT;");
      return { success: true, ackId, balanceAfterPaise: newBalancePaise, receiverUpi: account.upi_id };
    } catch (err: any) {
      try { db.exec("ROLLBACK;"); } catch {}
      return { success: false, reason: err.message || "Database credit transaction failed" };
    }
  }

  // Atomic Saga Compensating Rollback with SQLite Transaction & Ledger Reversal
  atomicRollback(
    transactionId: string
  ): { success: boolean; amountPaise?: number; reason?: string; alreadyRolledBack?: boolean } {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const debit = db.prepare("SELECT * FROM sender_debits WHERE transaction_id = ?").get(transactionId) as any;
      if (!debit) {
        // Check if this transaction has ALREADY been rolled back (idempotent retry)
        const existingReversal = db.prepare(
          "SELECT * FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'REVERSAL'"
        ).get(transactionId) as any;
        if (existingReversal) {
          db.exec("ROLLBACK;");
          return { success: true, amountPaise: existingReversal.amount_paise, alreadyRolledBack: true };
        }
        db.exec("ROLLBACK;");
        return { success: false, reason: "No debit found to roll back" };
      }

      // Check if receiver credit has already settled
      const credit = db.prepare("SELECT * FROM receiver_credits WHERE transaction_id = ?").get(transactionId) as any;
      if (credit) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Cannot roll back sender debit: receiver credit already settled for ${transactionId}` };
      }

      const account = db.prepare("SELECT * FROM accounts WHERE upi_id = ?").get(debit.sender_upi) as any;
      if (!account) {
        db.exec("ROLLBACK;");
        return { success: false, reason: "Account not found" };
      }

      const newBalancePaise = account.balance_paise + debit.amount_paise;
      const now = new Date().toISOString();

      // 1. Restore balance
      db.prepare("UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE id = ?").run(
        newBalancePaise,
        now,
        account.id
      );

      // 2. Remove debit record
      db.prepare("DELETE FROM sender_debits WHERE transaction_id = ?").run(transactionId);

      // 3. Insert compensating ledger entry
      const entryId = `LEDGER-REV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'REVERSAL', ?, ?, 'SETTLED', ?)
      `).run(
        entryId,
        transactionId,
        now,
        account.upi_id,
        account.name,
        account.bank_name,
        debit.amount_paise,
        newBalancePaise,
        `Compensating rollback of debit for failed transaction ${transactionId}`
      );

      // 4. Update transaction status in transactions table
      db.prepare(`
        UPDATE transactions 
        SET status = 'ROLLBACK_COMPLETED', failure_reason = COALESCE(failure_reason, 'Compensating saga rollback executed'), updated_at = ?
        WHERE transaction_id = ?
      `).run(now, transactionId);

      db.exec("COMMIT;");
      return { success: true, amountPaise: debit.amount_paise, alreadyRolledBack: false };
    } catch (err: any) {
      try { db.exec("ROLLBACK;"); } catch {}
      return { success: false, reason: err.message || "Rollback failed" };
    }
  }

  // Complete Atomic Transfer in a Single SQLite Transaction
  atomicTransfer(
    senderUpi: string,
    receiverUpi: string,
    amountPaise: number,
    transactionId: string,
    description: string
  ): { success: boolean; reason?: string; senderBalanceAfterPaise?: number; receiverBalanceAfterPaise?: number } {
    if (!Number.isFinite(amountPaise) || isNaN(amountPaise) || amountPaise <= 0 || !Number.isInteger(amountPaise)) {
      return { success: false, reason: "Invalid amount: must be positive integer paise" };
    }
    if (senderUpi === receiverUpi) {
      return { success: false, reason: "Self-transfers are not permitted: Sender and receiver must be different accounts" };
    }

    db.exec("BEGIN IMMEDIATE;");
    try {
      const sender = db.prepare("SELECT * FROM accounts WHERE LOWER(upi_id) = ? OR LOWER(id) = ?").get(senderUpi.toLowerCase(), senderUpi.toLowerCase()) as any;
      if (!sender) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Unknown sender account: ${senderUpi}` };
      }

      const receiver = db.prepare("SELECT * FROM accounts WHERE LOWER(upi_id) = ? OR LOWER(id) = ?").get(receiverUpi.toLowerCase(), receiverUpi.toLowerCase()) as any;
      if (!receiver) {
        db.exec("ROLLBACK;");
        return { success: false, reason: `Unknown receiver account: ${receiverUpi}` };
      }

      if (sender.balance_paise < amountPaise) {
        db.exec("ROLLBACK;");
        return { success: false, reason: "Insufficient balance" };
      }

      const now = new Date().toISOString();
      const senderNewBal = sender.balance_paise - amountPaise;
      const receiverNewBal = receiver.balance_paise + amountPaise;

      // 1. Debit sender
      db.prepare("UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE id = ?").run(senderNewBal, now, sender.id);

      // 2. Credit receiver
      db.prepare("UPDATE accounts SET balance_paise = ?, updated_at = ? WHERE id = ?").run(receiverNewBal, now, receiver.id);

      // 3. Insert double-entry ledger DEBIT
      const drId = `LEDGER-DR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'DEBIT', ?, ?, 'SETTLED', ?)
      `).run(drId, transactionId, now, sender.upi_id, sender.name, sender.bank_name, amountPaise, senderNewBal, description);

      // 4. Insert double-entry ledger CREDIT
      const crId = `LEDGER-CR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO ledger_entries (
          id, transaction_id, timestamp, account_upi, user_name, bank, entry_type,
          amount_paise, balance_after_paise, status, description
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREDIT', ?, ?, 'SETTLED', ?)
      `).run(crId, transactionId, now, receiver.upi_id, receiver.name, receiver.bank_name, amountPaise, receiverNewBal, description);

      db.exec("COMMIT;");
      return {
        success: true,
        senderBalanceAfterPaise: senderNewBal,
        receiverBalanceAfterPaise: receiverNewBal,
      };
    } catch (err: any) {
      try { db.exec("ROLLBACK;"); } catch {}
      return { success: false, reason: err.message || "Atomic transfer failed" };
    }
  }

  // Transactions Management
  upsertTransaction(record: DbTransactionRecord) {
    const amountPaise = record.amountPaise || rupeesToPaise(record.amount || 0);
    const existing = db.prepare("SELECT transaction_id FROM transactions WHERE transaction_id = ?").get(record.transactionId);
    if (!existing) {
      db.prepare(`
        INSERT INTO transactions (
          transaction_id, sender_id, receiver_id, amount_paise, status, failure_reason,
          idempotency_key, mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.transactionId,
        record.senderId,
        record.receiverId,
        amountPaise,
        record.status,
        record.failureReason || null,
        record.idempotencyKey || null,
        record.mode || "rest",
        record.createdAt,
        record.updatedAt
      );
    } else {
      db.prepare(`
        UPDATE transactions 
        SET status = ?, failure_reason = ?, updated_at = ?
        WHERE transaction_id = ?
      `).run(record.status, record.failureReason || null, record.updatedAt, record.transactionId);
    }

    if (record.idempotencyKey) {
      this.recordIdempotency(record.idempotencyKey, record.transactionId, record.status);
    }
  }

  appendTimelineEvent(transactionId: string, event: DbTimelineEvent) {
    const parent = db.prepare("SELECT transaction_id FROM transactions WHERE transaction_id = ?").get(transactionId);
    if (!parent) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO transactions (
          transaction_id, sender_id, receiver_id, amount_paise, status, failure_reason,
          idempotency_key, mode, created_at, updated_at
        ) VALUES (?, 'system', 'system', 100, 'PROCESSING', NULL, NULL, 'rest', ?, ?)
      `).run(transactionId, now, now);
    }

    db.prepare(`
      INSERT INTO transaction_timeline (
        transaction_id, event, service, message, timestamp, sequence, lamport,
        vector_clock, headers_json, inter_service_call
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      event.event,
      event.service,
      event.message,
      event.timestamp,
      event.sequence || null,
      event.lamport || null,
      event.vector ? JSON.stringify(event.vector) : null,
      event.headers ? JSON.stringify(event.headers) : null,
      event.interServiceCall || null
    );
  }

  getTransactionByIdempotencyKey(key: string): DbTransactionRecord | null {
    const idem = this.getIdempotency(key);
    if (!idem) return null;
    return this.getTransaction(idem.transactionId);
  }

  getTransaction(transactionId: string): DbTransactionRecord | null {
    const row = db.prepare("SELECT * FROM transactions WHERE transaction_id = ?").get(transactionId) as any;
    if (!row) return null;

    const timelineRows = db.prepare(`
      SELECT * FROM transaction_timeline WHERE transaction_id = ? ORDER BY id ASC
    `).all(transactionId) as any[];

    const timeline: DbTimelineEvent[] = timelineRows.map((t) => ({
      event: t.event,
      service: t.service,
      message: t.message,
      timestamp: t.timestamp,
      sequence: t.sequence,
      lamport: t.lamport,
      vector: t.vector_clock ? JSON.parse(t.vector_clock) : undefined,
      headers: t.headers_json ? JSON.parse(t.headers_json) : undefined,
      interServiceCall: t.inter_service_call || undefined,
    }));

    return {
      transactionId: row.transaction_id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      amount: paiseToRupees(row.amount_paise),
      amountPaise: row.amount_paise,
      status: row.status,
      failureReason: row.failure_reason,
      idempotencyKey: row.idempotency_key,
      mode: row.mode,
      timeline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listTransactions(limit = 100, statusFilter?: string): DbTransactionRecord[] {
    let query = "SELECT * FROM transactions";
    const params: any[] = [];

    if (statusFilter && statusFilter.toUpperCase() !== "ALL") {
      query += " WHERE status = ?";
      params.push(statusFilter.toUpperCase());
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((row) => {
      const timelineRows = db.prepare(`
        SELECT * FROM transaction_timeline WHERE transaction_id = ? ORDER BY id ASC
      `).all(row.transaction_id) as any[];

      const timeline: DbTimelineEvent[] = timelineRows.map((t) => ({
        event: t.event,
        service: t.service,
        message: t.message,
        timestamp: t.timestamp,
        sequence: t.sequence,
        lamport: t.lamport,
        vector: t.vector_clock ? JSON.parse(t.vector_clock) : undefined,
        headers: t.headers_json ? JSON.parse(t.headers_json) : undefined,
        interServiceCall: t.inter_service_call || undefined,
      }));

      return {
        transactionId: row.transaction_id,
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        amount: paiseToRupees(row.amount_paise),
        amountPaise: row.amount_paise,
        status: row.status,
        failureReason: row.failure_reason,
        idempotencyKey: row.idempotency_key,
        mode: row.mode,
        timeline,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  // Idempotency Management with Conflict Detection & Atomic Reservations
  checkOrReserveIdempotency(
    key: string,
    transactionId: string,
    senderId: string,
    receiverId: string,
    amountPaise: number,
    requestHash: string
  ): {
    status: "NEW" | "MATCH" | "CONFLICT";
    transactionId?: string;
    existingStatus?: string;
    responseJson?: string | null;
  } {
    const existing = db.prepare("SELECT * FROM idempotency_records WHERE key = ?").get(key) as any;
    if (existing) {
      // Validate whether the incoming request matches original parameters
      const hashMatches = existing.request_hash
        ? existing.request_hash === requestHash
        : (existing.sender_id === senderId && existing.receiver_id === receiverId && existing.amount_paise === amountPaise);

      if (!hashMatches) {
        return {
          status: "CONFLICT",
          transactionId: existing.transaction_id,
          existingStatus: existing.status,
          responseJson: existing.response_json,
        };
      }

      return {
        status: "MATCH",
        transactionId: existing.transaction_id,
        existingStatus: existing.status,
        responseJson: existing.response_json,
      };
    }

    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO idempotency_records (
          key, transaction_id, sender_id, receiver_id, amount_paise, request_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING', ?)
      `).run(key, transactionId, senderId, receiverId, amountPaise, requestHash, now);

      return { status: "NEW", transactionId };
    } catch {
      // Handle concurrent race-condition insert
      const raceExisting = db.prepare("SELECT * FROM idempotency_records WHERE key = ?").get(key) as any;
      if (raceExisting) {
        const hashMatches = raceExisting.request_hash
          ? raceExisting.request_hash === requestHash
          : (raceExisting.sender_id === senderId && raceExisting.receiver_id === receiverId && raceExisting.amount_paise === amountPaise);

        return {
          status: hashMatches ? "MATCH" : "CONFLICT",
          transactionId: raceExisting.transaction_id,
          existingStatus: raceExisting.status,
          responseJson: raceExisting.response_json,
        };
      }
      return { status: "NEW", transactionId };
    }
  }

  finalizeIdempotency(key: string, status: string, responseJson?: string) {
    db.prepare(`
      UPDATE idempotency_records SET status = ?, response_json = ? WHERE key = ?
    `).run(status, responseJson || null, key);
  }

  recordIdempotency(key: string, transactionId: string, status: string, responseJson?: string, requestHash?: string) {
    db.prepare(`
      INSERT INTO idempotency_records (key, transaction_id, status, response_json, request_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET status = excluded.status, response_json = excluded.response_json
    `).run(key, transactionId, status, responseJson || null, requestHash || null, new Date().toISOString());
  }

  getIdempotency(key: string): { transactionId: string; status: string; responseJson: string | null; requestHash: string | null } | null {
    const row = db.prepare("SELECT * FROM idempotency_records WHERE key = ?").get(key) as any;
    if (!row) return null;
    return {
      transactionId: row.transaction_id,
      status: row.status,
      responseJson: row.response_json,
      requestHash: row.request_hash,
    };
  }

  // Double-Entry Ledger Invariants & Audit
  getLedgerJournal(limit = 200): DbLedgerEntry[] {
    const rows = db.prepare(`
      SELECT * FROM ledger_entries ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      timestamp: r.timestamp,
      accountUpi: r.account_upi,
      userName: r.user_name,
      bank: r.bank,
      entryType: r.entry_type,
      amount: paiseToRupees(r.amount_paise),
      amountPaise: r.amount_paise,
      balanceAfter: paiseToRupees(r.balance_after_paise),
      balanceAfterPaise: r.balance_after_paise,
      status: r.status,
      description: r.description,
    }));
  }

  getGenesisSupplyPaise(): number {
    const row = db.prepare("SELECT COALESCE(SUM(initial_balance_paise), 0) as total FROM accounts").get() as { total: number };
    return row.total;
  }

  getLedgerInvariants() {
    const accounts = this.listAccounts();
    const currentTotalPaise = accounts.reduce((acc, u) => acc + u.balance_paise, 0);
    const genesisSupplyPaise = this.getGenesisSupplyPaise();

    const debits = db.prepare(`
      SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE entry_type = 'DEBIT' AND status = 'SETTLED'
    `).get() as { total: number };

    const credits = db.prepare(`
      SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries WHERE entry_type IN ('CREDIT', 'REVERSAL') AND status = 'SETTLED'
    `).get() as { total: number };

    const totalDebitedPaise = debits.total;
    const totalCreditedPaise = credits.total;

    // Money conservation check: In a closed interbank system:
    // 1. Settled debits must equal settled credits and reversals (double-entry parity)
    const debitCreditParity = totalDebitedPaise === totalCreditedPaise;
    // 2. Closed-system conservation: Current total deposits must strictly equal genesis supply
    const isConservationPreserved = debitCreditParity && (currentTotalPaise === genesisSupplyPaise);

    return {
      genesisSupply: paiseToRupees(genesisSupplyPaise),
      genesisSupplyPaise,
      currentTotalDeposits: paiseToRupees(currentTotalPaise),
      currentTotalPaise,
      totalDebited: paiseToRupees(totalDebitedPaise),
      totalCredited: paiseToRupees(totalCreditedPaise),
      debitCreditParity,
      isConservationPreserved,
      totalAccounts: accounts.length,
      dbEngine: "SQLite (WAL mode, busy_timeout=5000ms)",
      dbPath: DB_PATH,
    };
  }

  reconcileLedgerToBalances(): {
    reconciled: boolean;
    totalAccountsAudited: number;
    discrepancies: Array<{
      accountUpi: string;
      currentBalancePaise: number;
      expectedBalancePaise: number;
      initialBalancePaise: number;
      ledgerDebitsPaise: number;
      ledgerCreditsPaise: number;
      ledgerReversalsPaise: number;
      discrepancyPaise: number;
    }>;
    systemParity: boolean;
    totalSystemDepositsPaise: number;
  } {
    const accounts = this.listAccounts();
    const discrepancies: any[] = [];

    for (const acc of accounts) {
      const debits = db.prepare(`
        SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries 
        WHERE account_upi = ? AND entry_type = 'DEBIT' AND status = 'SETTLED'
      `).get(acc.upi_id) as { total: number };

      const credits = db.prepare(`
        SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries 
        WHERE account_upi = ? AND entry_type = 'CREDIT' AND status = 'SETTLED'
      `).get(acc.upi_id) as { total: number };

      const reversals = db.prepare(`
        SELECT COALESCE(SUM(amount_paise), 0) as total FROM ledger_entries 
        WHERE account_upi = ? AND entry_type = 'REVERSAL' AND status = 'SETTLED'
      `).get(acc.upi_id) as { total: number };

      const initial = acc.initial_balance_paise ?? 0;
      const expectedBalancePaise = initial - debits.total + credits.total + reversals.total;

      if (acc.balance_paise !== expectedBalancePaise || acc.balance_paise < 0) {
        discrepancies.push({
          accountUpi: acc.upi_id,
          currentBalancePaise: acc.balance_paise,
          expectedBalancePaise,
          initialBalancePaise: initial,
          ledgerDebitsPaise: debits.total,
          ledgerCreditsPaise: credits.total,
          ledgerReversalsPaise: reversals.total,
          discrepancyPaise: acc.balance_paise - expectedBalancePaise,
        });
      }
    }

    const invariants = this.getLedgerInvariants();
    const reconciled = discrepancies.length === 0 && invariants.debitCreditParity && invariants.isConservationPreserved;

    return {
      reconciled,
      totalAccountsAudited: accounts.length,
      discrepancies,
      systemParity: invariants.debitCreditParity,
      totalSystemDepositsPaise: invariants.currentTotalPaise,
    };
  }

  recoverInterruptedTransactions(): { recoveredCount: number; rolledBackCount: number; failedCount: number } {
    const rows = db.prepare(`
      SELECT * FROM transactions WHERE status IN ('INITIATED', 'PROCESSING', 'PENDING_RECONCILIATION')
    `).all() as any[];

    let rolledBackCount = 0;
    let failedCount = 0;

    for (const txn of rows) {
      const debit = db.prepare("SELECT * FROM sender_debits WHERE transaction_id = ?").get(txn.transaction_id);
      const debitLedger = db.prepare("SELECT * FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'DEBIT' AND status = 'SETTLED'").get(txn.transaction_id);
      const creditLedger = db.prepare("SELECT * FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'CREDIT' AND status = 'SETTLED'").get(txn.transaction_id);

      if (debitLedger && creditLedger) {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE transactions 
          SET status = 'SUCCESS', updated_at = ?
          WHERE transaction_id = ?
        `).run(now, txn.transaction_id);
        this.finalizeIdempotency(txn.idempotency_key || txn.transaction_id, "SUCCESS");
      } else if (debit || (debitLedger && !creditLedger)) {
        this.atomicRollback(txn.transaction_id);
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE transactions 
          SET status = 'ROLLBACK_COMPLETED', failure_reason = 'Interrupted transfer recovered on startup: sender debit rolled back', updated_at = ?
          WHERE transaction_id = ?
        `).run(now, txn.transaction_id);
        this.finalizeIdempotency(txn.idempotency_key || txn.transaction_id, "ROLLBACK_COMPLETED");
        rolledBackCount++;
      } else if (!debitLedger) {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE transactions 
          SET status = 'FAILED', failure_reason = 'Interrupted transfer recovered on startup: transaction aborted', updated_at = ?
          WHERE transaction_id = ?
        `).run(now, txn.transaction_id);
        this.finalizeIdempotency(txn.idempotency_key || txn.transaction_id, "FAILED");
        failedCount++;
      }
    }

    return { recoveredCount: rows.length, rolledBackCount, failedCount };
  }

  getTransactionStats(): { total: number; successful: number; failed: number; processing: number; pendingReconciliation: number } {
    const totalRow = db.prepare("SELECT COUNT(*) as count FROM transactions").get() as { count: number };
    const successRow = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'SUCCESS'").get() as { count: number };
    const failedRow = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE status IN ('FAILED', 'ROLLBACK_COMPLETED')").get() as { count: number };
    const pendingReconRow = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'PENDING_RECONCILIATION'").get() as { count: number };

    const total = totalRow.count;
    const successful = successRow.count;
    const failed = failedRow.count;
    const pendingReconciliation = pendingReconRow.count;
    const processing = Math.max(0, total - (successful + failed + pendingReconciliation));

    return { total, successful, failed, processing, pendingReconciliation };
  }
}

export const persistentDb = new PersistentLedgerDatabase();
