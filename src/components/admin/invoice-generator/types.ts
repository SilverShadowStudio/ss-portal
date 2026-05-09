export interface InvoiceItem {
  id: string;
  category: string;
  description: string;
  price: number;
}

export interface BankDetails {
  bankName: string;
  sortCode: string;
  accountNumber: string;
  swiftCode: string;
  iban: string;
}

export interface ClientDetails {
  name: string;
  address: string;
  contact: string;
  project: string;
  invoiceNumber: string;
}

export interface InvoiceData {
  client: ClientDetails;
  bank: BankDetails;
  items: InvoiceItem[];
  vatRate: number;
  downpaymentRate: number;
  invoiceDate: string;
  netDays: number;
}

export const initialInvoiceData: InvoiceData = {
  client: { name: "", address: "", contact: "", project: "", invoiceNumber: "" },
  bank: { bankName: "", sortCode: "", accountNumber: "", swiftCode: "", iban: "" },
  items: [],
  vatRate: 20,
  downpaymentRate: 40,
  invoiceDate: new Date().toISOString().split("T")[0],
  netDays: 30,
};
