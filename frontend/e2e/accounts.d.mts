/** Kiểu của `accounts.mjs`. */
export interface Account {
  email: string;
  displayName: string;
  password: string;
  role: "submitter" | "admin";
}

export function createAccount(role?: "submitter" | "admin"): Account;
export function removeAccount(email: string): void;
