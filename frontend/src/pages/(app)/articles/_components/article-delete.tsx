"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { authenticatedFetch } from "@/hooks/use-fetch";
import { queryKeys } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Article } from "@/types";

export function ArticleDeleteDialog({
  article,
  onOpenChange,
}: {
  article?: Article | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const open = !!article;

  const handleDelete = async () => {
    if (!article) return;
    setLoading(true);
    try {
      const res = await authenticatedFetch(`${import.meta.env.VITE_BACKEND_URL || ""}/api/articles/${article.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.list() });
      toast.success(t("articles.upsert.messages.deleteSuccess") || "Article deleted");
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("articles.upsert.messages.deleteError") || "Failed to delete article");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {article?.name ? `${t("articles.actions.delete") || "Delete"} ${article.name}` : t("articles.actions.delete") || "Delete article"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("articles.delete.description", { name: article?.name }) || `Are you sure you want to delete "${article?.name}"? This action cannot be undone.`}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {t("articles.actions.cancel") || "Cancel"}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? t("articles.actions.deleting") || "Deleting..." : t("articles.actions.delete") || "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ArticleDeleteDialog
