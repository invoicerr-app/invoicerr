import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface YearPickerProps {
  startYear?: number;
  endYear?: number;
  value: number;
  onChange: (year: number) => void;
}

export default function YearPicker({ startYear, endYear, value, onChange }: YearPickerProps) {
  return (
    <Select value={value.toString()} onValueChange={(v: string) => onChange(Number(v))}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from(
          { length: (endYear ?? 2100) - (startYear ?? 2000) + 1 },
          (_, i) => (startYear ?? 2000) + i,
        ).map((year) => (
          <SelectItem key={year} value={year.toString()}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
