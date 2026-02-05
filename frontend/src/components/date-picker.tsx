import { Popover, PopoverContent, PopoverTrigger } from "@radix-ui/react-popover";

import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { CalendarIcon } from "lucide-react";
import { FormControl } from "./ui/form";
import React from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { languageToLocale } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
  showOutsideDays?: boolean;
  'data-cy'?: string;
}

const DatePicker: React.FC<DatePickerProps> = (field: DatePickerProps) => {
  const { i18n } = useTranslation()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FormControl className="w-full">
          <Button
            variant={"outline"}
            className={cn(
              "w-[240px] pl-3 text-left font-normal",
              !field.value && "text-muted-foreground",
              field.className
            )}
            data-cy={field['data-cy']}
          >
            {field.value ? (
              format(field.value, "PPP", {
                locale: languageToLocale(i18n.language)
              })
            ) : (
              <span>{field.placeholder || "Pick a date"}</span>
            )}
            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="z-500 w-full p-0 mt-2 rounded-lg outline-1" align="start">
        <Calendar
          required
          mode="single"
          selected={field.value || undefined}
          onSelect={field.onChange}
          captionLayout="dropdown"
          showOutsideDays={field.showOutsideDays || true}
        />
      </PopoverContent>
    </Popover>
  );
};

export { DatePicker };