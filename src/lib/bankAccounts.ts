export interface BankAccountDetails {
  id: string;
  label: string;
  bankName: string;
  sortCode?: string;
  accountNumber?: string;
  swiftCode?: string;
  iban?: string;
}

export const BANK_ACCOUNTS: Record<string, BankAccountDetails> = {
  revolut_business: {
    id: "revolut_business",
    label: "Revolut Business",
    bankName: "Revolut",
    sortCode: "04-00-75",
    accountNumber: "75 91 35 42",
    swiftCode: "REVOGB21",
    iban: "GB91 REVO 0099 6974 0692 71",
  },
};

export const DEFAULT_BANK_ACCOUNT_ID = "revolut_business";

export function getBankAccount(id?: string | null): BankAccountDetails {
  return BANK_ACCOUNTS[id || DEFAULT_BANK_ACCOUNT_ID] || BANK_ACCOUNTS[DEFAULT_BANK_ACCOUNT_ID];
}
