import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

interface BetterPaginationProps {
  pageCount: number;
  page: number;
  setPage: (page: number) => void;
}

export default function BetterPagination({ pageCount, page, setPage }: BetterPaginationProps) {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
          />
        </PaginationItem>

        {pageCount &&
          (() => {
            const items = [];
            const total = pageCount;
            const current = page;

            const pushPage = (i: number) => {
              items.push(
                <PaginationItem key={i}>
                  <PaginationLink href="#" onClick={() => setPage(i)} isActive={i === current}>
                    {i}
                  </PaginationLink>
                </PaginationItem>,
              );
            };

            if (total <= 5) {
              for (let i = 1; i <= total; i++) pushPage(i);
            } else if (current <= 3) {
              for (let i = 1; i <= 4; i++) pushPage(i);
              items.push(
                <PaginationItem key="ellipsis-end">
                  <PaginationEllipsis />
                </PaginationItem>,
              );
              pushPage(total);
            } else if (current >= total - 2) {
              pushPage(1);
              items.push(
                <PaginationItem key="ellipsis-start">
                  <PaginationEllipsis />
                </PaginationItem>,
              );
              for (let i = total - 3; i <= total; i++) pushPage(i);
            } else {
              pushPage(1);
              items.push(
                <PaginationItem key="ellipsis-start">
                  <PaginationEllipsis />
                </PaginationItem>,
              );
              pushPage(current - 1);
              pushPage(current);
              pushPage(current + 1);
              items.push(
                <PaginationItem key="ellipsis-end">
                  <PaginationEllipsis />
                </PaginationItem>,
              );
              pushPage(total);
            }

            return items;
          })()}

        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={() => setPage(Math.min(pageCount, page + 1))}
            disabled={page === pageCount}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
