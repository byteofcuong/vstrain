import type { Locator } from "@playwright/test";

/** Kiểu của `accounts.mjs`. */
export interface Account {
  email: string;
  displayName: string;
  password: string;
  role: "submitter" | "admin";
}

export function createAccount(role?: "submitter" | "admin"): Account;
export function removeAccount(email: string): void;

/** Một genome thật kèm ngày lấy mẫu của nó (YYYY-MM-DD). */
export interface Genome {
  date: string;
  sequence: string;
}

export function genomesOutsideBuild(slug: string, count: number): Genome[];

/** Một file trong bộ nhớ, ở dạng mà `setInputFiles` nhận. */
export type FilePayload = Extract<Parameters<Locator["setInputFiles"]>[0], { name: string }>;
export function fastaFile(name: string, text: string): FilePayload;
export function submissionCounts(): { submissions: number; placements: number };
