export interface Expense {
  id: string;
  companyId: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
