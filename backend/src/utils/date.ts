import { format } from 'date-fns';
import type { Company } from '../../prisma/generated/prisma/client';

export const formatDate = (company: Company, date?: Date | null) => {
  if (!date) return 'N/A';

  let dateFormat = company.dateFormat;
  const allowedFormats = [
    'dd/MM/yyyy',
    'MM/dd/yyyy',
    'yyyy/MM/dd',
    'dd.MM.yyyy',
    'dd-MM-yyyy',
    'yyyy-MM-dd',
    'EEEE, dd MMM yyyy',
  ];
  if (!allowedFormats.includes(dateFormat)) {
    dateFormat = 'dd/MM/yyyy'; // Default format if the stored format is invalid
  }
  return format(date, dateFormat);
};
