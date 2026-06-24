"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePatch, usePost } from "@/hooks/use-fetch";
import { queryKeys } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";

import { BetterInput } from "@/components/better-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currencies } from "@/lib/constants/currencies";
import { toast } from "sonner";
import { useCompany } from "@/hooks/queries";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Article } from "@/types";

const articleSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  type: z.enum(["HOUR", "DAY", "DEPOSIT", "SERVICE", "PRODUCT"]),
  unitPrice: z.coerce.number().min(0, { message: "Price must be >= 0" }),
  vatRate: z.coerce.number().min(0, { message: "VAT must be >= 0" }),
});

type ArticleForm = z.infer<typeof articleSchema>;

interface ArticleUpsertProps {
  article?: Article | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArticleUpsert({ article, open, onOpenChange }: ArticleUpsertProps) {
  const { t } = useTranslation();
  const isEdit = !!article;
  const queryClient = useQueryClient();
  const { data: company } = useCompany();
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : undefined;

  const { trigger: createTrigger, loading: creating } = usePost("/api/articles");
  const { trigger: updateTrigger, loading: updating } = usePatch(`/api/articles/${article?.id || ""}`);

  const form = useForm<ArticleForm>({
    resolver: zodResolver(articleSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "SERVICE",
      unitPrice: 0,
      vatRate: 0,
    },
  });

  useEffect(() => {
    if (article) {
      form.reset({
        name: article.name || "",
        description: article.description || "",
        type: article.type || "SERVICE",
        unitPrice: article.unitPrice ?? 0,
        vatRate: article.vatRate ?? 0,
      });
    } else {
      form.reset({ name: "", description: "", type: "SERVICE", unitPrice: 0, vatRate: 0 });
    }
  }, [article, open, form]);

  const onSubmit = async (data: ArticleForm) => {
    try {
      // usePost/usePatch swallow request failures internally and resolve to
      // `null` instead of throwing, so the result must be checked explicitly
      // — awaiting alone does not tell us whether the request succeeded.
      if (isEdit) {
        const result = await updateTrigger({ ...data });
        if (!result) throw new Error("Update failed");
        toast.success(t("articles.upsert.messages.updateSuccess") || "Article updated");
      } else {
        const result = await createTrigger(data);
        if (!result) throw new Error("Create failed");
        toast.success(t("articles.upsert.messages.addSuccess") || "Article added");
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.list() });
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(
        isEdit
          ? t("articles.upsert.messages.updateError") || "Failed to update article"
          : t("articles.upsert.messages.addError") || "Failed to add article"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-2xl" dataCy="article-dialog">
        <DialogHeader>
          <DialogTitle>{t(`articles.upsert.title.${isEdit ? "edit" : "create"}`)}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" data-cy="article-form">
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("articles.fields.name.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("articles.fields.name.placeholder") as string} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("articles.fields.description.label")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("articles.fields.description.placeholder") as string} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField
                name="type"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("articles.fields.type.label")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={(val) => field.onChange(val as any)}>
                        <SelectTrigger className="w-full" size="sm" aria-label={t("articles.fields.type.label") as string} dataCy="article-type-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent dataCy="article-type-content">
                          <SelectItem value="HOUR">{t("articles.fields.type.hour")}</SelectItem>
                          <SelectItem value="DAY">{t("articles.fields.type.day")}</SelectItem>
                          <SelectItem value="DEPOSIT">{t("articles.fields.type.deposit")}</SelectItem>
                          <SelectItem value="SERVICE">{t("articles.fields.type.service")}</SelectItem>
                          <SelectItem value="PRODUCT">{t("articles.fields.type.product")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                name="unitPrice"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("articles.fields.unitPrice.label")}</FormLabel>
                    <FormControl>
                      <BetterInput {...field} type="number" step="0.01" min="0" postAdornment={currencySymbol} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                name="vatRate"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("articles.fields.vatRate.label")}</FormLabel>
                    <FormControl>
                      <BetterInput {...field} type="number" step="0.01" min="0" postAdornment="%" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                {t("articles.actions.cancel") || "Cancel"}
              </Button>
              <Button type="submit" disabled={creating || updating} dataCy="article-submit">
                {isEdit ? t("articles.actions.save") || "Save" : t("articles.actions.add") || "Add"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default ArticleUpsert
